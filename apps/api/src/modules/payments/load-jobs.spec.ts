import { LoadJobs } from './load-jobs.js';

describe('LoadJobs', () => {
  it('starts a job with nothing done and finds it again', () => {
    const jobs = new LoadJobs();

    const job = jobs.start(5);

    expect(job).toMatchObject({ total: 5, created: 0, failed: 0, done: false });
    expect(jobs.find(job.id)).toEqual(job);
  });

  it('counts progress and finishes when every payment was tried', () => {
    const jobs = new LoadJobs();
    const job = jobs.start(2);

    jobs.created(job.id);
    expect(jobs.find(job.id)?.done).toBe(false);
    jobs.failed(job.id);

    expect(jobs.find(job.id)).toMatchObject({ created: 1, failed: 1, done: true });
  });

  it('keeps only the latest jobs, so the registry cannot grow without bound', () => {
    const jobs = new LoadJobs(3);
    const first = jobs.start(1);
    for (let i = 0; i < 3; i += 1) jobs.start(1);

    expect(jobs.find(first.id)).toBeUndefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(new LoadJobs().find('nope')).toBeUndefined();
  });
});
