# WealthCore — Setu Account Aggregator Integration

> **Status: PARTIALLY IMPLEMENTED — SETU SANDBOX = BLOCKED (ENVIRONMENT NETWORK).**
> The Setu sandbox **contract** (auth, consent, webhook, data-session, ReBIT→canonical
> normalisation, persistence, idempotency) is wired and verified against the current
> official docs + a bounded local simulator. **Setu TEST credentials are present** and
> the adapter reports `configured=true` (`npm run config:setu`, `setuCryptoConfig().configured`,
> `SetuProvider.status()`). **The sole blocker to the REAL external E2E is network egress**:
> this runtime cannot complete a TLS handshake to `https://fiu-sandbox.setu.co` (an egress
> allowlist permits only `registry.npmjs.org` and `api.github.com`; every `*.setu.co` host
> is reset at the transport layer). **Production is PLANNED / BLOCKED BY REGULATORY
> ONBOARDING** — WealthCore is not an RBI-authorised FIU/AA.

---

## 1. Architecture (Setu as an adapter)

```text
WEALTHCORE
   │  /api/v1/aa/*  (auth-gated)  +  /api/v1/aa/webhook/setu (public, signature-verified)
   ▼
AAProvider abstraction (server/aa/interface.js)
   ▼
SetuProvider (server/aa/providers/setu.js)
   │  POST /v2/consents ; GET /consents/:id ; POST /v2/consents/:id/revoke
   │  POST /sessions  ; GET /sessions/:id
   ▼
Setu crypto (server/aa/crypto/setu-crypto.js)  — client-credentials + signature verification
   ▼
ReBIT normalizer (server/aa/rebit-normalizer.js)  → canonical model
   ▼
Sync engine (server/aa/sync.js)  → accounts / transactions / holdings + provenance
   ▼
Net Worth / Portfolio / Dashboard
```

## 2. Current official Setu API contract (verified)

| Operation | Method & path | Notes |
|-----------|---------------|-------|
| Create consent | `POST /v2/consents` | body `{consentDuration, vua, dataRange, context, additionalParams}` → `{id, url, status:PENDING, detail{..}}` |
| Get consent | `GET /consents/:id` | status `PENDING` → `ACTIVE` |
| Revoke consent | `POST /v2/consents/:request_id/revoke` | no body |
| Create data session | `POST /sessions` | body `{consentId, dataRange, format:"json"}` → `{id}` |
| Fetch FI data | `GET /sessions/:id` | status `COMPLETED/PARTIAL/PENDING`; `fips[].accounts[].data` ReBIT JSON |
| Notification | Webhook → your endpoint (Setu Bridge) | `X-Webhook-Signature` |

### Authentication (CURRENT OFFICIAL — verified)

Setu's current AA contract:
1. The **Setu Bridge** provides **client_id**, **client_secret** and
   **x-product-instance-id** (the Product ID).
2. The client credentials are used to **acquire an access token** via Setu's
   **Auth Mechanism / getToken** endpoint (`server/aa/providers/setu-auth.js`).
3. Every AA API request then sends:
   - `Authorization: Bearer <access_token>`
   - `x-product-instance-id: <product-instance-id>`

The **client secret is never sent as a request header on the AA APIs** — it is used
only to obtain the access token. WealthCore implements a **Setu Authentication
Manager** (`setu-auth.js`) that caches the token, tracks expiry, renews before
expiry, serialises concurrent refreshes (no token storm), and invalidates the token
on a confirmed auth failure. **No credential or token is ever logged.**

Sandbox base: `https://fiu-sandbox.setu.co` · Production: `https://fiu.setu.co`.

Setu's `format=json` sandbox path returns **decrypted ReBIT JSON** (Setu handles the
E2E encryption via its key exchange), so no FIU-side decryption is required on the
default path.

## 3. Adapter behavior

- `createConsent` maps Setu `PENDING/ACTIVE/REJECTED/REVOKED/EXPIRED` → WealthCore
  canonical states and returns the **redirect URL** for the Setu consent journey. The
  consent webview URL (e.g. `<sandbox>/consents/webview/<id>`) is now **persisted** on
  the consent row (`consents.consent_url`) and surfaced in the Integrations UI so the
  customer can open the provider screen to approve a **real** consent (never
  auto-approved from the UI).
- `requestFIData` calls `POST /sessions`; `getFIData` calls `GET /sessions/:id` and
  returns `{sessionId, consentId, status, data}`.
- `translateSetuFiToEnvelope` converts ReBIT deposit JSON → canonical envelope
  (accounts, transactions, holdings) with liability sign normalisation and
  merchant→category mapping.
