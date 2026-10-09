import { SpanKind } from '@opentelemetry/api';
import { setupTestTracing } from '../../../test/helpers/tracing.js';
import { withSpan } from '../../infrastructure/telemetry/trace-context.js';
import { processWithRetry } from './payment-retry.js';
import { TransientPspError } from './psp.client.js';

describe('payment attempt spans', () => {
  const tracing = setupTestTracing();
  afterAll(() => tracing.shutdown());
  beforeEach(() => tracing.exporter.reset());

  it('records one attempt span per try with its number, under the consumer span', async () => {
    const process = vi
      .fn()
      .mockRejectedValueOnce(new TransientPspError('x'))
      .mockResolvedValueOnce('completed');

    await withSpan('consume', { kind: SpanKind.CONSUMER }, () =>
      processWithRetry({ process, fail: vi.fn() }, 'p1', { maxAttempts: 4, retryBaseMs: 1 }, () =>
        Promise.resolve(),
      ),
    );

    const spans = tracing.exporter.getFinishedSpans();
    const attempts = spans.filter((s) => s.name === 'payment.attempt');
    const root = spans.find((s) => s.name === 'consume');
    expect(attempts.map((s) => s.attributes['payment.attempt'])).toEqual([1, 2]);
    expect(attempts.every((s) => s.parentSpanContext?.spanId === root?.spanContext().spanId)).toBe(
      true,
    );
    expect(attempts[0]?.attributes['payment.id']).toBe('p1');
  });

  it('returns the outcome and counts retries through onRetry', async () => {
    const onRetry = vi.fn();
    const process = vi
      .fn()
      .mockRejectedValueOnce(new TransientPspError('x'))
      .mockResolvedValueOnce('completed');

    const outcome = await processWithRetry(
      { process, fail: vi.fn() },
      'p1',
      { maxAttempts: 4, retryBaseMs: 1, onRetry },
      () => Promise.resolve(),
    );

    expect(outcome).toBe('completed');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('reports failed after the last attempt', async () => {
    const outcome = await processWithRetry(
      {
        process: vi.fn().mockRejectedValue(new TransientPspError('x')),
        fail: vi.fn().mockResolvedValue(undefined),
      },
      'p1',
      { maxAttempts: 2, retryBaseMs: 1 },
      () => Promise.resolve(),
    );

    expect(outcome).toBe('failed');
  });
});
