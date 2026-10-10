import { serverSpanName } from './tracing.js';

describe('serverSpanName', () => {
  it('uses the route template, so ids never reach the span name', () => {
    expect(serverSpanName({ method: 'GET', route: { path: '/api/v1/payments/:id' } })).toBe(
      'GET /api/v1/payments/:id',
    );
  });

  it('prefixes the mount path of a nested router', () => {
    expect(serverSpanName({ method: 'POST', baseUrl: '/api', route: { path: '/charges' } })).toBe(
      'POST /api/charges',
    );
  });

  it('falls back to a fixed word when no route matched', () => {
    expect(serverSpanName({ method: 'GET' })).toBe('GET unmatched');
  });

  it('never contains the concrete url', () => {
    const name = serverSpanName({
      method: 'GET',
      url: '/api/v1/payments/5d9d2ba7-c2c1-470c-8cfb-125a5adb1eff',
      route: { path: '/api/v1/payments/:id' },
    } as never);

    expect(name).not.toMatch(/[0-9a-f]{8}-/);
  });
});
