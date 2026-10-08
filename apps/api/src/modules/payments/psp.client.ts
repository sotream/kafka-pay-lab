export const DECLINE_CODES = [
  'insufficient_funds',
  'card_declined',
  'card_expired',
  'fraud_suspected',
] as const;
export type DeclineCode = (typeof DECLINE_CODES)[number];

export type PspResult =
  { kind: 'approved'; chargeId: string } | { kind: 'declined'; code: DeclineCode };

export interface ChargeRequest {
  amount: number;
  currency: string;
  cardToken: string;
}

/** The provider could not give a usable answer (5xx, timeout, reset, garbage). Worth retrying. */
export class TransientPspError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'TransientPspError';
  }
}

const DECLINE_STATUSES = new Set([402, 422]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDeclineCode(value: unknown): value is DeclineCode {
  return DECLINE_CODES.some((code) => code === value);
}

export class PspClient {
  constructor(private readonly options: { baseUrl: string; timeoutMs: number }) {}

  /** Approvals and card declines are results; anything else the caller should retry is a TransientPspError. */
  async charge(request: ChargeRequest, idempotencyKey: string): Promise<PspResult> {
    let status: number;
    let body: unknown;
    try {
      const response = await fetch(`${this.options.baseUrl}/charges`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      status = response.status;
      body = await response.json().catch(() => undefined);
    } catch (cause) {
      throw new TransientPspError(`PSP unreachable: ${String(cause)}`, cause);
    }

    if (status === 200 && isRecord(body) && typeof body.chargeId === 'string') {
      return { kind: 'approved', chargeId: body.chargeId };
    }
    if (DECLINE_STATUSES.has(status) && isRecord(body) && isDeclineCode(body.code)) {
      return { kind: 'declined', code: body.code };
    }
    throw new TransientPspError(`PSP responded ${status} with an unusable answer`);
  }
}
