import { Registry } from '@prometheus-io/client';
import { PaymentMetrics } from './payment-metrics.js';

const idle = {
  outbox: () => Promise.resolve({ pending: 0, oldestAgeSeconds: 0 }),
  lag: () => Promise.resolve(null),
};

describe('PaymentMetrics', () => {
  it('registers every metric once, with low-cardinality labels', async () => {
    const registry = new Registry();
    new PaymentMetrics(registry, idle);

    const metrics = await registry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name).sort()).toEqual([
      'outbox_backlog_events',
      'outbox_oldest_pending_age_seconds',
      'payments_breaker_state',
      'payments_breaker_transitions_total',
      'payments_consumer_lag',
      'payments_dlq_total',
      'payments_processing_duration_seconds',
      'payments_retries_total',
    ]);
    // One series per payment id, URL or message would grow without bound.
    const forbidden = ['paymentId', 'payment_id', 'id', 'url', 'path', 'error', 'message'];
    for (const metric of metrics) {
      const labels = (metric as { labelNames?: string[] }).labelNames ?? [];
      expect(labels.filter((label) => forbidden.includes(label))).toEqual([]);
    }
  });

  it('can be created twice on different registries', () => {
    expect(() => {
      new PaymentMetrics(new Registry(), idle);
      new PaymentMetrics(new Registry(), idle);
    }).not.toThrow();
  });

  it('counts breaker transitions only when the state really changes', async () => {
    const registry = new Registry();
    const metrics = new PaymentMetrics(registry, idle);

    metrics.breakerChanged('CLOSED');
    metrics.breakerChanged('OPEN');
    metrics.breakerChanged('OPEN');
    metrics.breakerChanged('HALF_OPEN');

    const text = await registry.metrics();
    expect(text).toContain('payments_breaker_transitions_total{from="CLOSED",to="OPEN"} 1');
    expect(text).toContain('payments_breaker_transitions_total{from="OPEN",to="HALF_OPEN"} 1');
    expect(text).toContain('payments_breaker_state{state="HALF_OPEN"} 1');
    expect(text).toContain('payments_breaker_state{state="OPEN"} 0');
  });

  it('counts retries, dead letters and processing time by outcome', async () => {
    const registry = new Registry();
    const metrics = new PaymentMetrics(registry, idle);

    metrics.retried();
    metrics.deadLettered();
    metrics.processed('failed', 7.2);

    const text = await registry.metrics();
    expect(text).toContain('payments_retries_total 1');
    expect(text).toContain('payments_dlq_total 1');
    expect(text).toContain('payments_processing_duration_seconds_count{outcome="failed"} 1');
  });

  it('exports outbox and lag gauges from their sources at scrape time', async () => {
    const registry = new Registry();
    new PaymentMetrics(registry, {
      outbox: () => Promise.resolve({ pending: 3, oldestAgeSeconds: 12 }),
      lag: () =>
        Promise.resolve({
          total: 5,
          partitions: [
            { partition: 0, lag: 2 },
            { partition: 1, lag: 3 },
          ],
        }),
    });

    const text = await registry.metrics();
    expect(text).toContain('outbox_backlog_events 3');
    expect(text).toContain('outbox_oldest_pending_age_seconds 12');
    expect(text).toContain('payments_consumer_lag{partition="1"} 3');
  });

  it('still answers a scrape when a source fails (Kafka or the database is down)', async () => {
    const registry = new Registry();
    new PaymentMetrics(registry, {
      outbox: () => Promise.reject(new Error('db down')),
      lag: () => Promise.reject(new Error('kafka down')),
    });

    await expect(registry.metrics()).resolves.toContain('payments_retries_total');
  });

  it('does not let a hanging source stall the scrape (Kafka unreachable, kafkajs keeps retrying)', async () => {
    const registry = new Registry();
    new PaymentMetrics(
      registry,
      { outbox: () => new Promise(() => {}), lag: () => new Promise(() => {}) },
      { sourceTimeoutMs: 20 },
    );

    await expect(registry.metrics()).resolves.toContain('payments_retries_total');
  });
});
