# CHANGE LOG

| Date | Version | Feature | Change | Reason | Impact | Docs Updated | Tests |
| ---- | ------- | ------- | ------ | ------ | ------ | ------------ | ----- |
| 2026-08-24 | 1.0.0 | Project bootstrap | Created the WealthCore repository from an initial commit | Product requirements | New app | README, BRD, FRD, PRD, ARCHITECTURE | — |
| 2026-08-24 | 1.0.0 | Auth | scrypt password hashing, server-side sessions, setup/login/logout, app-lock PIN | Security rule for credentials | Secure single-user auth | SECURITY, FRD (FR-AUTH) | api, money |
| 2026-08-24 | 1.0.0 | Database | Full schema with FK, WAL, indexes | Single source of truth | Data integrity | DATA_MODEL | — |
| 2026-08-24 | 1.0.0 | Accounts & categories | CRUD, asset/liability classification, default category seeding | Core financial model | Accounts module | FRD | api, networth |
| 2026-08-24 | 1.0.0 | Transactions | CRUD, validation, dedup, auto-categorisation, batch, import | Transaction intelligence | Transactions module | FRD, IMPORT_EXPORT | api, txn-intelligence |
| 2026-08-24 | 1.0.0 | Portfolio & net worth | qty×price valuation, P&L, invariant check, single source of truth; snapshots | Accurate position | Portfolio/Net Worth | FRD, DATA_MODEL | networth-portfolio |
| 2026-08-24 | 1.0.0 | Budgets & goals | CRUD + progress | Planning | Budgets/Goals | FRD | api |
| 2026-08-24 | 1.0.0 | Reports | Monthly cash flow, allocation | Analytics | Reports | FRD, API_SPEC | api |
| 2026-08-24 | 1.0.0 | Calculators | EMI, SIP, FD, CAGR, XIRR — deterministic | Rule 6 | Accurate math | FRD, API_SPEC | calculations |
| 2026-08-24 | 1.0.0 | AI agent | Tool layer over real data, conversation context, offline deterministic provider | AI over real data, no hallucination | AI module | AI_ARCHITECTURE | ai-agent |
| 2026-08-24 | 1.0.0 | AA integration | Consent lifecycle + honest READY_FOR_CONFIGURATION | Rule 14, no fake AA | Integrations | AA_INTEGRATION | api |
| 2026-08-24 | 1.0.0 | Market data | Price status classification + honest refresh | Rule 18 | Integrations | MARKET_DATA | api |
| 2026-08-24 | 1.0.0 | Import/export | JSON import, JSON/CSV export | Data portability | Backup/Control | IMPORT_EXPORT | api |
| 2026-08-24 | 1.0.0 | Frontend | Full SPA (dashboard, accounts, transactions, portfolio, net worth, budgets, goals, reports, calculators, AI, integrations, settings) | Product UX | Whole product | USER_GUIDE, PRD | — |
| 2026-08-24 | 1.0.0 | Docs | Full docs suite (BRD, FRD, PRD, ARCHITECTURE, DATA_MODEL, API_SPEC, AA, MARKET, SYNC, AI, SECURITY, PRIVACY, IMPORT_EXPORT, TEST_STRATEGY, TEST_CASES, UAT, DEPLOYMENT, USER_GUIDE) + audit docs | Documentation as source of truth | Governance | — | — |
| 2026-08-24 | 1.0.0 | Test suite | 41 tests across calculations, money, txn-intelligence, networth/portfolio, ai-agent, API | Rule 5 | Quality | TEST_STRATEGY, TEST_CASES | — |

## Fixes (see DEFECTS.md)
- D-001 AI category mislabel ("i spend")
- D-002 AI comparison fallback
- D-003 recurring merchant case
- D-004 `/health` auth ordering
- D-005 XIRR frontend syntax
- D-006 money parser validation
- D-007 allocation accounting for account balances

