'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { startLoad } from '@/lib/lab-api';
import { Hint } from './hint';

const input =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700';

export function LoadForm() {
  const [count, setCount] = useState('50');
  const [intervalMs, setIntervalMs] = useState('100');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const accepted = await startLoad({
        count: Number(count),
        intervalMs: Number(intervalMs),
        ...(amount === '' ? {} : { amount: Number(amount) }),
      });
      setMessage({
        ok: true,
        text: `Started: ${accepted} payments are being created in the background.`,
      });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Request failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="font-semibold">
        Generate payments
        <Hint text="Creates many payments quickly so you can watch them flow through Kafka. Combine it with a slow or broken provider (psp-sim page) to build up consumer lag." />
      </h2>
      <form onSubmit={submit} className="mt-2 grid gap-3 sm:grid-cols-4 sm:items-end">
        <label className="text-sm" title="How many payments to create (1 to 500).">
          How many
          <input
            className={input}
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            required
          />
        </label>
        <label
          className="text-sm"
          title="Pause between payments in milliseconds. 0 sends them as fast as possible, which builds lag quickest."
        >
          Delay between (ms)
          <input
            className={input}
            type="number"
            min={0}
            max={5000}
            value={intervalMs}
            onChange={(e) => setIntervalMs(e.target.value)}
            required
          />
        </label>
        <label
          className="text-sm"
          title="Optional fixed amount in cents for every payment. Leave empty for random amounts. The last two digits pick a provider outcome, e.g. 1051 = insufficient funds, 1091 = HTTP 503."
        >
          Amount in cents (optional)
          <input
            className={input}
            type="number"
            min={1}
            placeholder="random"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-white disabled:opacity-60"
          title="Start creating the payments. They appear in the table below as they are created."
        >
          {busy ? 'Starting…' : 'Generate'}
        </button>
      </form>
      <p className="mt-2 text-xs text-neutral-500">
        Tip: set the provider to “Slow” first, then generate 100 payments with no delay and watch
        lag climb.
      </p>
      {message && (
        <p
          role="status"
          className={`mt-2 text-sm ${message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
