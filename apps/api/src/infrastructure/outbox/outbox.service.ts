import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { currentTraceparent, withSpan } from '../telemetry/trace-context.js';
import { OutboxEvent } from './entities/outbox-event.entity.js';

@Injectable()
export class OutboxService {
  constructor(@InjectRepository(OutboxEvent) private readonly events: Repository<OutboxEvent>) {}

  /** Call inside the transaction that changes business data, so both commit or neither does. */
  async add(manager: EntityManager, topic: string, key: string, payload: object): Promise<void> {
    await withSpan(
      'outbox.add',
      { attributes: { 'messaging.destination.name': topic } },
      async () => {
        // Read inside the span so the relay's span becomes a child of this one.
        await manager.insert(OutboxEvent, {
          topic,
          key,
          payload,
          traceparent: currentTraceparent(),
        });
      },
    );
  }

  /** Backlog size and the age of the oldest unpublished row: the two numbers that say whether the relay keeps up. */
  async stats(): Promise<{ pending: number; oldestAgeSeconds: number }> {
    const row = await this.events
      .createQueryBuilder('event')
      .select('COUNT(*)', 'pending')
      .addSelect('MIN(event.createdAt)', 'oldest')
      .where('event.publishedAt IS NULL')
      .getRawOne<{ pending: string; oldest: Date | null }>();
    return {
      pending: Number(row?.pending ?? 0),
      oldestAgeSeconds: ageSeconds(row?.oldest ?? null, Date.now()),
    };
  }

  pendingCount(): Promise<number> {
    return this.events.count({ where: { publishedAt: IsNull() } });
  }
}

export function ageSeconds(oldest: Date | null, now: number): number {
  return oldest ? Math.max(0, Math.floor((now - new Date(oldest).getTime()) / 1000)) : 0;
}
