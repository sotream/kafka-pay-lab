import { PaymentFeed } from './payment-feed.js';
import { PaymentsService } from './payments.service.js';
import type { PaymentView } from './payment.view.js';

function setup() {
  const manager = {
    create: (_entity: unknown, data: object) => ({
      id: 'p1',
      declineReason: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...data,
    }),
    save: (entity: unknown) => Promise.resolve(entity),
  };
  const dataSource = {
    transaction: (work: (m: typeof manager) => Promise<unknown>) => work(manager),
  };
  const outbox = { add: vi.fn().mockResolvedValue(undefined) };
  const feed = new PaymentFeed();
  const service = new PaymentsService(dataSource as never, {} as never, outbox as never, feed);
  return { service, outbox, feed };
}

describe('PaymentsService', () => {
  it('saves a PENDING payment and its outbox event, then announces it', async () => {
    const { service, outbox, feed } = setup();
    const seen: PaymentView[] = [];
    feed.payment$.subscribe((view) => seen.push(view));

    const payment = await service.create({ amount: 1050, currency: 'USD', cardToken: 'tok_x' });

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

    await expect(service.create({ amount: 1000, currency: 'USD', cardToken: 't' })).rejects.toThrow(
      'db down',
    );

    expect(seen).toEqual([]);
  });

  it('runLoad creates `count` payments with the fixed amount and survives a failing insert', async () => {
    const { service, outbox } = setup();
    outbox.add.mockRejectedValueOnce(new Error('boom'));

    await service.runLoad({ count: 3, intervalMs: 0, amount: 1051 });

    expect(outbox.add).toHaveBeenCalledTimes(3);
    expect(outbox.add).toHaveBeenLastCalledWith(
      expect.anything(),
      'payments.requested',
      'p1',
      expect.objectContaining({ amount: 1051 }),
    );
  });
});
