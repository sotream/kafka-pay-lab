import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';
import type { CreatePaymentDto, LoadPaymentsDto } from './dto/payment.dto.js';
import { Payment, PaymentStatus } from './entities/payment.entity.js';
import { PAYMENT_REQUESTED_TOPIC } from './payment-events.js';
import type { PaymentRequestedEvent } from './payment-events.js';
import { PaymentFeed } from './payment-feed.js';
import { toPaymentView } from './payment.view.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Random whole amount between 10.00 and 499.00 (minor units), never a magic suffix. */
const randomAmount = (): number => (10 + Math.floor(Math.random() * 490)) * 100;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly outbox: OutboxService,
    private readonly feed: PaymentFeed,
  ) {}

  /** Payment row and outbox row commit together; Kafka is the relay's problem, not the request's. */
  async create(dto: CreatePaymentDto): Promise<Payment> {
    const payment = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(Payment, {
          amount: dto.amount,
          currency: dto.currency,
          cardToken: dto.cardToken,
          status: PaymentStatus.PENDING,
        }),
      );
      const event: PaymentRequestedEvent = {
        paymentId: saved.id,
        amount: saved.amount,
        currency: saved.currency,
        occurredAt: new Date().toISOString(),
      };
      await this.outbox.add(manager, PAYMENT_REQUESTED_TOPIC, saved.id, event);
      return saved;
    });
    this.feed.payment$.next(toPaymentView(payment));
    return payment;
  }

  recent(limit = 50): Promise<Payment[]> {
    return this.payments.find({ order: { createdAt: 'DESC', id: 'ASC' }, take: limit });
  }

  /** Background load generator behind `POST /payments/load`. Never throws: a failed insert is logged and skipped. */
  async runLoad(dto: LoadPaymentsDto): Promise<void> {
    for (let i = 0; i < dto.count; i++) {
      try {
        await this.create({
          amount: dto.amount ?? randomAmount(),
          currency: 'USD',
          cardToken: 'tok_load',
        });
      } catch (error) {
        this.logger.warn(`Load payment ${i + 1}/${dto.count} failed: ${String(error)}`);
      }
      if (dto.intervalMs > 0 && i < dto.count - 1) await sleep(dto.intervalMs);
    }
  }
}
