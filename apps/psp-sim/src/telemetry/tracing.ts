import type { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';

const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318';

interface RoutedRequest {
  method?: string;
  baseUrl?: string;
  route?: { path?: unknown };
}

/** `METHOD /route/:template`; a copy of the api's helper (docs/adr/0010-opentelemetry-opt-in.md). */
export function serverSpanName(req: RoutedRequest): string {
  const route = req.route ? `${req.baseUrl ?? ''}${String(req.route.path)}` : 'unmatched';
  return `${req.method ?? 'HTTP'} ${route}`;
}

/**
 * Starts the OpenTelemetry SDK when OTEL_ENABLED=true; otherwise returns at once and no SDK package is
 * loaded. A copy of the api's bootstrap on purpose (docs/adr/0010-opentelemetry-opt-in.md): about 30 lines
 * do not justify a shared package. The simulator makes no outgoing calls, so only the http server side
 * is instrumented.
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
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/instrumentation'),
    import('@opentelemetry/instrumentation-http'),
  ]);
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT;
  new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, '')}/v1/traces` }),
        {
          scheduledDelayMillis: 1000,
        },
      ),
    ],
  }).register();
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => ignoreIncomingRequest(req.url ?? ''),
        // Runs when the response ends, after Express matched a route.
        applyCustomAttributesOnSpan: (span, request) => {
          span.updateName(serverSpanName(request as RoutedRequest));
        },
      } satisfies HttpInstrumentationConfig),
    ],
  });
}
