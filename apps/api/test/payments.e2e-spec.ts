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
    const rows = await ctx.dataSource.query(`SELECT topic, key, "publishedAt" FROM outbox_events`);
    expect(rows).toEqual([{ topic: 'payments.requested', key: res.body.id, publishedAt: null }]);
    const list = await http().get('/api/v1/payments').expect(200);
    expect(list.body).toHaveLength(1);
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
    await http()
      .post('/api/v1/payments/load')
      .send({ count: 3, intervalMs: 0, amount: 1051 })
      .expect(202, { accepted: 3 });

    await vi.waitFor(async () => {
      const rows = await ctx.dataSource.query('SELECT amount FROM payments');
      expect(rows).toEqual([{ amount: 1051 }, { amount: 1051 }, { amount: 1051 }]);
    });
  });
});
