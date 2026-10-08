import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import type { Consumer } from 'kafkajs';
import type { EnvironmentVariables } from '../../infrastructure/config/env.validation.js';
import { KAFKA_CLIENT } from '../../infrastructure/messaging/messaging.constants.js';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
import { PAYMENT_REQUESTED_TOPIC, parsePaymentId } from './payment-events.js';
import { PaymentProcessor } from './payment-processor.js';
import { processWithRetry } from './payment-retry.js';
import { ensurePaymentTopics } from './payment-topics.js';
import { PAYMENT_BREAKER } from './payments.constants.js';

/** Extra wait after the breaker's reset timeout so the next try lands in HALF_OPEN, not just before it. */
const PROBE_MARGIN_MS = 100;
/** Well under the consumer group's session timeout (30 s by default), so a long wait is not mistaken for a crash. */
const HEARTBEAT_EVERY_MS = 3000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads `payments.requested`, one message at a time per partition. While the breaker is open the handler
 * simply keeps holding the current message: its offset is not committed and nothing after it is read, so
 * the backlog stays in Kafka (consumer lag grows) and the held message is retried as the probe request.
 * It deliberately does not throw while waiting: every error out of `eachMessage` spends kafkajs's retry
 * budget, and a long outage would eventually crash and restart the consumer.
 */
@Injectable()
export class PaymentRequestedConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentRequestedConsumer.name);
  private consumer?: Consumer;
  private stopped = false;
  /** How many times kafkajs gave up and restarted this consumer; a healthy lab keeps it at 0. */
  crashes = 0;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly processor: PaymentProcessor,
    @Inject(PAYMENT_BREAKER) private readonly breaker: CircuitBreaker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('KAFKA_ENABLED', { infer: true })) return;
    await ensurePaymentTopics(this.kafka);
    this.consumer = this.kafka.consumer({
      groupId: this.config.get('PAYMENTS_GROUP_ID', { infer: true }),
    });
    this.consumer.on(this.consumer.events.CRASH, ({ payload }) => {
      this.crashes += 1;
      this.logger.error(`Consumer crashed: ${String(payload.error)}`);
    });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: PAYMENT_REQUESTED_TOPIC, fromBeginning: true });
    await this.consumer.run({
      partitionsConsumedConcurrently: 1,
      eachMessage: ({ message, heartbeat }) => this.handle(message.value, heartbeat),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await this.consumer?.disconnect();
  }

  private async handle(value: Buffer | null, heartbeat: () => Promise<void>): Promise<void> {
    const paymentId = parsePaymentId(value);
    if (!paymentId) {
      this.logger.warn(`Skipping an unreadable ${PAYMENT_REQUESTED_TOPIC} message`);
      return;
    }
    while (!this.stopped) {
      try {
        await processWithRetry(this.processor, paymentId, {
          maxAttempts: this.config.get('PAYMENT_MAX_ATTEMPTS', { infer: true }),
          retryBaseMs: this.config.get('PAYMENT_RETRY_BASE_MS', { infer: true }),
        });
        return;
      } catch (error) {
        if (!(error instanceof CircuitOpenError)) throw error;
        await this.waitForProbe(heartbeat);
      }
    }
  }

  /** Sleeps until the breaker allows a trial call, sending heartbeats so the group keeps this member. */
  private async waitForProbe(heartbeat: () => Promise<void>): Promise<void> {
    const waitMs = this.breaker.snapshot().retryInMs + PROBE_MARGIN_MS;
    this.logger.warn(`Circuit open: holding the current message for ${waitMs} ms`);
    for (let left = waitMs; left > 0 && !this.stopped; left -= HEARTBEAT_EVERY_MS) {
      await sleep(Math.min(left, HEARTBEAT_EVERY_MS));
      await heartbeat();
    }
  }
}
