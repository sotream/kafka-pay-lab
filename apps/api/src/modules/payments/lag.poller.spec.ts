import { computeLag } from './lag.poller.js';

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
