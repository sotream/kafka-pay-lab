import { OutboxRelay } from '../src/infrastructure/outbox/outbox-relay.js';
import type {
  EventPublisher,
  PublishedEvent,
} from '../src/infrastructure/messaging/event-publisher.port.js';
import { createTestApp } from './helpers/test-app.js';
import type { TestApp } from './helpers/test-app.js';

class FakePublisher implements EventPublisher {
  readonly keys: string[] = [];
  /** Reject once this many events were published. */
  failAfter: number | null = null;

  publish<T>(_topic: string, { key }: PublishedEvent<T>): Promise<void> {
    if (this.failAfter !== null && this.keys.length >= this.failAfter) {
      return Promise.reject(new Error('broker down'));
    }
    this.keys.push(key);
    return Promise.resolve();
  }
}

describe('outbox relay (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const seed = (count: number) =>
    ctx.dataSource.query(
      `INSERT INTO outbox_events (topic, key, payload)
       SELECT 't', 'k' || g, '{}'::jsonb FROM generate_series(1, $1) g`,
      [count],
    );
  const pending = async (): Promise<number> =>
    Number(
      (
        await ctx.dataSource.query(`SELECT count(*) FROM outbox_events WHERE "publishedAt" IS NULL`)
      )[0].count,
    );

  it('publishes pending rows in insertion order and marks them published', async () => {
    const publisher = new FakePublisher();
    await seed(3);

    const published = await new OutboxRelay(ctx.dataSource, publisher, null).tick();

    expect(published).toBe(3);
    expect(publisher.keys).toEqual(['k1', 'k2', 'k3']);
    expect(await pending()).toBe(0);
  });

  it('keeps the failed row and everything after it pending, then resumes in order', async () => {
    const publisher = new FakePublisher();
    const relay = new OutboxRelay(ctx.dataSource, publisher, null);
    await seed(5);

    publisher.failAfter = 2;
    expect(await relay.tick()).toBe(2);
    expect(await pending()).toBe(3);

    publisher.failAfter = null;
    expect(await relay.tick()).toBe(3);
    expect(publisher.keys).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
  });
});
