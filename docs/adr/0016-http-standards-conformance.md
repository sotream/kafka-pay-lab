# 0016. HTTP standards conformance (mirrors the starter's ADR 0010)

- Status: accepted
- Date: 2026-10-11

## Context

The lab is built on nest-next-starter, whose [ADR 0010](https://github.com/sotream/nest-next-starter/blob/main/docs/adr/0010-http-standards-conformance.md)
brought its HTTP surface in line with RFC 9110, 9457, 6750, 8725 and the Fetch standard. The lab's
auth, users and vehicles modules are the starter's and are kept in step with it, so the same code is
taken over here. The lab's own payment routes ([ADR 0015](0015-client-idempotency-keys.md)) now use the
same error shape instead of a temporary one.

## Decision

The pieces were copied from the starter and renamed where they carry a project name; behaviour is the
same.

| Area                    | Rule                                                                                                                                                                                                               | Source                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Error format            | Every error is `application/problem+json` with `type`, `title`, `status`, `detail` and a `code` extension                                                                                                          | RFC 9457 s3               |
| Problem `type`          | Always `about:blank`, so `title` is the HTTP status phrase                                                                                                                                                         | RFC 9457 s4.2.1           |
| Validation errors       | `errors: [{ pointer: "#/email", detail }]`, `code: VALIDATION_FAILED`                                                                                                                                              | RFC 9457 s3 example       |
| Lab errors              | Payment errors carry their own `code` (`IDEMPOTENCY_KEY_MALFORMED`, `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_NOT_FOUND`, `LOAD_JOB_NOT_FOUND`); a malformed key has `errors: [{ pointer: "#/headers/Idempotency-Key" }]` | RFC 9457 s3.2             |
| Unexpected errors       | Generic 500; details only in the server log                                                                                                                                                                        | OWASP error handling      |
| 401                     | `WWW-Authenticate: Bearer realm="api"`, plus `error="invalid_token"` when a token was sent and rejected                                                                                                            | RFC 9110 s11.6.1, 6750 s3 |
| Authorization scheme    | `Bearer` is matched case-insensitively                                                                                                                                                                             | RFC 9110 s11.1            |
| 201                     | `Location` names the created resource (vehicles, payments)                                                                                                                                                         | RFC 9110 s10.2.2          |
| Unsupported body        | A body that is not JSON gets 415                                                                                                                                                                                   | RFC 9110 s15.5.16         |
| 429                     | `Retry-After` in seconds                                                                                                                                                                                           | RFC 6585 s4               |
| CORS                    | `Vary: Origin`, preflight cached 10 minutes, `Retry-After`, `Location`, `X-Request-Id` exposed                                                                                                                     | Fetch standard            |
| Early errors            | Helmet and CORS run before the body parser, so a 400 or 413 for a bad body carries them; the HTTP metrics middleware runs before both so those requests are counted                                                | Fetch standard            |
| Token responses         | `Cache-Control: no-store` where the body holds an access token                                                                                                                                                     | OWASP session management  |
| JWT algorithm           | Signing and verification are pinned to `HS256`                                                                                                                                                                     | RFC 8725 s3.1, s3.2       |
| JWT issuer and audience | `iss` is `kafka-pay-lab`, `aud` is `kafka-pay-lab-api`, both checked on every request. They differ from the starter's, so a token from one service is rejected by the other                                        | RFC 8725 s3.8, s3.9       |
| Passwords               | Sign-up accepts at most 72 **bytes**; sign-in is limited to 128 characters                                                                                                                                         | OWASP Password Storage    |

The web client reads `detail` and `errors` from problem documents, in the sign-in forms and in the
dashboard's load form.

## Deliberate deviations

All of the starter's deviations apply (no `WWW-Authenticate` on sign-in and refresh, no 405 with `Allow`,
`X-RateLimit-*` instead of the draft `RateLimit` fields, no `__Host-` cookie prefix, no `typ: at+jwt`,
secret length instead of entropy, bcrypt instead of Argon2id, offset pagination without `Link`). In
addition:

- **The provider simulator (`psp-sim`) keeps its own simple error JSON** (`{ "error": "..." }`). It is a
  test double for an external provider, and the API client only looks at its status codes and, for declines,
  a `code`. Converting it would add code to model something a real provider does its own way.
- **Payment and stream routes are public and unthrottled** by design (a local lab), so they never answer
  401 or 429; this predates this ADR and stays in the README's known limits.
- Idempotency, load-job and SSE deviations are in [ADR 0015](0015-client-idempotency-keys.md).

## Consequences

- The error body is a problem document everywhere in the API, so every client must read `detail` and
  `errors`; the dashboard does. `psp-sim` is the one exception.
- Access tokens issued before this change have no `iss` or `aud` and are rejected; they live at most 15
  minutes and the web app refreshes its session silently.
- Passwords longer than 72 bytes can no longer be created; existing accounts keep working.
- Keeping the lab's auth, users and vehicles code identical to the starter's means later starter changes can
  be applied as a patch.
