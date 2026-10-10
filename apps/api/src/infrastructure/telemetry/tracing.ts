import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';
import { DEFAULT_OTLP_ENDPOINT } from '../config/defaults.js';

const TRACING_KEYS = ['OTEL_ENABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT'];

/**
 * Tracing starts before Nest's ConfigModule, so it reads its own two keys from the same files, in the same
 * order (first file wins, the real environment wins over both). Nothing else is copied into process.env,
 * otherwise the root .env would start to override apps/api/.env for every other setting.
 */
export function loadTracingEnv(files: string[] = ['.env', '../../.env']): void {
  for (const file of files) {
    let parsed: Record<string, string | undefined>;
    try {
      parsed = parseEnv(readFileSync(file, 'utf8'));
    } catch {
      continue; // missing file: defaults apply
    }
    for (const key of TRACING_KEYS) {
      if (process.env[key] === undefined && parsed[key] !== undefined)
        process.env[key] = parsed[key];
    }
  }
}

interface RoutedRequest {
  method?: string;
  baseUrl?: string;
  route?: { path?: unknown };
}

/**
 * `METHOD /route/:template` for server spans. The route is only known once Express has matched it, so
 * this runs when the response ends. The template, never the URL: ids in span names would make every
 * payment its own operation in Tempo. No matched route collapses into one fixed word.
 */
export function serverSpanName(req: RoutedRequest): string {
  const route = req.route ? `${req.baseUrl ?? ''}${String(req.route.path)}` : 'unmatched';
  return `${req.method ?? 'HTTP'} ${route}`;
}

/** Shared by startTracing and the trace e2e test, so the test exercises the real naming hook. */
export function httpInstrumentationConfig(
  ignoreIncomingRequest: (url: string) => boolean,
): HttpInstrumentationConfig {
  return {
    ignoreIncomingRequestHook: (req) => ignoreIncomingRequest(req.url ?? ''),
    // Runs when the response ends, after Express matched a route; the request then carries `route`.
    applyCustomAttributesOnSpan: (span, request) => {
      span.updateName(serverSpanName(request as RoutedRequest));
    },
  };
}

/**
 * Starts the OpenTelemetry SDK when OTEL_ENABLED=true; otherwise returns at once and no SDK package is
 * loaded. It must run before the HTTP server framework is imported so the http instrumentation can patch
 * `node:http`; main.ts therefore awaits it before importing the app (docs/adr/0010-opentelemetry-opt-in.md).
 */
export async function startTracing(
  serviceName: string,
  ignoreIncomingRequest: (url: string) => boolean,
): Promise<void> {
  if (process.env.OTEL_ENABLED !== 'true') return;
  const [
    { NodeTracerProvider, BatchSpanProcessor },
    { OTLPTraceExporter },
    { resourceFromAttributes },
    { registerInstrumentations },
    { HttpInstrumentation },
    { UndiciInstrumentation },
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/instrumentation'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-undici'),
  ]);
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    // Short delay: a lab user wants to see the trace within a second or two.
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, '')}/v1/traces` }),
        {
          scheduledDelayMillis: 1000,
        },
      ),
    ],
  });
  provider.register();
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(httpInstrumentationConfig(ignoreIncomingRequest)),
      // Node's fetch (PspClient) goes through undici, not node:http.
      new UndiciInstrumentation(),
    ],
  });
}
