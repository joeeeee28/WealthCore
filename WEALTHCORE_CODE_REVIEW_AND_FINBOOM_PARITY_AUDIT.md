# WEALTHCORE — COMPLETE CODE REVIEW + FINBOOM PARITY + PRODUCT ENHANCEMENT AUDIT

> **Evidence-based audit.** Every claim below was validated against the actual repository, the running server (port 8080), and the automated test suite. Nothing is assumed from prior docs. Where a capability could not be verified (e.g. headless-browser console capture), that is stated explicitly.

**Audit date:** 2026-08-25 · **Branch:** `arena/01a035a4-wealthcore` · **HEAD:** `2b88e5e` (v1.1.0) · **Runtime:** Node 22, Express 5, better-sqlite3.

---

## 1. Executive Summary

WealthCore is a **genuinely substantial, functional** single-user personal financial application. The core loop (auth, accounts, transactions, portfolio, net worth, budgets, goals, reports, calculators, AI-over-real-data, import/export, consent lifecycle, market-data status) is real, wired end-to-end, and covered by **81 passing automated tests**. It is materially more capable than the original 41-test prototype.

However, several claims in the existing documentation are **ahead of the code**:

- **"Real LLM tool calling"** is **not implemented** — the agent is a deterministic regex intent-resolver; the LLM provider interface and tool schemas exist but there is no function-calling loop and no provider call.
- **"PostgreSQL adapter-ready" / repository abstraction** is **not wired** — the connector exists but is unused dead code; every query calls better-sqlite3 directly.
- **"Rollback" on import** is **not implemented** — `rollbackId` is just the run id.
- **Date/entity comparison in AI** has a **confirmed month-anchor bug**.

The most important **financial correctness defect** (confirmed with live data) is:

> **Multi-currency mixing** — holding values, net-worth assets, portfolio value, P&L and monthly spend totals sum minor units **across currencies without FX conversion**. A USD BTC holding (value 60,500 USD-minor) is added directly to INR-minor totals, producing an incorrect net worth / portfolio value / P&L.

Other confirmed defects include an unpriced-holding validation false-positive, reconciliation "run-all" only persisting one account, and no actual retry/timeout handling in the market-data provider path.

---

## 2. Repository Health

| Check | Result |
| ----- | ------ |
| Git clean | ✅ clean on `arena/01a035a4-wealthcore` |
| Commits | 3 (initial → v1.0 functional → v1.1 production-readiness) |
| package.json scripts | start, dev, test, seed, lint, lint:client, audit:secrets, audit:deps, config:check |
| Node version OK | ✅ Node 22 |
| Dependencies | `better-sqlite3`, `express` only — minimal, audit = **0 vulnerabilities** |
| Install ready | ✅ `node_modules` present |
| Server boots | ✅ `server/index.js`, binds 0.0.0.0:8080 |
| Health | ✅ `/api/v1/health` → 200 |
| Readiness | ✅ `/api/v1/ready` → 200, components `{database, aa, market, llm}` |
| Tests | ✅ **81/81 pass** in ~2.1s (13 files) |

**Verdict:** Healthy and buildable.

---

## 3. Architecture Review

```text
UI (public/app.js SPA, vanilla JS)
   │ REST /api/v1  (bearer OR httpOnly cookie + CSRF)
   ▼
Express (server/index.js)  ── middleware: request/correlation IDs, security headers, health/ready
   ▼
REST router (server/routes/api.js — 1014 lines)   ── auth middleware scopes all data routes
   ▼
Domain services (server/lib/*)  ── engines are pure-ish, DB-backed
   ▼
SQLite (better-sqlite3) via server/db.js  ── inline SCHEMA + migrations.js + (unused) connector.js
```

**Layering on paper is correct.** In practice two seams are **not** honored:

