# REMEDIATION BASELINE

> Generated at the start of the production-readiness pass. This documents the **actual** current state after inspection, code reading, running the app, and running the existing suite. It is the source of truth for what must be remediated. Every item below was checked against the real code — nothing is assumed from prior documentation.

## 1. How the baseline was established

- Read `package.json`, `server/index.js`, `server/db.js`, all files in `server/lib/*`, `server/routes/api.js`, `server/seed.js`.
- Read `public/app.js`, `public/styles.css`, `public/index.html`.
- Read all test files under `tests/`.
- Ran `npm test` → **41/41 pass** (verified).
- Started the server (`node server/index.js`, port 8080) and exercised the HTTP endpoints.
- Ran a secret/credential scan across `server/` and `public/`.
- Cross-checked every document in `docs/` against the code (correctness, staleness, claims).

## 2. Current architecture

- Single-process Node 22 + Express 5 server; SQLite 3 via `better-sqlite3`; vanilla-JS SPA (no framework, no build step).
- `server/index.js` — Express bootstrap, static file serving, SPA fallback, global error handler.
- `server/db.js` — single SQLite connection, schema applied inline on open (no migration system), WAL + FK.
- `server/routes/api.js` — 765-line REST router: auth, dashboard, accounts, categories, transactions, budgets, goals, securities, holdings, portfolio, net worth, snapshots, reports, AA/consents, sync, calculators, import/export, notifications, audit, AI, seed-demo.
- `server/lib/*` — domain services: `money` (integer minor units), `calculations` (EMI/SIP/FD/CAGR/XIRR), `networth`, `portfolio`, `transaction-intelligence`, `market-data`, `aa-integration`, `ai-tools`, `ai-agent`, `auth`, `defaults`.
- Tests: `node --test` with in-memory SQLite.

## 3. Existing capabilities (working & tested)

| Capability | Status | Tests |
| ---------- | ------ | ----- |
| Auth (scrypt, sessions, app-lock PIN, logout) | Working | api |
| Accounts/categories CRUD, default category seeding | Working | api |
| Transactions CRUD, validation, dedup, auto-categorisation, batch, import | Working | api, txn-intelligence |
| Portfolio engine (qty×price=value, P&L, invariant validation) | Working | networth-portfolio |
| Net worth engine (single source of truth, allocation) | Working | networth-portfolio |
| Budgets, goals, reports | Working | api |
| Calculators (EMI/SIP/FD/CAGR/XIRR) | Working | calculations |
| AI agent over real data (offline deterministic) + context | Working | ai-agent |
| AA consent lifecycle (create/approve/reject/revoke/expire) | Working (state machine) | api |
| Market-data status model | Working (status only) | api |
| Import/export (JSON import, JSON/CSV export) | Working | api |
| Dashboard aggregated view | Working | api |

## 4. Broken / partial capabilities

| Area | Status | Specific gap |
| ---- | ------ | ------------ |
| Healing endpoint | **OK after a prior fix** | `/api/v1/health` returns `{ok,service}`; no `/ready`, no component status |
| Transaction list JOIN | **Previously ambiguous column** — fixed | Now t.-prefixed; regression-tested |
| AI conversation context | **Fixed** | `lastMetric` now reconstructed from full message history |
| Import | Partial | JSON only; no CSV/Excel/broker formats; no preview/mapping/rollback |
| Reconciliation | **Missing** | No subsystem, API, UI, or history |
| Background sync | **Missing** | No scheduler, jobs, retries, or backoff |
| Notifications | Partial | Seed-level only; no evaluation engine, preferences, or dismissal |
| Market data | Partial | Status model only; no provider adapter, no `COST_BASIS`/`UNPRICED`, no history |
| AA integration | Partial | Consent lifecycle only; no provider adapter interface, correlation IDs, raw payload, idempotency, mocked adapter tests |
| AI | Partial | Offline resolver only; limited tool set; no LLM provider interface or `LLM_NOT_CONFIGURED` status |
| Login security | **Weak** | No rate limiting / brute-force protection; token in `localStorage`; no password reset |
| CSRF | **Missing** | Sensitive mutations rely on bearer token only; no CSRF token if cookies are used |
| Config validation | **Missing** | No `.env.example`, no fail-fast on missing prod config |
| Observability | Weak | No structured logs, request/correlation IDs, metrics |
| Database production path | **Not supported** | Hard-coded to SQLite; no migrations/PostgreSQL adapter |
| Password reset | **Missing** | No flow/table/API | 

## 5. Missing capabilities (target list)

