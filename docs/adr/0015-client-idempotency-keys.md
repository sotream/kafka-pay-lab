# 0015. Client idempotency keys and the lab's HTTP deviations

- Status: accepted
- Date: 2026-10-10

## Context

`POST /payments` creates a payment. A client that times out and retries creates a second one. The
processor already protects the provider call (it sends `payment.id` as the provider's `Idempotency-Key`),
but nothing protected the API itself. The lab's HTTP surface also deviated from common API conventions in
places that are cheap to fix.

The reference is the IETF draft `draft-ietf-httpapi-idempotency-key-header` (revision 07). It is an
**expired Internet-Draft, not a standard** (IESG state "Expired", no intended RFC status), so it is
followed where sensible and every deviation is listed here.

## Decision

Followed from the draft:

- `Idempotency-Key` is an RFC 8941 Structured Field **String**, so it is sent quoted
  (`Idempotency-Key: "8e03978e-40d5"`), 1 to 255 characters. A malformed value is a 400.
- The same key with the same body returns the stored payment (the same status 201 and `Location`), and
  creates nothing: no payment, no outbox row, no Kafka message. The same key with a different body is a
  422 and writes nothing. "Same body" is a SHA-256 over amount, currency and card token.
- The key and fingerprint are stored on the `payments` row (two nullable columns and a partial unique
  index, one generated migration). The key, the payment and the outbox row commit in the same transaction
  as before, so the outbox invariants of [ADR 0011](0011-trace-context-outbox-kafka.md) and
  [ADR 0014](0014-outbox-retention.md) are unchanged.
- `psp-sim` parses the same quoted form on `/charges` (a bare value is a 400) and answers 422 with
  `{ "error": "idempotency_key_reused" }` when a key comes back with a different charge. `PspClient` sends
  the quoted form, and treats that 422 as a transient error, never as a card decline (a decline always has
  a known `code`).
- Observability: span attribute `idempotency.replayed` and the counter `payments_idempotent_replays_total`.

Standards changes around it:

- `POST /payments` returns 201 with `Location: /api/v1/payments/:id`; the new `GET /api/v1/payments/:id`
  reads it (404 for an unknown id, 400 for a non-UUID).
- `POST /payments` and `GET /payments` return `PaymentView` (the shape the stream already used), so the
  card token is no longer echoed.
- `POST /payments/load` returns 202 with `Location: /api/v1/payments/load/:jobId` and the body
  `{ accepted, jobId }` (`accepted` stays for the dashboard). `GET .../load/:jobId` reports
  `{ id, total, created, failed, done }`.
- The lab's own errors are built in one function (`payment-errors.ts`) in the current NestJS shape, so
  moving them to RFC 9457 problem details was a change in one place ([ADR 0016](0016-http-standards-conformance.md)).

## Deliberate deviations (kept)

- **The key is optional.** The draft allows requiring it (400 when missing); the dashboard and scripts
  send none and keep working. Without a key every request is a new payment.
- **No 409 for a request in progress.** The draft says a concurrent request with the same key SHOULD get 409. Here the unique index serialises them instead: the second insert waits for the first transaction,
  fails with a unique violation, and replays the stored payment. Creating a payment is one short
  transaction, so an "in progress" state would only add machinery.
- **Key lifetime equals the payment row.** Keys are never purged (payments are not deleted either); this is
  the published expiry policy the draft asks for. Reusing a key months later still replays.
- **psp-sim waits instead of answering 409** for a concurrent request with the same key, and replays the
  first result: it models a provider that holds duplicates (README scenario 10).
- **psp-sim stores only approvals and declines.** Simulated outages (503, hang, reset) are transient by
  design, so a retry with the same key is processed again. The draft says to return the earlier result,
  success or error.
- **No `Retry-After` on simulated 503s.** `PspClient` retries on its own backoff; honouring a header would
  change the retry and breaker behaviour this lab exists to show. Payment routes are unthrottled by
  design, so they never answer 429.
- **The load job registry is in memory**: the latest 20 jobs are kept, and a restart forgets all of them
  (a status request then answers 404).
- **SSE without `id`/`Last-Event-ID` and `retry`.** Every (re)connect starts with a full `snapshot`, so
  replaying from an id adds nothing; a `metrics` event every second keeps the connection warm (the HTML
  Living Standard suggests a comment about every 15 seconds). The browser's default reconnection time
  applies.

## Mirrored later

RFC 9457 problem details, JWT pinning with issuer and audience, `WWW-Authenticate`, bearer parsing and the
other conventions of the starter were taken over in [ADR 0016](0016-http-standards-conformance.md). The lab's
errors from this ADR use that shape now (`payment-errors.ts` builds them, the filter formats them).

## Consequences

- A client can retry `POST /payments` safely, and the lab shows the pattern next to the outbox.
- Two small parsers (api and psp-sim) must stay in step; there is no shared package.
- Replays need one extra indexed lookup per keyed request; unkeyed requests are unchanged.
