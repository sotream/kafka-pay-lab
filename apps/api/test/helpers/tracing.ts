import { trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

/** Registers a global provider that keeps finished spans in memory; call `shutdown` in afterAll. */
export function setupTestTracing(): {
  exporter: InMemorySpanExporter;
  shutdown: () => Promise<void>;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
  return {
    exporter,
    shutdown: async () => {
      await provider.shutdown();
      trace.disable();
    },
  };
}
