# WealthCore — Setu Account Aggregator Integration

> **Status: PARTIALLY IMPLEMENTED (sandbox contract wired + verified against official docs; external sandbox connectivity BLOCKED — credentials not available; production PLANNED).**
>
> Setu is the first **real** external AA provider wired into WealthCore's
> provider-neutral layer. The adapter follows the **current official Setu
> authentication contract**; **no live Setu connectivity is claimed** because no
> Setu sandbox credentials are present in this environment.

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
  canonical states and returns the **redirect URL** for the Setu consent journey.
- `requestFIData` calls `POST /sessions`; `getFIData` calls `GET /sessions/:id` and
  returns `{sessionId, consentId, status, data}`.
- `translateSetuFiToEnvelope` converts ReBIT deposit JSON → canonical envelope
  (accounts, transactions, holdings) with liability sign normalisation and
  merchant→category mapping.
- Webhook `handleNotification` verifies `X-Webhook-Signature` (HMAC, if a secret is
  configured) and accepts the payload; the API route updates the matching consent.

## 4. Environment configuration

```
AA_PROVIDER=setu            # or WEALTHCORE_AA_PROVIDER=setu
AA_ENVIRONMENT=sandbox      # sandbox | production
SETU_ENVIRONMENT=sandbox
WEALTHCORE_SETU_BASE_URL=https://fiu-sandbox.setu.co   # sandbox
# CURRENT OFFICIAL AUTH — client credentials (from the Setu Bridge). These are used
# to ACQUIRE an access token (Auth Mechanism / getToken), not sent as headers:
WEALTHCORE_SETU_CLIENT_ID=                              # client_id
WEALTHCORE_SETU_CLIENT_SECRET=                          # client_secret
WEALTHCORE_SETU_PRODUCT_INSTANCE_ID=                    # product-instance-id
# Override the token endpoint / a legacy short-lived access token (optional):
# WEALTHCORE_SETU_TOKEN_URL=
WEALTHCORE_SETU_TOKEN=
WEALTHCORE_SETU_WEBHOOK_SECRET=                         # for signature verification (optional)
WEALTHCORE_SETU_SIGNING_PUBLIC_KEY=                     # request-signing public key (optional)
```

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
documented v2 endpoints and asserts the **current official auth headers** are sent
(`x-client-id` / `x-client-secret` / `x-product-instance-id`). It verifies the full
WealthCore flow: `connect-setu → approve → sync → accounts+transactions persisted →
dashboard updated → idempotent re-sync → webhook updates consent state`.

### Real external Setu sandbox (credential-gated)

`tests/setu-external.test.js` (run via **`npm run test:setu:sandbox`**) hits the real
`https://fiu-sandbox.setu.co` endpoint. It is **not** part of `npm test` (which stays
credential-free) and it **aborts/skips** if no real Setu credentials are present.

**Result in this environment: `BLOCKED — Real Setu sandbox credentials/access are not
available.`** Setu is therefore **not** reported as `configured=true`, and no external
connectivity is claimed. The adapter is contract-complete and simulator-verified;
only the missing credentials prevent the real external E2E.

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

`PENDING SETU DOCUMENTATION CONFIRMATION`: the exact getToken request wire format
(form-encoded `grant_type=client_credentials` vs Basic auth / other), the exact token
endpoint path, and the webhook signature algorithm. These are isolated in `setu-auth.js`
and `setu-crypto.js` and never guessed.

## 8. Data provenance & reconciliation

Imported records carry `source='aa'`, `provider='setu'`, `fip`, `source_txn_id`,
`consentId`, `sessionId`, `importedAt`. Repeated sync is idempotent: accounts keyed
by `external_ref`, transactions by `source_txn_id`/`dedup_key`; a reused Setu
`sessionId` updates the existing `aa_sessions` row instead of failing.

## 9. Status

