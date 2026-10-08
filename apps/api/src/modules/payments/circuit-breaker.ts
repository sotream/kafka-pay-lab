export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerSnapshot {
  state: BreakerState;
  failures: number;
  /** Milliseconds until the next probe is allowed; 0 unless OPEN. */
  retryInMs: number;
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}

export interface BreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  now?: () => number;
  onChange?: (snapshot: BreakerSnapshot) => void;
}

/**
 * Consecutive-failure breaker. Any error thrown by the wrapped function counts as a failure, so callers
 * return expected business outcomes (like a card decline) as values instead of throwing them.
 */
export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private probing = false;
  private readonly now: () => number;

  constructor(private readonly options: BreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.refresh();
    if (this.state === 'OPEN' || (this.state === 'HALF_OPEN' && this.probing)) {
      throw new CircuitOpenError();
    }
    const isProbe = this.state === 'HALF_OPEN';
    this.probing = isProbe;
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      if (isProbe) this.probing = false;
    }
  }

  snapshot(): BreakerSnapshot {
    this.refresh();
    return this.view();
  }

  /** OPEN turns into HALF_OPEN lazily, the first time anyone looks after the reset timeout. */
  private refresh(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.options.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
      this.emit();
    }
  }

  private recordSuccess(): void {
    const changed = this.failures !== 0 || this.state !== 'CLOSED';
    this.failures = 0;
    this.state = 'CLOSED';
    if (changed) this.emit();
  }

  private recordFailure(): void {
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
    this.emit();
  }

  private view(): BreakerSnapshot {
    const retryInMs =
      this.state === 'OPEN'
        ? Math.max(0, this.options.resetTimeoutMs - (this.now() - this.openedAt))
        : 0;
    return { state: this.state, failures: this.failures, retryInMs };
  }

  private emit(): void {
    this.options.onChange?.(this.view());
  }
}
