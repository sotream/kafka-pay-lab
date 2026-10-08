import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { OutboxEvent } from './entities/outbox-event.entity.js';

@Injectable()
export class OutboxService {
  constructor(@InjectRepository(OutboxEvent) private readonly events: Repository<OutboxEvent>) {}

  /** Call inside the transaction that changes business data, so both commit or neither does. */
  async add(manager: EntityManager, topic: string, key: string, payload: object): Promise<void> {
    await manager.insert(OutboxEvent, { topic, key, payload });
  }

  pendingCount(): Promise<number> {
    return this.events.count({ where: { publishedAt: IsNull() } });
  }
}
