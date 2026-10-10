import { HttpException } from '@nestjs/common';
import { parseIdempotencyKey } from './idempotency-key.js';

describe('parseIdempotencyKey', () => {
  it('returns undefined when the header is absent (the key is optional)', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it('reads a quoted string', () => {
    expect(parseIdempotencyKey('"8e03978e-40d5-43e8-bc93-6894a57f9324"')).toBe(
      '8e03978e-40d5-43e8-bc93-6894a57f9324',
    );
  });

  it('unescapes quotes and backslashes', () => {
    expect(parseIdempotencyKey('"a\\"b\\\\c"')).toBe('a"b\\c');
  });

  it.each([
    '',
    'plain',
    '"unterminated',
    "'single'",
    '""',
    '"a" "b"',
    '"line\nbreak"',
    `"${'x'.repeat(256)}"`,
    ['"a"', '"b"'],
  ])('rejects %j with a 400', (raw) => {
    const attempt = () => parseIdempotencyKey(raw);

    expect(attempt).toThrow(HttpException);
    expect(attempt).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('accepts the longest allowed key', () => {
    expect(parseIdempotencyKey(`"${'x'.repeat(255)}"`)).toHaveLength(255);
  });
});