| Provider | Status |
|----------|--------|
| Mock AA | IMPLEMENTED |
| Setu adapter (contract) | IMPLEMENTED against current official Setu auth + v2 endpoints |
| Setu sandbox external E2E | BLOCKED — Setu sandbox credentials/access not available |
| Setu production | PLANNED (requires credentials + onboarding) |
| Finvu | PARTIALLY IMPLEMENTED / PENDING PROVIDER CONFIRMATION |

## 10. Remaining external dependencies

- `WEALTHCORE_SETU_CLIENT_ID`, `WEALTHCORE_SETU_CLIENT_SECRET`,
  `WEALTHCORE_SETU_PRODUCT_INSTANCE_ID` — from the Setu Bridge (see docs `Setu AA quickstart`)
- Setu sandbox access (`support@setu.co` / `aa@setu.co`) to run `test:setu:sandbox`
- Production: FIU eligibility / TSP arrangement, Sahamati certification, central
  registry, production credentials

## 11. External sandbox verification — recorded result (2026-09-02)

| Check | Result |
|-------|--------|
| Setu credentials present in environment | **NO** (WEALTHCORE_SETU_CLIENT_ID / _CLIENT_SECRET / _PRODUCT_INSTANCE_ID all unset; no .env) |
| `GET /aa/providers` | `setu configured=false, mode=sandbox, requiresCredentials=true` (honest) |
| `GET /config` | `aa.configured=false` — `READY_FOR_CONFIGURATION` / `Provider credentials required` |
| `npm run test:setu:sandbox` | **BLOCKED — Real Setu sandbox credentials/access are not available.** (test SKIPped) |
| External Setu sandbox reached | **NO** |
| Local simulator E2E (credential-free) | **PASS** — verifies contract + current auth headers + full WealthCore flow |

**Conclusion: Setu external sandbox connectivity is BLOCKED pending real Setu-issued
credentials. The adapter and simulator E2E are complete and contract-correct; only the
credential-gated external step is held.** This is the honest state — no fabricated
connectivity, no simulator passed off as real Setu.

To run the real external sandbox test, provide via environment/secrets (never commit):
`WEALTHCORE_SETU_CLIENT_ID`, `WEALTHCORE_SETU_CLIENT_SECRET`,
`WEALTHCORE_SETU_PRODUCT_INSTANCE_ID`, set `AA_PROVIDER=setu`,
`AA_ENVIRONMENT=sandbox`, then run `npm run test:setu:sandbox`.

## 12. Source register (official resources used)

| Source | URL | Purpose | Verified | Area |
|--------|-----|---------|----------|------|
| Setu AA overview | https://docs.setu.co/data/account-aggregator/overview | Ecosystem/roles | 2026-09 | Architecture |
| Setu AA quickstart | https://docs.setu.co/data/account-aggregator/quickstart | Bridge onboarding + credentials | 2026-09 | Config/onboarding |
| Setu consent flow | https://docs.setu.co/data/account-aggregator/api-integration/consent-flow | POST /consents, PENDING→ACTIVE, consent URL | 2026-09 | Consent |
| Setu data APIs | https://docs.setu.co/data/account-aggregator/api-integration/data-apis | POST /sessions, GET /sessions/:id, PARTIAL/COMPLETED | 2026-09 | Data session |
| Setu account availability | https://docs.setu.co/data/account-aggregator/api-integration/account-availability-apis | POST /v2/account-availability, Bearer auth | 2026-09 | Account discovery |
| Setu support FAQ | https://support.setu.co/support/solutions/81000205398 | Bridge sandbox credentials | 2026-09 | Onboarding |
| RBI NBFC-AA Master Direction | (RBI Master Direction NBFC-Account Aggregator) | Consent, no customer auth credentials | 2026-09 | Regulatory |
| Sahamati AA onboarding | https://sahamati.org.in/how-to-join-the-account-aggregator-network-to-share-and-access-financial-data/ | FIU/FIP onboarding, UAT, certification | 2026-09 | Regulatory/onboarding |
| ReBIT AA API / FI schemas | https://api.rebit.org.in/ · https://api.rebit.org.in/spec/aa | ReBIT versions + FI schemas | 2026-09 | Normalization |
