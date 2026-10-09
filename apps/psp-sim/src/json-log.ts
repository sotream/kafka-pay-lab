import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One JSON line per event for the log shipper, same shape as the api's pino lines (`time`, `msg`, `trace_id`).
 * ponytail: synchronous append, fine for a simulator; use a stream if volume ever matters.
 */
export function logLine(dir: string | undefined, fields: Record<string, string | number>): void {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, 'psp-sim.log'),
    `${JSON.stringify({ time: Date.now(), service: 'kafka-pay-lab-psp-sim', ...fields })}\n`,
  );
}
