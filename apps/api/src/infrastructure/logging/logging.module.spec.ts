import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import { setupTestTracing } from '../../../test/helpers/tracing.js';
import { withSpan } from '../telemetry/trace-context.js';
import { REDACTED_PATHS, buildTransport, resolveRequestId, traceFields } from './logging.module.js';

const withHeader = (value?: string | string[]) =>
  ({ headers: { 'x-request-id': value } }) as unknown as IncomingMessage;

describe('resolveRequestId', () => {
  it('keeps a plain client id', () => {
    expect(resolveRequestId(withHeader('abc-123_DEF.4'))).toBe('abc-123_DEF.4');
  });

  it.each([undefined, '', 'a'.repeat(65), 'has space', 'line\nbreak', '<script>', ['a', 'b']])(
    'generates a new id for %j',
    (value) => {
      expect(resolveRequestId(withHeader(value))).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe('REDACTED_PATHS', () => {
  it('masks authorization and cookie headers in request and response logs', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } },
      { write: (line: string) => lines.push(line) },
    );

    logger.info({
      req: {
        headers: { authorization: 'Bearer secret-token', cookie: 'starter_rt=secret-cookie' },
      },
      res: { headers: { 'set-cookie': ['starter_rt=secret-cookie; HttpOnly'] } },
    });

    expect(lines[0]).not.toMatch(/secret-token|secret-cookie/);
    expect(lines[0]).toContain('[REDACTED]');
  });
});

describe('trace ids in log lines', () => {
  const tracing = setupTestTracing();
  afterAll(() => tracing.shutdown());

  it('adds nothing without an active span', () => {
    expect(traceFields()).toEqual({});
  });

  it('adds trace_id and span_id inside a span', async () => {
    const fields = await withSpan('x', {}, () => Promise.resolve(traceFields()));

    expect(fields.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(fields.span_id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('log transport', () => {
  it('keeps the dev console output and no file by default', () => {
    expect(buildTransport(false, undefined)).toEqual({
      target: 'pino-pretty',
      options: { singleLine: true, colorize: true },
    });
  });

  it('uses plain stdout in production without a log dir', () => {
    expect(buildTransport(true, undefined)).toBeUndefined();
  });

  it('also writes JSON lines to <dir>/api.log when a log dir is set', () => {
    expect(buildTransport(true, '/var/logs')).toEqual({
      targets: [
        { target: 'pino/file', options: { destination: 1 } },
        { target: 'pino/file', options: { destination: '/var/logs/api.log', mkdir: true } },
      ],
    });
  });

  it.each(['*.cardToken', 'req.body.cardToken'])('redacts %s', (path) => {
    expect(REDACTED_PATHS).toContain(path);
  });
});
