import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ChargesController } from './charges.controller.js';
import { SimController } from './sim.controller.js';
import { SimService } from './sim.service.js';
import { DEFAULT_STATE } from './sim-state.js';

const body = (amount: number) => ({ amount, currency: 'USD', cardToken: 'tok' });

describe('psp-sim concurrency', () => {
  let app: INestApplication;
  let sim: SimService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChargesController, SimController],
      providers: [SimService],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    sim = app.get(SimService);
    sim.setState({ ...DEFAULT_STATE, latencyMs: 0, jitterMs: 0 });
  });
  afterEach(() => app.close());

  const url = () => `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  it('releases a hung request as soon as the client gives up', async () => {
    const req = httpRequest(`${url()}/charges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'hang-1' },
    });
    req.on('error', () => undefined);
    req.end(JSON.stringify(body(1092)));
    await vi.waitFor(() => expect(sim.hanging).toBe(1));

    req.destroy();

    await vi.waitFor(() => expect(sim.hanging).toBe(0));
  });

  it('answers a retry that arrives while the first call is still in flight with the same charge', async () => {
    sim.setState({ ...DEFAULT_STATE, latencyMs: 300, jitterMs: 0 });
    const post = () =>
      request(app.getHttpServer()).post('/charges').set('Idempotency-Key', 'slow').send(body(1000));

    const [first, second] = await Promise.all([post(), post()]);

    expect(first.status).toBe(200);
    expect(second.body.chargeId).toBe(first.body.chargeId);
    const { counters } = sim.snapshot() as { counters: Record<string, number> };
    expect(counters.approved).toBe(1);
    expect(counters.replayed).toBe(1);
  });
});
