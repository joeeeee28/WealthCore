# RELEASE NOTES

## v1.1.0 — Production-readiness pass (current)

### New capability
- Reconciliation subsystem (engine/API/UI/history/audit, adopt-source or record-for-review).
- Background scheduler (5 jobs; daily/monthly/interval; retries + exponential backoff; `/jobs`).
- Extensible ingestion framework (CSV/JSON/bank/Zerodha/Groww; preview; mapping; dedup; summary; failed-record report; idempotent re-import).
- Notification engine (14 types; preferences; evaluate; dismiss).
- Market-data provider interface; `COST_BASIS`/`UNPRICED`; price history; stale detection.
- AA/FIU provider adapter interface; consent validation; correlation IDs; raw-payload store; honest `PROVIDER_NOT_CONFIGURED`.
- Expanded AI tools (19) + LLM provider interface + `LLM_NOT_CONFIGURED`.
- Password reset request/confirm; login rate limiting; CSRF; httpOnly cookie sessions; `/auth/csrf`.
- Config module + `.env.example`; production fail-fast.
- `/health` + `/ready` with per-component status.
- Privacy controls (revoke connections, delete all data).
- Structured logging with request/correlation IDs and redaction.

### Improvements
- AI intent coverage (income, holdings, reconciliation, freshness, calculators, market price, compare periods).
- Transaction normalisation metadata (reference, posting date, confidence, normalized merchant, ingested_at).
- Export now includes consents, reconciliation runs, notifications, snapshots, audit.
- End-to-end reconciliation on sample data (MATCHED + DIFFERENCE demonstration).

### Security
- Login rate limiting; password reset; CSRF; httpOnly cookies; config validation; secret scan clean; dependency audit 0 vulnerabilities.

### Testing
- Suite grew from 41 to **81** tests (unit, DB integration, adapters, scheduler, E2E HTTP, negative cases).

### Known limitations
- Live AA / market / LLM data require provider credentials (honestly represented).
- Excel import deferred (vulnerable dependency removed); use CSV/JSON.
- No cursor pagination / caching for very large histories.
- Scheduler is in-process.

## v1.0.0 — Initial functional build
Auth, accounts, transactions, portfolio, net worth, budgets, goals, reports, calculators, AI agent, AA consent lifecycle, market-data status, JSON/CSV import/export, app lock, 41 tests, full docs.
