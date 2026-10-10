import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Counter, Registry } from '@prometheus-io/client';
import { CronJob } from 'cron';
import { Repository } from 'typeorm';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { OutboxEvent } from './entities/outbox-event.entity.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;
const JOB_NAME = 'outbox-cleanup';

/**
 * Deletes outbox rows that were published more than OUTBOX_RETENTION_DAYS ago. Consumers read from Kafka,
 * not from this table, so a published row is only history; unpublished rows are never touched
 * (docs/adr/0014-outbox-retention.md). Retention 0 switches the job off.
 */
@Injectable()
export class OutboxCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxCleanupService.name);
  private readonly deletedTotal: Counter;

  constructor(
    @InjectRepository(OutboxEvent) private readonly events: Repository<OutboxEvent>,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly scheduler: SchedulerRegistry,
    registry: Registry,
  ) {
    this.deletedTotal = new Counter({
      name: 'outbox_deleted_total',
      help: 'Published outbox rows removed by the retention job',
      registers: [registry],
    });
  }

  /** The schedule comes from config, which decorators cannot read, so the job is registered here. */
  onApplicationBootstrap(): void {
    if (this.config.get('OUTBOX_RETENTION_DAYS', { infer: true }) === 0) return;
    const job = CronJob.from({
      cronTime: this.config.get('OUTBOX_CLEANUP_CRON', { infer: true }),
      onTick: () => void this.runSafely(),
      start: true,
    });
    this.scheduler.addCronJob(JOB_NAME, job);
  }

  /**
   * Deletes in batches of `batchSize`, so no single statement holds locks for long. `FOR UPDATE SKIP
   * LOCKED` lets several replicas run the job at once without deleting the same row twice. Returns the
   * rows deleted.
   */
  async cleanup(now = new Date(), batchSize = BATCH_SIZE): Promise<number> {
    const publishedBefore = new Date(
      now.getTime() - this.config.get('OUTBOX_RETENTION_DAYS', { infer: true }) * DAY_MS,
    );
    let total = 0;
    let deleted: number;
    do {
      deleted = await this.deleteBatch(publishedBefore, batchSize);
      total += deleted;
    } while (deleted === batchSize);
    this.deletedTotal.inc(total);
    return total;
  }

  private async deleteBatch(publishedBefore: Date, limit: number): Promise<number> {
    // `<` is never true for NULL, so unpublished rows (publishedAt IS NULL) cannot match.
    // The Postgres driver answers a DELETE with [returnedRows, affectedCount].
    const [, affected]: [unknown, number] = await this.events.query(
      `DELETE FROM outbox_events WHERE id IN (
         SELECT id FROM outbox_events
         WHERE "publishedAt" < $1
         ORDER BY id
         LIMIT $2 FOR UPDATE SKIP LOCKED
       )`,
      [publishedBefore, limit],
    );
    return affected;
  }

  private async runSafely(): Promise<void> {
    try {
      const removed = await this.cleanup();
      this.logger.log(`Removed ${removed} published outbox rows`);
    } catch (error) {
      this.logger.error(`Outbox cleanup failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
