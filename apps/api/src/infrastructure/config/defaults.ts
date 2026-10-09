/** Kept free of decorators so tooling that runs outside Nest (e.g. Vitest config) can import it. */
export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:5432/app';

/** Collector OTLP/HTTP base URL. Loopback IP, not `localhost`, so it does not resolve to ::1 where Docker only binds IPv4. */
export const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318';
