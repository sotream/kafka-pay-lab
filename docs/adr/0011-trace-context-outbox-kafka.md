# 0011. Trace context through the outbox and Kafka headers

- Status: accepted
- Date: 2026-10-09

## Context

The HTTP request ends before the relay publishes. The relay may run seconds later, after an API restart or
a Kafka outage. In-memory trace context cannot survive that gap, and a trace that breaks there is useless
for the one thing this lab teaches.

## Decision

Two carriers, because they cover different gaps:

1. `outbox_events.traceparent` (nullable `varchar(55)`, W3C format). `OutboxService.add` writes the
   active context into it, inside its own `outbox.add` span. The relay reads it and uses it as the parent
   of its `outbox.publish` span. This is what survives "request over, relay later".
2. W3C `traceparent` in the Kafka message headers, written by the relay and read by the consumer as the
   parent of its `payments.requested process` span. This is the standard carrier and works for any other
   consumer.

`PaymentProcessor.settle` writes its outbox rows inside its own span, so `payments.completed` and
`payments.dlq` continue the same trace. `EventPublisher` gets an optional `headers` field; the no-op
publisher ignores it. A missing, empty or invalid value starts a new trace and never fails processing.

## Consequences

- The trace survives restarts and Kafka outages; the long gap is visible in the waterfall.
- One nullable 55-byte column per outbox row, added by a generated migration.
- Other services only need standard W3C extraction.
- A message held behind an open breaker shows as one long consumer span with a `breaker.hold` event, not
  many spans. Retries show as one `payment.attempt` span each.
- At-least-once redelivery produces a second consumer span in the same trace.
- Rows written before the migration, or with tracing off, have a null `traceparent`.
- Trace ids are not an identity: `HttpInstrumentation` honours an inbound `traceparent` from any caller, so
  a client can choose the trace id (and force sampling). Use `payment.id`, `requestId` and the database
  rows as the audit trail. Only `traceparent` is stored (re-serialised, at most 55 characters); `tracestate`
  is ignored.
