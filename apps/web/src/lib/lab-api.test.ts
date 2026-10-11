import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLoad } from './lab-api';

const problem = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('startLoad', () => {
  it('returns how many payments were accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ accepted: 3, jobId: 'j1' }), { status: 202 }),
        ),
    );

    await expect(startLoad({ count: 3, intervalMs: 0 })).resolves.toBe(3);
  });

  it('shows one text per failed field from a problem document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        problem(400, {
          status: 400,
          detail: 'Request validation failed',
          errors: [
            { pointer: '#/count', detail: 'count must not be greater than 500' },
            { pointer: '#/intervalMs', detail: 'intervalMs must not be less than 0' },
          ],
        }),
      ),
    );

    await expect(startLoad({ count: 501, intervalMs: -1 })).rejects.toThrow(
      'count must not be greater than 500, intervalMs must not be less than 0',
    );
  });

  it('shows the detail of a problem without a field list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(problem(503, { status: 503, detail: 'Down' })),
    );

    await expect(startLoad({ count: 1, intervalMs: 0 })).rejects.toThrow('Down');
  });
});
