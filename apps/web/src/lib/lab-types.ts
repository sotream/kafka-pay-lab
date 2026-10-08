export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface BreakerSnapshot {
  state: BreakerState;
  failures: number;
  retryInMs: number;
}
export interface LagSample {
  total: number;
  partitions: { partition: number; lag: number }[];
}
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'DECLINED' | 'FAILED';
export interface PaymentView {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  declineReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `StreamEvent` in apps/api/src/modules/payments/stream.service.ts. */
export type StreamEvent =
  | {
      type: 'snapshot';
      kafkaEnabled: boolean;
      breaker: BreakerSnapshot;
      lag: LagSample | null;
      outboxPending: number;
      payments: PaymentView[];
    }
  | { type: 'breaker'; breaker: BreakerSnapshot }
  | { type: 'metrics'; lag: LagSample | null; outboxPending: number }
  | { type: 'payment'; payment: PaymentView };

export type Connection = 'connecting' | 'live' | 'reconnecting';
export type LabAction = StreamEvent | { type: 'connection'; connection: Connection };
