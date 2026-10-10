/** Printable ASCII except `"` and `\`, or an escaped `\"` / `\\`: an RFC 8941 sf-string. */
const SF_STRING = /^"((?:[\x20\x21\x23-\x5B\x5D-\x7E]|\\["\\])+)"$/;
const MAX_KEY_LENGTH = 255;

/**
 * Parses the `Idempotency-Key` header, a Structured Field String per draft-ietf-httpapi-idempotency-key-header
 * (an expired draft, see docs/adr/0015-client-idempotency-keys.md). Null when it is not one.
 * A copy of the api's parser: two small apps, no shared package.
 */
export function parseIdempotencyKey(raw: string | undefined): string | null {
  const match = raw === undefined ? null : SF_STRING.exec(raw);
  const key = match?.[1]?.replace(/\\(["\\])/g, '$1');
  return key && key.length <= MAX_KEY_LENGTH ? key : null;
}
