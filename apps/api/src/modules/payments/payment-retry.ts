import { TransientPspError } from './psp.client.js';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Processing {
  process(paymentId: string): Promise<unknown>;
  fail(paymentId: string, reason: string): Promise<void>;
}

/**
 * Tries one payment up to `maxAttempts` times with doubling backoff. Only transient provider errors are
 * retried; an open circuit or any other error propagates so the consumer can pause or crash loudly.
 */
export async function processWithRetry(
  deps: Processing,
  paymentId: string,
  options: { maxAttempts: number; retryBaseMs: number },
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.process(paymentId);
      return;
    } catch (error) {
      if (!(error instanceof TransientPspError)) throw error;
      if (attempt >= options.maxAttempts) {
        await deps.fail(paymentId, 'psp_unavailable');
        return;
      }
      await sleep(options.retryBaseMs * 2 ** (attempt - 1));
    }
  }
}