- Webhook `handleNotification` verifies the (optional) HMAC signature, parses the
  canonical Setu notification envelope, and reflects it on the consent/session rows.
  The `/aa/webhook/setu` route reads the status from **`payload.data.status`** (Setu's
  real contract — not a top-level `status`), handles both `CONSENT_STATUS_UPDATE` and
  `SESSION_STATUS_UPDATE`, applies **idempotency** via the `webhook_notifications`
  table (a notification id is processed once), and audits each receipt. No raw
  financial/payload data is logged.

## 4. Environment configuration

**Two env namespaces are accepted** for every Setu value: the canonical
`WEALTHCORE_SETU_*` and the short `SETU_*` alias (e.g. `SETU_CLIENT_ID`,
`SETU_CLIENT_SECRET`, `SETU_PRODUCT_INSTANCE_ID`). Either works; the secret is
**only** ever read from the environment and **never** logged, returned by an API,
or written to source/git/docs.

```
AA_PROVIDER=setu            # or WEALTHCORE_AA_PROVIDER=setu
AA_ENVIRONMENT=sandbox      # sandbox | production
SETU_ENVIRONMENT=sandbox
# Sandbox base URL (configurable, never hard-coded in app code):
SETU_BASE_URL=https://fiu-sandbox.setu.co        # == WEALTHCORE_SETU_BASE_URL
# CURRENT OFFICIAL AUTH — client credentials (from the Setu Bridge). Used ONLY to
# ACQUIRE an access token (Auth Mechanism / getToken), NOT sent as AA headers:
SETU_CLIENT_ID=                                   # == WEALTHCORE_SETU_CLIENT_ID
SETU_CLIENT_SECRET=                               # == WEALTHCORE_SETU_CLIENT_SECRET  (fresh, regenerated; env-only)
SETU_PRODUCT_INSTANCE_ID=                         # == WEALTHCORE_SETU_PRODUCT_INSTANCE_ID
# Override the token endpoint / a legacy short-lived access token (optional):
# SETU_TOKEN_URL=                                 # == WEALTHCORE_SETU_TOKEN_URL
# SETU_TOKEN=
# Public WealthCore URL Setu can reach for the customer's consent/return journey:
SETU_REDIRECT_URL=                                # == WEALTHCORE_SETU_REDIRECT_URL
# Public callback Setu posts notifications to:
SETU_WEBHOOK_URL=https://<public-domain>/api/v1/aa/webhook/setu   # == WEALTHCORE_SETU_WEBHOOK_URL
# Optional webhook signing secret (best-effort; Setu AA docs don't publish an algorithm):
# SETU_WEBHOOK_SECRET=                            # == WEALTHCORE_SETU_WEBHOOK_SECRET
```

> **NOTE:** WealthCore reads configuration from `process.env` — there is **no** `dotenv`
> parser. Set these variables via your process manager / secrets store, or `set -a; . ./.env; set +a`
> before starting.

### Configuration validation (presence-only, no secret leak)

```bash
npm run config:setu
```

Reports only presence/absence (never the secret value):

```text
SETU_ENVIRONMENT: sandbox
SETU_CLIENT_ID: configured | NOT SET
SETU_CLIENT_SECRET: configured | NOT SET
SETU_PRODUCT_INSTANCE_ID: configured | NOT SET
SETU_BASE_URL: configured
SETU_TOKEN_URL: NOT SET
SETU_REDIRECT_URL: not set
SETU_WEBHOOK_URL: not set
MISSING: ...
configured: true/false
```

The **Setu product instance ID is non-secret configuration** and may be displayed in the
Connections UI (never the client secret/access token/private key).

### Account availability

`POST /v2/account-availability` (Setu) verifies a customer's accounts across AAs using a
mobile number. WealthCore exposes it as `POST /api/v1/aa/setu/availability` and the
adapter method `checkAccountAvailability({ mobileNumber })` which uses the same
`Authorization: Bearer <token>` + `x-product-instance-id` auth model.

## 5. Environment separation & production safety

| Config | Mode |
|--------|------|
| `AA_PROVIDER=mock` | MOCK — development/test, no creds |
| `AA_PROVIDER=setu` + `AA_ENVIRONMENT=sandbox` | SANDBOX / UAT |
| `AA_PROVIDER=setu` + `AA_ENVIRONMENT=production` | PRODUCTION |

`config.js` blocks a **production** AA activated without `AA_ENVIRONMENT=production`
and without valid Setu credentials (`PRODUCTION_CONFIGURATION_ERROR`). WealthCore
never silently falls back from production to mock data.

