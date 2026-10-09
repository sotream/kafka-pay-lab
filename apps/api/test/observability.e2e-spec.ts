import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { setupTestTracing } from './helpers/tracing.js';
import type { TestApp } from './helpers/test-app.js';

// New per run: the topic keeps messages of earlier runs, and a fresh consumer group re-reads them.
const TRACE_ID = randomBytes(16).toString('hex');
const TRACEPARENT = `00-${TRACE_ID}-a1b2c3d4e5f60718-01`;

describe('trace propagation through the outbox and Kafka (e2e)', () => {
  const previousEnv = { ...process.env };
  const tracing = setupTestTracing();
  let ctx: TestApp;
  let provider: Server;

  beforeAll(async () => {
    // Registered before express and supertest are imported below, so node:http is patched in time.
    // Outgoing requests are ignored: the test client must not replace the traceparent header we send.
    registerInstrumentations({
      instrumentations: [new HttpInstrumentation({ ignoreOutgoingRequestHook: () => true })],
    });
    provider = createServer((req, res) => {
      req.resume();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ chargeId: 'ch_test', status: 'approved' }));
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, {
      KAFKA_ENABLED: 'true',
      PSP_URL: `http://127.0.0.1:${(provider.address() as AddressInfo).port}`,
      OUTBOX_POLL_MS: '100',
      // Fresh group per run: no leftover committed offsets from earlier runs.
      PAYMENTS_GROUP_ID: `e2e-trace-${Date.now()}`,
    });
    const { createTestApp } = await import('./helpers/test-app.js');
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
    provider.close();
    await tracing.shutdown();
    process.env = previousEnv;
  });

  it('keeps one trace id from the HTTP request to the consumer span and the stored outbox row', async () => {
    const { default: request } = await import('supertest');
    await ctx.reset();
    tracing.exporter.reset();

    const created = await request(ctx.app.getHttpServer())
      .post('/api/v1/payments')
      .set('traceparent', TRACEPARENT)
      .send({ amount: 1000, currency: 'USD' })
      .expect(201);
    const paymentId: string = created.body.id;

    const ours = () =>
      tracing.exporter.getFinishedSpans().filter((s) => s.spanContext().traceId === TRACE_ID);
    await vi.waitFor(
      () => {
        const names = ours().map((s) => s.name);
        expect(names).toContain('payments.requested process');
        expect(names).toContain('payment.settle');
      },
      { timeout: 60_000 },
    );

    const spans = ours();
    const byName = (name: string) => spans.filter((s) => s.name === name);
    for (const name of [
      'payment.create',
      'outbox.add',
      'outbox.publish payments.requested',
      'payments.requested process',
      'payment.attempt',
      'breaker.execute',
      'payment.settle',
    ]) {
      expect(byName(name).length, name).toBeGreaterThan(0);
    }
    const consumer = byName('payments.requested process')[0];
    const publish = byName('outbox.publish payments.requested')[0];
    expect(consumer?.attributes['payment.id']).toBe(paymentId);
    expect(consumer?.parentSpanContext?.spanId).toBe(publish?.spanContext().spanId);
    expect(byName('breaker.execute')[0]?.attributes['breaker.state']).toBe('CLOSED');

    const [row] = await ctx.dataSource.query<{ traceparent: string | null }[]>(
      `SELECT traceparent FROM outbox_events WHERE topic = 'payments.requested' AND key = $1`,
      [paymentId],
    );
    expect(row?.traceparent).toContain(TRACE_ID);
  });
});
