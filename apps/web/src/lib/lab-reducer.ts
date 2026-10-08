import type { BreakerSnapshot, Connection, LabAction, LagSample, PaymentView } from './lab-types';

export interface LabState {
  connection: Connection;
  kafkaEnabled: boolean;
  breaker: BreakerSnapshot | null;
  lag: LagSample | null;
  outboxPending: number;
  payments: PaymentView[];
}

export const initialState: LabState = {
  connection: 'connecting',
  kafkaEnabled: true,
  breaker: null,
  lag: null,
  outboxPending: 0,
  payments: [],
};

const MAX_PAYMENTS = 100;

/** Keeps the newer version of a payment: a buffered stream event can be older than the snapshot row. */
function upsert(list: PaymentView[], payment: PaymentView): PaymentView[] {
  const existing = list.find((p) => p.id === payment.id);
  if (!existing) return [payment, ...list].slice(0, MAX_PAYMENTS);
  if (existing.updatedAt > payment.updatedAt) return list;
  return list.map((p) => (p.id === payment.id ? payment : p));
}

export function reduce(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'connection':
      return { ...state, connection: action.connection };
    case 'snapshot':
      return {
        ...state,
        connection: 'live',
        kafkaEnabled: action.kafkaEnabled,
        breaker: action.breaker,
        lag: action.lag,
        outboxPending: action.outboxPending,
        payments: action.payments.slice(0, MAX_PAYMENTS),
      };
    case 'breaker':
      return { ...state, breaker: action.breaker };
    case 'metrics':
      return { ...state, lag: action.lag, outboxPending: action.outboxPending };
    case 'payment':
      return { ...state, payments: upsert(state.payments, action.payment) };
  }
}
