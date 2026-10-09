import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Registry } from '@prometheus-io/client';
import type { EnvironmentVariables } from '../../infrastructure/config/env.validation.js';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { Payment } from './entities/payment.entity.js';
import { LagPoller } from './lag.poller.js';
import { PaymentFeed } from './payment-feed.js';
import { PaymentMetrics } from './payment-metrics.js';
import { PaymentProcessor } from './payment-processor.js';
import { PaymentRequestedConsumer } from './payment-requested.consumer.js';
import { PAYMENT_BREAKER } from './payments.constants.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PspClient } from './psp.client.js';
import { StreamController } from './stream.controller.js';
import { StreamService } from './stream.service.js';

type AppConfig = ConfigService<EnvironmentVariables, true>;

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), OutboxModule],
  controllers: [PaymentsController, StreamController],
  providers: [
    PaymentsService,
    PaymentFeed,
    PaymentProcessor,
    PaymentRequestedConsumer,
    LagPoller,
    StreamService,
    {
      provide: PaymentMetrics,
      inject: [Registry, OutboxService, LagPoller],
      useFactory: (registry: Registry, outbox: OutboxService, lag: LagPoller) =>
        new PaymentMetrics(registry, { outbox: () => outbox.stats(), lag: () => lag.sample() }),
    },
    {
      provide: PspClient,
      inject: [ConfigService],
      useFactory: (config: AppConfig) =>
        new PspClient({
          baseUrl: config.get('PSP_URL', { infer: true }),
          timeoutMs: config.get('PSP_TIMEOUT_MS', { infer: true }),
        }),
    },
    {
      provide: PAYMENT_BREAKER,
      inject: [ConfigService, PaymentFeed, PaymentMetrics],
      useFactory: (config: AppConfig, feed: PaymentFeed, metrics: PaymentMetrics) =>
        new CircuitBreaker({
          failureThreshold: config.get('CB_FAILURE_THRESHOLD', { infer: true }),
          resetTimeoutMs: config.get('CB_RESET_TIMEOUT_MS', { infer: true }),
          onChange: (snapshot) => {
            feed.breaker$.next(snapshot);
            metrics.breakerChanged(snapshot.state);
          },
        }),
    },
  ],
  exports: [PAYMENT_BREAKER, PaymentFeed, PaymentsService],
})
export class PaymentsModule {}