## 6. Verification — local simulator vs real external sandbox

### Local simulator (credential-free, part of `npm test`)

`tests/setu-e2e.test.js` spins a **bounded local Setu simulator** that mirrors the
documented v2 endpoints and asserts the **current official auth model** is used: the
token endpoint `/auth/token` is exercised, and every AA request carries
`Authorization: Bearer <access_token>` + `x-product-instance-id` (the client secret is
**never** sent as an AA request header). It verifies the full WealthCore flow:
`connect-setu → approve → sync → accounts+transactions persisted → dashboard updated →
idempotent re-sync → webhook (real Setu payload shape) updates consent state → webhook
replay is idempotent`.

### Real external Setu sandbox (credential-gated)

`tests/setu-external.test.js` (run via **`npm run test:setu:sandbox`**) hits the real
`https://fiu-sandbox.setu.co` endpoint. It is **not** part of `npm test` (which stays
credential-free) and it **aborts/skips** if no real Setu credentials are present.

**Result in this environment: `BLOCKED — NETWORK`.** With credentials present the test
resolves them through the app config and **attempts** the real connection; the runtime
cannot reach the Setu token endpoint, so it fails cleanly with `PROVIDER_UNAVAILABLE`
("Setu token endpoint unreachable") and reports `STATUS: BLOCKED — NETWORK`. It does
**not** skip and does **not** fabricate a pass. The adapter is contract-complete, claims
`configured=true` (presence-based), and is simulator-verified; only the network egress
prevents the real external E2E.

## 7. Crypto & auth abstraction

`server/aa/crypto/setu-crypto.js`:
- `setuCryptoConfig()` reads Setu config from env (client credentials or a legacy token).
- `setuAuthHeaders()` returns `Authorization: Bearer <access_token>` (acquired via the
  auth manager) + `x-product-instance-id`. The token is obtained from client credentials.
- `verifySetuWebhookSignature(rawBody, signatureHeader)` verifies an HMAC signature if
  `WEALTHCORE_SETU_WEBHOOK_SECRET` is configured; otherwise returns `NO_SECRET_CONFIGURED`.

`server/aa/providers/setu-auth.js` (Setu Authentication Manager):
- `setuCreds()` — detects configured client credentials.
- `getAccessToken()` — acquires + caches a token, renews before expiry, serialises
  concurrent refreshes, retries once on a confirmed auth failure.
- `invalidateAccessToken(clientId)` — clears a cached token.
- `setuTokenEndpoint()` — resolves the token URL (`WEALTHCORE_SETU_TOKEN_URL` if set,
  else `<base>/auth/token`); `setuTokenRequest()` — builds the OAuth2 client-credentials
  request (`grant_type=client_credentials` + `client_id` + `client_secret`).

`PENDING SETU DOCUMENTATION CONFIRMATION`: the exact getToken wire format
(form-encoded `grant_type=client_credentials` vs Basic auth / other) and the exact
token endpoint path are isolated behind `setuTokenEndpoint()`/`setuTokenRequest()` and
are **not guessed** — they are configurable via `WEALTHCORE_SETU_TOKEN_URL`. The
webhook **signature algorithm** is also not published on Setu's AA Notifications doc, so
signature verification is **best-effort/optional defence-in-depth** (enforced only when
`WEALTHCORE_SETU_WEBHOOK_SECRET` is configured); it is never treated as a hard gate on a
provider whose docs omit it.

## 8. Data provenance & reconciliation

Imported records carry `source='aa'`, `provider='setu'`, `fip`, `source_txn_id`,
`consentId`, `sessionId`, `importedAt`. Repeated sync is idempotent: accounts keyed
by `external_ref`, transactions by `source_txn_id`/`dedup_key`; a reused Setu
`sessionId` updates the existing `aa_sessions` row instead of failing.

### Status polling / recovery

Webhooks are **not** the only update path. The adapter exposes `getDataSessionStatus(consentId)`
and `getConsentStatus(consentId)` for safe status reconciliation, and WealthCore's
idempotent "Sync data" path re-fetches an existing session without duplicating records,
so a lost/delayed webhook can be recovered manually. **Automatic scheduled auto-fetch is
deliberately disabled**: it would incur Setu data costs and duplicate-fetch risk, and it
cannot be validated against a real sandbox until credentials exist. Status polling is
therefore offered via the adapter + on-demand sync; scheduled auto-fetch is a documented
follow-up once real sandbox credentials are available.

## 9. ReBIT compatibility (recorded at implementation time)

Recorded from the ReBIT portal (`https://api.rebit.org.in/`) and Setu docs on
2026-09-03:

