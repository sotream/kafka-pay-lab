import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { setupTestTracing } from '../../../test/helpers/tracing.js';
import {
  contextFromTraceparent,
  currentTraceparent,
  extractHeaders,
  injectHeaders,
  withSpan,
} from './trace-context.js';

const TRACE_ID = '8f3c1d5e9a7b4c2d6e0f1a3b5c7d9e1f';
const TRACEPARENT = `00-${TRACE_ID}-a1b2c3d4e5f60718-01`;

describe('trace context helpers', () => {
  const tracing = setupTestTracing();
  afterAll(() => tracing.shutdown());
  beforeEach(() => tracing.exporter.reset());

  it('returns null when there is no active span', () => {
    expect(currentTraceparent()).toBeNull();
  });

  it('round-trips a traceparent through a plain carrier', () => {
    const ctx = contextFromTraceparent(TRACEPARENT);

    expect(trace.getSpanContext(ctx)?.traceId).toBe(TRACE_ID);
    expect(injectHeaders(ctx).traceparent).toMatch(new RegExp(`^00-${TRACE_ID}-[0-9a-f]{16}-01$`));
  });

  it.each([null, '', 'garbage', '00-short-short-01'])('starts a fresh trace for %j', (value) => {
    expect(trace.getSpanContext(contextFromTraceparent(value))).toBeUndefined();
  });

  it.each([
    ['Buffer', Buffer.from(TRACEPARENT)],
    ['string', TRACEPARENT],
    ['array', [Buffer.from(TRACEPARENT)]],
  ])('extracts a %s Kafka header value', (_name, value) => {
    const ctx = extractHeaders({ traceparent: value });

    expect(trace.getSpanContext(ctx)?.traceId).toBe(TRACE_ID);
  });

  it('returns the root context for missing headers', () => {
    expect(extractHeaders(undefined)).toBe(ROOT_CONTEXT);
    expect(extractHeaders({ traceparent: undefined })).toBe(ROOT_CONTEXT);
  });

  it('runs the function inside an active span and ends it', async () => {
    const seen = await withSpan('unit', { kind: SpanKind.INTERNAL }, () =>
      Promise.resolve(currentTraceparent()),
    );

    expect(seen).not.toBeNull();
    expect(tracing.exporter.getFinishedSpans().map((s) => s.name)).toEqual(['unit']);
  });

  it('records the error, marks the span failed, ends it and rethrows', async () => {
    await expect(withSpan('boom', {}, () => Promise.reject(new Error('nope')))).rejects.toThrow(
      'nope',
    );

    const [span] = tracing.exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.map((e) => e.name)).toContain('exception');
  });

  it('parents the span on the supplied context', async () => {
    await withSpan('child', { parent: contextFromTraceparent(TRACEPARENT) }, () =>
      Promise.resolve(),
    );

    expect(tracing.exporter.getFinishedSpans()[0]?.spanContext().traceId).toBe(TRACE_ID);
  });
});
