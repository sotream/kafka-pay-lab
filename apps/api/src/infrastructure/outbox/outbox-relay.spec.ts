import { SpanStatusCode, trace } from '@opentelemetry/api';
import { setupTestTracing } from '../../../test/helpers/tracing.js';
import type { EventPublisher, PublishedEvent } from '../messaging/event-publisher.port.js';
import { publishRow } from './outbox-relay.js';

const TRACE_ID = '8f3c1d5e9a7b4c2d6e0f1a3b5c7d9e1f';

function capturingPublisher() {
  const sent: { topic: string; event: PublishedEvent<unknown> }[] = [];
  const publisher: EventPublisher = {
    publish: (topic, event) => {
      sent.push({ topic, event });
      return Promise.resolve();
    },
  };
  return { publisher, sent };
}

describe('publishRow', () => {
  const tracing = setupTestTracing();
  afterAll(() => tracing.shutdown());
  beforeEach(() => tracing.exporter.reset());

  const row = (traceparent: string | null) => ({
    topic: 'payments.requested',
    key: 'p1',
    payload: { a: 1 },
    traceparent,
  });

  it('continues the trace saved on the row, not the (empty) context the relay runs in', async () => {
    const { publisher, sent } = capturingPublisher();

    await publishRow(publisher, row(`00-${TRACE_ID}-a1b2c3d4e5f60718-01`));

    expect(sent[0]?.event.headers?.traceparent).toContain(TRACE_ID);
    expect(tracing.exporter.getFinishedSpans()[0]?.spanContext().traceId).toBe(TRACE_ID);
  });

  it('starts a new trace for a row without a traceparent', async () => {
    const { publisher, sent } = capturingPublisher();

    await publishRow(publisher, row(null));

    expect(sent[0]?.event.headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-/);
    expect(sent[0]?.event.headers?.traceparent).not.toContain(TRACE_ID);
  });

  it('treats a garbage traceparent like a missing one', async () => {
    const { publisher, sent } = capturingPublisher();

    await publishRow(publisher, row('garbage'));

    expect(sent[0]?.event.headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-/);
  });

  it('marks the span failed and rethrows when the broker rejects', async () => {
    const failing: EventPublisher = { publish: () => Promise.reject(new Error('broker down')) };

    await expect(publishRow(failing, row(null))).rejects.toThrow('broker down');

    expect(tracing.exporter.getFinishedSpans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(trace.getActiveSpan()).toBeUndefined();
  });
});
