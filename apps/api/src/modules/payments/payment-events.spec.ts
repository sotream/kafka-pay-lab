import { parsePaymentId } from './payment-events.js';

describe('parsePaymentId', () => {
  it('reads the id from a JSON message', () => {
    expect(parsePaymentId(Buffer.from(JSON.stringify({ paymentId: 'abc', amount: 1 })))).toBe(
      'abc',
    );
  });

  it.each([
    null,
    Buffer.from('not json'),
    Buffer.from('{}'),
    Buffer.from('{"paymentId":5}'),
    Buffer.from('null'),
  ])('returns null for an unusable message (%s)', (value) => {
    expect(parsePaymentId(value)).toBeNull();
  });
});
