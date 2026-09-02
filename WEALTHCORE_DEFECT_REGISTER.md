# WEALTHCORE DEFECT REGISTER

Severity: **P0** Critical · **P1** High · **P2** Medium · **P3** Low. All findings were confirmed by code inspection and, where noted, by live reproduction against the running server.

## P0 — Critical

### D-001 · Multi-currency value mixing (no FX) — FINANCIAL CORRUPTION
- **Component:** `server/lib/networth.js`, `server/lib/portfolio.js`, `server/lib/ai-tools.js` (monthly totals)
- **Function:** `computeNetWorth`, `computePortfolio`, `toolGetTransactionTotal`, `toolGetMonthlyExpenses`
- **Description:** Holding values, asset totals, portfolio value/P&L and monthly income/expense/category sums add **minor units across currencies with no FX conversion**. Confirmed live: BTC (currency USD, value 60,500) added directly to INR totals.
- **Impact:** Net worth, portfolio value, P&L, allocation, savings rate and AI answers are **incorrect** whenever any non-INR instrument exists. This is a financial-data-integrity failure.
- **Root cause:** `currentValueMinor` is a unit-less integer; engines sum it globally ignoring `currency`.
- **Recommended fix:** Make values currency-aware; either (a) convert to a base currency using an FX rate before summing, or (b) if no FX, **refuse/flag** cross-currency mixing (compute per-currency totals and present them separately). Add a `convert(value, from, to)` in `money.js` and apply in `networth`/`portfolio`/`ai-tools`. Mark the result `@currency` in responses.
- **Test required:** P0 test asserting a USD holding does not inflate INR totals; per-currency breakdown.

## P1 — High

### D-002 · AI compare-month anchor is wrong
- **Component:** `server/lib/ai-agent.js` (`resolvePlan` → `compare_spend`)
- **Function:** `resolvePlan`
- **Description:** "Compare that with the previous month." after "How much did I spend on food last month?" compares the **same month to itself** (July vs July) because the compare step uses `previousMonth(now)` (relative to current date) instead of the month before the conversation's `lastPeriod`.
- **Impact:** Misleading comparisons; shows `+₹0.00` incorrectly.
- **Root cause:** `prev = previousMonth(now)`; should be `previousMonth(period)`.
- **Recommended fix:** Use `previousMonth(new Date(period + '-01'))` (month before `lastPeriod`).
- **Test required:** ai-agent compare test asserting July vs June.

### D-003 · Import "rollback" is not implemented
- **Component:** `server/lib/ingest.js` + `server/routes/api.js`
- **Function:** `ingest()`, `POST /ingest`
- **Description:** Response promises `rollbackId` but there is no rollback; the id is just the run id. Docs claim "rollback capability where practical".
- **Impact:** Misleading contract; no recovery from a bad import.
- **Root cause:** rollback never implemented.
- **Recommended fix:** Track created transaction ids in the run; add a `DELETE /ingestion/:runId/rollback` that soft-deletes the created records for that run (guarded by `user_id`).
- **Test required:** rollback removes only that run's created rows.

### D-004 · PostgreSQL/repository abstraction is dead code
- **Component:** `server/db/connector.js`
- **Description:** `all/get/run/transaction/toPostgresParams` and `DIALECT` exist but are **never imported** by any business module; all logic uses `db.prepare(...)` directly. Docs claim "adapter-ready / repository abstraction".
- **Impact:** No actual production DB path; SQLite coupling everywhere; breaking change risk if moving to Postgres.
- **Root cause:** connector built but not adopted.
- **Recommended fix:** Reference `connector.all/get/run/transaction` in engines/routes (or add a repository layer) so SQLite↔Postgres is a one-line `DIALECT` switch; add a Postgres adapter and a CI matrix.
- **Test required:** connector param translation (`?`→`$n`) unit test.

### D-005 · `POST /holdings` does not validate security/account ownership
- **Component:** `server/routes/api.js`
- **Function:** `POST /holdings`
- **Description:** Accepts arbitrary `securityId`/`accountId` without verifying they belong to the user. Single-user setup prevents cross-user in practice, but the data layer has no guard; the JOIN in `getHoldingsValuation` pulls the referenced security by id globally.
- **Impact:** Potential IDOR if multi-user appears; data-integrity coupling.
- **Root cause:** missing ownership check.
- **Recommended fix:** Validate `security_id` and `account_id` belong to `req.user.id` before insert.
- **Test required:** rejected cross-user security/account.

## P2 — Medium