## v1.1.0 — Production-readiness pass
- Added reconciliation engine + API + UI + history + resolve.
- Added background scheduler (5 jobs, retries/backoff, `/jobs`).
- Added ingestion framework (CSV/JSON/bank/Zerodha/Groww, preview, dedup, summary, failed report) — idempotent.
- Added notification engine (14 types, preferences, dismiss, evaluate).
- Added market-data provider interface + `COST_BASIS`/`UNPRICED` + history + stale detection.
- Added AA/FIU provider adapter interface + config validation + correlation IDs + raw-payload store.
- Expanded AI tools (19) + LLM provider interface + `LLM_NOT_CONFIGURED`.
- Added password reset, login rate limiting, CSRF, httpOnly cookie sessions, `/auth/csrf`.
- Added config module + `.env.example` + production fail-fast.
- Added `/health` + `/ready` per-component status.
- Added privacy controls (revoke connections, delete all data).
- Added structured redacted logging with request/correlation IDs.
- Tests: 41 → **81**. Documentation updated; added OPERATIONS_RUNBOOK, DISASTER_RECOVERY, TROUBLESHOOTING, RELEASE_NOTES.
| 2026-09-02 | 1.4.1 | Setu AA webhook + consent URL + currency exposure | Corrected webhook to Setu's real notification contract (`data.status`, CONSENT_STATUS_UPDATE/SESSION_STATUS_UPDATE); added webhook idempotency (`webhook_notifications` table) + audit; persisted + surfaced the Setu consent webview URL (`consents.consent_url`, Integrations "Open consent"); corrected external test to the current Bearer auth model; added per-currency net-worth breakdown (`currencyBreakdown`, `mixedCurrency`). | Correct AA status handling, idempotent replays, real consent approval path, honest multi-currency exposure | AA/Setu, webhooks, net worth | SETU_INTEGRATION, AA_INTEGRATION, ARCHITECTURE, SECURITY, PRIVACY, README | setu-e2e, networth-portfolio, setu-external |
| 2026-09-02 | 1.4.2 | Setu config aliases + validator + UI product id | Added `SETU_*` env aliases (mirroring `WEALTHCORE_SETU_*`), `npm run config:setu` (presence-only validator), Setu Connections card showing product + non-sensitive product-instance-id; recorded the two hard blockers (no regenerated secret & no egress to setu.co). | Real Setu config surface with zero secret leakage; honest blocked status | AA/Setu config + Connections UI | SETU_INTEGRATION, ARCHITECTURE, SECURITY | config, aa-provider |
| 2026-09-03 | 1.4.3 | Setu creds configured + network blocker isolated | `config:setu` now reports all 3 creds present/`configured:true`; external-test harness fixed to use `config().setu` (both env namespaces) so it attempts (not skips) when creds are set and reports `BLOCKED — NETWORK`; added public `GET /aa/setu/consent/return`; documented the egress allowlist blocker (only npmjs.org + api.github.com reachable). | Honest accounting: sole real-external blocker is network egress, not credentials | Setu AA + consent-return route | SETU_INTEGRATION, API_SPECIFICATION, SECURITY | setu-external, api |
| 2026-09-03 | 1.4.4 | GitHub Actions Setu E2E workflow | Added `.github/workflows/setu-e2e.yml` (workflow_dispatch, GH Secrets only, outbound connectivity test, real test-gated, redacted evidence) + `docs/SETU_GITHUB_ACTIONS.md`. | Enable the real Setu sandbox E2E from a network-enabled runner once the owner adds secrets; does not claim success. | Setu AA / CI | SETU_GITHUB_ACTIONS, SETU_INTEGRATION, README | (none — no app code changed) |
| 2026-09-03 | 1.4.5 | Setu token acquisition corrected to current official Generate Token API | `POST https://uat.setu.co/api/v2/auth/token` (sandbox; `prod.setu.co` in production), JSON body `{clientID, secret}`, response `data.token`; removed old OAuth2 form-encoded `grant_type=client_credentials`. Updated setu-auth.js, docs/.env.example; local simulator + tests enforce the JSON request/`data.token`. | Authenticate against Setu's current official API; prevent the old token contract from returning | Setu AA auth | SETU_INTEGRATION, CHANGELOG, .env.example | setu-auth, setu-e2e |
