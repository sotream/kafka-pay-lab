# 0013. Rolling log files with pino-roll

- Status: accepted
- Date: 2026-10-10

## Context

With `LOG_DIR` set, the api and `psp-sim` write JSON lines to files that Alloy ships to Loki
([ADR 0012](0012-grafana-stack.md)). A single file grows without limit, which is a poor default even for
a lab that is left running.

## Decision

- Use `pino-roll` 4.0.0 (MIT, by the pino maintainers; dependencies `date-fns` and `sonic-boom`, which
  pino already uses; no install scripts; released a year before adoption, so it passes the repository's
  minimum release age). The version is pinned exactly. It is the maintained rolling transport in the pino
  ecosystem, so there is no rotation code to write or own. Logrotate is not an option: the apps run on
  laptops, often on macOS, and a copy-truncate step would race with Alloy.
- The api uses it as a pino transport target; `psp-sim` has no pino and writes its lines to the same
  stream. Both roll daily and at `LOG_ROLL_SIZE` (default `10m`) into `<LOG_DIR>/<service>.<n>.log`, and
  keep the five newest files besides the current one. About 60 MB per service at the defaults.
- `pino-roll` never renames a file: each roll opens the next number. Alloy therefore tails the glob
  `<service>.*.log`, reads every new file once from its start, and stops following a deleted one. No
  line is read twice and none is skipped across a roll.
- The console output of the api is unchanged.

## Consequences

- One more dependency (and its two transitive ones); `pino-roll` ships no types, so `psp-sim` declares
  the small part it uses in `src/pino-roll.d.ts`.
- Lines are in Loki for as long as Loki keeps them (24 hours here); the files on disk are only the buffer
  for the shipper.
- Size rolling is checked as lines are written, so a file can slightly exceed the limit.
- Plain `api.log` / `psp-sim.log` files from earlier runs are no longer matched by Alloy and can be deleted.
- The files are only a buffer for the shipper: `size x files kept` must outlast Alloy's file discovery
  (10 s). With a tiny `LOG_ROLL_SIZE` (2k at a few requests per second) files were deleted before Alloy saw
  them and lines were lost; at the defaults the buffer lasts hours.
