import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject, map, merge } from 'rxjs';
import type { EnvironmentVariables } from '../../infrastructure/config/env.validation.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type { BreakerSnapshot } from './circuit-breaker.js';
import { LagPoller } from './lag.poller.js';
import type { LagSample } from './lag.poller.js';
import { PaymentFeed } from './payment-feed.js';
import { PAYMENT_BREAKER } from './payments.constants.js';
import { PaymentsService } from './payments.service.js';
import { toPaymentView } from './payment.view.js';
import type { PaymentView } from './payment.view.js';

export type StreamEvent =
  | {
      type: 'snapshot';
      kafkaEnabled: boolean;
      breaker: BreakerSnapshot;
      lag: LagSample | null;
      outboxPending: number;
      payments: PaymentView[];
    }
  | { type: 'breaker'; breaker: BreakerSnapshot }
  | { type: 'metrics'; lag: LagSample | null; outboxPending: number }
  | { type: 'payment'; payment: PaymentView };

@Injectable()
export class StreamService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StreamService.name);
  private readonly metrics$ = new Subject<StreamEvent>();
  private latest: { lag: LagSample | null; outboxPending: number } = {
    lag: null,
    outboxPending: 0,
  };
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly feed: PaymentFeed,
    @Inject(PAYMENT_BREAKER) private readonly breaker: CircuitBreaker,
    private readonly lagPoller: LagPoller,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.tick(),
      this.config.get('LAG_POLL_MS', { infer: true }),
    );
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /**
   * One SSE connection: a snapshot first, then everything that changes. Live events are subscribed to
   * before the snapshot query runs and buffered until it is out, so nothing that happens meanwhile is lost
   * (a buffered event can be older than the snapshot; the client keeps the newer version of each payment).
   */
  open(): Observable<StreamEvent> {
    return new Observable<StreamEvent>((subscriber) => {
      const buffered: StreamEvent[] = [];
      let ready = false;
      const live = merge(
        this.feed.breaker$.pipe(map((breaker): StreamEvent => ({ type: 'breaker', breaker }))),
        this.feed.payment$.pipe(map((payment): StreamEvent => ({ type: 'payment', payment }))),
        this.metrics$,
      ).subscribe((event) => (ready ? subscriber.next(event) : buffered.push(event)));

      this.snapshot().then(
        (snapshot) => {
          subscriber.next(snapshot);
          buffered.forEach((event) => subscriber.next(event));
          ready = true;
        },
        (error: unknown) => subscriber.error(error),
      );
      return () => live.unsubscribe();
    });
  }

  /** Once a second: refresh the breaker countdown (also moves OPEN to HALF_OPEN), lag and outbox backlog. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.feed.breaker$.next(this.breaker.snapshot());
      const [lag, outboxPending] = await Promise.all([this.safeLag(), this.safePending()]);
      this.latest = { lag, outboxPending };
      this.metrics$.next({ type: 'metrics', lag, outboxPending });
    } finally {
      this.ticking = false;
    }
  }

  private async snapshot(): Promise<StreamEvent> {
    const recent = await this.payments.recent();
    return {
      type: 'snapshot',
      kafkaEnabled: this.config.get('KAFKA_ENABLED', { infer: true }),
      breaker: this.breaker.snapshot(),
      ...this.latest,
      payments: recent.map(toPaymentView),
    };
  }

  private async safeLag(): Promise<LagSample | null> {
    try {
      return await this.lagPoller.sample();
    } catch (error) {
      this.logger.debug(`Lag unavailable: ${String(error)}`);
      return null;
    }
  }

  private async safePending(): Promise<number> {
    try {
      return await this.outbox.pendingCount();
    } catch (error) {
      this.logger.debug(`Outbox count unavailable: ${String(error)}`);
      return this.latest.outboxPending;
    }
  }
}