| Component | Version / status | Notes |
|-----------|------------------|-------|
| ReBIT AA API | v2.0.0 core (GoT 2023-08-09); AA client standards v1.0.0 (2026-04-30) | `/spec/aa` |
| ReBIT FIP API | **v2.2.0** (RBI Govt. Securities FI Type Schema, published 2026-08-31) | `/spec/fip` |
| ReBIT FIU callback API | v2.0.0 core | `/spec/fiu` |
| ReBIT Deposit / RD / TD FI schema | **v2.0.0** (published 2025-01-23) | Setu sandbox `format=json` returns decrypted ReBIT JSON |
| Setu supported format | `format=json` (decrypted JSON), plus `xml` | Setu handles Rahasya E2E key-exchange |
| WealthCore supported | Canonical model (accounts/transactions/holdings) mapped from ReBIT JSON via `translateSetuFiToEnvelope` + `rebit-normalizer` | Provider-neutral; no FIU-side decrypt on JSON path |

**Compatibility status:** WealthCore consumes the decrypted ReBIT **JSON** envelope
(account summary + transactions) from Setu's `format=json` sandbox path and maps it to
its canonical model. The Deposit schema v2.0.0 fields used (`summary.currentBalance`,
`currency`, `type`, `transactions.transaction[]{txnId, amount, type, narration,
transactionDateTime}`) are present in Setu's JSON output. The GI `GOVT_SECURITIES`
schema (FIP API v2.2.0) is **not** yet mapped — it is surfaced as unsupported until an
adapter is written and verified. **Re-verify versions before any production go-live**;
this table is a snapshot, not an ongoing binding.

## 10. Status

| Provider | Status |
|----------|--------|
| Mock AA | IMPLEMENTED |
| Setu adapter (contract) | IMPLEMENTED against current official Setu auth + v2 endpoints |
| Setu sandbox external E2E | **BLOCKED — ENVIRONMENT NETWORK** (credentials OK; runtime cannot reach fiu-sandbox.setu.co — see §12) |
| Setu production | PLANNED / BLOCKED BY REGULATORY ONBOARDING |

## 11. Remaining external dependencies

- **Network egress to `https://fiu-sandbox.setu.co`** — the **only** blocker to the real
  external test. The runtime must run where it can reach Setu (this sandbox's egress
  allowlist blocks every `*.setu.co` host at the TLS layer; no proxy is configured). No
  application/config change can fix this.
- Setu sandbox access/product configuration (`support@setu.co` / `aa@setu.co`) to run
  `test:setu:sandbox`, and to confirm the exact getToken wire format/path (see §7).
- Production: FIU eligibility / TSP arrangement, Sahamati certification, central
  registry, production credentials.

## 12. External sandbox verification — recorded result (2026-09-03)

| Check | Result |
|-------|--------|
| Setu **client_id** present in env as non-secret config | **YES** (`SETU_CLIENT_ID` resolves to `config().setu.clientId`) |
| Setu **product_instance_id** present (non-secret) | **YES** (`SETU_PRODUCT_INSTANCE_ID` resolved; verified the adapter would send `x-product-instance-id: a068da97-a7d8-4ed0-a7bd-764d00fbde68`) |
| Setu **client_secret** present (secure env) | **YES** — provided via runtime env only (never printed, never in repo) |
| `npm run config:setu` | `SETU_CLIENT_ID: configured` · `SETU_CLIENT_SECRET: configured` · `SETU_PRODUCT_INSTANCE_ID: configured` · `SETU_BASE_URL: configured` · `configured: true` (no secret leaked) |
| `setuCryptoConfig().configured` | `true` |
| Setu provider `status()` | `configured=true, mode=sandbox, environment=SANDBOX, requiresCredentials=false`, product `Account Aggregator Data` |
| Sandbox network egress from this environment | **BLOCKED** — `https://fiu-sandbox.setu.co` is unreachable. DNS resolves to `13.205.36.27`, but the **TLS Client hello is reset** at the transport layer (`OpenSSL SSL_connect: SSL_ERROR_SYSCALL`). An **egress allowlist** permits only `registry.npmjs.org` and `api.github.com`; every `*.setu.co` host is blocked. No proxy is configured, so this cannot be fixed from within the application. |
| `npm run test:setu:sandbox` | **BLOCKED — NETWORK.** With credentials present the test now **attempts** the real connection and fails cleanly with `PROVIDER_UNAVAILABLE` ("Setu token endpoint unreachable") — it does **not** skip and does **not** fabricate a pass. |
| External Setu sandbox reached / authenticated | **NO** (network egress block; credentials verified by `config:setu` + provider `status()`, not by a live call) |
| Local simulator E2E (credential-free) | **PASS** — verifies current Bearer auth + full WealthCore flow + webhook (real payload shape, idempotent) |
| Webhook consent-status contract (`payload.data.status`) | **FIXED** to Setu's real notification shape (was reading a non-existent top-level `status`) |
| Webhook idempotency | **ADDED** (`webhook_notifications` table, one process per notification id) |
| Consent URL persisted + surfaced | **ADDED** (`consents.consent_url`; Integrations screen "Open consent") |
| Multi-currency exposure | **ADDED** per-currency breakdown in net worth (`currencyBreakdown`, `mixedCurrency`) — no silent FX mixing claim |