- **Repository abstraction is missing.** `server/db/connector.js` (all/get/run/transaction, `toPostgresParams`) is **never imported by any business module**. Every engine and route calls `db.prepare(...)` directly. `DIALECT` is computed once from env at import and is effectively meaningless. → **Architectural violation (medium).**
- **External integration → normalizer → domain model** is only half present: the normalizer exists (ingest), but no AA/market provider is actually wired to produce domain records (they return honest `NOT_CONFIGURED` stubs). → **Architecturally defined, not connected.**

**AI architecture:** The doc diagram describes an LLM tool-calling loop, but the code has **no** `await fetch(...chat-completion...)` and **no** function-call dispatch. `resolvePlan`/`runPlan` are regex + direct tool invocation. → The "real AI" is **deterministic offline**, not LLM.

---

## 4. Backend Code Review

Modules inspected: `money`, `calculations`, `networth`, `portfolio`, `transaction-intelligence`, `auth`, `reconciliation`, `scheduler`, `notifications`, `market-data`, `aa-integration`, `ingest`, `csv`, `config`, `logger`, `health`, `db`, `connector`, `migrations`, `defaults`. See `WEALTHCORE_DEFECT_REGISTER.md` for the full list. Highlights:

- **Good:** deterministic financial math separated into `calculations.js`; single-source-of-truth net worth; redacted structured logger; migration runner with idempotent columns; consent lifecycle state machine; honest integration status everywhere.
- **Dead code:** `looksLikeDate` (ingest), `waitFor` (scheduler), `csrfValid` (auth), `vals` in `validateConfig` (config), `logger.setLevel/setJsonMode` never wired to `config().logging`, `encryptionKey` validated but never used for encryption, `recordSnapshot`'s `isDemo` param partly unused at call sites.
- **Unused imports:** `import { config } from '../config.js'` in `reconciliation.js` (unused).
- **Inconsistent session TTL:** `auth.js` uses a hard-coded `SESSION_TTL_MS = 12h` for DB sessions, while the cookie Max-Age uses `config().sessionTtlMs`. If `WEALTHCORE_SESSION_TTL_HOURS` is changed, cookie and DB session expiry diverge.
- **Logger config drift:** `logger.js` reads `WEALTHCORE_LOG_LEVEL`/`WEALTHCORE_LOG_JSON` from env directly, ignoring `config().logging`.

---

## 5. Frontend Code Review

`public/app.js` (1051 lines). **Assessment via code inspection + endpoint verification** (no headless browser in this environment, so visual/console checks are code-inferred).