### D-006 · Unpriced-holding validation false-positive
- **Component:** `server/lib/portfolio.js` (`encode`), `networth.js`
- **Function:** `computePortfolio` validation
- **Description:** For an unpriced holding, `priceMinor` is set to `cost_basis_minor` (total cost), but `currentValueMinor = cost_basis_minor`. For qty≠1 it sets `priceMinor = cost_basis_minor`; `recomputed = qty*priceMinor` ≠ `currentValueMinor`. Confirmed: qty=5, cost=200000 → `mismatches: 1` though it is validly valued at cost.
- **Impact:** Portfolio "invariant check" shows a false mismatch for legitimately unpriced holdings; erodes trust in the validation.
- **Root cause:** using total cost as the "unit price" for unpriced.
- **Recommended fix:** For unpriced, set the unit price to `cost_basis_minor / quantity` (or skip the recompute when `priceMissing`).
- **Test required:** unpriced qty≠1 invariant assertion.

### D-007 · `runAllReconciliations(forceSave)` persists only one account
- **Component:** `server/lib/reconciliation.js`
- **Function:** `runAllReconciliations`
- **Description:** With `forceSave` it calls `recordReconciliationRun` only for `accounts[0]`.
- **Impact:** "Run reconciliation" records history for the first account only.
- **Root cause:** loop not applied on save.
- **Recommended fix:** Record a run for every account (or a user-wide run with items per account).
- **Test required:** run-all persists runs for all accounts.

### D-008 · `transactions.dedup_key` not UNIQUE
- **Component:** `server/db.js`
- **Description:** dedup enforced only in app code; schema lacks a UNIQUE constraint.
- **Impact:** Race/edge could insert duplicates; the dedup guard is soft.
- **Recommended fix:** Add `UNIQUE(user_id, dedup_key)` (or a generated unique column) with care for nulls.
- **Test required:** unique-constraint dedup test.

### D-009 · Dedup key collides when a provider reuses a ref across accounts
- **Component:** `server/lib/transaction-intelligence.js` (`dedupKey`)
- **Description:** `dedupKey` with `providerRef` uses only `ref:${providerRef}`; no account/user component.
- **Impact:** Two accounts with the same ref would dedup wrongly.
- **Root cause:** ref-only key.
- **Recommended fix:** Include `accountId` (and optionally userId) in the key (hash over `account|ref|date|amount|direction`).
- **Test required:** same ref different account → distinct keys.

### D-010 · Market-data fetch has no retry/timeout/error record
- **Component:** `server/lib/market-data.js` (`refreshPrices`)
- **Description:** Per-quote errors swallowed in `catch {}`; no retry/backoff/timeout; no error surfacing.
- **Impact:** Silent failures contradict "no silent synchronization failures".
- **Recommended fix:** Record failed quotes in a log/sync shape; add retry with backoff and timeout; surface in `/market/status`.
- **Test required:** provider-failure recorded.

### D-011 · Reconciliation source balance is only manual
- **Component:** `server/lib/reconciliation.js`
- **Description:** Compares to `source_balance_minor`, which is never auto-populated (no provider feed).
- **Impact:** Engine real but no live source; always `MISSING_SOURCE_DATA` unless manually set.
- **Recommended fix:** Wire to AA/market provider (or a manual balance entry flow with clear UI).
- **Test required:** (see D-007).

### D-012 · Session TTL inconsistency
- **Component:** `server/lib/auth.js` vs `server/config.js`
- **Description:** DB session uses hard-coded 12h; cookie uses `config().sessionTtlMs`. Divergence if env changed.
- **Recommended fix:** Use `config().sessionTtlMs` in `createSession`.
- **Test required:** TTL respects config.

## P3 — Low

| ID | Issue | Location | Recommendation |
| -- | ----- | -------- | -------------- |
| D-013 | Dead code: `looksLikeDate` | ingest.js | remove |
| D-014 | Dead code: `waitFor` | scheduler.js | remove |
| D-015 | Dead code: `csrfValid` | auth.js | remove |
| D-016 | Unused import `config` | reconciliation.js | remove |
| D-017 | Empty no-op `wireDashboardActions()` | app.js | remove or implement |
| D-018 | `logger.setLevel`/`setJsonMode` not wired to `config().logging` | logger.js | wire config |
| D-019 | `encryptionKey` validated but never used | config.js/security | document or implement at-rest encryption |
| D-020 | `POST /jobs/:name/run` bypasses `runJob` (doesn't update `jobs` status) | api.js/scheduler.js | route through runJob |
| D-021 | `notifications` types EMI-due/low-balance/portfolio-movement/concentration are enum-only (no rule) | notifications.js | add rules |
| D-022 | `GET /holdings` returns 404 (only `/portfolio`) | api.js | add listing or document |

## Severity summary
- **P0: 1** (D-001)
- **P1: 4** (D-002, D-003, D-004, D-005)
- **P2: 7** (D-006, D-007, D-008, D-009, D-010, D-011, D-012)
- **P3: 10** (D-013 … D-022)

## Note
No CRITICAL **security** defect (cross-user access) was found because the app enforces a single user; the multi-currency issue is the P0 and is a **data/financial-correctness** defect, not a security breach.
