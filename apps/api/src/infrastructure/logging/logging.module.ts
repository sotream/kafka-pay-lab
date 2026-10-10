import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { LoggerModule } from 'nestjs-pino';
import type { TransportMultiOptions, TransportSingleOptions } from 'pino';
import type { EnvironmentVariables } from '../config/env.validation.js';

// Secrets must never reach log sinks; see docs/adr/0003-pino-logging.md.
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.cardToken',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.cardToken',
];

const REQUEST_ID_HEADER = 'x-request-id';

// The id is echoed in a response header and written to logs, so only accept a short, plain value.
const SAFE_REQUEST_ID = /^[\w.-]{1,64}$/;

export function resolveRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Correlates every log line with the active trace; empty (and free) when tracing is off. */
export function traceFields(): { trace_id?: string; span_id?: string } {
  const span = trace.getActiveSpan()?.spanContext();
  return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
}

/** Files kept besides the current one; with the default size this bounds the log folder at about 60 MB. */
const LOG_FILES_KEPT = 5;

/**
 * Console output as before; with a log dir the JSON lines are also written to rolling files for the log
 * shipper (`<dir>/api.<n>.log`, new number on every roll, oldest deleted). Rolls daily and at `rollSize`.
 */
export function buildTransport(
  isProduction: boolean,
  logDir: string | undefined,
  rollSize = '10m',
): TransportSingleOptions | TransportMultiOptions | undefined {
  const consoleTarget: TransportSingleOptions = isProduction
    ? { target: 'pino/file', options: { destination: 1 } }
    : { target: 'pino-pretty', options: { singleLine: true, colorize: true } };
  if (!logDir) return isProduction ? undefined : consoleTarget;
  return {
    targets: [
      consoleTarget,
      {
        target: 'pino-roll',
        options: {
          file: join(logDir, 'api'),
          extension: '.log',
          frequency: 'daily',
          size: rollSize,
          limit: { count: LOG_FILES_KEPT },
          mkdir: true,
        },
      },
    ],
  };
}

export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
    const isProduction = config.get('APP_ENV', { infer: true }) === 'prod';
    return {
      pinoHttp: {
        level: config.get('LOG_LEVEL', { infer: true }),
        genReqId: (req, res) => {
          const id = resolveRequestId(req);
          res.setHeader(REQUEST_ID_HEADER, id);
          return id;
        },
        // Bound to the per-request child logger, so every line logged during a request carries it.
        customProps: (req) => ({ requestId: req.id }),
        redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
        mixin: traceFields,
        transport: buildTransport(
          isProduction,
          config.get('LOG_DIR', { infer: true }),
          config.get('LOG_ROLL_SIZE', { infer: true }),
        ),
      },
    };
  },
});
