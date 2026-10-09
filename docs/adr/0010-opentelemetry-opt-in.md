# 0010. OpenTelemetry tracing, opt-in

- Status: accepted
- Date: 2026-10-09

## Context

The lab shows how a payment moves through asynchronous stages: HTTP request, outbox row, relay, Kafka,
consumer, circuit breaker, provider. Logs alone cannot show one payment across those hops, and a
learning repository must still start with nothing extra running.

## Decision

- Use the OpenTelemetry Node SDK in `api` and `psp-sim`. It starts only when `OTEL_ENABLED=true`.
- `main.ts` awaits `startTracing()` and only then imports the Nest application with dynamic `import()`.
  That order lets the `http` instrumentation patch `node:http` before the framework loads, and no SDK
  package is loaded at all when tracing is off. Code elsewhere uses only `@opentelemetry/api`, which is a
  no-op without an SDK.
- Auto-instrumentation covers only `http` (server side, and the provider simulator) and `undici` (Node's
  `fetch`, used by `PspClient`). Pipeline spans are written by hand with `withSpan()` so they carry
  business attributes (`payment.id`, `payment.attempt`, `breaker.state`, `breaker.outcome`) and so context
  crossing Kafka is explicit (see [ADR 0011](0011-trace-context-outbox-kafka.md)). No meta-package and no
  `express`, `pg` or `kafkajs` auto-instrumentation: fewer dependencies and quieter traces.
- Service names are fixed in code (`kafka-pay-lab-api`, `kafka-pay-lab-psp-sim`) because both apps read
  the same `.env`.
- The bootstrap (about 40 lines) is duplicated in `psp-sim` instead of living in a shared package, which
  would need its own build step and Dockerfile changes.
- Metrics have their own switch, `METRICS_ENABLED` (see [ADR 0012](0012-grafana-stack.md)).

## Consequences

- With tracing off there is no SDK cost and no behaviour change.
- Everything is sampled (100%) and exported by a one second batch, so up to a second of spans can be lost
  on a hard stop. Production would sample in the Collector.
- Two copies of the bootstrap must be kept in step.
- A new pipeline stage needs a hand-written span; it is not picked up automatically.
- Declines are not span errors (they are a business answer); open circuits and provider failures are.
