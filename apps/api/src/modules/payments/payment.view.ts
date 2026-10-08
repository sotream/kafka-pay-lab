import type { Payment, PaymentStatus } from './entities/payment.entity.js';

/** What the dashboard sees: no card token, dates as ISO strings. */
export interface PaymentView {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  declineReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPaymentView(payment: Payment): PaymentView {
  return {
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    declineReason: payment.declineReason,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}
