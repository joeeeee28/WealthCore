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

## v1.4.0 — Setu Authentication Manager + correct current official Bearer auth model
- Corrected Setu auth to the current official model: Bridge client_id + client_secret are used to ACQUIRE an access token (Setu Auth Mechanism / getToken); all AA APIs use `Authorization: Bearer <token>` + `x-product-instance-id`. The client secret is never sent as an AA request header.
- Added Setu Authentication Manager (`server/aa/providers/setu-auth.js`): acquire/cache/renew the access token, serialise concurrent refreshes (no token storm), invalidate on auth failure, single retry on confirmed auth failure. Never logs credentials/tokens.
- `setu-crypto.js` → `setuAuthHeaders()` (Bearer + product-instance-id); adapter `http()` uses it with a token-refresh retry wrapper.
- Setu Account Availability (`POST /v2/account-availability`) + `/aa/setu/availability` route + `getDataSessionStatus` recovery/polling.
- Docs corrected (SETU_INTEGRATION auth section + source register); `.env.example` updated.
- Tests 114 → 119. **External Setu sandbox: BLOCKED — no Setu credentials in environment.**

## v1.4.1 — Setu webhook contract fix, webhook idempotency, consent URL surfacing & currency exposure
- **Fixed Setu webhook handling to the real notification contract**: status now read from `payload.data.status` (Setu posts `{type, consentId, notificationId, data:{status,...}}`), not a top-level `status`. Handles both `CONSENT_STATUS_UPDATE` and `SESSION_STATUS_UPDATE`.
- **Webhook idempotency** via new `webhook_notifications` table (migration 11): a notification id is processed once; replays return `{ok:true, idempotent:true}`. Audits receipt without storing raw payloads.
- **Consent URL persisted + surfaced**: new `consents.consent_url` column (migration 12); `/aa/connect` and `/aa/connect-setu` persist the provider consent webview URL; Integrations UI adds an "Open consent" action so a real Setu consent is approved by the customer opening the provider screen (never auto-approved).
- **External `test:setu:sandbox` corrected to the current official Bearer auth model** (acquires a token via the Setu Authentication Manager; no `x-client-secret` request header). Still credential-gated and BLOCKED here.
- **Multi-currency exposure in net worth**: `computeNetWorth` now returns a per-currency `currencyBreakdown` + `mixedCurrency`/`baseCurrency` so non-INR balances are surfaced and never silently treated as INR minors (no FX conversion).
- Tests 119 → 120 (added mixed-currency + webhook idempotency assertions). **External Setu sandbox: BLOCKED — no Setu credentials in environment.**

## v1.4.2 — Setu config aliases, config:setu validator, non-secret product-id in UI, egress/secret blocker recorded
- **Setu env aliases**: `SETU_CLIENT_ID` / `SETU_CLIENT_SECRET` / `SETU_PRODUCT_INSTANCE_ID` (and `SETU_BASE_URL`, `SETU_TOKEN_URL`, `SETU_REDIRECT_URL`, `SETU_WEBHOOK_URL`, `SETU_WEBHOOK_SECRET`) are now accepted in addition to the canonical `WEALTHCORE_SETU_*` names. `config().setu` resolves both; the secret is read from env only and never logged/returned.
- **`npm run config:setu`**: presence-only Setu config validation (never prints the secret/token); reports `SETU_ENVIRONMENT`, each field as `configured|NOT SET`, and the missing list.
- **Connections UI**: Setu provider card now shows Environment, Product (`Account Aggregator Data`), and the **non-sensitive** Product Instance ID (never the client secret/access token).
- **Recorded (2026-09-03)**: the non-secret Setu product instance ID wires correctly; `config:setu` shows `SETU_CLIENT_SECRET: NOT SET`. **BOTH** hard blockers confirmed: (1) no `.env`/secret (must be a freshly regenerated TEST secret) and (2) **no runtime egress to `setu.co`** (TLS to `fiu-sandbox.setu.co` is reset). Real external E2E remains **BLOCKED**; simulator E2E still PASS.
- Tests 120 → 122 (config alias + validateSetuConfig secret-non-leak). `audit:secrets` clean.

## v1.4.3 — Setu TEST credentials configured; real-external blocker isolated to network egress; consent-return route; external-test harness fix
- **Credentials confirmed present** (runtime env only, never committed): `npm run config:setu` reports `SETU_CLIENT_ID/SETU_CLIENT_SECRET/SETU_PRODUCT_INSTANCE_ID: configured`, `configured: true`; `setuCryptoConfig().configured=true`; `SetuProvider.status()` → `configured=true, mode=sandbox, environment=SANDBOX, requiresCredentials=false`, product `Account Aggregator Data`. The non-secret product instance id resolves and would be sent as `x-product-instance-id`.
- **Real external blocker isolated to NETWORK EGRESS only**: this runtime cannot complete a TLS handshake to `https://fiu-sandbox.setu.co` (DNS resolves to `13.205.36.27`; the TLS Client hello is reset at the transport layer). An egress allowlist permits only `registry.npmjs.org` and `api.github.com`; every `*.setu.co` host and `raw.githubusercontent.com` is blocked. No proxy is configured. This is an environment/firewall block, not an application defect.
- **External-test harness fix**: `tests/setu-external.test.js` now resolves credentials through `config().setu` (honouring both `SETU_*` and `WEALTHCORE_SETU_*`), so with creds present it **attempts** the real sandbox and reports `STATUS: BLOCKED — NETWORK` (`PROVIDER_UNAVAILABLE`), instead of incorrectly SKIPping on the short env names. No secrets printed.
- **New public consent-return route** `GET /api/v1/aa/setu/consent/return?request_id=...` — informational page; the authoritative status change still comes from the verified webhook (no state mutation from untrusted query params).
- Docs updated (SETU_INTEGRATION, API_SPECIFICATION, SECURITY). `audit:secrets` clean, `npm audit` 0 vulns.
- **Status: SETU SANDBOX = BLOCKED (ENVIRONMENT NETWORK).** Local simulator E2E still PASS. No fabricated connectivity.

## v1.4.4 — GitHub Actions workflow for real Setu sandbox E2E (network-enabled runner)
- Added `.github/workflows/setu-e2e.yml`: a `workflow_dispatch`-only workflow that runs on `ubuntu-latest`, injects Setu credentials exclusively via GitHub Secrets (`SETU_CLIENT_ID`, `SETU_CLIENT_SECRET`, `SETU_PRODUCT_INSTANCE_ID`), validates config (`config:setu`), tests outbound connectivity to `fiu-sandbox.setu.co` (DNS/TLS/HTTP, no `curl -k`), runs the genuine `test:setu:sandbox`, then full regression + lint + config + secret scan + dependency audit, and uploads only a redacted evidence summary. Never dumps env, never echoes secrets, never disables TLS.
- Added `docs/SETU_GITHUB_ACTIONS.md` documenting why GH Actions is required, the three required Secrets, the manual trigger, what the workflow tests, the public webhook/callback requirement, the human Setu-approval step, and the definition of real Setu success.
- `docs/README.md` updated to link the new doc.
- **Status: `Setu Sandbox = BLOCKED`** — the workflow is prepared but has NOT executed against real Setu. Repository-owner action required: add the three Secrets and run the workflow; the real full E2E also needs a public inbound HTTPS callback.
