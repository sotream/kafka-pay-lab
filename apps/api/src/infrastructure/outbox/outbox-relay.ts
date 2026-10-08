import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { EventPublisher } from '../messaging/event-publisher.port.js';
import { OutboxEvent } from './entities/outbox-event.entity.js';

const BATCH_SIZE = 50;

/**
 * Publishes outbox rows to Kafka in insertion order. Delivery is at-least-once: a crash between publish and
 * commit re-sends a row, so consumers must be idempotent.
 */
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  /** `pollMs` null keeps the relay idle (Kafka disabled, or tests that call `tick` themselves). */
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventPublisher,
    private readonly pollMs: number | null,
  ) {}

  onApplicationBootstrap(): void {
    if (this.pollMs !== null) this.schedule(this.pollMs);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Publishes one batch and returns how many rows were published. Stops at the first publish error. */
  async tick(): Promise<number> {
    const { published, failure } = await this.dataSource.transaction(async (manager) => {
      const rows = await manager
        .getRepository(OutboxEvent)
        .createQueryBuilder('event')
        .where('event.publishedAt IS NULL')
        .orderBy('event.id', 'ASC')
        .limit(BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      const done: OutboxEvent[] = [];
      let error: unknown;
      for (const row of rows) {
        try {
          await this.events.publish(row.topic, { key: row.key, payload: row.payload });
        } catch (publishError) {
          error = publishError;
          break;
        }
        row.publishedAt = new Date();
        done.push(row);
      }
      if (done.length > 0) await manager.save(done);
      return { published: done.length, failure: error };
    });
    if (failure) this.logger.warn(`Publish failed, will retry: ${String(failure)}`);
    return published;
  }

  /** setTimeout chain instead of setInterval, so a slow tick never overlaps the next one. */
  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.run(delayMs), delayMs);
  }

  private async run(delayMs: number): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Outbox tick failed: ${String(error)}`);
    } finally {
      if (!this.stopped) this.schedule(delayMs);
    }
  }
}
