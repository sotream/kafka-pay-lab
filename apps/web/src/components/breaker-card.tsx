import type { BreakerSnapshot, BreakerState } from '@/lib/lab-types';
import { Hint } from './hint';

const LOOK: Record<BreakerState, { label: string; box: string; help: string }> = {
  CLOSED: {
    label: 'CLOSED',
    box: 'border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100',
    help: 'Healthy. Payments are sent to the provider normally.',
  },
  OPEN: {
    label: 'OPEN',
    box: 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100',
    help: 'The provider is considered down. Calls are blocked and the consumer is paused, so payments wait in Kafka and lag grows.',
  },
  HALF_OPEN: {
    label: 'HALF_OPEN',
    box: 'border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
    help: 'Testing recovery. One trial payment goes through: success closes the breaker, failure opens it again.',
  },
};

export function BreakerCard({ breaker }: { breaker: BreakerSnapshot | null }) {
  const look = breaker ? LOOK[breaker.state] : null;
  return (
    <section className="rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="font-semibold">
        Circuit breaker
        <Hint text="A safety switch around the payment provider. After several failures in a row it opens and stops calling the provider, so a broken provider is not hammered. It tests the provider again after a pause." />
      </h2>
      {breaker && look ? (
        <>
          <div
            className={`mt-2 inline-block rounded-md border px-3 py-1 font-mono text-lg ${look.box}`}
            title={look.help}
          >
            {look.label}
          </div>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{look.help}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt title="Provider calls that failed in a row. Reaching the limit (5 by default) opens the breaker. Any success resets it to 0.">
              Failures in a row
            </dt>
            <dd className="font-mono">{breaker.failures}</dd>
            <dt title="While OPEN: seconds until the breaker lets one trial payment through.">
              Next trial in
            </dt>
            <dd className="font-mono">
              {breaker.state === 'OPEN' ? `${Math.ceil(breaker.retryInMs / 1000)} s` : '–'}
            </dd>
          </dl>
        </>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">Waiting for data…</p>
      )}
    </section>
  );
}
