import type { Kafka } from 'kafkajs';
import { LagPoller, computeLag } from './lag.poller.js';

describe('computeLag', () => {
  it('is latest offset minus committed offset, per partition and in total', () => {
    const sample = computeLag(
      [
        { partition: 0, high: '10', low: '0' },
        { partition: 1, high: '7', low: '0' },
      ],
      [
        { partition: 0, offset: '4' },
        { partition: 1, offset: '7' },
      ],
    );

    expect(sample).toEqual({
      total: 6,
      partitions: [
        { partition: 0, lag: 6 },
        { partition: 1, lag: 0 },
      ],
    });
  });

  it('counts from the earliest offset when the group has not committed yet (-1)', () => {
    const sample = computeLag(
      [{ partition: 0, high: '9', low: '3' }],
      [{ partition: 0, offset: '-1' }],
    );

    expect(sample.total).toBe(6);
  });

  it('never goes negative', () => {
    expect(
      computeLag([{ partition: 0, high: '2', low: '0' }], [{ partition: 0, offset: '5' }]).total,
    ).toBe(0);
  });
});

describe('LagPoller connection', () => {
  const config = { get: () => true } as never;

  it('shares one pending connect between concurrent samples while the broker is unreachable', async () => {
    const admin = vi.fn(() => ({ connect: () => new Promise<void>(() => {}) }));
    const poller = new LagPoller({ admin } as unknown as Kafka, config);

    void poller.sample();
    void poller.sample();
    await Promise.resolve();

    expect(admin).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failed connect', async () => {
    const admin = vi.fn(() => ({ connect: () => Promise.reject(new Error('down')) }));
    const poller = new LagPoller({ admin } as unknown as Kafka, config);

    await expect(poller.sample()).rejects.toThrow('down');
    await expect(poller.sample()).rejects.toThrow('down');

    expect(admin).toHaveBeenCalledTimes(2);
  });
});
