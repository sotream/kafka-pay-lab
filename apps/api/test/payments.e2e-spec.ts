import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';
import type { TestApp } from './helpers/test-app.js';

describe('payments (e2e, Kafka disabled)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('stores a PENDING payment and an unpublished outbox event without logging in', async () => {
    const res = await http()
      .post('/api/v1/payments')
      .send({ amount: 1000, currency: 'USD' })
      .expect(201);

    expect(res.body).toMatchObject({ amount: 1000, currency: 'USD', status: 'PENDING' });
    expect(res.body).not.toHaveProperty('cardToken');
    expect(res.headers.location).toBe(`/api/v1/payments/${res.body.id}`);
    const rows = await ctx.dataSource.query(`SELECT topic, key, "publishedAt" FROM outbox_events`);
    expect(rows).toEqual([{ topic: 'payments.requested', key: res.body.id, publishedAt: null }]);
    const list = await http().get('/api/v1/payments').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('cardToken');
  });

  it.each([
    { amount: 0, currency: 'USD' },
    { amount: -5, currency: 'USD' },
    { amount: 10.5, currency: 'USD' },
    { amount: 1_000_000_000, currency: 'USD' },
    { amount: 1000, currency: 'XXX' },
    { amount: 1000, currency: 'USD', unexpected: true },
    { amount: 1000, currency: 'USD', cardToken: null },
    { currency: 'USD' },
  ])('rejects the invalid payment %j', async (body) => {
    await http().post('/api/v1/payments').send(body).expect(400);
    expect(await ctx.dataSource.query('SELECT 1 FROM payments')).toEqual([]);
  });

  it('rejects load requests that are too big or malformed', async () => {
    await http().post('/api/v1/payments/load').send({ count: 501, intervalMs: 0 }).expect(400);
    await http().post('/api/v1/payments/load').send({ count: 0, intervalMs: 0 }).expect(400);
    await http().post('/api/v1/payments/load').send({ count: 5, intervalMs: -1 }).expect(400);
  });

  it('accepts a load request and creates the payments in the background', async () => {
    const res = await http()
      .post('/api/v1/payments/load')
      .send({ count: 3, intervalMs: 0, amount: 1051 })
      .expect(202);
    expect(res.body).toEqual({ accepted: 3, jobId: expect.any(String) });
    expect(res.headers.location).toBe(`/api/v1/payments/load/${res.body.jobId}`);

    await vi.waitFor(async () => {
      const rows = await ctx.dataSource.query('SELECT amount FROM payments');
      expect(rows).toEqual([{ amount: 1051 }, { amount: 1051 }, { amount: 1051 }]);
    });
  });

  it('reports the progress of a load job at the URL from Location', async () => {
    const started = await http()
      .post('/api/v1/payments/load')
      .send({ count: 2, intervalMs: 0, amount: 1051 })
      .expect(202);

    await vi.waitFor(async () => {
      const status = await http().get(String(started.headers.location)).expect(200);
      expect(status.body).toMatchObject({ total: 2, created: 2, failed: 0, done: true });
    });
  });

  it('answers 404 for an unknown load job', async () => {
    await http().get('/api/v1/payments/load/no-such-job').expect(404);
  });

  it('reads one payment by id, without the card token', async () => {
    const created = await http()
      .post('/api/v1/payments')
      .send({ amount: 1000, currency: 'USD' })
      .expect(201);

    const res = await http().get(String(created.headers.location)).expect(200);

    expect(res.body).toMatchObject({ id: created.body.id, status: 'PENDING' });
    expect(res.body).not.toHaveProperty('cardToken');
  });

  it('answers 404 for an unknown payment and 400 for an id that is not a UUID', async () => {
    await http().get('/api/v1/payments/6f1c2f0e-3b53-4c6b-9f0e-2d2b8b1f7a11').expect(404);
    await http().get('/api/v1/payments/not-a-uuid').expect(400);
  });
});
