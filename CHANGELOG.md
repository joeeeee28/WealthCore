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
| 2026-08-24 | 1.0.0 | Test suite | 39 tests across calculations, money, txn-intelligence, networth/portfolio, ai-agent, API | Rule 5 | Quality | TEST_STRATEGY, TEST_CASES | — |

## Fixes (see DEFECTS.md)
- D-001 AI category mislabel ("i spend")
- D-002 AI comparison fallback
- D-003 recurring merchant case
- D-004 `/health` auth ordering
- D-005 XIRR frontend syntax
- D-006 money parser validation
- D-007 allocation accounting for account balances

## v1.1.0 — Production-readiness pass
- Reconciliation engine + API + UI + history + resolve (differences never hidden).
- Background scheduler (5 jobs, retries/backoff, `/jobs`).
- Ingestion framework (CSV/JSON/bank/Zerodha/Groww; preview, dedup, summary, failed report; idempotent).
- Notification engine (14 types, preferences, dismiss, evaluate).
- Market-data provider interface + `COST_BASIS`/`UNPRICED` + history + stale detection.
- AA/FIU provider adapter interface + config validation + correlation IDs + raw-payload store.
- AI tools expanded (19) + LLM provider interface + `LLM_NOT_CONFIGURED`.
- Security hardening: password reset, login rate limiting, CSRF, httpOnly cookie sessions, config validation.
- Health/readiness + structured redacted logging; privacy controls.
- Tests: 41 → **81**.

## v1.2.0 — Account Aggregator foundation (provider-neutral + Mock AA)
- Provider-neutral AA abstraction + registry (mock, finvu, setu, onemoney, anumati, ink, saafe, nadl, protean).
- Fully-functional local Mock AA with realistic synthetic data (banking, investments, retirement, insurance, loans, 12 transactions), labelled TEST DATA — NOT REAL FINANCIAL DATA.
- Explicit consent + FI-data state machine with valid/invalid transitions.
- ReBIT normalizer → canonical WealthCore accounts/transactions/holdings.
- Sync engine with idempotency (accounts by external_ref, transactions by source_txn_id/dedup_key) and provenance (source=aa, fip, source_txn_id).
- API: /aa/providers, /aa/workflow, /aa/connect, /aa/sync, /aa/sessions; enhanced Integrations UI (connect flow, approve/sync/revoke, Demo vs Sandbox vs Production labels).
- DB migration 10 (consent enrichment, provenance columns, aa_sessions).
- Finvu/Setu adapter contracts marked PARTIALLY IMPLEMENTED / PENDING PROVIDER CONFIRMATION (no fabricated crypto/live).
- Tests: 81 → 101 (new aa-consent-machine, aa-provider, aa-api suites).
- Docs: AA_IMPLEMENTATION.md (architecture, ADRs, provider status, Finvu checklist).

## v1.3.0 — Setu Account Aggregator connectivity (sandbox path)
- Setu provider adapter implemented against current official Setu AA docs (v2 consents, sessions, fetch, revoke).
- ReBIT deposit JSON → canonical envelope translation (accounts, transactions, holdings; liability sign; category mapping).
- Setu crypto abstraction (signature verification, auth headers). Verified Webhook route (public, signature-verified) updates consent state.
- Environment separation: AA_PROVIDER + AA_ENVIRONMENT (mock | sandbox | production); production safety guard (never mock-fallback).
- Config: WEALTHCORE_SETU_TOKEN / _PRODUCT_INSTANCE_ID / _BASE_URL / _WEBHOOK_SECRET / _SIGNING_PUBLIC_KEY; .env.example.
- /aa/connect-setu, /aa/webhook/setu endpoints; /aa/providers honed to report live configured status; session idempotency.
- Tests: 101 → 113 (setu-adapter, setu-e2e via local Setu simulator). Docs: SETU_INTEGRATION.md.

## v1.3.1 — Setu auth-model correction + external sandbox test harness
- Corrected Setu auth to the CURRENT official model: x-client-id + x-client-secret + x-product-instance-id (client-credentials, from Setu Bridge). Legacy bearer token retained only as fallback.
- config/env: WEALTHCORE_SETU_CLIENT_ID / _CLIENT_SECRET / _PRODUCT_INSTANCE_ID added; setuCryptoConfig.setuHeaders emit the current headers.
- Added credential-gated external Setu sandbox integration test (`npm run test:setu:sandbox`, `tests/setu-external.test.js`) that is NOT part of `npm test` and skips/aborts if credentials are absent.
- `npm test` stays credential-free; local Setu simulator now asserts the current auth headers.
- Tests: 113 -> 114 (auth-model header test). External Setu E2E: BLOCKED (no credentials in environment).

## v1.3.2 — External Setu sandbox connectivity re-verified (BLOCKED)
- Re-confirmed the current official Setu contract (v2 consents, /consents/:id, consent URL, status PENDING→ACTIVE, Bridge client-credentials auth) matches the adapter.
- Re-verified NO Setu credentials present in the environment: /aa/providers and /config honestly report setu configured=false / READY_FOR_CONFIGURATION.
- `npm run test:setu:sandbox` reports BLOCKED — Real Setu sandbox credentials/access are not available (test skips).
- No fabricated connectivity; local simulator E2E remains the credential-free contract proof. Docs recorded.
