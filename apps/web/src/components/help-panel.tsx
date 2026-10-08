export function HelpPanel() {
  return (
    <details className="rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
      <summary className="cursor-pointer font-semibold">How to use this page</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>
          Open the <b>provider simulator</b> (link above) and pick a preset, for example{' '}
          <b>Outage</b>.
        </li>
        <li>
          Come back here and press <b>Generate</b>. Watch payments stay <b>PENDING</b>, the breaker
          go <b>OPEN</b> and <b>consumer lag</b> climb.
        </li>
        <li>
          Switch the provider back to <b>Healthy</b>. The breaker moves to <b>HALF_OPEN</b>, then{' '}
          <b>CLOSED</b>, and the lag drains.
        </li>
      </ol>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Hover any label, badge or <span className="font-mono">?</span> for an explanation. Open
        Kafka UI to inspect topics, partitions and the consumer group directly.
      </p>
    </details>
  );
}
