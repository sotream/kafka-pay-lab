import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTracingEnv } from './tracing.js';

describe('loadTracingEnv', () => {
  const keys = ['OTEL_ENABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'PORT'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const envFile = (content: string): string => {
    const file = join(mkdtempSync(join(tmpdir(), 'tracing-env-')), '.env');
    writeFileSync(file, content);
    return file;
  };

  it('reads only the tracing keys, so other settings keep the ConfigModule file order', () => {
    delete process.env.OTEL_ENABLED;
    delete process.env.PORT;

    loadTracingEnv([envFile('OTEL_ENABLED=true\nPORT=9999\n')]);

    expect(process.env.OTEL_ENABLED).toBe('true');
    expect(process.env.PORT).toBeUndefined();
  });

  it('lets the first file and the real environment win', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://shell:1';
    delete process.env.OTEL_ENABLED;

    loadTracingEnv([
      envFile('OTEL_ENABLED=true\n'),
      envFile('OTEL_ENABLED=false\nOTEL_EXPORTER_OTLP_ENDPOINT=http://file:2\n'),
    ]);

    expect(process.env.OTEL_ENABLED).toBe('true');
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://shell:1');
  });

  it('ignores a missing file', () => {
    expect(() => loadTracingEnv(['/nonexistent/.env'])).not.toThrow();
  });
});
