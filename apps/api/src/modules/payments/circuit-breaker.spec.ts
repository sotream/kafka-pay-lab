import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
import type { BreakerSnapshot } from './circuit-breaker.js';

const ok = () => Promise.resolve('ok');
const boom = () => Promise.reject(new Error('boom'));

function setup() {
  let time = 0;
  const events: BreakerSnapshot[] = [];
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    now: () => time,
    onChange: (snapshot) => events.push(snapshot),
  });
  return { breaker, events, advance: (ms: number) => (time += ms) };
}

async function fail(breaker: CircuitBreaker, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await expect(breaker.execute(boom)).rejects.toThrow('boom');
  }
}

describe('CircuitBreaker', () => {
  it('opens after the threshold of consecutive failures', async () => {
    const { breaker } = setup();

    await fail(breaker, 2);
    expect(breaker.snapshot()).toMatchObject({ state: 'CLOSED', failures: 2 });
    await fail(breaker, 1);

    expect(breaker.snapshot()).toMatchObject({ state: 'OPEN', failures: 3, retryInMs: 1000 });
  });

  it('a success resets the failure count', async () => {
    const { breaker } = setup();

    await fail(breaker, 2);
    await breaker.execute(ok);
    await fail(breaker, 2);

    expect(breaker.snapshot()).toMatchObject({ state: 'CLOSED', failures: 2 });
  });

  it('rejects without calling the function while open', async () => {
    const { breaker } = setup();
    await fail(breaker, 3);
    const fn = vi.fn(ok);

    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);

    expect(fn).not.toHaveBeenCalled();
  });

  it('goes half-open after the reset timeout and closes on a successful probe', async () => {
    const { breaker, advance } = setup();
    await fail(breaker, 3);

    advance(1000);
    expect(breaker.snapshot().state).toBe('HALF_OPEN');
    await expect(breaker.execute(ok)).resolves.toBe('ok');

    expect(breaker.snapshot()).toMatchObject({ state: 'CLOSED', failures: 0 });
  });

  it('re-opens when the probe fails', async () => {
    const { breaker, advance } = setup();
    await fail(breaker, 3);
    advance(1000);

    await expect(breaker.execute(boom)).rejects.toThrow('boom');

    expect(breaker.snapshot()).toMatchObject({ state: 'OPEN', retryInMs: 1000 });
  });

  it('lets exactly one probe through while half-open', async () => {
    const { breaker, advance } = setup();
    await fail(breaker, 3);
    advance(1000);
    let release!: () => void;
    const slow = new Promise<string>((resolve) => (release = () => resolve('ok')));

    const probe = breaker.execute(() => slow);
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();

    await probe;
    expect(breaker.snapshot().state).toBe('CLOSED');
  });

  it('reports every failure and state change through onChange', async () => {
    const { breaker, events, advance } = setup();

    await fail(breaker, 3);
    advance(1000);
    breaker.snapshot();

    expect(events.map((e) => e.state)).toEqual(['CLOSED', 'CLOSED', 'OPEN', 'HALF_OPEN']);
  });
});
