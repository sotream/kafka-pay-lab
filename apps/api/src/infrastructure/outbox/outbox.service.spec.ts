import { SpanKind } from '@opentelemetry/api';
import type { EntityManager, Repository } from 'typeorm';
import { setupTestTracing } from '../../../test/helpers/tracing.js';
import { withSpan } from '../telemetry/trace-context.js';
import type { OutboxEvent } from './entities/outbox-event.entity.js';
import { OutboxService, ageSeconds } from './outbox.service.js';

function fakeManager() {
  const inserted: Partial<OutboxEvent>[] = [];
  const manager = {
    insert: (_entity: unknown, row: Partial<OutboxEvent>) => {
      inserted.push(row);
      return Promise.resolve();
    },
  } as unknown as EntityManager;
  return { manager, inserted };
}

describe('OutboxService.add', () => {
  const tracing = setupTestTracing();
  afterAll(() => tracing.shutdown());
  const service = new OutboxService({} as Repository<OutboxEvent>);

  it('stores the active trace context on the row', async () => {
    const { manager, inserted } = fakeManager();

    await withSpan('request', { kind: SpanKind.SERVER }, () => service.add(manager, 't', 'k', {}));

    expect(inserted[0]?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  });
});

describe('ageSeconds', () => {
  it('is 0 when nothing is waiting', () => {
    expect(ageSeconds(null, 1_000_000)).toBe(0);
  });

  it('measures the age of the oldest waiting row', () => {
    expect(ageSeconds(new Date(1_000_000 - 42_000), 1_000_000)).toBe(42);
  });

  it('never goes negative when clocks disagree', () => {
    expect(ageSeconds(new Date(2_000_000), 1_000_000)).toBe(0);
  });
});
