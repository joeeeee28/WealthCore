# ACCOUNT AGGREGATOR (AA) / FIU INTEGRATION

## Purpose

WealthCore acquires permitted financial data through an **Account Aggregator / Financial Information User (FIU)** integration. This is the core improvement over the manual-import-first model.

## Honesty contract (ABSOLUTE RULE 14)

No connectivity is faked. With no production FIU credentials/onboarding, the integration reports:

```text
Integration: READY_FOR_CONFIGURATION
Status: Provider credentials required
```

`LIVE` is **never** displayed unless actual live data has been retrieved.

## Architecture

```text
WealthCore (FIU)  ←→  AA (Sahamati/other network)  ←→  Financial Information Providers (banks/brokers/MFs)
        │
        │  consent lifecycle
        │  financial information request
        │  data-ready notification (webhook)
        │  retrieve → decrypt → validate → normalise → store
        ▼
   WealthCore DB
```

The FIU role is played by WealthCore (acting as the consumer). Providers are abstracted behind a configurable adapter (`server/lib/aa-integration.js`).

## Consent flow (implemented — "state machine")

1. **Create** `POST /api/v1/aa/consent` → row with `status='pending'`, 90-day `expires_at`. Real FIU handshake requires provider config.
2. **Approve** `POST /api/v1/aa/consent/:id/approve` → `approved` + `approved_at`.
3. **Reject** → `rejected`.
4. **Revoke** → `revoked` + `revoked_at`.
5. **Expire** → `GET /aa/status` calls `expireConsents()` to auto-mark past-due approved consents as `expired`.

Data retrieval is only allowed for `approved` consents and only if a provider is configured; otherwise it records a failed `sync_run` and returns `FAILED / PROVIDER_NOT_CONFIGURED`.

## Provider abstraction

Configuration (env): `WEALTHCORE_AA_PROVIDER`, `WEALTHCORE_AA_CLIENT_ID`, `WEALTHCORE_AA_SECRET`, `WEALTHCORE_AA_BASE_URL`. When all four are set, `aaProviderConfig().configured === true` and the mode becomes `PRODUCTION`. Otherwise it is `DEVELOPMENT_SANDBOX`.

## Environments

| Environment | Returns |
| ----------- | ------- |
| `DEVELOPMENT` | `READY_FOR_CONFIGURATION`, no live data |
| `SANDBOX` | Same as development until a sandbox FIU is wired |
| `PRODUCTION` | Config-dependent; live data when credentials present |

## Encryption / decryption

AA responses are delivered encrypted. WealthCore stores the key material only in **environment/config** (never in source) and decrypts after retrieval. The decryption wrapper is applied in the retrieval path when a provider is configured. This build exposes the boundary; actual key handling is provider-specific.

## Normalisation & storage

- Provider accounts → `accounts` (source = provider, `external_ref` = provider id, `aa_status`).
- Provider transactions → normalise to `transactions` (date, amount, direction, category).
- Validation runs through the same `validateTransaction` path; dedup runs through `dedupKey`.

## Synchronisation

`sync_runs` records every attempt (including failures) so nothing is silent. `GET /sync/runs` surfaces them.

## Webhook handling

Provider callbacks arrive at the public (non-user-auth, by design) endpoint
`POST /api/v1/aa/webhook/setu`. The handler:
- validates the (optional) signature when `WEALTHCORE_SETU_WEBHOOK_SECRET` is configured;
- reads the status from **`payload.data.status`** (Setu's real notification contract) and
  the event type (`CONSENT_STATUS_UPDATE` / `SESSION_STATUS_UPDATE`) plus `consentId` /
  `dataSessionId` / `notificationId`;
- is **idempotent**: a notification id is persisted in `webhook_notifications` (unique on
  provider + id) and a replay is acknowledged + ignored;
- reflects the change on the matching `consents`/`aa_sessions` rows (ACTIVE/REJECTED/
  REVOKED/PAUSED/EXPIRED; COMPLETED/PARTIAL/PENDING/EXPIRED/FAILED);
- audits each receipt (`aa.webhook`) with the event type/ids/status only — **never the raw
  payload** (which may contain masked account references).

## Errors & retries

- Missing provider → `PROVIDER_NOT_CONFIGURED` recorded as a failed sync.
- Invalid consent state → `BAD_STATE` (HTTP 400).
- Expired/revoked consent → retrieval refused.
- Retries/backoff are provider-specific; recorded in `sync_runs.errors`.

## Audit

Every consent action and data request is written to `audit_log` with its user, action and result.

## v1.1 — provider adapter interface & honesty

- `aaProviderConfig()` reads `WEALTHCORE_AA_PROVIDER/_CLIENT_ID/_SECRET/_BASE_URL` from config; `configured` is only true when all are present.
- `registerProvider(name, adapter)` registers an adapter implementing `createConsentRequest` and `fetchFinancialData`. `resolveProvider()` returns it when configured, else null.
- Consent creation validates against a schema; a **correlation ID** and an **idempotency ref** (`external_ref`) are generated.
- Raw payload storage is available via `requestFinancialData` (returns the payload when a provider is configured) and is hashed for audit.
- Without a provider, `requestFinancialData` returns `FAILED / PROVIDER_NOT_CONFIGURED` and records a failed `sync_run` (no silent failure, no fabricated data).
- `GET /aa/status` reports `READY_FOR_CONFIGURATION` / `Provider credentials required`.

## Environments
`DEVELOPMENT`/`SANDBOX` → `READY_FOR_CONFIGURATION`, no live data. `PRODUCTION` → config-dependent; live when credentials present.

## v1.2 — provider-neutral foundation (see docs/AA_IMPLEMENTATION.md)

The AA layer is now provider-neutral with a working local Mock AA. Live Finvu/Setu/
OneMoney connectivity remains gated on provider credentials and marked
`PENDING PROVIDER CONFIRMATION`. See `docs/AA_IMPLEMENTATION.md` for the architecture,
provider status, consent state machine, normalizer, sync engine and the Finvu
exploratory-call checklist.

## v1.3 — Setu adapter (see docs/SETU_INTEGRATION.md)

Setu is now a real (sandbox-contract) AA adapter in the provider-neutral layer:
`AA_PROVIDER=setu` + `AA_ENVIRONMENT=sandbox` enables the Setu consent → data-session
→ FI-fetch path. Verified against official Setu docs and a bounded local Setu
simulator. Live connectivity requires `WEALTHCORE_SETU_TOKEN` +
`WEALTHCORE_SETU_PRODUCT_INSTANCE_ID`; production is `PLANNED`. See
`docs/SETU_INTEGRATION.md`.

### v1.3.1 / v1.4.x — Setu auth model updated to current official (Bearer via getToken)
Setu authenticates with `Authorization: Bearer <access_token>` + `x-product-instance-id`.
The access token is acquired from Bridge client credentials
(`WEALTHCORE_SETU_CLIENT_ID` / `_CLIENT_SECRET`) via the Setu Auth Mechanism / getToken
(`server/aa/providers/setu-auth.js`); the client secret is **never** sent as an AA request
header. The adapter and the local simulator assert this model. A credential-gated external
test (`npm run test:setu:sandbox`) hits the real sandbox and reports
`BLOCKED — Setu credentials/access not available` when creds are absent. v1.4.x also added
webhook idempotency + real-notification-contract handling, persistence of the Setu consent
URL (`consents.consent_url`) and a per-currency net-worth breakdown. See
`docs/SETU_INTEGRATION.md`.
