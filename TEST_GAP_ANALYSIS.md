# TEST GAP ANALYSIS

Baseline: **81 automated tests, all passing** across 13 files. No coverage tooling configured (coverage % is not measured).

## Existing coverage by area

| Area | Files | Tests | Notes |
| ---- | ----- | ----- | ----- |
| Money / decimal | money.test.js | 7 | good edge cases |
| Financial calculations | calculations.test.js | 10 | reference-validated |
| Transaction intelligence | transaction-intelligence.test.js | 6 | dedup/cat/transfer/recurring |
| Net worth / portfolio | networth-portfolio.test.js | 3 | invariant, unpriced flag |
| AI agent | ai-agent.test.js | 5 | net worth, spend, context, no-hallucination |
| API / E2E HTTP | api.test.js | 10 | auth, CRUD, calc, AI, AA, export, lock |
| Security | security.test.js | 3 | rate limit, reset, CSRF |
| Reconciliation | reconciliation.test.js | 6 | statuses, history, resolve |
| Ingestion | ingest.test.js | 8 | CSV, dedup, idempotency, failed records |
| Notifications | notifications.test.js | 4 | prefs, rules, emit |
| Scheduler | scheduler.test.js | 4 | registry, run, honest market |
| Adapters | adapters.test.js | 8 | AA/market status, consent, quote |
| Config | config.test.js | 7 | prod fail-fast, partial-config |

## Critical gaps (missing tests that would catch real defects)

| # | Gap | Would have caught | Priority |
| - | --- | ----------------- | -------- |
| G-01 | **Multi-currency valuation** — no test asserts that a USD holding is NOT summed into INR net worth/portfolio | **P0 currency-mixing defect** | P0 |
| G-02 | Unpriced holding with qty≠1 validation | **mismatch false-positive** | P1 |
| G-03 | AI compare-month anchor ("previous month" relative to conversation period) | **AI compare bug** | P1 |
| G-04 | Dedup key collision when provider reuses a ref across accounts | dedup robustness | P1 |
| G-05 | `runAllReconciliations(forceSave)` persists only one account | reconciliation run-all | P2 |
| G-06 | Per-currency income/expense totals | currency mixing in spend | P0 |
| G-07 | No actual live-provider success path (mock adapter fixture) | adapter contract | P1 |
| G-08 | No coverage tooling | no % claim | P2 |

## Recommended E2E journey coverage (the task's 20-step list)

| Step | Covered by | Status |
| ---- | ---------- | ------ |
| 1 Registration | api.test.js (setup) | ✅ |
| 2 Login | api.test.js, security.test.js | ✅ |
| 3 Account creation | api.test.js | ✅ |
| 4 Transaction creation | api.test.js | ✅ |
| 5 Import | api.test.js (/import), ingest.test.js | ✅ |
| 6 Duplicate detection | api.test.js, ingest.test.js | ✅ |
| 7 Categorization | api.test.js, txn-intelligence | ✅ |
| 8 Dashboard | api.test.js (/dashboard) | ✅ |
| 9 Budget | api.test.js (budgets endpoint) | ⚠ (no UI E2E) |
| 10 Goal | api.test.js (goals endpoint) | ⚠ |
| 11 Investment | networth-portfolio.test.js | ✅ |
| 12 Portfolio | networth-portfolio, api | ✅ |
| 13 Net worth | networth-portfolio, api | ✅ |
| 14 Calculator | api.test.js | ✅ |
| 15 AI | ai-agent.test.js, api.test.js | ✅ |
| 16 Export | api.test.js | ✅ |
| 17 App lock | api.test.js | ✅ |
| 18 Reconciliation | reconciliation.test.js, api | ⚠ (no UI E2E) |
| 19 Notifications | notifications.test.js | ⚠ (no UI E2E) |
| 20 Logout | api.test.js (endpoint) | ⚠ (no UI E2E) |

**Verdict:** backend E2E is strong; **UI/browser E2E is absent** (no Playwright/Cypress). All 20 steps are covered at the API/unit level except a few UI-only render paths.

## Recommended new tests (priority-ordered)

1. P0: multi-currency net worth/portfolio/spend totals (must fail until fixed).
2. P1: unpriced qty≠1 validation invariant.
3. P1: AI compare-month correctness (July→June).
4. P1: provider adapter success path using a fixture/mock (market + AA).
5. P2: reconciliation run-all persists all accounts.
6. P2: dedup ref-collision across accounts.
7. P2: notification rules for EMI-due/low-balance/portfolio-movement/concentration (once implemented).
8. P2: performance smoke (10k tx) for pagination/index.
9. Add `c8`/`node --test --experimental-test-coverage` (Node 22 supports `--experimental-test-coverage`) and a coverage threshold check.
10. Add a Playwright/Cypress smoke test for the 20-step journeys once a browser harness is available.
