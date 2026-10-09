import { withSpan } from '../../infrastructure/telemetry/trace-context.js';
import type { MessageOutcome, ProcessOutcome } from './payment-processor.js';
import { TransientPspError } from './psp.client.js';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Processing {
  process(paymentId: string): Promise<ProcessOutcome>;
  fail(paymentId: string, reason: string): Promise<void>;
}

/**
 * Tries one payment up to `maxAttempts` times with doubling backoff. Only transient provider errors are
 * retried; an open circuit or any other error propagates so the consumer can pause or crash loudly.
 */
export async function processWithRetry(
  deps: Processing,
  paymentId: string,
  options: { maxAttempts: number; retryBaseMs: number; onRetry?: () => void },
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<MessageOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withSpan(
        'payment.attempt',
        { attributes: { 'payment.id': paymentId, 'payment.attempt': attempt } },
        () => deps.process(paymentId),
      );
    } catch (error) {
      if (!(error instanceof TransientPspError)) throw error;
      if (attempt >= options.maxAttempts) {
        await deps.fail(paymentId, 'psp_unavailable');
        return 'failed';
      }
      options.onRetry?.();
      await sleep(options.retryBaseMs * 2 ** (attempt - 1));
    }
  }
}
