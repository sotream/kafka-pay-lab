import type { PaymentStatus, PaymentView } from '@/lib/lab-types';
import { Hint } from './hint';

const STATUS: Record<PaymentStatus, { box: string; help: string }> = {
  PENDING: {
    box: 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100',
    help: 'Saved. Waiting for the consumer to send it to the provider.',
  },
  COMPLETED: {
    box: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100',
    help: 'The provider approved the payment.',
  },
  DECLINED: {
    box: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
    help: 'The provider refused it for a business reason (see Reason). Final: not retried.',
  },
  FAILED: {
    box: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
    help: 'The provider stayed unavailable through all retries. The message was copied to the dead-letter topic payments.dlq.',
  },
};

const money = (p: PaymentView) => `${(p.amount / 100).toFixed(2)} ${p.currency}`;

export function PaymentsTable({ payments }: { payments: PaymentView[] }) {
  return (
    <section className="rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="font-semibold">
        Payments
        <Hint text="The latest 100 payments, newest first. Statuses update live as the consumer works through them." />
      </h2>
      {payments.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          No payments yet. Use “Generate payments” above.
        </p>
      ) : (
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-neutral-500 dark:bg-neutral-950">
              <tr>
                <th className="py-1 pr-3" title="When the payment was created">
                  Time
                </th>
                <th
                  className="py-1 pr-3"
                  title="Payment amount. The last two digits of the amount in cents can force a provider outcome (magic amounts)."
                >
                  Amount
                </th>
                <th
                  className="py-1 pr-3"
                  title="Where the payment is in its life: PENDING, COMPLETED, DECLINED or FAILED. Hover a badge for details."
                >
                  Status
                </th>
                <th className="py-1" title="Why a payment was declined or failed">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1 pr-3 font-mono">
                    {new Date(p.createdAt).toLocaleTimeString()}
                  </td>
                  <td className="py-1 pr-3 font-mono">{money(p)}</td>
                  <td className="py-1 pr-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS[p.status].box}`}
                      title={STATUS[p.status].help}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="py-1 font-mono text-xs">{p.declineReason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
