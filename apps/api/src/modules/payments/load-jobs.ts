import { randomUUID } from 'node:crypto';

export interface LoadJob {
  id: string;
  total: number;
  created: number;
  failed: number;
  done: boolean;
}

/** Jobs kept in memory; older ones are forgotten, so the registry cannot grow without bound. */
const DEFAULT_KEEP = 20;

/**
 * Status of the background load generator behind `POST /payments/load`, so the 202 can point at a status
 * resource. In memory on purpose: a restart forgets running and finished jobs (docs/adr/0015).
 */
export class LoadJobs {
  private readonly jobs = new Map<string, LoadJob>();

  constructor(private readonly keep = DEFAULT_KEEP) {}

  start(total: number): LoadJob {
    const job: LoadJob = { id: randomUUID(), total, created: 0, failed: 0, done: false };
    this.jobs.set(job.id, job);
    if (this.jobs.size > this.keep) {
      const oldest = this.jobs.keys().next().value;
      if (oldest !== undefined) this.jobs.delete(oldest);
    }
    return { ...job };
  }

  find(id: string): LoadJob | undefined {
    const job = this.jobs.get(id);
    return job && { ...job };
  }

  created(id: string): void {
    this.progress(id, 'created');
  }

  failed(id: string): void {
    this.progress(id, 'failed');
  }

  private progress(id: string, counter: 'created' | 'failed'): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job[counter] += 1;
    job.done = job.created + job.failed >= job.total;
  }
}
