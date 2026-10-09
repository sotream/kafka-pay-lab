import { ROOT_CONTEXT, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import type { Attributes, Context, Span, SpanKind } from '@opentelemetry/api';

export type Carrier = Record<string, string>;
type HeaderValue = Buffer | string | (Buffer | string)[] | undefined;

const TRACER_NAME = 'kafka-pay-lab';

/** Without an SDK the global propagator is a no-op, so the carrier stays empty and callers get null. */
export function injectHeaders(ctx: Context = context.active()): Carrier {
  const carrier: Carrier = {};
  propagation.inject(ctx, carrier);
  return carrier;
}

export function currentTraceparent(): string | null {
  return injectHeaders().traceparent ?? null;
}

/** kafkajs hands header values over as Buffer, string or an array of them. */
export function extractHeaders(headers: Record<string, HeaderValue> | undefined): Context {
  const carrier: Carrier = {};
  for (const [key, raw] of Object.entries(headers ?? {})) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined) carrier[key] = value.toString();
  }
  return Object.keys(carrier).length === 0
    ? ROOT_CONTEXT
    : propagation.extract(ROOT_CONTEXT, carrier);
}

/** An invalid or missing value yields a context without a span, so the next span starts a new trace. */
export function contextFromTraceparent(value: string | null): Context {
  return extractHeaders(value ? { traceparent: value } : undefined);
}

export interface SpanSpec {
  kind?: SpanKind;
  attributes?: Attributes;
  /** Defaults to the active context. The relay and consumer pass the context carried by the message. */
  parent?: Context;
}

/** Runs `fn` in an active span; failures are recorded on the span and rethrown, the span always ends. */
export function withSpan<T>(
  name: string,
  spec: SpanSpec,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  const options = { kind: spec.kind, attributes: spec.attributes };
  return tracer.startActiveSpan(name, options, spec.parent ?? context.active(), async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
