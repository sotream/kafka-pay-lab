import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { Payment, PaymentStatus } from './entities/payment.entity.js';
import { PAYMENT_COMPLETED_TOPIC, PAYMENT_DLQ_TOPIC } from './payment-events.js';
import type { PaymentCompletedEvent, PaymentDlqEvent } from './payment-events.js';
import { PaymentFeed } from './payment-feed.js';
import { PAYMENT_BREAKER } from './payments.constants.js';
import { toPaymentView } from './payment.view.js';
import { PspClient } from './psp.client.js';

export type ProcessOutcome = 'skipped' | 'completed' | 'declined';

@Injectable()
export class PaymentProcessor {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly psp: PspClient,
    @Inject(PAYMENT_BREAKER) private readonly breaker: CircuitBreaker,
    private readonly outbox: OutboxService,
    private readonly feed: PaymentFeed,
  ) {}

  /**
   * Charges one pending payment through the breaker. Throws CircuitOpenError or TransientPspError when
   * the provider cannot answer; the payment then stays PENDING for the caller to retry or pause on.
   */
  async process(paymentId: string): Promise<ProcessOutcome> {
    const payment = await this.payments.findOneBy({ id: paymentId });
    // Kafka delivers at least once, so a settled or unknown payment is a duplicate, not an error.
    if (payment?.status !== PaymentStatus.PENDING) return 'skipped';

    const result = await this.breaker.execute(() =>
      this.psp.charge(
        { amount: payment.amount, currency: payment.currency, cardToken: payment.cardToken },
        payment.id,
      ),
    );
    if (result.kind === 'approved') {
      await this.settle(payment, PaymentStatus.COMPLETED, null);
      return 'completed';
    }
    await this.settle(payment, PaymentStatus.DECLINED, result.code);
    return 'declined';
  }

  /** Gives up on a payment after all retries: FAILED, announced, and copied to the dead-letter topic. */
  async fail(paymentId: string, reason: string): Promise<void> {
    const payment = await this.payments.findOneBy({ id: paymentId });
    if (payment?.status === PaymentStatus.PENDING) {
      await this.settle(payment, PaymentStatus.FAILED, reason, true);
    }
  }

  /** Status change and its outbox events commit together; the status guard makes a lost race a no-op. */
  private async settle(
    payment: Payment,
    status: PaymentStatus,
    reason: string | null,
    deadLetter = false,
  ): Promise<void> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.update(
        Payment,
        { id: payment.id, status: PaymentStatus.PENDING },
        { status, declineReason: reason },
      );
      if (!affected) return false;
      const occurredAt = new Date().toISOString();
      const completed: PaymentCompletedEvent = {
        paymentId: payment.id,
        status,
        declineReason: reason,
        occurredAt,
      };
      await this.outbox.add(manager, PAYMENT_COMPLETED_TOPIC, payment.id, completed);
      if (deadLetter) {
        const dead: PaymentDlqEvent = {
          paymentId: payment.id,
          reason: reason ?? 'unknown',
          occurredAt,
        };
        await this.outbox.add(manager, PAYMENT_DLQ_TOPIC, payment.id, dead);
      }
      return true;
    });
    if (changed) {
      this.feed.payment$.next(
        toPaymentView({ ...payment, status, declineReason: reason, updatedAt: new Date() }),
      );
    }
  }
}
