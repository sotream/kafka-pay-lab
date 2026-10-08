import { CircuitBreaker } from './circuit-breaker.js';
import { PaymentFeed } from './payment-feed.js';
import { StreamService } from './stream.service.js';
import type { StreamEvent } from './stream.service.js';
import type { PaymentView } from './payment.view.js';

const view: PaymentView = {
  id: 'p1',
  amount: 1000,
  currency: 'USD',
  status: 'PENDING' as PaymentView['status'],
  declineReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function setup() {
  const feed = new PaymentFeed();
  const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
  const lag = {
    sample: vi.fn().mockResolvedValue({ total: 4, partitions: [{ partition: 0, lag: 4 }] }),
  };
  const outbox = { pendingCount: vi.fn().mockResolvedValue(2) };
  const payments = {
    recent: vi
      .fn()
      .mockResolvedValue([
        { ...view, createdAt: new Date(view.createdAt), updatedAt: new Date(view.updatedAt) },
      ]),
  };
  const config = { get: (key: string) => (key === 'KAFKA_ENABLED' ? true : 1000) };
  const service = new StreamService(
    feed,
    breaker,
    lag as never,
    outbox as never,
    payments as never,
    config as never,
  );
  return { service, feed, lag, outbox, payments };
}

describe('StreamService', () => {
  it('starts every connection with a full snapshot, then relays live events', async () => {
    const { service, feed } = setup();
    const events: StreamEvent[] = [];
    const subscription = service.open().subscribe((event) => events.push(event));
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({
      type: 'snapshot',
      kafkaEnabled: true,
      breaker: { state: 'CLOSED' },
      payments: [{ id: 'p1' }],
    });

    feed.payment$.next({ ...view, status: 'COMPLETED' as PaymentView['status'] });
    feed.breaker$.next({ state: 'OPEN', failures: 5, retryInMs: 9000 });

    expect(events.slice(1)).toEqual([
      { type: 'payment', payment: { ...view, status: 'COMPLETED' } },
      { type: 'breaker', breaker: { state: 'OPEN', failures: 5, retryInMs: 9000 } },
    ]);
    subscription.unsubscribe();
  });

  it('does not lose a payment update that happens while the snapshot is being built', async () => {
    const { service, feed, payments } = setup();
    let finishQuery!: () => void;
    payments.recent.mockReturnValue(
      new Promise((resolve) => {
        finishQuery = () => resolve([]);
      }),
    );
    const events: StreamEvent[] = [];
    const subscription = service.open().subscribe((event) => events.push(event));

    feed.payment$.next({ ...view, status: 'COMPLETED' as PaymentView['status'] });
    finishQuery();

    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events.map((e) => e.type)).toEqual(['snapshot', 'payment']);
    subscription.unsubscribe();
  });

  it('publishes lag and outbox backlog on every tick', async () => {
    const { service } = setup();
    const events: StreamEvent[] = [];
    const subscription = service.open().subscribe((event) => events.push(event));
    await vi.waitFor(() => expect(events).toHaveLength(1));

    await service.tick();

    expect(events).toContainEqual({
      type: 'metrics',
      lag: { total: 4, partitions: [{ partition: 0, lag: 4 }] },
      outboxPending: 2,
    });
    subscription.unsubscribe();
  });

  it('reports lag as null instead of failing the tick when the broker is unreachable', async () => {
    const { service, lag } = setup();
    lag.sample.mockRejectedValue(new Error('broker down'));
    const events: StreamEvent[] = [];
    const subscription = service.open().subscribe((event) => events.push(event));
    await vi.waitFor(() => expect(events).toHaveLength(1));

    await service.tick();

    expect(events).toContainEqual({ type: 'metrics', lag: null, outboxPending: 2 });
    subscription.unsubscribe();
  });

  it('releases its subscriptions when the client disconnects', async () => {
    const { service, feed } = setup();
    const subscription = service.open().subscribe();
    await vi.waitFor(() => expect(feed.payment$.observed).toBe(true));

    subscription.unsubscribe();

    expect(feed.payment$.observed).toBe(false);
    expect(feed.breaker$.observed).toBe(false);
  });
});
