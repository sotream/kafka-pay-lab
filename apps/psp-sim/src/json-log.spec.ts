import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeLog, initLog, logLine, rollOptions } from './json-log.js';

describe('rollOptions', () => {
  it('rolls daily and at the given size into <dir>/psp-sim.<n>.log, keeping a bounded number', () => {
    expect(rollOptions('/var/logs', '5m')).toEqual({
      file: '/var/logs/psp-sim',
      extension: '.log',
      frequency: 'daily',
      size: '5m',
      limit: { count: 5 },
      mkdir: true,
    });
  });
});

describe('logLine', () => {
  afterEach(() => closeLog());

  it('does nothing before the log is initialised', () => {
    expect(() => logLine({ msg: 'x' })).not.toThrow();
  });

  it('appends one JSON line per call with the service name and a timestamp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'psp-sim-log-'));
    await initLog(dir, '10m');

    logLine({ msg: 'charge', outcome: 'approved' });
    logLine({ msg: 'charge', outcome: 'http503' });
    await closeLog();

    const [file] = readdirSync(dir);
    expect(file).toMatch(/^psp-sim\.\d+\.log$/);
    const lines = readFileSync(join(dir, file ?? ''), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      service: 'kafka-pay-lab-psp-sim',
      msg: 'charge',
      outcome: 'approved',
    });
    expect(typeof lines[0]?.time).toBe('number');
  });
});
