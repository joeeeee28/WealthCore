# SYNC ENGINE

## Purpose

Keep WealthCore's data fresh: new transactions, updated balances, refreshed portfolio values, recalculated net worth, and surfaced errors.

## Current implementation

The sync path is initiated **on demand** (via the AA `requestFinancialData` and market `refresh` endpoints) and records every attempt in `sync_runs`. **No background scheduler is implemented yet** — see `ROADMAP.md` Phase 2 for the automated scheduler.

## What sync does

1. **Trigger** — from an approved AA consent (`POST /aa/consent/:id/request-data`) or market refresh (`POST /market/refresh`).
2. **Record** — insert a `sync_runs` row with `status`, `started_at`, `finished_at`, `records_processed`, `errors`.
3. **Retrieve** — provider-dependent. Without credentials, it records `FAILED / PROVIDER_NOT_CONFIGURED` (no silent failure).
4. **Normalise & validate** — provider records go through the same validation/dedup path as manual entry.
5. **Store** — write accounts/transactions/securities.
6. **Recalculate** — dashboard/net worth/portfolio recompute from the single source of truth.

## Error handling

- Failed `sync_runs` are stored and visible via `GET /sync/runs`.
- No failure is swallowed — ABSOLUTE RULE 9.
- Retry/backoff is provider-specific (documented in `AA_INTEGRATION.md`).

## Automation (planned)

- A node-based scheduler (e.g. `node-cron` or a SetInterval) will:
  - re-request data for approved, non-expired consents,
  - refresh market prices,
  - take a monthly net-worth snapshot,
  - detect consent expiry and create notifications,
  - surface sync errors.

## Reconciliation (planned, RULE 16)

A future `GET /reconciliation` will compare a provider-reported source balance against the WealthCore account balance and display the difference when non-zero, never hiding discrepancies.

## v1.1 — background scheduler (implemented)

`server/lib/scheduler.js` runs jobs in-process without blocking the HTTP server. It ticks on an interval (`WEALTHCORE_SCHEDULER_INTERVAL_SECONDS`, default 60s), decides which jobs are due, executes them, and records status/attempts/duration/errors in `jobs`.

### Jobs
| Job | Schedule | Action |
| --- | -------- | ------ |
| `expire-consents` | daily | Mark expired approved consents |
| `market-refresh` | interval | Refresh prices (honest `not_configured` if no provider) |
| `notify-evaluate` | daily | Evaluate notification rules |
| `monthly-networth-snapshot` | monthly | Record a net-worth snapshot per user |
| `reconciliation-scan` | daily | Run reconciliation across accounts |

### Reliability
- Retries with exponential backoff (1,2,4… min, cap 30 min; max `max_attempts`).
- `jobs.status` = `pending | running | success | failed`; `last_run_at`, `next_run_at`, `last_duration_ms`, `error` recorded.
- A job returning `not_configured` (e.g. market refresh without a provider) is recorded as success with a note — never a fake refresh.
- `GET /api/v1/jobs` and `POST /api/v1/jobs/:name/run` expose status + manual trigger.
- The scheduler only runs when `WEALTHCORE_SCHEDULER_ENABLED` (true unless test/unset).

### Event-driven triggers (notification engine)
Large transaction, budget threshold, goal milestone/behind, consent expiry, failed sync, reconciliation difference and stale market data are surfaced as notifications via `notify-evaluate`.