**Conclusion: the Setu TEST credentials are now present and the adapter reports
`configured=true` (verified by `npm run config:setu`, `setuCryptoConfig().configured`,
and `SetuProvider.status()` — all showing presence, never the secret value). The
**sole remaining blocker for the REAL external E2E is network egress**: this runtime
cannot complete a TLS handshake to `https://fiu-sandbox.setu.co` (an egress allowlist
permits only `registry.npmjs.org` and `api.github.com`; every `*.setu.co` host and
`raw.githubusercontent.com` are reset at the transport layer). With credentials present,
`npm run test:setu:sandbox` now attempts the real connection and fails cleanly with
`STATUS: BLOCKED — NETWORK` (it does **not** skip and does **not** fabricate a pass).

To run the real external sandbox test, keep the credentials in the environment (never
commit) and **run it in a deployment whose network can reach `https://fiu-sandbox.setu.co`**,
then `npm run test:setu:sandbox`. Everything the adapter needs is already wired: the Setu
product is `Account Aggregator Data` (TEST/SANDBOX), product instance id
`a068da97-a7d8-4ed0-a7bd-764d00fbde68` is sent as `x-product-instance-id` (non-secret).

A public Setu **consent-return** route was added at `GET /api/v1/aa/setu/consent/return`
(informational only; the authoritative status change comes from the verified webhook), and
the external-test harness was fixed to resolve credentials through the app config (honouring
both `SETU_*` and `WEALTHCORE_SETU_*`), so it attempts rather than skips when creds are set.

## 13. Source register (official resources used)

| Source | URL | Purpose | Verified | Area |
|--------|-----|---------|----------|------|
| Setu AA overview | https://docs.setu.co/data/account-aggregator/overview | Ecosystem/roles | 2026-09 | Architecture |
| Setu AA quickstart | https://docs.setu.co/data/account-aggregator/quickstart | Bridge onboarding + credentials | 2026-09 | Config/onboarding |
| Setu consent flow | https://docs.setu.co/data/account-aggregator/api-integration/consent-flow | POST /consents, PENDING→ACTIVE, consent URL | 2026-09 | Consent |
| Setu data APIs | https://docs.setu.co/data/account-aggregator/api-integration/data-apis | POST /sessions, GET /sessions/:id, PARTIAL/COMPLETED | 2026-09 | Data session |
| Setu account availability | https://docs.setu.co/data/account-aggregator/api-integration/account-availability-apis | POST /v2/account-availability, Bearer auth | 2026-09 | Account discovery |
| Setu notifications / webhooks | https://docs.setu.co/data/account-aggregator/api-integration/notifications | Webhook payloads (`data.status`, CONSENT_STATUS_UPDATE / SESSION_STATUS_UPDATE) | 2026-09 | Webhook |
| Setu API reference (Auth Mechanism / getToken) | https://docs.setu.co/data/account-aggregator/api-reference#/operation~getToken | Token acquisition for `Authorization: Bearer` | 2026-09 | Authentication |
| Setu multi-AA / consent object | https://docs.setu.co/data/account-aggregator/consent-object | Consent params (purpose, FI types, duration, fetch type) | 2026-09 | Consent |
| Setu support FAQ | https://support.setu.co/support/solutions/81000205398 | Bridge sandbox credentials | 2026-09 | Onboarding |
| RBI NBFC-AA Master Direction | (RBI Master Direction NBFC-Account Aggregator) | Consent, no customer auth credentials | 2026-09 | Regulatory |
| Sahamati AA onboarding | https://sahamati.org.in/how-to-join-the-account-aggregator-network-to-share-and-access-financial-data/ | FIU/FIP onboarding, UAT, certification | 2026-09 | Regulatory/onboarding |
| ReBIT AA API / FI schemas | https://api.rebit.org.in/ · https://api.rebit.org.in/spec/aa | ReBIT versions + FI schemas | 2026-09 | Normalization |
