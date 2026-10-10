import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ChargesController } from './charges.controller.js';
import { SimController } from './sim.controller.js';
import { SimService } from './sim.service.js';
import { DEFAULT_STATE } from './sim-state.js';

const fast = { ...DEFAULT_STATE, latencyMs: 0, jitterMs: 0 };
const body = (amount: number) => ({ amount, currency: 'USD', cardToken: 'tok' });

describe('psp-sim HTTP', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChargesController, SimController],
      providers: [SimService],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await http().put('/sim/state').send(fast).expect(200);
  });
  afterEach(() => app.close());

  it('approves a charge', async () => {
    const res = await http()
      .post('/charges')
      .set('Idempotency-Key', '"k1"')
      .send(body(1000))
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'approved',
      chargeId: expect.stringMatching(/^ch_/),
    });
  });

  it('requires an idempotency key', async () => {
    await http().post('/charges').send(body(1000)).expect(400);
  });

  it.each(['plain', '"unterminated', "'single'", '""', '"a" "b"'])(
    'rejects the key %s: it must be a quoted structured field string',
    async (key) => {
      await http().post('/charges').set('Idempotency-Key', key).send(body(1000)).expect(400);
    },
  );

  it('accepts a key with escaped quotes and backslashes', async () => {
    await http()
      .post('/charges')
      .set('Idempotency-Key', '"a\\"b\\\\c"')
      .send(body(1000))
      .expect(200);
  });

  it('answers 422 without a decline code when a key is reused with another payload', async () => {
    await http().post('/charges').set('Idempotency-Key', '"reuse"').send(body(1000)).expect(200);

    const reused = await http()
      .post('/charges')
      .set('Idempotency-Key', '"reuse"')
      .send(body(2000))
      .expect(422);

    expect(reused.body).toEqual({ error: 'idempotency_key_reused' });
  });

  it('returns the stored result for a repeated idempotency key (duplicate delivery)', async () => {
    const first = await http()
      .post('/charges')
      .set('Idempotency-Key', '"dup"')
      .send(body(1000))
      .expect(200);

    await http()
      .put('/sim/state')
      .send({ ...fast, outage: 'http503' })
      .expect(200);
    const second = await http()
      .post('/charges')
      .set('Idempotency-Key', '"dup"')
      .send(body(1000))
      .expect(200);

    expect(second.body.chargeId).toBe(first.body.chargeId);
  });

  it('declines a magic amount with 402 and the reason code', async () => {
    await http()
      .post('/charges')
      .set('Idempotency-Key', '"k2"')
      .send(body(1051))
      .expect(402, { code: 'insufficient_funds' });
  });

  it('answers 503 during an http503 outage', async () => {
    await http()
      .put('/sim/state')
      .send({ ...fast, outage: 'http503' })
      .expect(200);

    await http().post('/charges').set('Idempotency-Key', '"k3"').send(body(1000)).expect(503);
  });

  it('drops the connection during a reset outage', async () => {
    await http()
      .put('/sim/state')
      .send({ ...fast, outage: 'reset' })
      .expect(200);

    await expect(
      http().post('/charges').set('Idempotency-Key', '"k4"').send(body(1000)),
    ).rejects.toThrow();
  });

  it.each([
    { ...fast, failRate: 150 },
    { ...fast, outage: 'explode' },
    { ...fast, extra: 1 },
    { latencyMs: 0 },
  ])('rejects the invalid state %j', async (state) => {
    await http().put('/sim/state').send(state).expect(400);
  });

  it('rejects a charge with a bad amount', async () => {
    await http().post('/charges').set('Idempotency-Key', '"k5"').send(body(0)).expect(400);
  });
});
