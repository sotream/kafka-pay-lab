import { OutboxCleanupService } from '../src/infrastructure/outbox/outbox-cleanup.service.js';
import { createTestApp } from './helpers/test-app.js';
import type { TestApp } from './helpers/test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-10T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe('outbox cleanup (e2e)', () => {
  let ctx: TestApp;
  let cleanup: OutboxCleanupService;

  beforeAll(async () => {
    ctx = await createTestApp();
    cleanup = ctx.app.get(OutboxCleanupService);
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const insert = (key: string, createdAt: Date, publishedAt: Date | null) =>
    ctx.dataSource.query(
      `INSERT INTO outbox_events (topic, key, payload, "createdAt", "publishedAt")
       VALUES ('t', $1, '{}'::jsonb, $2, $3)`,
      [key, createdAt, publishedAt],
    );
  const remaining = async (): Promise<string[]> =>
    (
      (await ctx.dataSource.query('SELECT key FROM outbox_events ORDER BY key')) as {
        key: string;
      }[]
    ).map((row) => row.key);

  it('removes rows published long ago and keeps recent and unpublished ones', async () => {
    // Retention defaults to 14 days.
    await insert('old-published', daysAgo(30), daysAgo(15));
    await insert('recent-published', daysAgo(3), daysAgo(2));
    await insert('old-unpublished', daysAgo(30), null);

    const removed = await cleanup.cleanup(NOW);

    expect(removed).toBe(1);
    expect(await remaining()).toEqual(['old-unpublished', 'recent-published']);
  });

  it('never deletes an unpublished row, however old it is', async () => {
    await insert('stuck-1', daysAgo(400), null);
    await insert('stuck-2', daysAgo(900), null);

    expect(await cleanup.cleanup(NOW)).toBe(0);
    expect(await remaining()).toEqual(['stuck-1', 'stuck-2']);
  });

  it('works through batches', async () => {
    for (let i = 0; i < 5; i += 1) await insert(`old${i}`, daysAgo(30), daysAgo(20));
    await insert('keep', daysAgo(1), daysAgo(1));

    expect(await cleanup.cleanup(NOW, 2)).toBe(5);
    expect(await remaining()).toEqual(['keep']);
  });
});
