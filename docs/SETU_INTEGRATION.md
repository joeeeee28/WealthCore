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

### Authentication (CURRENT OFFICIAL — correction)

Setu's current AA contract provides **`x-client-id` + `x-client-secret` (client-credentials
style)** and **`x-product-instance-id` (the Product ID)** via the Setu Bridge. These are
sent as request headers. There is **no direct `Authorization: Bearer` access token** in
the current sandbox gate. The WealthCore adapter was updated from the earlier
`Authorization: Bearer <token>` model to the current official `x-client-id` /
`x-client-secret` / `x-product-instance-id` model (a legacy bearer token is still
accepted only when no client credentials are supplied, for backward compatibility).

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
# CURRENT OFFICIAL AUTH (client credentials) — from the Setu Bridge:
WEALTHCORE_SETU_CLIENT_ID=                              # x-client-id
WEALTHCORE_SETU_CLIENT_SECRET=                          # x-client-secret
WEALTHCORE_SETU_PRODUCT_INSTANCE_ID=                    # product-instance-id
# Legacy access-token alternative (only if client credentials are not used):
WEALTHCORE_SETU_TOKEN=
WEALTHCORE_SETU_WEBHOOK_SECRET=                         # for signature verification (optional)
WEALTHCORE_SETU_SIGNING_PUBLIC_KEY=                     # request-signing public key (optional)
```

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

## 7. Crypto abstraction (server/aa/crypto/setu-crypto.js)

- `setuCryptoConfig()` reads Setu config from env (client-credentials or a legacy token).
- `setuHeaders()` builds `x-client-id`, `x-client-secret`, `x-product-instance-id`
  (and falls back to `Authorization: Bearer` only for the legacy token path).
- `verifySetuWebhookSignature(rawBody, signatureHeader)` verifies an HMAC signature if
  `WEALTHCORE_SETU_WEBHOOK_SECRET` is configured; otherwise returns
  `NO_SECRET_CONFIGURED`.

`PENDING SETU DOCUMENTATION CONFIRMATION`: exact webhook signature algorithm
(normalized vs `sha256=...`) and whether the RSA request-signing public key is
required for outbound calls. These are isolated in the crypto module and never guessed.

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
