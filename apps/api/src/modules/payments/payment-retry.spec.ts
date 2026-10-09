import { CircuitOpenError } from './circuit-breaker.js';
import type { ProcessOutcome } from './payment-processor.js';
import { processWithRetry } from './payment-retry.js';
import { TransientPspError } from './psp.client.js';

const options = { maxAttempts: 4, retryBaseMs: 1000 };

function setup(process: (id: string) => Promise<ProcessOutcome>) {
  const fail = vi.fn().mockResolvedValue(undefined);
  const sleep = vi.fn().mockResolvedValue(undefined);
  return { deps: { process: vi.fn(process), fail }, fail, sleep };
}

describe('processWithRetry', () => {
  it('returns after one successful try', async () => {
    const { deps, sleep } = setup(() => Promise.resolve('completed'));

    await processWithRetry(deps, 'p1', options, sleep);

    expect(deps.process).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient errors with doubling backoff', async () => {
    const process = vi
      .fn()
      .mockRejectedValueOnce(new TransientPspError('x'))
      .mockRejectedValueOnce(new TransientPspError('x'))
      .mockResolvedValueOnce('completed');
    const { deps, sleep, fail } = setup(process);

    await processWithRetry(deps, 'p1', options, sleep);

    expect(deps.process).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(fail).not.toHaveBeenCalled();
  });

  it('marks the payment failed after the last attempt, without throwing', async () => {
    const { deps, sleep, fail } = setup(() => Promise.reject(new TransientPspError('x')));

    await processWithRetry(deps, 'p1', options, sleep);

    expect(deps.process).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect(fail).toHaveBeenCalledExactlyOnceWith('p1', 'psp_unavailable');
  });

  it('lets an open circuit propagate so the consumer can pause, without failing the payment', async () => {
    const { deps, sleep, fail } = setup(() => Promise.reject(new CircuitOpenError()));

    await expect(processWithRetry(deps, 'p1', options, sleep)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );

    expect(fail).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate', async () => {
    const { deps, sleep } = setup(() => Promise.reject(new Error('db down')));

    await expect(processWithRetry(deps, 'p1', options, sleep)).rejects.toThrow('db down');
  });
});
