// Drives the provider simulator through healthy -> slow -> outage -> recovery while creating payments,
// so the dashboards fill up and the alerts fire. Ctrl+C or any error puts the simulator back to healthy.
const API = process.env.API_URL ?? 'http://localhost:4000';
const PSP = process.env.PSP_URL ?? 'http://localhost:4100';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HEALTHY = {
  latencyMs: 50,
  jitterMs: 50,
  outage: 'none',
  failRate: 0,
  declineRate: 0,
  declineReason: 'random',
};

async function setSim(patch) {
  const res = await fetch(`${PSP}/sim/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...HEALTHY, ...patch }),
  });
  if (!res.ok) throw new Error(`psp-sim answered ${res.status}`);
}

async function pay(amount) {
  const res = await fetch(`${API}/api/v1/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount, currency: 'USD' }),
  });
  if (!res.ok) throw new Error(`api answered ${res.status}`);
}

// Amounts never end in 51-54 or 91-94 (magic outcomes), so the simulator state alone decides the result.
async function burst(count, everyMs) {
  for (let i = 0; i < count; i++) {
    await pay(1000);
    await sleep(everyMs);
  }
}

const phases = [
  ['healthy traffic: normal traces, flat dashboards', () => setSim({}), () => burst(10, 300)],
  [
    'slow provider (2 s): latency histogram climbs, lag may build',
    () => setSim({ latencyMs: 2000 }),
    () => burst(10, 200),
  ],
  [
    'outage: one payment burns 4 tries and lands in the DLQ (alert: DLQ growing)',
    () => setSim({ outage: 'http503' }),
    () => burst(1, 0),
  ],
  [
    'outage continues: breaker opens, later payments wait (alert: breaker open too long)',
    async () => {},
    async () => {
      await burst(10, 200);
      await sleep(90_000);
    },
  ],
  ['recovery: breaker half-opens, closes, lag drains', () => setSim({}), () => sleep(20_000)],
];

process.on('SIGINT', () => {
  setSim({}).finally(() => process.exit(130));
});

try {
  for (const [label, prepare, run] of phases) {
    console.log(`\n== ${label}`);
    await prepare();
    await run();
  }
  console.log('\nDone. Open Grafana (see docs/guides/observability-walkthrough.md).');
} finally {
  await setSim({}).catch(() => {});
}