- **Routes ↔ views validated:** 15 routes (`dashboard, accounts, transactions, portfolio, networth, budgets, goals, reports, calculators, reconciliation, import, notifications, ai, integrations, settings`) each have a corresponding real view function. ✅
- **All views call real API endpoints** (e.g. `viewReconciliation` → `/reconciliation`, `viewImport` → `/ingest`, `viewNotifications` → `/notifications/preferences`). ✅
- **Dead code / no-ops:** `wireDashboardActions()` is an empty no-op function called but does nothing.
- **Data-freshness card** in Integrations renders a generic message via `/ai/status`, not a live freshness computation (the backend `get_data_freshness` AI tool exists but the UI doesn't present it).
- **Currency display** uses a client-side `sym()` map and `fmtMoney`; INR lakh/crore formatting is custom and correct. No FX handling (mirrors backend).
- **No third-party scripts/CDNs/telemetry** — privacy-positive.

---

## 6. Database Review

- **Schema:** comprehensive, FK-enforced (`PRAGMA foreign_keys=ON`), WAL, integer minor units, `CHECK(direction IN ('in','out'))`, indexes on transactions/securities/holdings/consents. ✅
- **Migrations:** forward-only, idempotent runner (`schema_migrations`, `columnExists` guards), 9 migrations add ingestion/metadata, price-history, reconciliation, jobs, notification-prefs, password-resets, login-attempts tables. ✅
- **Constraints gap:** `transactions.dedup_key` is **indexed but not UNIQUE** — dedup is enforced only in application code. Low risk (single writer) but not a hard guarantee.
- **Deletion behavior:** account delete → `ON DELETE SET NULL` for transactions (history kept), cascade for holdings/securities. Good.
- **Currency column on holdings/securities/accounts** exists but is **not used** to convert values before summing (see §12). FKs reference `user_id` broadly. ✅ scoping.
- **SQLite coupling:** high. No repository abstraction used; business logic depends on `better-sqlite3` semantics (`db.prepare`, `lastInsertRowid`).

---

## 7. API Review

1014-line router. All data routes behind `requireAuth`; all `:id` writes/reads I inspected scope by `user_id` (accounts, transactions, budgets, goals, securities, holdings, consents, notifications, ai conversations). Public routes: `/health`, `/ready`, `/config`, `/auth/*`, and **calculators**.

- **Calculators are unauthenticated** (`/calculators/emi|sip|fd|cagr|xirr`). They read only request inputs (no user data), so not a data leak — but they are effectively a public computation utility. Acceptable for a local app; note for a shared deployment.
- **`GET /holdings` → 404** — holdings are only reachable via `/portfolio` (which works). Minor API-surface inconsistency.
- **Consistency:** `POST /holdings` does **not** verify that the referenced `security_id`/`account_id` belong to the user (it only stores `user_id` on the holding). Multi-user would leak another user's security metadata via the join. Currently mitigated only by the **single-user setup constraint**.
- All mutations validated and audited via `audit_log`. ✅

---

## 8. Authentication & Authorization Review

- **Auth:** scrypt (64-byte key, per-user 16-byte salt), timing-safe verification; server-side opaque session tokens (32-byte hex, 12h expiry, revocable). ✅
- **App lock:** session-bound scrypt PIN; locked sessions return HTTP 423 on data routes. ✅
- **httpOnly cookie sessions** supported (`wc_session`, `HttpOnly`, `SameSite`, `Secure` in prod); **CSRF** enforced for cookie-authenticated mutations (bearer skips CSRF). ✅
- **Login rate limiting** per identifier (default 3 failed / 15 min) → 429. ✅
- **Password reset** (15-min, single-use, hashed token). ✅
- **Authorization / IDOR:** I inspected every `:id` route; **all scope by `user_id`**. The only generalization risk is `POST /holdings` (no ownership check on security/account) and `PUT /accounts/:id`'s follow-up SELECT (already scoped). Given the **hard single-user constraint** (`/auth/setup` returns 409 if a user already exists), cross-user access is structurally prevented. **No CRITICAL cross-user exposure found.**
- **Note:** the app is fundamentally single-user — `users` table and `user_id` columns exist, but setup blocks >1 user.

---

## 9. Security Review

| Area | Status |
| ---- | ------ |
| Password hashing | ✅ scrypt + salt |
| Session tokens | ✅ opaque server-side |
| httpOnly / SameSite / Secure cookie | ✅ (Secure in prod) |
| CSRF | ✅ cookie-auth mutations |
| Rate limiting / brute-force | ✅ login |
| SQL injection | ✅ all prepared statements |
| XSS | ✅ `esc()` on all dynamic HTML |
| Command injection / path traversal | ✅ no `child_process`, static served from fixed dir |
| Secret scanning | ✅ `npm run audit:secrets` → clean |
| Dependency audit | ✅ `npm audit` → 0 vulnerabilities |
| Security headers | ✅ CSP, nosniff, referrer-policy, frame-options, XSS-protection, COOP, no-store |
| Sensitive log redaction | ✅ `logger.redact`; HTTP logs metadata only |
| Config validation | ✅ production fail-fast |
| Token storage (client) | **⚠** bearer token in `localStorage` (documented; cookie channel available but not default) |
| DB at-rest encryption | **⚠** not implemented (`encryptionKey` validated but unused) |
| Endpoint rate limiting | **⚠** only login is rate-limited |

**No production blockers found in code** beyond the documented-at-rest-encryption and client-token-storage items.

---

## 10. Financial Calculation Review

`calculations.js` is closed-form/solver-based; the AI never computes figures. I rederived references independently:

| Calc | Reference | Implementation | Verdict |
| ---- | --------- | -------------- | ------- |
| EMI | P·r·(1+r)^n/((1+r)^n−1) | ✅ matches | Correct |
| SIP | annuity-due FV | ✅ matches start/end | Correct |
| FD | quarterly compound | ✅ matches | Correct |
| CAGR | (end/beg)^(1/n)−1 | ✅ matches | Correct |
| XIRR | Newton+bisection | ✅ matches ±1e-4 | Correct |
| Amortization | ends at 0, principal sums to loan | ✅ | Correct |
| Savings rate | (inc−exp)/inc | ✅ | Correct |

**Edge-case risk:** EMI/SIP/FD use JS `**` over floats — fine within tolerance but not decimal-exact; `parseAmount`/`parseMinor` use `Math.round(x*100)` (float), acceptable for 2-decimals but does not handle true decimal arithmetic. No LLM dependency anywhere. **No financial calculation uses the LLM** — confirmed.

---

## 11. Transaction Engine Review

- **CRUD + validation + dedup + auto-categorise + transfer + recurring** all implemented and tested. ✅
- **Dedup key:** `sha256(accountId|date|amount|direction)` or `sha256(ref:)` if `providerRef`/`external_id` present. **Cross-account collision if a provider reuses a ref across accounts** (mitigated by `user_id` filter but not by account). Medium-low.
- **Repeated import is idempotent** — verified by test (same CSV twice → 0 created, 2 duplicates). ✅
- **Currency handling:** transactions validate against the account's currency, but category/month totals **sum across currencies** (see §12).

---

## 12. Net-Worth Engine Review (CRITICAL FINDING)

`computeNetWorth` is the single source of truth used by dashboard, reports, snapshots, portfolio and AI. Formula is correct:

```text
Net Worth = (non-liability account balances + holding market values) − (liability balances)
```

**BUT** it sums `currentValueMinor` across **all holdings regardless of currency**, and adds it to account balances without FX conversion. Confirmed with live data:

```
Bitcoin   qty=0.01  price=6,050,000 (USD)  value=60,500 (USD-minor=$605)  cost=550,000
```
This `60,500` is added directly to INR-minor totals. `totalValueMinor` (11,715,500) and `totalPnlMinor` (945,500) are therefore **currency-mixed and financially incorrect**. The same applies to monthly income/expense sums and category totals.

**Classification: P0 Financial-correctness defect.** Fix requires FX conversion (or refusing to mix) before summing, and currency-aware per-account/per-holding value.

**Historical snapshots:** only created on demand (`POST /net-worth/snapshot`) or by the monthly scheduler job — not automatic per-transaction. ✅ (scheduler provides monthly).

---

## 13. Portfolio Engine Review

- Per-holding `qty × price = value`, P&L, portfolio invariant, asset-class breakdown — implemented. ✅
- **Realized P&L:** not modelled (only unrealized). Partial.
- **Multi-account / multi-broker:** `getHoldingsValuation` left-joins accounts; grouping by account type exists in net worth, but portfolio grouping is by asset class only. Broker grouping missing. Partial.
- **Unpriced holdings:** valued at cost, `priceMissing=true`, `priceStatus=MANUAL` — honest. **BUT validation false-positive:** for an unpriced holding with qty≠1, `mismatches` is reported as 1 even though it's validly valued at cost (confirmed empirically: qty=5, cost=200000 → `mismatches: 1`). P2.
- **Price freshness:** `LIVE/DELAYED/LAST_AVAILABLE/MANUAL/COST_BASIS/UNPRICED`, stale detection >24h. ✅ honestly represented.
- **Multi-currency:** the exact issue as §12 — the whole portfolio is summed without FX. ❌.

---

## 14. Import/Export Review

| Format | Parser | Preview | Mapping | Dedup | Failed-report | Rollback | Test |
| ------ | ------ | ------- | ------- | ----- | ------------- | -------- | ---- |
| CSV (generic) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (id only) | ✅ |
| Bank CSV | ✅ | ✅ | ✅ (auto-detect) | ✅ | ✅ | ❌ | ⚠ via generic |
| JSON transactions | ✅ | ✅ | n/a | ✅ | ✅ | ❌ | ✅ |
| Zerodha holdings | ✅ | ⚠ | ✅ | ✅ | ✅ | ❌ | ⚠ partial |
| Groww holdings | ✅ | ⚠ | ✅ | ✅ | ✅ | ❌ | ⚠ partial |
| Excel (.xlsx) | ❌ | — | — | — | — | — | ❌ (dependency removed for CVE) |
| CAS/MFCentral | ❌ | — | — | — | — | — | ❌ |

- **Export:** `/export.json` (accounts, transactions, securities, holdings, goals, budgets, categories, consents, reconciliation runs, notifications, snapshots, audit) and `/export.csv` (transactions). ✅ real data.
- **Rollback overclaimed:** docs/`IMPORT_EXPORT.md` says "rollback capability where practical" and the API returns `rollbackId`, but there is **no rollback** — the id is just the run id.
- **Excel** intentionally removed (the `xlsx` package has an unfixed high-severity ReDoS/Prototype-Pollution advisory). Honest.

---

## 15. AI Review

- **Tools query real data** (19 tool schemas; the regex resolver invokes up to 20 tool functions). ✅
- **Financial values come from engines / DB**, never computed by a model. ✅
- **Authorization:** all tools are called with the request `userId` and the shared `db`. ✅ (single-user).
- **Conversation context:** `lastPeriod`/`lastEntity`/`lastMetric` persist and are reconstructed from history. Partially works. **Confirmed bug:** "Compare that with the previous month." after "How much did I spend on food last month?" produced "2026-07 vs last month ₹6,400" — i.e. it compared July to itself because the compare step uses `previousMonth(now)` instead of the month before the conversation's `lastPeriod`. **P1.**
- **"Why did it increase?"** → unsupported (returns generic suggestion, no tools). Missing explainability.
- **No LLM path:** `llmStatus`/`llmProviderConfig`/`TOOL_SCHEMAS` exist, but there is no chat-completion call and no function-call dispatch. The claims of "real LLM tool-calling" are **architecture-only**. Honest `LLM_NOT_CONFIGURED`.

**Empirical AI chain test:**

```
Q: How much did I spend on food last month?  → "food spending in 2026-07 was ₹6,400.00"  [tool: get_transaction_total]  ✅
Q: Compare that with the previous month.     → "2026-07 was ₹6,400 vs last month ₹6,400 (+₹0)"  ❌ (self-compare)
Q: Why did it increase?                      → generic fallback, no tools  ❌ (not supported)
```

---

## 16. AA/FIU Review

Classification: **IMPLEMENTED_NOT_CONFIGURED (consent lifecycle real; data retrieval not wired).**

- Consent create/approve/reject/revoke/expire — real, DB-backed, validated. ✅
- Provider adapter interface (`registerProvider`/`resolveProvider`), correlation IDs, raw-payload store, config validation — present. ✅
- **FI session, FI data retrieval, decryption, normalisation of AA records, retries/timeout** — **not implemented**. `requestFinancialData` returns `PROVIDER_NOT_CONFIGURED` (unconfigured) or `PROVIDER_ERROR` (configured but `'AA provider driver not wired'`). ✅ honest.
- Never labelled LIVE without a real provider. ✅

---

## 17. Market Data Review

Classification: **IMPLEMENTED_NOT_CONFIGURED (status model real; live fetch not wired).**

- Price states incl. `COST_BASIS`/`UNPRICED`, freshness/stale detection, `market_price_history` table, `validateQuote`. ✅
- No actual provider driver (stub throws). No retry/backoff/timeout in the fetch loop (per-quote errors swallowed silently). ❌ partially.
- Supports Indian equities/MF/ETF/SGB/gold/crypto via asset_class; no live FX; no corporate actions; no historical price API. Partial.

Never shows LIVE without a provider. ✅

---

## 18. Notification Review

Classification: **IMPLEMENTED (offline, rule-based).**

- `notifications.js` evaluates budget threshold, large transaction, goal milestone/behind, consent expiry, failed sync, reconciliation difference, stale market data. Preferences, read/unread, dismiss. ✅
- Not implemented: `emi_due`, `credit_card_due`, `low_balance`, `portfolio_movement`, `concentration_warning`, `unusual_spending` (types exist in the enum but no evaluation rule fires them). Partial.
- Rules are heuristic/simple; no user-defined thresholds except a hard-coded large-txn threshold env default.

---

## 19. Scheduler/Automation Review

- In-process scheduler, 5 jobs, retry/backoff, status in `jobs`. ✅
- Runs off the request path. ✅
- `POST /jobs/:name/run` invokes the runner **directly** (skips `runJob`), so manual runs don't update `jobs` status — inconsistent. Minor.
- Single-process only (no distributed lock) — fine for personal use.

---

## 20. Reconciliation Review

- Engine compares `source_balance_minor` vs `balance_minor`, classifies statuses, records history + items. ✅
- **Source balance is only ever set manually** (no provider feed) — so it works when a user supplies a source figure, otherwise `MISSING_SOURCE_DATA`. Honest partial.
- **`runAllReconciliations(forceSave=true)` only persists a run for the first account** — the "Run reconciliation" action records history for just one account. Confirmed in code. P2.
- Differences are surfaced, never auto-hidden. ✅ (matches requirement).

---

## 21. Performance Review

- Synchronous SQLite; single-user friendly. Transaction list has LIMIT/OFFSET (max 500) but **no cursor pagination**; no read caching. Dashboard recomputes on each request.
- Potential N+1: `computePortfolio`/`computeNetWorth` do a couple of queries; budget view runs a per-budget spend query (N+1 across budgets). Not benchmarked at scale (no 10k/100k dataset test). Recommend pagination + caching + an index on `transactions(account_id, date)`.

---

## 22. Testing Review

- **81 tests**, all passing, ~2.1s. Categorized:
  - Unit: `money`, `calculations`, `transaction-intelligence`, `csv`, `config`, `ingest` (normalisation).
  - DB-integration: `networth-portfolio`, `reconciliation`, `notifications`, `scheduler`, `adapters`.
  - API/E2E HTTP: `api`, `security`.
  - AI: `ai-agent`.
  - Security: `security`.
- **No coverage tooling** configured → the docs' coverage claims are **not measured**. No benchmarks at scale. See `TEST_GAP_ANALYSIS.md`.
- Missing: multi-currency tests (would have caught §12), unpriced-qty validation, FX, cross-user (impossible by design), performance, browser-console tests.

---

## 23. Documentation Review

Docs are extensive (32 files) and mostly accurate, but contain **overclaims** vs. code:

| Doc claim | Reality |
| --------- | ------- |
| "Real LLM tool calling" (AI_ARCHITECTURE, PRD) | Deterministic offline only; no LLM call |
| "PostgreSQL adapter-ready / repository abstraction" (ARCHITECTURE, FINAL_PRODUCTION_AUDIT) | `connector.js` unused; all queries direct better-sqlite3 |
| "Rollback" on import (IMPORT_EXPORT) | No rollback (id = run id) |
| "Coverage" / "95%" claims | No coverage tooling |
| "19 tools" in AI_ARCHITECTURE | 20 tool schemas registered |
| "Notifications operational" (Health) | 8 of 14 types fire; several enum-only |

Docs that are **accurate & honest**: `APPLICATION_AUDIT`, `DEFECTS`, `FINAL_PRODUCTION_AUDIT` (mostly), `AA_INTEGRATION`, `MARKET_DATA`, `SECURITY`, `PRIVACY`.

---

## 24. FinBoom Parity Matrix

See `FINBOOM_FEATURE_PARITY_MATRIX.md` for the full table. Summary:

| Domain | Status |
| ------ | ------ |
| Dashboard (net worth, trend, cash flow, allocation, goals, alerts) | **COMPLETE / PARTIAL** (no health score, snapshots manual/monthly) |
| Transactions (manual entry, import, search, categories, transfers, recurring, dedup) | **COMPLETE** (no split/clone/bulk) |
| Investments (securities, holdings, P&L, allocation, freshness) | **COMPLETE** (no realized P&L, no broker grouping, multi-currency broken) |
| Goals (targets, progress) | **COMPLETE** (no sub-targets/projections) |
| Loans (EMI) | **PARTIAL** (EMI calculator, no loan dashboard) |
| Financial planning (SIP, CAGR, XIRR, FD, EMI) | **COMPLETE** (no step-up SIP, no emergency-fund) |
| Imports (bank, broker, CAS/MFCentral) | **PARTIAL** (CSV/JSON/Zerodha/Groww; no Excel, no CAS) |
| Multi-currency | **MISSING/BROKEN** (status only, no FX) |
| Privacy (export, delete, local) | **COMPLETE** (privacy mode absent) |
| Profiles/Sharing | **NOT APPLICABLE** (single-user non-goal) |
| Notifications center | **PARTIAL** |
| Historical data (snapshots, trend, annotations) | **PARTIAL** (snapshots + trend; no annotations) |

---

## 25. Missing Features

See `WEALTHCORE_MISSING_FEATURES.md`. Highlights: multi-currency/FX, split transactions, realized P&L, broker grouping, loan dashboard, step-up SIP, emergency-fund/health score, CAS/MFCentral + Excel import, budget-percent & allocation goal views, annotations, cash-flow forecasting, net-worth attribution, explainable AI ("why"), live LLM, live AA, live market.

---

## 26. Good-to-Have Features

See `WEALTHCORE_GOOD_TO_HAVE.md`.

---

## 27. Better-than-FinBoom Opportunities

See `WEALTHCORE_DIFFERENTIATORS.md`.

---

## 28. Defect Register

See `WEALTHCORE_DEFECT_REGISTER.md`. Summary: **1 P0 (multi-currency mixing), 4 P1, 9 P2, 7 P3.**

---

## 29. Risk Register

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Multi-currency miscounting | High (if any non-INR asset) | **Critical — wrong financials** | Currency-aware valuation + FX (or reject mixing) |
| Live integrations unproven | High | Medium | Honest status already; add real provider + mocked fixture tests |
| AI "compare/why" correctness | Medium | Medium | Fix month-anchor; add explainability |
| Data loss (single SQLite file) | Medium | High | Backup/restore CLI; documented export |
| No at-rest encryption | Medium | Medium | SQLCipher / key management |
| Large-history performance | Medium | Low/Med | Pagination + caching + indexes |
| Single-process scheduler | Low | Low | Durable queue if multi-instance |

---

## 30. Recommended Implementation Order

Phase 1 — **Critical** (P0, financial correctness): currency-aware valuation/FX; fix unpriced-validation false-positive.
Phase 2 — **Data Integrity**: unique dedup guard; rollback proper; transaction currency consistency.
Phase 3 — **FinBoom Parity**: split transactions, realized P&L, loan dashboard, step-up SIP, goals sub-targets/projections, budget & goal allocation views, snapshots annotations.
Phase 4 — **Automation/Integrations**: real AA adapter (fixtures), market provider adapter, CAS/MFCentral + safe Excel, notification types (EMI due, low balance, portfolio movement, concentration, unusual spending), scheduler manual-run status update.
Phase 5 — **AI**: real LLM tool-calling loop (function-call dispatch over the existing `TOOL_SCHEMAS`), fix compare-month anchor, "why"/explainability.
Phase 6 — **Better-than-FinBoom**: data-health score, net-worth attribution, predictive cash flow, explainable AI with data/freshness provenance.
Phase 7 — **Production**: PostgreSQL repository seam actually wired, at-rest encryption, cursor pagination/caching, coverage tooling, backup/restore, browser-based E2E.

---

## 31. Final Remediation Plan

The concrete, ordered, code-level plan is in `WEALTHCORE_IMPLEMENTATION_PROMPT.md`, containing **only** changes identified by this audit. It is intentionally scoped to verified defects and real gaps.
