'use client';

import { BreakerCard } from '@/components/breaker-card';
import { HelpPanel } from '@/components/help-panel';
import { LagCard } from '@/components/lag-card';
import { LoadForm } from '@/components/load-form';
import { PaymentsTable } from '@/components/payments-table';
import { API_URL, KAFKA_UI_URL, PSP_URL } from '@/lib/lab-api';
import { useLabStream } from '@/lib/use-lab-stream';

const CONNECTION = {
  connecting: 'Connecting to the API…',
  live: 'Live',
  reconnecting: 'Connection lost, reconnecting…',
} as const;

export default function DashboardPage() {
  const lab = useLabStream(`${API_URL}/api/v1/stream`);
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">kafka-pay-lab</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Watch payments flow through Kafka, build consumer lag and trip a circuit breaker.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <span
            title="Live connection to the API (server-sent events)"
            className={
              lab.connection === 'live'
                ? 'text-green-700 dark:text-green-400'
                : 'text-amber-700 dark:text-amber-400'
            }
          >
            ● {CONNECTION[lab.connection]}
          </span>
          <a
            className="underline"
            href={PSP_URL}
            target="_blank"
            rel="noreferrer"
            title="Open the payment provider simulator to make it slow, decline payments or go down"
          >
            Provider simulator ↗
          </a>
          <a
            className="underline"
            href={KAFKA_UI_URL}
            target="_blank"
            rel="noreferrer"
            title="Open Kafka UI to inspect topics, partitions, messages and consumer groups"
          >
            Kafka UI ↗
          </a>
        </nav>
      </header>

      {!lab.kafkaEnabled && (
        <p
          role="alert"
          className="rounded-md border border-amber-600 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          Kafka is disabled (<code>KAFKA_ENABLED=false</code>). Payments are saved but stay PENDING
          because nothing publishes or consumes them. Set it to <code>true</code> in{' '}
          <code>.env</code> and restart the API.
        </p>
      )}

      <HelpPanel />
      <div className="grid gap-4 md:grid-cols-2">
        <BreakerCard breaker={lab.breaker} />
        <LagCard lag={lab.lag} outboxPending={lab.outboxPending} kafkaEnabled={lab.kafkaEnabled} />
      </div>
      <LoadForm />
      <PaymentsTable payments={lab.payments} />
    </div>
  );
}
