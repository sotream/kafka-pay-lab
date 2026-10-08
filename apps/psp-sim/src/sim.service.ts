import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Source } from './scenario.js';
import { DEFAULT_STATE } from './sim-state.js';
import type { SimState } from './sim-state.js';

export interface LogEntry {
  at: string;
  key: string;
  amount: number;
  latencyMs: number;
  /** `approved`, `declined:<code>`, `http503`, `hang`, `reset` or `replayed`. */
  outcome: string;
  source: Source | 'idempotent-replay';
}

export type Counters = Record<string, number>;

export type SimEvent =
  | { type: 'snapshot'; state: SimState; log: LogEntry[]; counters: Counters }
  | { type: 'state'; state: SimState }
  | { type: 'request'; entry: LogEntry; counters: Counters };

interface StoredCharge {
  status: number;
  body: object;
}

const LOG_LIMIT = 100;
// ponytail: unbounded growth is capped by dropping the oldest key; a real PSP would expire keys by time.
const IDEMPOTENCY_LIMIT = 10_000;

@Injectable()
export class SimService {
  readonly events$ = new Subject<SimEvent>();
  /** Requests currently held open on purpose (outage "hang"); should drop back to 0 when clients give up. */
  hanging = 0;
  private state: SimState = { ...DEFAULT_STATE };
  private readonly log: LogEntry[] = [];
  private readonly counters: Counters = {};
  private readonly charges = new Map<string, StoredCharge>();
  private readonly inFlight = new Map<string, Promise<void>>();

  getState(): SimState {
    return this.state;
  }

  setState(state: SimState): SimState {
    this.state = { ...state };
    this.events$.next({ type: 'state', state: this.state });
    return this.state;
  }

  snapshot(): SimEvent {
    return { type: 'snapshot', state: this.state, log: this.log, counters: { ...this.counters } };
  }

  record(entry: LogEntry): void {
    this.log.unshift(entry);
    if (this.log.length > LOG_LIMIT) this.log.pop();
    this.counters[entry.outcome] = (this.counters[entry.outcome] ?? 0) + 1;
    this.events$.next({ type: 'request', entry, counters: { ...this.counters } });
  }

  /** Resolves once no other request is working on this key, so a retry sees the first one's result. */
  settled(key: string): Promise<void> {
    return this.inFlight.get(key) ?? Promise.resolve();
  }

  /** Marks `key` as being worked on; call the returned function when the request is done. */
  claim(key: string): () => void {
    let release!: () => void;
    this.inFlight.set(key, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      this.inFlight.delete(key);
      release();
    };
  }

  replay(key: string): StoredCharge | undefined {
    return this.charges.get(key);
  }

  store(key: string, charge: StoredCharge): void {
    if (this.charges.size >= IDEMPOTENCY_LIMIT) {
      const oldest = this.charges.keys().next().value;
      if (oldest !== undefined) this.charges.delete(oldest);
    }
    if (!this.charges.has(key)) this.charges.set(key, charge);
  }
}
