import { join } from 'node:path';
import pinoRoll from 'pino-roll';
import type { RollingStream } from 'pino-roll';

/** Same policy as the api's pino transport: daily or at `size`, the 5 newest files kept (ADR 0013). */
export function rollOptions(dir: string, size: string) {
  return {
    file: join(dir, 'psp-sim'),
    extension: '.log',
    frequency: 'daily' as const,
    size,
    limit: { count: 5 },
    mkdir: true,
  };
}

let stream: RollingStream | undefined;

/** Opens the rolling log file; without a log dir nothing is written. Called once at startup. */
export async function initLog(dir: string | undefined, size = '10m'): Promise<void> {
  if (dir) stream = await pinoRoll(rollOptions(dir, size));
}

export async function closeLog(): Promise<void> {
  const open = stream;
  stream = undefined;
  if (!open) return;
  await new Promise<void>((resolve) => {
    open.once('close', resolve);
    open.end();
  });
}

/** One JSON line per event for the log shipper, same shape as the api's pino lines (`time`, `msg`, `trace_id`). */
export function logLine(fields: Record<string, string | number>): void {
  stream?.write(
    `${JSON.stringify({ time: Date.now(), service: 'kafka-pay-lab-psp-sim', ...fields })}\n`,
  );
}
