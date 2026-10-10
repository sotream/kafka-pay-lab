import { serverSpanName } from './tracing.js';

describe('serverSpanName', () => {
  it('names a charge call by its route template', () => {
    expect(serverSpanName({ method: 'POST', route: { path: '/charges' } })).toBe('POST /charges');
  });

  it('falls back to a fixed word when no route matched', () => {
    expect(serverSpanName({ method: 'GET' })).toBe('GET unmatched');
  });
});
