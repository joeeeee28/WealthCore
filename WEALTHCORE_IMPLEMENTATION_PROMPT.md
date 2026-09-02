# WEALTHCORE MASTER IMPLEMENTATION PROMPT

> This prompt contains **only** changes identified by the audit (`WEALTHCORE_CODE_REVIEW_AND_FINBOOM_PARITY_AUDIT.md`, `WEALTHCORE_DEFECT_REGISTER.md`, `TEST_GAP_ANALYSIS.md`). Do not rewrite the app, delete working code, or fabricate integrations. Each item is tied to a verified defect/gap.

## Hard rules
- Keep the deterministic financial engine; never let the LLM compute money.
- Preserve honest integration status (`READY_FOR_CONFIGURATION`/`PROVIDER_NOT_CONFIGURED`/`LLM_NOT_CONFIGURED`).
- Single source of truth for net worth / portfolio (fix, don't fork).
- Keep all existing tests green; add tests for every change.
- Keep secrets in env; never hard-code; no telemetry; no real provider data without credentials.

## Phase 1 — P0 financial correctness (do first)
1. **Currency-aware valuation.** In `server/lib/money.js` add a `convert(minor, from, to, rate)` and a per-currency `normalizeValue(minor, currency)` helper. In `server/lib/networth.js`, `server/lib/portfolio.js`, and `server/lib/ai-tools.js` (`toolGetTransactionTotal`, `toolGetMonthlyExpenses`, `toolGetIncome`, `toolGetExpenses`), **either** (a) convert every holding/account value to the user's base currency (default INR) using a stored/configured FX rate before summing, **or** (b) if no rate is available, compute **per-currency totals** and expose them separately (never sum across currencies). Mark every returned value with a `currency`.
   - Tests: P0 net-worth/portfolio/spend tests that fail today (USD holding must not inflate INR; per-currency breakdown present).
2. **Fix unpriced-holding validation.** In `server/lib/portfolio.js`, for `priceMissing` holdings set the "unit price" used in the recompute to `costBasisMinor / quantity` (or skip the recompute when `priceMissing`) so `validation.mismatches` is not a false positive.
   - Tests: unpriced qty≠1 invariant assertion.

## Phase 2 — Data integrity
3. **Unique dedup guard.** Add a migration to UNIQUE-constrain `(user_id, dedup_key)` on `transactions` (guard nulls by storing a sentinel for keyless rows). Keep app-level dedup.
4. **Dedup key includes account.** In `dedupKey`, hash over `accountId|date|amount|direction|ref` (region the `ref:` fast-path to include account) so a reused provider ref across accounts does not collide.
5. **Real import rollback.** Track created transaction ids per `ingestion_runs`; add `DELETE /ingestion/:runId/rollback` that soft-deletes only that run's created rows (guarded by `user_id`). Replace the current `rollbackId` semantics.

## Phase 3 — FinBoom parity
6. **Holding ownership.** In `POST /holdings`, verify `security_id` and `account_id` belong to the user before insert.
7. **Realized P&L / broker grouping / security grouping.** Extend portfolio to group by account (broker) and expose realized P&L where a sell is recorded.
8. **Split transaction, clone, bulk categorize/delete** (transactions module + API + UI).
9. **Loan dashboard** (payoff + amortization chart) using existing `amortization()`.
10. **Goals** sub-targets/milestones, asset-linking (link a goal to holdings/accounts), inflation-adjusted projection.
11. **Step-up SIP** in calculator + API.
12. **Emergency-fund health** (months of expenses) from transactions/budgets/goals.
13. **Pagination/caching** for large histories (cursor pagination on `/transactions`, index on `(account_id, date)`, in-memory read cache for dashboard/portfolio).

## Phase 4 — Automation & integrations
14. **AA adapter success path + fixtures.** Implement `registerProvider('mock', adapter)` returning fixture data; wire `requestFinancialData` to persist mock accounts/transactions with `correlation_id`; keep `PROVIDER_NOT_CONFIGURED` when no real credential is present.
15. **Market provider adapter + retry/timeout/error.** In `refreshPrices`, add per-quote retry with backoff, a timeout, and record failures (don't swallow); surface in `/market/status`.
16. **Notification types.** Add rules for `emi_due`, `credit_card_due`, `low_balance`, `portfolio_movement`, `concentration_warning`, `unusual_spending`.
17. **Safe Excel import** (vendor a maintained parser with no CVE, or accept CSV-only and remove any "Excel" claim); **CAS/MFCentral** parser.
18. **Scheduler manual-run status.** Route `POST /jobs/:name/run` through `runJob` so status/attempts/last_run are updated.

## Phase 5 — AI
19. **Fix compare-month anchor** (`resolvePlan`): `prev = previousMonth(period)` (month before `lastPeriod`), not `previousMonth(now)`.
20. **Real LLM tool-calling loop.** Add a provider adapter that calls a chat-completion endpoint with `TOOL_SCHEMAS`, dispatches returned function calls to the existing tools, and composes the answer from the real result. Keep `LLM_NOT_CONFIGURED` when no key is set; never let the model compute figures.
21. **"Why" / explainability.** For a follow-up "why did it <increase/decrease>?", compare the same category between the two periods and attribute to specific merchants/categories; return source + date range + formula + freshness.

## Phase 6 — Better-than-FinBoom
22. **Financial data-health score** (categorized %, reconciled %, priced %, stale prices, duplicates, missing cost basis) → API + UI card.
23. **Net-worth attribution** ("why did my net worth change": income + investment P&L + revaluation).
24. **Predictive cash flow** (forecast income/expense/EMI/SIP/bills over N months) via the existing engine + transaction history.
25. **Explainable AI provenance** on every AI answer (source, date range, formula, freshness).

## Phase 7 — Production
26. **Adopt repository seam.** Replace direct `db.prepare` calls in engines/routes with `connector.all/get/run/transaction`; add a Postgres driver behind `DIALECT`; add a CI matrix (SQLite + Postgres). 
27. **At-rest encryption** using `config().encryptionKey` (SQLCipher or field-level for secrets) — or explicitly document if deferred.
28. **Coverage tooling** (`node --test --experimental-test-coverage`) with a threshold, and add the P0/P1 tests from `TEST_GAP_ANALYSIS.md`.
29. **Backup/restore CLI** and browser-based E2E harness (Playwright/Cypress) for the 20-step journeys.

## Acceptance gate
- All existing 81 tests still pass; new tests added for every change.
- P0 currency defect fixed (tests prove no cross-currency summing).
- AI 3-step chain: spend → compare (correct month) → explain "why".
- No fake LIVE; integrations honest.
- No hard-coded secrets; `npm audit:secrets` and `npm audit` clean.
- Docs updated to match reality (remove overclaims for rollback/Postgres/LLM until actually implemented).
