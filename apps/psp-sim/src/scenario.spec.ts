import { DEFAULT_STATE } from './sim-state.js';
import type { SimState } from './sim-state.js';
import { resolveScenario } from './scenario.js';

const state = (overrides: Partial<SimState> = {}): SimState => ({
  ...DEFAULT_STATE,
  latencyMs: 0,
  jitterMs: 0,
  ...overrides,
});
const never = () => 0.999; // never below any percentage < 100
const always = () => 0; // always below any percentage > 0

describe('resolveScenario', () => {
  it('approves a healthy request', () => {
    expect(resolveScenario(state(), 1000, never)).toEqual({
      latencyMs: 0,
      outcome: { kind: 'approve' },
      source: 'normal',
    });
  });

  it.each([
    [1051, 'insufficient_funds'],
    [1052, 'card_declined'],
    [1053, 'card_expired'],
    [1054, 'fraud_suspected'],
    [51, 'insufficient_funds'],
  ])('amount %i is a magic decline (%s)', (amount, code) => {
    expect(resolveScenario(state(), amount, never)).toMatchObject({
      outcome: { kind: 'decline', code },
      source: 'magic-amount',
    });
  });

  it.each([
    [1091, { kind: 'http503' }],
    [1092, { kind: 'hang' }],
    [1094, { kind: 'reset' }],
  ])('amount %i is a magic failure', (amount, outcome) => {
    expect(resolveScenario(state(), amount, never)).toMatchObject({
      outcome,
      source: 'magic-amount',
    });
  });

  it('amount ending in 93 adds 5 s of latency and still approves', () => {
    expect(resolveScenario(state({ latencyMs: 100 }), 1093, never)).toMatchObject({
      latencyMs: 5100,
      outcome: { kind: 'approve' },
    });
  });

  it('amounts with other endings are not magic', () => {
    expect(resolveScenario(state(), 1000, never).source).toBe('normal');
    expect(resolveScenario(state(), 1099, never).source).toBe('normal');
  });

  it('a magic amount beats an outage', () => {
    expect(resolveScenario(state({ outage: 'http503' }), 1051, never)).toMatchObject({
      outcome: { kind: 'decline' },
    });
  });

  it.each(['http503', 'hang', 'reset'] as const)(
    'outage %s beats random failures and declines',
    (outage) => {
      expect(
        resolveScenario(state({ outage, failRate: 100, declineRate: 100 }), 1000, always),
      ).toMatchObject({ outcome: { kind: outage }, source: 'outage' });
    },
  );

  it('failRate produces random 503s', () => {
    expect(resolveScenario(state({ failRate: 30 }), 1000, always)).toMatchObject({
      outcome: { kind: 'http503' },
      source: 'fail-rate',
    });
    expect(resolveScenario(state({ failRate: 30 }), 1000, never).outcome.kind).toBe('approve');
  });

  it('declineRate uses the configured reason', () => {
    expect(
      resolveScenario(state({ declineRate: 100, declineReason: 'card_expired' }), 1000, never),
    ).toMatchObject({ outcome: { kind: 'decline', code: 'card_expired' }, source: 'decline-rate' });
  });

  it('picks a random reason when declineReason is random', () => {
    const outcome = resolveScenario(
      state({ declineRate: 100, declineReason: 'random' }),
      1000,
      () => 0.99,
    ).outcome;

    expect(outcome).toEqual({ kind: 'decline', code: 'fraud_suspected' });
  });

  it('adds jitter to the base latency', () => {
    expect(
      resolveScenario(state({ latencyMs: 200, jitterMs: 100 }), 1000, () => 0.5).latencyMs,
    ).toBe(250);
  });
});
