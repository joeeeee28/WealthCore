# API SPECIFICATION

Base URL: `/api/v1`. All data responses use **integer minor units** for money and a `currency` string. Authentication = `Authorization: Bearer <token>` for all routes except `/config`, `/health` and the auth endpoints. Errors are `{ "error": { "code", "message" } }`. Client rate limiting is intentionally permissive (single-user local app).

## Auth

### POST /auth/setup
Create the single user (only if none exists). Seeds default categories.
- Request: `{ name, email, password }` (password ≥ 8)
- 200: `{ token, user: { id, email, name } }`
- 409 `ALREADY_SETUP`, 400 `INVALID_INPUT`

### POST /auth/login
- Request: `{ email, password }` → 200 `{ token, user }`; 401 `INVALID_CREDENTIALS`

### GET /auth/me
- 200: `{ user, session: { locked, appLockEnabled, expiresAt } }`

### POST /auth/logout · POST /auth/lock
Revoke session / lock it. 200 `{ ok: true }`.

### POST /auth/pin
Set/replace app-lock PIN (4–6 digits). 200 `{ ok: true }`.

### POST /auth/unlock
`{ pin }` → 200 `{ ok: true }`; 401 `INVALID_PIN`.

## Config / health (public)

- `GET /config` → `{ name, tagline, setupRequired, aa, market, version }`
- `GET /health` → `{ ok, service }`

## Dashboard

- `GET /dashboard` → net worth, portfolio, month, income/expense, savingsRate, topExpenses, allocation, snapshots, notifications, demoCount, aa.

## Accounts

- `GET /accounts` → `[{ id, name, type, institution, currency, balanceMinor, isLiability, source, provider, aaStatus, isDemo, lastSyncedAt, createdAt, updatedAt }]`
- `POST /accounts` `{ name, type, currency?, balanceMinor?, institution?, isLiability?, source? }` → 200 account; 400 `INVALID_INPUT`
- `PUT /accounts/:id` → updated account
- `DELETE /accounts/:id` → `{ ok: true }` (transactions retained)

## Categories

- `GET /categories` → list; `POST /categories` `{ name, kind?, color?, icon? }` → 409 `DUPLICATE` if exists.

## Transactions

- `GET /transactions?month&direction&accountId&categoryId&search&limit&offset` → `{ transactions, total, limit, offset }`. Dates ISO. `limit ≤ 500`.
- `POST /transactions` `{ accountId, date, amountMinor, currency?, direction, kind?, categoryId?, merchant?, note?, source?, providerRef?, externalId?, isTransfer?, transferAccountId?, isRecurring?, recurrence? }`
  - 200 `{ transaction, dedupKey }`; 400 `INVALID_TRANSACTION`; 400 `DUPLICATE`.
- `POST /transactions/batch` `[ {...}, ... ]` → `{ results, count }`
- `PUT /transactions/:id` `{ categoryId?, merchant?, note?, amountMinor?, date?, kind? }`
- `DELETE /transactions/:id` → soft-delete (`status='deleted'`)
- `GET /transactions/intelligence/detect-transfers` → `{ transfers, count }`
- `GET /transactions/intelligence/recurring` → `{ recurring: [{ merchant, amountMinor, months }] }`

## Budgets & Goals

- `GET/POST/PUT/DELETE /budgets` — `{ categoryId, period?, amountMinor, currency? }`
- `GET/POST/PUT/DELETE /goals` — `{ name, targetAmountMinor, currentAmountMinor?, currency?, deadline?, status? }`

## Securities / Holdings / Portfolio

- `GET/POST /securities` — `{ ticker?, name, exchange?, assetClass, currency?, priceMinor?, priceStatus?, provider? }`
- `PUT /securities/:id` — update price/status/name/class
- `POST/PUT/DELETE /holdings` — `{ accountId?, securityId, quantity, costBasisMinor, currency? }`
- `GET /portfolio` → `{ totalValueMinor, totalCostMinor, totalPnlMinor, totalPnlPct, holdingsCount, unpricedCount, byAssetClass, holdings[], validation }`
  - `validation.invariantHolds` = `SUM(qty×price) == totalValue`; `mismatches` count.
