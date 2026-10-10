# 0012. Grafana stack for the lab, and what it leaves out

- Status: accepted
- Date: 2026-10-09

## Context

The lab needs one command that shows traces, metrics, logs and alerts tied together, without changing
what `pnpm infra:up` starts and without turning a learning repository into a production platform.

## Decision

- A compose profile `observability` (`pnpm obs:up` / `pnpm obs:down`): OpenTelemetry Collector, Tempo,
  Prometheus, Loki, Alloy and Grafana, all provisioned from `observability/`. Every image is pinned by
  digest and Dependabot's `docker-compose` ecosystem tracks them. Every published port binds `127.0.0.1`.
- The Collector is the single place apps send traces to, and where sampling or redaction would go later.
- Logs are JSON files written to `LOG_DIR` (rolling, see [ADR 0013](0013-log-file-rotation.md)) and tailed by Alloy. The apps run on the host, so there is no
  container stdout to collect, and this path works with tracing off. Alloy is used instead of Promtail,
  which is deprecated. Loki labels are only `service`; `trace_id` stays in the line, where Loki's derived
  field and Tempo's trace-to-logs link find it.
- Metrics use `prom-client`'s successor `@prometheus-io/client` (the old package is deprecated). They are
  served by a separate `node:http` listener on `METRICS_HOST:METRICS_PORT` (default `127.0.0.1:9464`), not
  by Nest. The public port and any reverse proxy in front of it never expose `/metrics`, and no guard or
  throttler is bypassed because the route is not in Nest (the same reasoning as
  [ADR 0007](0007-no-trust-proxy.md): do not guess the network in front of the API).
  On Docker Desktop for macOS the Prometheus container reaches the loopback listener through
  `host.docker.internal`. On Linux that usually does not work: set `METRICS_HOST` to the Docker bridge
  gateway (usually `172.17.0.1`). Do not use `0.0.0.0`: `/metrics` is unauthenticated and each scrape
  queries Postgres and Kafka, so exposing it to the network allows load and information leaks. Loopback
  stays the default.
- Labels are low-cardinality only: route template (`unmatched` when there is none), outcome, breaker
  state, partition. Ids, URLs and error messages are never labels.
- Scrape-time gauges (outbox backlog and age, consumer lag) wait at most two seconds for their source and
  keep the last value when it fails, so a dead Kafka or database cannot stall a scrape.
- Grafana allows anonymous access with the Editor role and the default admin password, which is acceptable
  only because of the loopback binding. Grafana 13 logs that `auth.anonymous.org_role` is deprecated, but
  the Viewer role cannot use Explore, so the setting stays. A later Grafana release may remove it.
- Alert rules are Grafana-managed, provisioned, with short `for` values so the failure scenario shows them
  firing: outbox oldest pending age over 30 s, dead letters increasing, breaker open for most of 30 s.
  There is no contact point.

## Deliberately not included

What production would need and this lab skips: sampling (head or tail, in the Collector); retention beyond
24 hours and object storage; authentication and TLS on Grafana and the backends; high availability;
Alertmanager and notification routing; exemplars linking metrics to traces; browser (web) tracing; Kafka
and PostgreSQL auto-instrumentation; metrics for `psp-sim`; log-based alerts. The gitleaks image in
`ci.yml` is pinned by digest but not tracked by Dependabot, because it is a shell string in a workflow.

## Consequences

- One command shows the whole picture; the stack is not tuned for load.
- Tempo is on the 2.x line (single binary, local storage); 3.x is a new architecture not evaluated here.
- Dashboards and alerts are code and reviewable, but they depend on the metric names in
  `PaymentMetrics` and on the fixed service names.
