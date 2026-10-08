import { validateEnv } from './env.validation.js';

describe('payments lab settings', () => {
  it('has lab defaults', () => {
    const env = validateEnv({ APP_ENV: 'dev' });

    expect(env).toMatchObject({
      PAYMENTS_GROUP_ID: 'kafka-pay-lab-payments',
      PSP_URL: 'http://localhost:4100',
      PSP_TIMEOUT_MS: 3000,
      CB_FAILURE_THRESHOLD: 5,
      CB_RESET_TIMEOUT_MS: 10_000,
      PAYMENT_MAX_ATTEMPTS: 4,
      PAYMENT_RETRY_BASE_MS: 1000,
      OUTBOX_POLL_MS: 500,
      LAG_POLL_MS: 1000,
    });
  });

  it('reads numbers from strings and rejects a zero failure threshold', () => {
    expect(validateEnv({ APP_ENV: 'dev', CB_RESET_TIMEOUT_MS: '2500' }).CB_RESET_TIMEOUT_MS).toBe(
      2500,
    );
    expect(() => validateEnv({ APP_ENV: 'dev', CB_FAILURE_THRESHOLD: '0' })).toThrow(
      /CB_FAILURE_THRESHOLD/,
    );
  });
});
