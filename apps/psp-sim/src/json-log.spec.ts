import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logLine } from './json-log.js';

describe('logLine', () => {
  it('does nothing without a log dir', () => {
    expect(() => logLine(undefined, { msg: 'x' })).not.toThrow();
  });

  it('appends one JSON line per call with the service name and a timestamp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psp-sim-log-'));

    logLine(dir, { msg: 'charge', outcome: 'approved' });
    logLine(dir, { msg: 'charge', outcome: 'http503' });

    const lines = readFileSync(join(dir, 'psp-sim.log'), 'utf8')
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