- `POST /market/refresh` → `READY_FOR_CONFIGURATION` when no provider; otherwise `IN_PROGRESS`.

## Net worth & Reports

- `GET /net-worth` → `{ totalAssetsMinor, totalLiabilitiesMinor, netWorthMinor, assetClassBreakdown[], byType[], accountCount, holdingCount }`
- `GET /net-worth/snapshots` · `POST /net-worth/snapshot` `{ asOf?, isDemo? }`
- `GET /reports/cashflow?year=` → `{ year, rows: [{ month, incomeMinor, expenseMinor }] }`
- `GET /reports/allocations` → `{ assetClassBreakdown, byType }`

## AA / Consent / Sync

- `GET /aa/status` → `{ integration, status, provider, mode, configured, consents[] }`
- `POST /aa/consent` `{ provider?, fiType, purpose }` → `{ consent, providerConfigured }`
- `POST /aa/consent/:id/approve|reject|revoke` → `{ consent }`; 400 `BAD_STATE`
- `POST /aa/consent/:id/request-data` → `FAILED|IN_PROGRESS` (honest)
- `GET /sync/runs` → recent sync attempts.
- `GET /aa/providers` → `{ providers[], active }` — each provider carries `status()` (configured, mode, environment, and for Setu the non-sensitive `product` + `productInstanceId`).
- `POST /aa/connect-setu` `{ fiType?, fiTypes?, purpose?, dataRange?, frequency?, customerHandle? }` → `{ consent, provider, mode, redirectUrl, consentUrl }`
- `GET /aa/sessions` → recent FI data sessions.
- `POST /aa/webhook/setu` — **public** Setu notification callback (see §Webhooks).
- `GET /aa/setu/consent/return?request_id=...` — **public** informational consent-return page (browser lands here after the Setu consent journey; status changes come from the verified webhook, not this route).
- `POST /aa/setu/availability` `{ mobileNumber }` → `{ accounts[], traceId }` (Setu account availability).

## Webhooks (Setu AA)

`POST /aa/webhook/setu` is a public provider callback (Setu calls it server-to-server; it must not require a user session). It is signature-checked when `SETU_WEBHOOK_SECRET` is configured, is **idempotent** per `notification_id` (`webhook_notifications`), and audits each receipt without storing raw payloads.

- Setu consent notification: `{ type: "CONSENT_STATUS_UPDATE", consentId, notificationId, data: { status } }` → status under `data.status` (`ACTIVE|REJECTED|REVOKED|PAUSED|EXPIRED`).
- Setu session notification: `{ type: "SESSION_STATUS_UPDATE", consentId, dataSessionId, data: { status } }` → `data.status` (`PENDING|PARTIAL|COMPLETED|EXPIRED|FAILED`).
- Returns `200 { ok: true }` (or `{ ok: true, idempotent: true }` on a duplicate), `400` on a malformed/rejected payload. `GET /aa/setu/consent/return` is a separate informational page.

## Calculators (deterministic)

- `POST /calculators/emi` `{ principal, annualRatePercent, months }` → `{ emi, totalInterest, schedule[] }`
- `POST /calculators/sip` `{ monthlyInvestment, annualRatePercent, months, atBeginning? }` → `{ futureValue }`
- `POST /calculators/fd` `{ principal, annualRatePercent, compoundingPerYear?, years }` → `{ maturity }`
- `POST /calculators/cagr` `{ beginValue, endValue, years }` → `{ cagr }`
- `POST /calculators/xirr` `{ flows: [{ date, amount }] }` → `{ xirr }`
- Errors: 400 `INVALID_INPUT`.

## Import / Export

- `POST /import` `{ transactions: [...] }` → `{ results, created, failed }`
- `GET /export.json` → full data JSON (attachment)
- `GET /export.csv` → transactions CSV (attachment)

