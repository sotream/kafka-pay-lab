import { PspClient, TransientPspError } from './psp.client.js';

const request = { amount: 1000, currency: 'USD', cardToken: 'tok' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientWith(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  return new PspClient({ baseUrl: 'http://psp.test', timeoutMs: 500 });
}

afterEach(() => vi.unstubAllGlobals());

describe('PspClient', () => {
  it('returns approved with the charge id and sends the idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { chargeId: 'ch_1' }));

    await expect(clientWith(fetchMock).charge(request, 'pay-1')).resolves.toEqual({
      kind: 'approved',
      chargeId: 'ch_1',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://psp.test/charges');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('pay-1');
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it.each([402, 422])('returns a decline for HTTP %i with a known code', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(json(status, { code: 'insufficient_funds' }));

    await expect(clientWith(fetchMock).charge(request, 'k')).resolves.toEqual({
      kind: 'declined',
      code: 'insufficient_funds',
    });
  });

  it.each([
    ['503', () => json(503, { error: 'down' })],
    ['404', () => json(404, {})],
    ['200 with garbage', () => new Response('<html>oops</html>', { status: 200 })],
    ['200 without a charge id', () => json(200, { status: 'approved' })],
    ['402 with an unknown code', () => json(402, { code: 'made_up' })],
    ['402 with an empty body', () => new Response('', { status: 402 })],
  ])('treats %s as transient, never as approved or declined', async (_name, respond) => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(respond()));

    await expect(clientWith(fetchMock).charge(request, 'k')).rejects.toBeInstanceOf(
      TransientPspError,
    );
  });

  it.each([
    ['a connection reset', new TypeError('fetch failed')],
    ['a timeout', new DOMException('The operation timed out', 'TimeoutError')],
  ])('treats %s as transient', async (_name, error) => {
    const fetchMock = vi.fn().mockRejectedValue(error);

    await expect(clientWith(fetchMock).charge(request, 'k')).rejects.toBeInstanceOf(
      TransientPspError,
    );
  });
});
