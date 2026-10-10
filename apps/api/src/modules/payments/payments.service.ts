import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Span } from '@opentelemetry/api';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/utils/db-errors.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';
import { withSpan } from '../../infrastructure/telemetry/trace-context.js';
import type { CreatePaymentDto, LoadPaymentsDto } from './dto/payment.dto.js';
import { Payment, PaymentStatus } from './entities/payment.entity.js';
import { LoadJobs } from './load-jobs.js';
import type { LoadJob } from './load-jobs.js';
import { paymentError } from './payment-errors.js';
import { PAYMENT_REQUESTED_TOPIC } from './payment-events.js';
import type { PaymentRequestedEvent } from './payment-events.js';
import { PaymentFeed } from './payment-feed.js';
import { PaymentMetrics } from './payment-metrics.js';
import { toPaymentView } from './payment.view.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Hash of what the client asked for, to tell a retry (same body) from a reused key (another body). */
export function fingerprint(dto: CreatePaymentDto): string {
  return createHash('sha256')
    .update(JSON.stringify([dto.amount, dto.currency, dto.cardToken]))
    .digest('hex');
}

/** Random whole amount between 10.00 and 499.00 (minor units), never a magic suffix. */
const randomAmount = (): number => (10 + Math.floor(Math.random() * 490)) * 100;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly outbox: OutboxService,
    private readonly feed: PaymentFeed,
    private readonly metrics: PaymentMetrics,
    private readonly jobs: LoadJobs,
  ) {}

  /**
   * Payment row and outbox row commit together; Kafka is the relay's problem, not the request's.
   * With an `Idempotency-Key` a repeated request gets the stored payment back instead of a second one,
   * and the same key with another body is a 422 (docs/adr/0015-client-idempotency-keys.md). The unique
   * index on the key serialises two concurrent requests: the loser waits, fails the insert and replays.
   */
  async create(
    dto: CreatePaymentDto,
    idempotencyKey?: string,
  ): Promise<{ payment: Payment; replayed: boolean }> {
    return withSpan('payment.create', {}, async (span) => {
      const requestFingerprint = fingerprint(dto);
      const replay = idempotencyKey
        ? await this.replayOf(idempotencyKey, requestFingerprint)
        : null;
      if (replay) return this.replayed(span, replay);

      try {
        const payment = await this.insert(dto, idempotencyKey, requestFingerprint);
        span.setAttribute('payment.id', payment.id);
        this.feed.payment$.next(toPaymentView(payment));
        return { payment, replayed: false };
      } catch (error) {
        if (!idempotencyKey || !isUniqueViolation(error)) throw error;
        const winner = await this.replayOf(idempotencyKey, requestFingerprint);
        if (!winner) throw error;
        return this.replayed(span, winner);
      }
    });
  }

  private replayed(span: Span, payment: Payment): { payment: Payment; replayed: true } {
    span.setAttributes({ 'payment.id': payment.id, 'idempotency.replayed': true });
    this.metrics.idempotentReplay();
    return { payment, replayed: true };
  }

  /** The stored payment for this key, null for a new key, a 422 when the key belongs to another request. */
  private async replayOf(key: string, requestFingerprint: string): Promise<Payment | null> {
    const existing = await this.payments.findOneBy({ idempotencyKey: key });
    if (!existing) return null;
    if (existing.requestFingerprint !== requestFingerprint)
      throw paymentError('idempotency-key-reused');
    return existing;
  }

  private insert(
    dto: CreatePaymentDto,
    idempotencyKey: string | undefined,
    requestFingerprint: string,
  ): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(Payment, {
          amount: dto.amount,
          currency: dto.currency,
          cardToken: dto.cardToken,
          status: PaymentStatus.PENDING,
          idempotencyKey: idempotencyKey ?? null,
          requestFingerprint: idempotencyKey ? requestFingerprint : null,
        }),
      );
      const event: PaymentRequestedEvent = {
        paymentId: saved.id,
        amount: saved.amount,
        currency: saved.currency,
        occurredAt: new Date().toISOString(),
      };
      await this.outbox.add(manager, PAYMENT_REQUESTED_TOPIC, saved.id, event);
      return saved;
    });
  }

  findById(id: string): Promise<Payment | null> {
    return this.payments.findOneBy({ id });
  }

  recent(limit = 50): Promise<Payment[]> {
    return this.payments.find({ order: { createdAt: 'DESC', id: 'ASC' }, take: limit });
  }

  loadJob(id: string): LoadJob | undefined {
    return this.jobs.find(id);
  }

  /** Registers the job and runs it in the background; the caller answers 202 with the job's status URL. */
  startLoad(dto: LoadPaymentsDto): LoadJob {
    const job = this.jobs.start(dto.count);
    void this.runLoad(job.id, dto);
    return job;
  }

  /** Background load generator behind `POST /payments/load`. Never throws: a failed insert is logged and counted. */
  async runLoad(jobId: string, dto: LoadPaymentsDto): Promise<void> {
    for (let i = 0; i < dto.count; i++) {
      try {
        await this.create({
          amount: dto.amount ?? randomAmount(),
          currency: 'USD',
          cardToken: 'tok_load',
        });
        this.jobs.created(jobId);
      } catch (error) {
        this.jobs.failed(jobId);
        this.logger.warn(`Load payment ${i + 1}/${dto.count} failed: ${String(error)}`);
      }
      if (dto.intervalMs > 0 && i < dto.count - 1) await sleep(dto.intervalMs);
    }
  }
}
