import { initialState, reduce } from './lab-reducer';
import type { PaymentView } from './lab-types';

const payment = (id: string, status: PaymentView['status'] = 'PENDING'): PaymentView => ({
  id,
  amount: 1000,
  currency: 'USD',
  status,
  declineReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const closed = { state: 'CLOSED', failures: 0, retryInMs: 0 } as const;

describe('lab reducer', () => {
  it('a snapshot replaces everything and marks the stream live', () => {
    const next = reduce(initialState, {
      type: 'snapshot',
      kafkaEnabled: true,
      breaker: closed,
      lag: { total: 3, partitions: [{ partition: 0, lag: 3 }] },
      outboxPending: 2,
      payments: [payment('a')],
    });

    expect(next).toMatchObject({
      connection: 'live',
      kafkaEnabled: true,
      breaker: closed,
      outboxPending: 2,
    });
    expect(next.payments.map((p) => p.id)).toEqual(['a']);
  });

  it('puts a new payment first and updates an existing one in place', () => {
    let state = reduce(initialState, { type: 'payment', payment: payment('a') });
    state = reduce(state, { type: 'payment', payment: payment('b') });
    state = reduce(state, { type: 'payment', payment: payment('a', 'COMPLETED') });

    expect(state.payments.map((p) => [p.id, p.status])).toEqual([
      ['b', 'PENDING'],
      ['a', 'COMPLETED'],
    ]);
  });

  it('ignores an older version of a payment it already has', () => {
    const newer = { ...payment('a', 'COMPLETED'), updatedAt: '2026-01-01T00:00:05.000Z' };
    let state = reduce(initialState, { type: 'payment', payment: newer });
    state = reduce(state, { type: 'payment', payment: payment('a', 'PENDING') });

    expect(state.payments.map((p) => p.status)).toEqual(['COMPLETED']);
  });

  it('keeps at most 100 payments', () => {
    let state = initialState;
    for (let i = 0; i < 120; i++) {
      state = reduce(state, { type: 'payment', payment: payment(`p${i}`) });
    }

    expect(state.payments).toHaveLength(100);
    expect(state.payments[0]?.id).toBe('p119');
  });

  it('applies breaker and metrics events and connection changes', () => {
    let state = reduce(initialState, {
      type: 'breaker',
      breaker: { state: 'OPEN', failures: 5, retryInMs: 8000 },
    });
    state = reduce(state, { type: 'metrics', lag: null, outboxPending: 7 });
    state = reduce(state, { type: 'connection', connection: 'reconnecting' });

    expect(state).toMatchObject({
      breaker: { state: 'OPEN' },
      lag: null,
      outboxPending: 7,
      connection: 'reconnecting',
    });
  });
});
