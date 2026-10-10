import { paymentError } from './payment-errors.js';

describe('paymentError', () => {
  it.each([
    ['idempotency-key-malformed', 400],
    ['idempotency-key-reused', 422],
    ['payment-not-found', 404],
    ['load-job-not-found', 404],
  ] as const)('%s answers HTTP %i with the current error shape', (kind, status) => {
    const error = paymentError(kind);

    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({
      statusCode: status,
      message: expect.any(String),
      error: expect.any(String),
    });
  });
});
