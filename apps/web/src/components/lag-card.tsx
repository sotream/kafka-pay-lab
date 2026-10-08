import type { LagSample } from '@/lib/lab-types';
import { Hint } from './hint';

interface Props {
  lag: LagSample | null;
  outboxPending: number;
  kafkaEnabled: boolean;
}

export function LagCard({ lag, outboxPending, kafkaEnabled }: Props) {
  const max = Math.max(1, ...(lag?.partitions.map((p) => p.lag) ?? [1]));
  return (
    <section className="rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="font-semibold">
        Consumer lag
        <Hint text="Lag = payment messages waiting in the Kafka topic payments.requested that the consumer has not processed yet (newest offset minus last committed offset). It grows when the consumer is paused (breaker OPEN) or is slower than payments arrive." />
      </h2>
      {!kafkaEnabled ? (
        <p className="mt-2 text-sm text-neutral-500">Kafka is disabled, so there is no lag.</p>
      ) : lag ? (
        <>
          <p
            className="mt-2 font-mono text-3xl"
            title="Total messages waiting across all partitions"
          >
            {lag.total}
          </p>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            messages waiting. 0 means the consumer has caught up.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {lag.partitions.map((p) => (
              <li
                key={p.partition}
                className="flex items-center gap-2"
                title={`Partition ${p.partition}: ${p.lag} messages waiting. A topic is split into partitions that are read in parallel.`}
              >
                <span className="w-16 text-neutral-500">part. {p.partition}</span>
                <span className="h-2 flex-1 rounded bg-neutral-200 dark:bg-neutral-800">
                  <span
                    className="block h-2 rounded bg-blue-600"
                    style={{ width: `${(p.lag / max) * 100}%` }}
                  />
                </span>
                <span className="w-10 text-right font-mono">{p.lag}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">
          Lag is not available yet (is Kafka running?).
        </p>
      )}
      <p
        className="mt-3 text-sm"
        title="Events saved in Postgres but not yet published to Kafka. It grows when Kafka is unreachable and drains when it comes back."
      >
        Outbox backlog: <span className="font-mono">{outboxPending}</span>
        <Hint text="The outbox holds events written to the database together with the payment. A background relay publishes them to Kafka. If Kafka is down, they wait here instead of being lost." />
      </p>
    </section>
  );
}
