import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { LoadJobs } from './load-jobs.js';
import { PaymentFeed } from './payment-feed.js';
import { PaymentsService, fingerprint } from './payments.service.js';
import type { PaymentView } from './payment.view.js';

const dto = { amount: 1050, currency: 'USD', cardToken: 'tok_x' };

function stored(overrides: object = {}) {
  return {
    id: 'p0',
    amount: 1050,
    currency: 'USD',
    cardToken: 'tok_x',
    status: 'PENDING',
    declineReason: null,
    idempotencyKey: 'k1',
    requestFingerprint: fingerprint(dto),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(existing: ReturnType<typeof stored> | null = null) {
  const manager = {
    create: (_entity: unknown, data: object) => ({
      id: 'p1',
      declineReason: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...data,
    }),
    save: vi.fn((entity: unknown) => Promise.resolve(entity)),
  };
  const dataSource = {
    transaction: vi.fn((work: (m: typeof manager) => Promise<unknown>) => work(manager)),
  };
  const outbox = { add: vi.fn().mockResolvedValue(undefined) };
  const repo = { findOneBy: vi.fn().mockResolvedValue(existing) };
  const metrics = { idempotentReplay: vi.fn() };
  const feed = new PaymentFeed();
  const jobs = new LoadJobs();
  const service = new PaymentsService(
    dataSource as never,
    repo as never,
    outbox as never,
    feed,
    metrics as never,
    jobs,
  );
  return { service, outbox, feed, manager, dataSource, repo, metrics, jobs };
}

const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

describe('PaymentsService.create', () => {
  it('saves a PENDING payment and its outbox event, then announces it', async () => {
    const { service, outbox, feed } = setup();
    const seen: PaymentView[] = [];
    feed.payment$.subscribe((view) => seen.push(view));

    const { payment, replayed } = await service.create(dto);

    expect(replayed).toBe(false);
    expect(payment).toMatchObject({ id: 'p1', amount: 1050, status: 'PENDING' });
    expect(outbox.add).toHaveBeenCalledWith(
      expect.anything(),
      'payments.requested',
      'p1',
      expect.objectContaining({ paymentId: 'p1', amount: 1050, currency: 'USD' }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: 'p1', status: 'PENDING' });
  });

  it('does not announce a payment when the transaction fails', async () => {
    const { service, outbox, feed } = setup();
    outbox.add.mockRejectedValueOnce(new Error('db down'));
    const seen: PaymentView[] = [];
    feed.payment$.subscribe((view) => seen.push(view));

    await expect(service.create(dto)).rejects.toThrow('db down');

    expect(seen).toEqual([]);
  });

  it('stores the key and a fingerprint of the request with the payment', async () => {
    const { service, manager } = setup();

    await service.create(dto, 'k1');

    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'k1', requestFingerprint: fingerprint(dto) }),
    );
  });

  it('does not look a payment up when there is no key', async () => {
    const { service, repo } = setup();

    await service.create(dto);

    expect(repo.findOneBy).not.toHaveBeenCalled();
  });

  it('replays the stored payment for the same key and body: nothing new is written or announced', async () => {
    const { service, outbox, feed, dataSource, metrics } = setup(stored());
    const seen: PaymentView[] = [];
    feed.payment$.subscribe((view) => seen.push(view));

    const { payment, replayed } = await service.create(dto, 'k1');

    expect(replayed).toBe(true);
    expect(payment.id).toBe('p0');
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(metrics.idempotentReplay).toHaveBeenCalledTimes(1);
  });

  it('answers 422 when the key was used with another body, and writes nothing', async () => {
    const { service, outbox } = setup(stored());

    const attempt = service.create({ ...dto, amount: 2000 }, 'k1');

    await expect(attempt).rejects.toThrow(expect.objectContaining({ status: 422 }));
    await expect(attempt).rejects.toBeInstanceOf(HttpException);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('replays when a concurrent request with the same key won the unique index', async () => {
    const { service, repo, dataSource, outbox } = setup();
    dataSource.transaction.mockRejectedValueOnce(uniqueViolation());
    repo.findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(stored());

    const { payment, replayed } = await service.create(dto, 'k1');

    expect(replayed).toBe(true);
    expect(payment.id).toBe('p0');
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('lets other database errors through', async () => {
    const { service, dataSource } = setup();
    dataSource.transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(service.create(dto, 'k1')).rejects.toThrow('db down');
  });
});

describe('fingerprint', () => {
  it('is stable for the same request and differs for any changed field', () => {
    expect(fingerprint(dto)).toBe(fingerprint({ ...dto }));
    for (const changed of [{ amount: 1 }, { currency: 'EUR' }, { cardToken: 'other' }]) {
      expect(fingerprint({ ...dto, ...changed })).not.toBe(fingerprint(dto));
    }
  });
});

describe('PaymentsService.runLoad', () => {
  it('creates `count` payments with the fixed amount, survives a failing insert and tracks the job', async () => {
    const { service, outbox, jobs } = setup();
    outbox.add.mockRejectedValueOnce(new Error('boom'));
    const job = jobs.start(3);

    await service.runLoad(job.id, { count: 3, intervalMs: 0, amount: 1051 });

    expect(outbox.add).toHaveBeenCalledTimes(3);
    expect(outbox.add).toHaveBeenLastCalledWith(
      expect.anything(),
      'payments.requested',
      'p1',
      expect.objectContaining({ amount: 1051 }),
    );
    expect(jobs.find(job.id)).toMatchObject({ created: 2, failed: 1, done: true });
  });
});