- Reconciliation subsystem (engine/API/UI/history/audit).
- Background sync scheduler (daily/monthly/event-driven, retries, backoff, status).
- Ingestion framework (CSV/Excel/bank/broker/Zerodha/Groww) with preview/mapping/summary/rollback.
- Notifications engine (evaluation, preferences, read/unread, dismissal) + notifications UI.
- Market provider adapter (LIVE/DELAYED/LAST_AVAILABLE/MANUAL/COST_BASIS/UNPRICED, history, stale detection).
- AA provider adapter interface + mocked adapter tests + correlation IDs + raw payload + idempotency.
- Real LLM tool-calling provider interface + `LLM_NOT_CONFIGURED` status.
- Config module + `.env.example` + per-environment validation.
- Health/readiness endpoints with per-component status.
- Structured observability (logger, request/correlation IDs, metrics).
- Password reset, login rate limiting, CSRF, cookie-based sessions.
- Recovery/backup tooling + disaster-recovery + ops runbook docs.

## 6. Security issues

- **No login rate limiting** — brute-force is not mitigated.
- **Session token in `localStorage`** — readable by any XSS; should be httpOnly cookie (bearer is retained for API flexibility).
- **No CSRF protection** — relevant once cookie auth is used.
- **No password reset** flow.
- **No environment-variable validation** — production can start with missing required secrets.
- Logging is minimal (good) but **not structured** and loses request correlation.
- Secret scan: **no hard-coded secrets found** (verified) — good; must remain so.
- App-lock PIN is scrypt-hashed (good); data routes gated (good).
- SQL is parameterised everywhere (good); no raw interpolation into SQL.

## 7. Integration issues

- AA: consent lifecycle real; live retrieval honestly returns `PROVIDER_NOT_CONFIGURED`. No adapter interface/`CONFIGURED` booleans, no correlation IDs, no raw payload store, no mocked (fixture-based) adapter tests.
- Market data: status model real (never fakes LIVE); no adapter, no history, no `COST_BASIS`/`UNPRICED` status.
- No background ingestion/sync scheduler.
- No reconciliation against provider-reported balances.

## 8. UI issues

- No data-freshness indicators on price/AI surfaces.
- Reconciliation UI does not exist (feature missing).
- Notifications UI is minimal (no preferences/dismissal).
- Import UI missing (no file upload/preview/mapping).
- Some states (loading/empty/error) present but not uniformly; no retry affordances everywhere.
- Terminology is mostly consistent; a few labels inconsistent (e.g. "sample" vs "demo").

## 9. Data-model issues

- No dedicated tables for reconciliation, jobs, notification preferences, ingestion runs, raw ingest, market-price history, password resets.
- No migration system; schema is inline SQL.
- `transactions` lacks `posting_date`, `confidence`, `source_ref`, `ingested_at`, normalized-merchant columns that automated ingestion needs.
- No unique index enforcing idempotency beyond the `dedup_key` column.
- `securities` lacks `previous_close_minor` and a provider-quote link.
- Business logic directly references SQLite (`db.prepare`) — no repository abstraction for PostgreSQL.

## 10. Performance issues

- Transaction list is LIMIT/OFFSET only with a 500 cap; no pagination cursor; large histories could be slow.
- No caching for dashboard/portfolio reads.
- Synchronous SQLite is fine for a single user; no background worker.

## 11. Testing gaps

- 41 tests: unit (money, calculations, txn-intelligence), DB (networth/portfolio), AI agent, HTTP E2E.
- Missing tests: reconciliation, ingestion/dedup edge cases, notifications, scheduler, market/AA adapters (fixture-based), config validation, rate limiting, CSRF, password reset, repository abstraction.
- No mocked provider tests.
- No test for CSV/Excel import.
- Target: substantial increase with integration + E2E + negative coverage.

## 12. Documentation gaps

- Existing docs are largely accurate but **overclaim** some things (e.g. "notifications" and "reports" present where the engine is minimal; "market data" and "AA" described as integrated when only the status model exists — that part IS honest).
- Missing docs: `OPERATIONS_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `TROUBLESHOOTING.md`, `RELEASE_NOTES.md`.
- No `.env.example`.
- `DATA_MODEL.md` does not list the new subsystems' tables (they don't exist yet).

## 13. Objective for this pass

1. Keep the existing working implementation; only extend/refactor with tests.
2. Implement reconciliation, background sync, ingestion, notifications, config validation, health/readiness, observability, password reset, rate limiting, CSRF, cookie sessions, market/AA provider adapter interfaces + mocked tests, expanded AI tools + LLM provider interface, and repository/DB abstraction.
3. Verify with a substantially larger test suite and an E2E run.
4. Update every doc to match reality; add the missing docs.
5. Produce `FINAL_PRODUCTION_AUDIT.md` that is honest about any credential-blocked external dependency.
