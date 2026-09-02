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
