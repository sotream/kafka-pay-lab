import { DECLINE_CODES } from './sim-state.js';
import type { DeclineCode, SimState } from './sim-state.js';

export type Outcome =
  | { kind: 'approve' }
  | { kind: 'decline'; code: DeclineCode }
  | { kind: 'http503' }
  | { kind: 'hang' }
  | { kind: 'reset' };

export type Source = 'magic-amount' | 'outage' | 'fail-rate' | 'decline-rate' | 'normal';

export interface Scenario {
  latencyMs: number;
  outcome: Outcome;
  source: Source;
}

const MAGIC_SLOW_MS = 5000;

/** Magic amounts: the last two digits of the amount (minor units) pick a deterministic outcome. */
const MAGIC_OUTCOMES: Record<number, Outcome> = {
  51: { kind: 'decline', code: 'insufficient_funds' },
  52: { kind: 'decline', code: 'card_declined' },
  53: { kind: 'decline', code: 'card_expired' },
  54: { kind: 'decline', code: 'fraud_suspected' },
  91: { kind: 'http503' },
  92: { kind: 'hang' },
  93: { kind: 'approve' }, // approved, but slow: see MAGIC_SLOW_MS
  94: { kind: 'reset' },
};

function randomDecline(state: SimState, random: () => number): DeclineCode {
  if (state.declineReason !== 'random') return state.declineReason;
  return DECLINE_CODES[Math.floor(random() * DECLINE_CODES.length)] ?? 'card_declined';
}

/**
 * Decides what one request gets. Precedence: magic amount, outage, failRate, declineRate; latency always
 * applies. `random` is injectable so the rules can be tested without luck.
 */
export function resolveScenario(
  state: SimState,
  amount: number,
  random: () => number = Math.random,
): Scenario {
  const suffix = amount % 100;
  const slow = suffix === 93 ? MAGIC_SLOW_MS : 0;
  const latencyMs = Math.round(state.latencyMs + state.jitterMs * random()) + slow;
  const done = (outcome: Outcome, source: Source): Scenario => ({ latencyMs, outcome, source });

  const magic = MAGIC_OUTCOMES[suffix];
  if (magic) return done(magic, 'magic-amount');
  if (state.outage !== 'none') return done({ kind: state.outage }, 'outage');
  if (random() * 100 < state.failRate) return done({ kind: 'http503' }, 'fail-rate');
  if (random() * 100 < state.declineRate) {
    return done({ kind: 'decline', code: randomDecline(state, random) }, 'decline-rate');
  }
  return done({ kind: 'approve' }, 'normal');
}