## Notifications & Audit

- `GET /notifications` ; `POST /notifications/read`
- `GET /audit` → user audit trail

## AI

- `POST /ai/message` `{ message, conversationId? }` → `{ conversationId, answer, toolCalls[], provider, context }`
  - `provider` = `offline-deterministic` (no model key) or LLM provider when configured.
  - Tools available: `get_net_worth, get_accounts, get_account_balance, get_transaction_total, get_portfolio, get_monthly_expenses, get_goals, get_budgets, get_consent_status, get_sync_status, get_net_worth_history`.
- `GET /ai/conversations` ; `GET /ai/conversations/:id/messages`

## Demo data

- `POST /seed-demo` → seeds clearly-labelled sample data for the user; `{ ok, accountCount, holdingCount, message }`.

## Reconciliation

- `GET /reconciliation` → `{ results[], summary }` (per-account source vs local).
- `POST /reconciliation/run` `{ accountId? }` → records a run; re-evaluates notifications.
- `GET /reconciliation/history?limit=` → recent runs.
- `POST /reconciliation/:accountId/resolve` `{ setBalance?, note? }` → adopt source balance or record; audited.

## Notifications & preferences

- `GET /notifications/preferences` → per-type enabled/severity.
- `PUT /notifications/preferences/:type` `{ enabled?, thresholdMinor?, minSeverity? }`.
- `POST /notifications/evaluate` → runs rules, returns created count.
- `POST /notifications/:id/dismiss` → dismiss a notification.
- `POST /notifications/read` → mark all read.

## Scheduler / jobs

- `GET /jobs` → job status (status, attempts, last/next run, error).
- `POST /jobs/:name/run` → trigger a registered job (`expire-consents`, `market-refresh`, `notify-evaluate`, `monthly-networth-snapshot`, `reconciliation-scan`).

## Ingestion

- `GET /ingest/connectors` → supported formats.
- `POST /ingest/preview` `{ format, text, mapping?, defaultAccountId? }` → `{ total, holdings, preview[] }`.
- `POST /ingest` `{ format, text, fileName?, mapping?, defaultAccountId?, currency? }` → `{ ok, runId, summary, created[], duplicates[], failedRecords[], rollbackId }`.
- `GET /ingestion/runs` → previous imports with counts and status.

## Market data

- `GET /market/status` → provider config + `priceStatusBreakdown`.
- `POST /market/refresh` → `READY_FOR_CONFIGURATION` (no provider) or refresh result.

## Health / readiness (public)

- `GET /health` → `{ status, service, version, uptime }`.
- `GET /ready` → `{ status, components: { database, aa, market, llm } }`. Returns 503 if the database is unavailable; optional provider components are `not_configured`, not failures.

## Security / auth additions

- `GET /auth/csrf` → `{ csrf }` signed token for cookie-authenticated mutations.
- `POST /auth/password-reset/request` `{ email }` → `{ ok, resetToken? }` (token returned only in this personal build; production would email it).
- `POST /auth/password-reset/confirm` `{ token, password }` → resets password.
- Login returns `{ token, csrf, user }` and sets an httpOnly session cookie. Login is rate-limited per identifier (default 3 failed / 15 min).

## Privacy

- `POST /privacy/revoke-connections` → revoke consents + detach accounts.
- `POST /privacy/delete-data` → delete all user financial data (accounts, transactions, holdings, securities, budgets, goals, consents, snapshots, notifications).

## AI

- `GET /ai/status` → `{ configured, provider, model, status }`; `LLM_NOT_CONFIGURED` until a provider key is set.

## Rate limit & CSRF

- Login is rate-limited (configurable via `WEALTHCORE_LOGIN_RATE_MAX`/`_WINDOW_MINUTES`).
- Mutating requests authenticated via the httpOnly **cookie** require an `X-CSRF-Token` header (from `/auth/csrf`). Bearer-authenticated requests do not require CSRF.
