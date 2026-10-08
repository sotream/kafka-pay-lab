import { IsIn, IsInt, Max, Min } from 'class-validator';

export const DECLINE_CODES = [
  'insufficient_funds',
  'card_declined',
  'card_expired',
  'fraud_suspected',
] as const;
export type DeclineCode = (typeof DECLINE_CODES)[number];

export const OUTAGES = ['none', 'http503', 'hang', 'reset'] as const;
export type Outage = (typeof OUTAGES)[number];

export type DeclineReason = 'random' | DeclineCode;

export interface SimState {
  latencyMs: number;
  jitterMs: number;
  outage: Outage;
  failRate: number;
  declineRate: number;
  declineReason: DeclineReason;
}

export const DEFAULT_STATE: SimState = {
  latencyMs: 50,
  jitterMs: 50,
  outage: 'none',
  failRate: 0,
  declineRate: 0,
  declineReason: 'random',
};

/** Validated body of `PUT /sim/state`: the whole state is replaced at once. */
export class SimStateDto implements SimState {
  @IsInt() @Min(0) @Max(60_000) latencyMs: number;
  @IsInt() @Min(0) @Max(60_000) jitterMs: number;
  @IsIn(OUTAGES) outage: Outage;
  @IsInt() @Min(0) @Max(100) failRate: number;
  @IsInt() @Min(0) @Max(100) declineRate: number;
  @IsIn(['random', ...DECLINE_CODES]) declineReason: DeclineReason;
}
