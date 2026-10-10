import { Registry } from '@prometheus-io/client';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { Repository } from 'typeorm';
import type { OutboxEvent } from './entities/outbox-event.entity.js';
import { OutboxCleanupService } from './outbox-cleanup.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-10T12:00:00Z');

/** Answers each DELETE like the Postgres driver: [returnedRows, affectedCount]. */
function setup(batches: number[], retentionDays = 14) {
  const query = vi.fn();
  for (const affected of batches) query.mockResolvedValueOnce([[], affected]);
  const registry = new Registry();
  const addCronJob = vi.fn();
  const service = new OutboxCleanupService(
    { query } as unknown as Repository<OutboxEvent>,
    {
      get: (key: string) =>
        ({ OUTBOX_RETENTION_DAYS: retentionDays, OUTBOX_CLEANUP_CRON: '0 4 * * *' })[key],
    } as never,
    { addCronJob } as unknown as SchedulerRegistry,
    registry,
  );
  return { service, query, registry, addCronJob };
}

describe('OutboxCleanupService.cleanup', () => {
  it('deletes batch after batch until one comes back short, and returns the total', async () => {
    const { service, query } = setup([3, 3, 1]);

    const removed = await service.cleanup(NOW, 3);

    expect(removed).toBe(7);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('stops after one query when nothing is old enough', async () => {
    const { service, query } = setup([0]);

    expect(await service.cleanup(NOW, 3)).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('only asks for rows published before the cutoff, in bounded batches', async () => {
    const { service, query } = setup([0], 14);

    await service.cleanup(NOW, 1000);

    const [sql, params] = query.mock.calls[0] as [string, [Date, number]];
    expect(sql).toContain('"publishedAt" <');
    expect(sql).not.toMatch(/publishedAt" IS NULL/);
    expect(params[0]).toEqual(new Date(NOW.getTime() - 14 * DAY_MS));
    expect(params[1]).toBe(1000);
  });

  it('counts the deleted rows in outbox_deleted_total, without labels', async () => {
    const { service, registry } = setup([2, 1]);

    await service.cleanup(NOW, 2);

    expect(await registry.metrics()).toContain('outbox_deleted_total 3');
  });
});

describe('OutboxCleanupService.onApplicationBootstrap', () => {
  it('schedules the job when retention is on', () => {
    const { service, addCronJob } = setup([], 14);

    service.onApplicationBootstrap();

    expect(addCronJob).toHaveBeenCalledWith('outbox-cleanup', expect.anything());
  });

  it('schedules nothing when retention is 0 (off)', () => {
    const { service, addCronJob } = setup([], 0);

    service.onApplicationBootstrap();

    expect(addCronJob).not.toHaveBeenCalled();
  });
});
