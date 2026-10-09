import { Registry } from '@prometheus-io/client';
import { CircuitBreaker } from './circuit-breaker.js';
import { Payment, PaymentStatus } from './entities/payment.entity.js';
import { PaymentFeed } from './payment-feed.js';
import { PaymentMetrics } from './payment-metrics.js';
import { PaymentProcessor } from './payment-processor.js';
import { TransientPspError } from './psp.client.js';
import type { PspResult } from './psp.client.js';
import type { PaymentView } from './payment.view.js';

function pending(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'p1',
    amount: 1000,
    currency: 'USD',
    cardToken: 'tok',
    status: PaymentStatus.PENDING,
    declineReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(payment: Payment | null, charge: () => Promise<PspResult>, affected = 1) {
  const manager = { update: vi.fn().mockResolvedValue({ affected }) };
  const dataSource = {
    transaction: (work: (m: typeof manager) => Promise<unknown>) => work(manager),
  };
  const outbox = { add: vi.fn().mockResolvedValue(undefined) };
  const feed = new PaymentFeed();
  const seen: PaymentView[] = [];
  feed.payment$.subscribe((view) => seen.push(view));
  const registry = new Registry();
  const metrics = new PaymentMetrics(registry, {
    outbox: () => Promise.resolve({ pending: 0, oldestAgeSeconds: 0 }),
    lag: () => Promise.resolve(null),
  });
  const processor = new PaymentProcessor(
    dataSource as never,
    { findOneBy: vi.fn().mockResolvedValue(payment) } as never,
    { charge: vi.fn(charge) } as never,
    new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000 }),
    outbox as never,
    feed,
    metrics,
  );
  return { processor, manager, outbox, seen, registry };
}

const approved = () => Promise.resolve<PspResult>({ kind: 'approved', chargeId: 'ch_1' });

describe('PaymentProcessor.process', () => {
  it('completes an approved payment and emits payments.completed', async () => {
    const { processor, manager, outbox, seen } = setup(pending(), approved);

    await expect(processor.process('p1')).resolves.toBe('completed');

    expect(manager.update).toHaveBeenCalledWith(
      Payment,
      { id: 'p1', status: PaymentStatus.PENDING },
      { status: PaymentStatus.COMPLETED, declineReason: null },
    );
    expect(outbox.add).toHaveBeenCalledWith(
      manager,
      'payments.completed',
      'p1',
      expect.objectContaining({ paymentId: 'p1', status: 'COMPLETED', declineReason: null }),
    );
    expect(seen.map((v) => v.status)).toEqual(['COMPLETED']);
  });

  it('records a card decline with its reason and does not count it against the breaker', async () => {
    const { processor, manager } = setup(pending(), () =>
      Promise.resolve<PspResult>({ kind: 'declined', code: 'insufficient_funds' }),
    );

    await expect(processor.process('p1')).resolves.toBe('declined');

    expect(manager.update).toHaveBeenCalledWith(Payment, expect.anything(), {
      status: PaymentStatus.DECLINED,
      declineReason: 'insufficient_funds',
    });
  });

  it.each([
    ['already settled', pending({ status: PaymentStatus.COMPLETED })],
    ['missing', null],
  ])('skips a payment that is %s (duplicate delivery)', async (_name, payment) => {
    const charge = vi.fn(approved);
    const { processor, outbox } = setup(payment, charge);

    await expect(processor.process('p1')).resolves.toBe('skipped');

    expect(charge).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('leaves the payment pending when the provider is unavailable', async () => {
    const { processor, manager, outbox } = setup(pending(), () =>
      Promise.reject(new TransientPspError('down')),
    );

    await expect(processor.process('p1')).rejects.toBeInstanceOf(TransientPspError);

    expect(manager.update).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('writes nothing when another worker settled the payment first', async () => {
    const { processor, outbox, seen } = setup(pending(), approved, 0);

    await processor.process('p1');

    expect(outbox.add).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});

describe('PaymentProcessor.fail', () => {
  it('marks the payment FAILED and writes to payments.completed and payments.dlq', async () => {
    const { processor, manager, outbox } = setup(pending(), approved);

    await processor.fail('p1', 'psp_unavailable');

    expect(manager.update).toHaveBeenCalledWith(Payment, expect.anything(), {
      status: PaymentStatus.FAILED,
      declineReason: 'psp_unavailable',
    });
    expect(outbox.add.mock.calls.map((call) => call[1])).toEqual([
      'payments.completed',
      'payments.dlq',
    ]);
  });

  it('counts a dead letter only when this worker really settled the payment', async () => {
    const won = setup(pending(), approved);
    const lost = setup(pending(), approved, 0);

    await won.processor.fail('p1', 'psp_unavailable');
    await lost.processor.fail('p1', 'psp_unavailable');

    expect(await won.registry.metrics()).toContain('payments_dlq_total 1');
    expect(await lost.registry.metrics()).toContain('payments_dlq_total 0');
  });
});
