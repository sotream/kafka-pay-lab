import { paymentError } from './payment-errors.js';

/** Printable ASCII except `"` and `\`, or an escaped `\"` / `\\`: an RFC 8941 sf-string. */
const SF_STRING = /^"((?:[\x20\x21\x23-\x5B\x5D-\x7E]|\\["\\])+)"$/;
const MAX_KEY_LENGTH = 255;

/**
 * Parses the optional `Idempotency-Key` header, a Structured Field String per
 * draft-ietf-httpapi-idempotency-key-header (an expired draft, see docs/adr/0015-client-idempotency-keys.md).
 * Absent means no deduplication; present but malformed is a 400.
 */
export function parseIdempotencyKey(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const match = typeof raw === 'string' ? SF_STRING.exec(raw) : null;
  const key = match?.[1]?.replace(/\\(["\\])/g, '$1');
  if (!key || key.length > MAX_KEY_LENGTH) throw paymentError('idempotency-key-malformed');
  return key;
}
