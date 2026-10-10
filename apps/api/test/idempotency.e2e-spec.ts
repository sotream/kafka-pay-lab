import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';
import type { TestApp } from './helpers/test-app.js';

describe('Idempotency-Key on POST /payments (e2e)', () => {
  let ctx: TestApp;
  const post = (body: object, key?: string) => {
    const req = request(ctx.app.getHttpServer()).post('/api/v1/payments');
    return (key === undefined ? req : req.set('Idempotency-Key', key)).send(body);
  };
  const count = async (table: string): Promise<number> =>
    Number(
      ((await ctx.dataSource.query(`SELECT count(*) FROM ${table}`)) as { count: string }[])[0]
        ?.count,
    );
  const body = { amount: 1000, currency: 'USD' };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('creates once and replays the same payment for a repeated key and body', async () => {
    const first = await post(body, '"k-1"').expect(201);
    const second = await post(body, '"k-1"').expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.headers.location).toBe(first.headers.location);
    expect(await count('payments')).toBe(1);
    expect(await count('outbox_events')).toBe(1);
  });

  it('answers 422 and writes nothing when the key is reused with another body', async () => {
    await post(body, '"k-2"').expect(201);

    const reused = await post({ ...body, amount: 2000 }, '"k-2"').expect(422);

    expect(reused.body).toMatchObject({ statusCode: 422 });
    expect(await count('payments')).toBe(1);
    expect(await count('outbox_events')).toBe(1);
  });

  it.each(['plain', '"unterminated', '""', `"${'x'.repeat(256)}"`])(
    'answers 400 for the malformed key %s',
    async (key) => {
      await post(body, key).expect(400);
      expect(await count('payments')).toBe(0);
    },
  );

  it('treats a request without a key as a new payment every time', async () => {
    await post(body).expect(201);
    await post(body).expect(201);

    expect(await count('payments')).toBe(2);
  });

  it('keeps different keys apart', async () => {
    const a = await post(body, '"a"').expect(201);
    const b = await post(body, '"b"').expect(201);

    expect(a.body.id).not.toBe(b.body.id);
  });

  it('creates exactly one payment when the same key arrives in parallel', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(body, '"race"')));

    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await count('payments')).toBe(1);
    expect(await count('outbox_events')).toBe(1);
  });
});
