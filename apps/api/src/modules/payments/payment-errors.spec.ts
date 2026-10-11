import { paymentError } from './payment-errors.js';

describe('paymentError', () => {
  it.each([
    ['idempotency-key-malformed', 400, 'IDEMPOTENCY_KEY_MALFORMED'],
    ['idempotency-key-reused', 422, 'IDEMPOTENCY_KEY_REUSED'],
    ['payment-not-found', 404, 'PAYMENT_NOT_FOUND'],
    ['load-job-not-found', 404, 'LOAD_JOB_NOT_FOUND'],
  ] as const)('%s is HTTP %i with its own problem code', (kind, status, code) => {
    const error = paymentError(kind);

    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ message: expect.any(String), code });
  });

  it('points a malformed key at the header, in the shape the filter turns into errors[]', () => {
    expect(paymentError('idempotency-key-malformed').getResponse()).toMatchObject({
      errors: [{ pointer: '#/headers/Idempotency-Key', detail: expect.any(String) }],
    });
  });

  it('adds no field list to errors that are not about one input', () => {
    expect(paymentError('payment-not-found').getResponse()).not.toHaveProperty('errors');
  });
});
