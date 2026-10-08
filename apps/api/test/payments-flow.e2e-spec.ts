import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { CircuitBreaker } from '../src/modules/payments/circuit-breaker.js';
import { PaymentRequestedConsumer } from '../src/modules/payments/payment-requested.consumer.js';
import { PAYMENT_BREAKER } from '../src/modules/payments/payments.constants.js';
import type { TestApp } from './helpers/test-app.js';

/** Stands in for psp-sim: `mode` flips between a healthy and a broken provider. */
function startProvider(): Promise<{
  server: Server;
  port: number;
  setMode: (mode: 'ok' | 'down') => void;
}> {
  let mode: 'ok' | 'down' = 'ok';
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    if (mode === 'down') {
      res.statusCode = 503;
      res.end('{"error":"down"}');
      return;
    }
    res.end(JSON.stringify({ chargeId: `ch_${Date.now()}`, status: 'approved' }));
  });
  return new Promise((resolve) =>
    server.listen(0, () =>
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        setMode: (m) => (mode = m),
      }),
    ),
  );
}

describe('payments flow with Kafka (e2e)', () => {
  const previousEnv = { ...process.env };
  let ctx: TestApp;
  let provider: Awaited<ReturnType<typeof startProvider>>;
  const http = () => request(ctx.app.getHttpServer());
  const statuses = async (): Promise<string[]> =>
    (await ctx.dataSource.query('SELECT status FROM payments ORDER BY "createdAt"')).map(
      (row: { status: string }) => row.status,
    );
  const breakerState = () => ctx.app.get<CircuitBreaker>(PAYMENT_BREAKER).snapshot().state;

  beforeAll(async () => {
    provider = await startProvider();
    Object.assign(process.env, {
      KAFKA_ENABLED: 'true',
      PSP_URL: `http://127.0.0.1:${provider.port}`,
      PSP_TIMEOUT_MS: '500',
      CB_FAILURE_THRESHOLD: '2',
      CB_RESET_TIMEOUT_MS: '1000',
      PAYMENT_RETRY_BASE_MS: '20',
      OUTBOX_POLL_MS: '100',
      // Fresh group per run: no leftover committed offsets from earlier runs.
      PAYMENTS_GROUP_ID: `e2e-payments-${Date.now()}`,
    });
    // AppModule validates the environment when it is first imported, so import it only now.
    const { createTestApp } = await import('./helpers/test-app.js');
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
    provider.server.close();
    process.env = previousEnv;
  });

  it('completes payments, stalls them while the provider is down, and recovers', async () => {
    await ctx.reset();

    await http().post('/api/v1/payments').send({ amount: 1000, currency: 'USD' }).expect(201);
    await vi.waitFor(async () => expect(await statuses()).toEqual(['COMPLETED']), {
      timeout: 30_000,
    });

    provider.setMode('down');
    for (let i = 0; i < 3; i++) {
      await http().post('/api/v1/payments').send({ amount: 2000, currency: 'USD' }).expect(201);
    }
    await vi.waitFor(() => expect(breakerState()).toBe('OPEN'), { timeout: 30_000 });
    expect((await statuses()).filter((s) => s === 'PENDING').length).toBeGreaterThan(0);

    provider.setMode('ok');
    await vi.waitFor(
      async () =>
        expect(await statuses()).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED']),
      { timeout: 30_000 },
    );
    expect(breakerState()).toBe('CLOSED');
  }, 120_000);

  it('survives a long outage without the consumer crashing, then recovers', async () => {
    await ctx.reset();
    provider.setMode('down');
    await http().post('/api/v1/payments').send({ amount: 3000, currency: 'USD' }).expect(201);

    // Many more breaker open/probe cycles than kafkajs's default retry budget of 5 (30 s gave 4 crashes before the fix).
    await new Promise((resolve) => setTimeout(resolve, 30_000));

    expect(ctx.app.get(PaymentRequestedConsumer).crashes).toBe(0);
    expect(await statuses()).toEqual(['PENDING']);

    provider.setMode('ok');
    await vi.waitFor(async () => expect(await statuses()).toEqual(['COMPLETED']), {
      timeout: 30_000,
    });
  }, 120_000);

  it('records a card decline as DECLINED, not as a provider failure', async () => {
    await ctx.reset();
    provider.server.removeAllListeners('request');
    provider.server.on('request', (req, res) => {
      req.resume();
      res.statusCode = 402;
      res.setHeader('content-type', 'application/json');
      res.end('{"code":"insufficient_funds"}');
    });

    await http().post('/api/v1/payments').send({ amount: 1051, currency: 'USD' }).expect(201);

    await vi.waitFor(
      async () => {
        const rows = await ctx.dataSource.query('SELECT status, "declineReason" FROM payments');
        expect(rows).toEqual([{ status: 'DECLINED', declineReason: 'insufficient_funds' }]);
      },
      { timeout: 30_000 },
    );
    expect(breakerState()).toBe('CLOSED');
  }, 60_000);
});
