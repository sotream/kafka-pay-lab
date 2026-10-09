import { Counter, Gauge, Histogram } from '@prometheus-io/client';
import type { Registry } from '@prometheus-io/client';
import type { BreakerState } from './circuit-breaker.js';
import type { LagSample } from './lag.poller.js';
import type { MessageOutcome } from './payment-processor.js';

const BREAKER_STATES: BreakerState[] = ['CLOSED', 'OPEN', 'HALF_OPEN'];

/** A scrape waits for its sources; a hung one (kafkajs retries a dead broker for a long time) must not eat the scrape timeout. */
const DEFAULT_SOURCE_TIMEOUT_MS = 2000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`metric source timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface MetricSources {
  outbox(): Promise<{ pending: number; oldestAgeSeconds: number }>;
  lag(): Promise<LagSample | null>;
}

/**
 * Every payments-pipeline instrument. Labels are fixed small sets (outcome, breaker state, partition):
 * ids and messages would create one time series per payment (docs/adr/0012-grafana-stack.md).
 */
export class PaymentMetrics {
  private readonly retries: Counter;
  private readonly dlq: Counter;
  private readonly duration: Histogram<'outcome'>;
  private readonly transitions: Counter<'from' | 'to'>;
  private readonly breakerState: Gauge<'state'>;
  private lastState: BreakerState = 'CLOSED';

  constructor(
    registry: Registry,
    sources: MetricSources,
    { sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS }: { sourceTimeoutMs?: number } = {},
  ) {
    this.retries = new Counter({
      name: 'payments_retries_total',
      help: 'Retries after a transient provider error',
      registers: [registry],
    });
    this.dlq = new Counter({
      name: 'payments_dlq_total',
      help: 'Payments sent to the dead-letter topic',
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'payments_processing_duration_seconds',
      help: 'Time the consumer spent on one payments.requested message, retries included',
      labelNames: ['outcome'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      registers: [registry],
    });
    this.transitions = new Counter({
      name: 'payments_breaker_transitions_total',
      help: 'Circuit breaker state changes',
      labelNames: ['from', 'to'],
      registers: [registry],
    });
    this.breakerState = new Gauge({
      name: 'payments_breaker_state',
      help: '1 for the current breaker state, 0 for the others',
      labelNames: ['state'],
      registers: [registry],
    });
    for (const state of BREAKER_STATES) {
      this.breakerState.set({ state }, state === this.lastState ? 1 : 0);
    }

    // Scrape-time collectors must never reject or hang: one failing source would fail the whole scrape,
    // so they keep the last value instead.
    new Gauge({
      name: 'outbox_backlog_events',
      help: 'Outbox rows not yet published to Kafka',
      registers: [registry],
      async collect() {
        try {
          this.set((await within(sources.outbox(), sourceTimeoutMs)).pending);
        } catch {
          // keep the last value
        }
      },
    });
    new Gauge({
      name: 'outbox_oldest_pending_age_seconds',
      help: 'Age of the oldest unpublished outbox row, 0 when empty',
      registers: [registry],
      async collect() {
        try {
          this.set((await within(sources.outbox(), sourceTimeoutMs)).oldestAgeSeconds);
        } catch {
          // keep the last value
        }
      },
    });
    new Gauge({
      name: 'payments_consumer_lag',
      help: 'Messages the payments consumer group has not committed yet, per partition',
      labelNames: ['partition'],
      registers: [registry],
      async collect() {
        try {
          const sample = await within(sources.lag(), sourceTimeoutMs);
          if (!sample) return;
          this.reset();
          for (const { partition, lag } of sample.partitions) {
            this.set({ partition: String(partition) }, lag);
          }
        } catch {
          // keep the last values
        }
      },
    });
  }

  retried(): void {
    this.retries.inc();
  }

  deadLettered(): void {
    this.dlq.inc();
  }

  processed(outcome: MessageOutcome, seconds: number): void {
    this.duration.observe({ outcome }, seconds);
  }

  /** The breaker also reports plain failure-count changes; only a real state change is a transition. */
  breakerChanged(state: BreakerState): void {
    if (state === this.lastState) return;
    this.transitions.inc({ from: this.lastState, to: state });
    this.lastState = state;
    for (const s of BREAKER_STATES) this.breakerState.set({ state: s }, s === state ? 1 : 0);
  }
}
