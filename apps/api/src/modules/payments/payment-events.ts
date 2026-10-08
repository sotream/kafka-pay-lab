import type { PaymentStatus } from './entities/payment.entity.js';

export const PAYMENT_REQUESTED_TOPIC = 'payments.requested';
export const PAYMENT_COMPLETED_TOPIC = 'payments.completed';
export const PAYMENT_DLQ_TOPIC = 'payments.dlq';

export interface PaymentRequestedEvent {
  paymentId: string;
  amount: number;
  currency: string;
  occurredAt: string;
}

export interface PaymentCompletedEvent {
  paymentId: string;
  status: PaymentStatus;
  declineReason: string | null;
  occurredAt: string;
}

export interface PaymentDlqEvent {
  paymentId: string;
  reason: string;
  occurredAt: string;
}

/** Returns the payment id of a `payments.requested` message, or null when the message is unusable. */
export function parsePaymentId(value: Buffer | null): string | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value.toString());
    if (typeof parsed === 'object' && parsed !== null && 'paymentId' in parsed) {
      return typeof parsed.paymentId === 'string' ? parsed.paymentId : null;
    }
  } catch {
    // fall through: not JSON
  }
  return null;
}
