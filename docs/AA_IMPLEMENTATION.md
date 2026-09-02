# WealthCore — Account Aggregator Foundation

> **Status: IMPLEMENTED (provider-neutral) + PARTIALLY IMPLEMENTED (Finvu/Setu crypto).**
>
> This documents the Account Aggregator foundation added to WealthCore: a
> **provider-neutral** architecture with a fully functional **local Mock AA**,
> an explicit **consent state machine**, a **ReBIT normalizer**, and **data
> provenance**. Real providers (Finvu, Setu, OneMoney, ...) are wired through the
> same interface; live connectivity is **not** claimed and is gated on credentials.

---

## 1. Architecture

```text
                    WEALTHCORE
                        │
            /api/v1/aa/* (API routes, auth-gated)
                        │
              AA Service / Domain (server/aa/index.js)
                        │
              Provider Abstraction (server/aa/interface.js)
                        │
   ┌──────────────┬─────┴──────┬──────────────┐
   ▼              ▼            ▼              ▼
 Mock          Finvu         Setu       Other stubs
 (working)   (pending)     (pending)   (onemoney, anumati, ink, saafe, nadl, protean)
   │              │            │
   └──────────────┴────────────┘
                        ▼
       Consent State Machine (server/aa/consent-state-machine.js)
                        ▼
       FI Retrieval + Crypto abstraction (providers/crypto)
                        ▼
       ReBIT Normalizer (server/aa/rebit-normalizer.js) → canonical model
                        ▼
       Sync orchestration (server/aa/sync.js) → accounts / transactions / holdings
                        ▼
       Evidence: sync_runs, aa_sessions, data provenance (source/provider/fip)
                        ▼
       Net Worth / Portfolio / Dashboard (existing engines, unchanged)
```

## 2. Provider-neutral interface (`server/aa/interface.js`)

Every provider implements `AAProvider`:

- `createConsent(request)` · `getConsent(id)` · `getConsentStatus(id)` · `revokeConsent(id)`
- `requestFIData(request)` · `getFIData(sessionId)` · `handleNotification(notification)`
- `normalizeFinancialData(data)`
- `getSupportedFIs()` / `getSupportedFITypes()` / `supportsFIType(type)`
- `status()` → `{ configured, mode, requiresCredentials, detail }` · `getSupportedFITypes()`

Selection is by configuration (`AA_PROVIDER` / `WEALTHCORE_AA_PROVIDER`), defaulting to
`mock`. The UI and sync engine **never** call a provider-specific API directly.

## 3. Provider registry

Registered in `server/aa/index.js`: `mock`, `finvu`, `setu`, `onemoney`, `anumati`,
`ink`, `saafe`, `nadl`, `protean`. `GET /api/v1/aa/providers` returns each with its
status, mode (`MOCK | SANDBOX | PRODUCTION`) and `requiresCredentials`.

| Provider | Adapter | Sandbox tested | Credentials required | Status |
| -------- | ------- | -------------- | -------------------- | ------ |
| Mock     | ✅ complete | ✅ (local, tests) | none | **IMPLEMENTED** |
| Finvu    | ✅ contract | closed (no creds) | client_api_key + key material | **PARTIALLY IMPLEMENTED / PLANNED** |
| Setu     | ✅ contract | closed (no creds) | access_token + product-instance-id | **PARTIALLY IMPLEMENTED / PLANNED** |
| OneMoney | stub | — | required | PLANNED |
| Anumati  | stub | — | required | PLANNED |
| INK      | stub | — | required | PLANNED |
| Saafe    | stub | — | required | PLANNED |
| NADL     | stub | — | required | PLANNED |
| Protean  | stub | — | required | PLANNED |

## 4. Local Mock AA (server/aa/providers/mock.js)

**TEST DATA — NOT REAL FINANCIAL DATA.** Fully local, deterministic, zero credentials.
Lifecycle: `createConsent → approve → requestFIData → markDataReady → getFIData → normalize → persist → dedupe`.
Supports negative states (`reject`, `revoke` blocks fetch). Fixtures in
`server/aa/fixtures/mock-data.js` cover savings/current/credit-card/fixed-deposit,
equity/MF/ETF/gold/SGB, EPF/PPF/NPS, life/health/vehicle insurance, loans, and
12 consistent transactions (salary, groceries, rent, utilities, dining, travel,
SIP, EMI, insurance premium, subscription, transfer).

## 5. Consent state machine (`server/aa/consent-state-machine.js`)

| Consent | allowed next |
| ------- | ------------ |
| draft | pending, rejected |
| pending | approved, rejected, expired |
| approved | active, revoked, expired |
| active | revoked, expired |
| rejected / revoked / expired | (terminal) |

| Data | allowed next |
| ---- | ------------ |
| idle | data_requested |
| data_requested | data_ready, timeout, partial_failure |
| data_ready | fetched, partial_failure |
| fetched | (terminal) |
| timeout / partial_failure | data_requested (retry) |

Invalid transitions throw `INVALID_TRANSITION`. `GET /api/v1/aa/workflow` publishes
the flows for the UI.

## 6. Normalizer & canonical model (`server/aa/rebit-normalizer.js`)

Maps the provider-neutral envelope → WealthCore domain rows (`accounts`,
`transactions`, `holdings`). Liability balances are normalised to positive
outstanding; transactions are assigned `direction`/`kind`/`category` from ReBIT
types; unsupported FI types raise `capabilityError` (`UNSUPPORTED_FI_TYPE`).

## 7. Sync engine (`server/aa/sync.js`)

`runAASync` runs connect → consent → approve → request FI → ready → fetch →
normalize → deduplicate → store, recording a `sync_runs` row and an `aa_sessions`
row. Idempotency: accounts are keyed by `external_ref`, transactions by
`source_txn_id` then `dedup_key`. Returns a summary and recalculated net worth /
portfolio.

## 8. Data provenance

Imported records carry `source='aa'`, `provider`, `fip`, `source_txn_id`,
`ingested_at`, `is_demo=1`. The UI can explain "Imported through Account Aggregator"
and never presents mock data as manual/live.

## 9. API routes (auth-gated)

`GET /aa/providers` · `GET /aa/workflow` · `POST /aa/connect` · `GET /aa/consents` ·
`POST /aa/consent/:id/approve|reject|revoke` · `POST /aa/sync` · `GET /aa/sessions` ·
(plus existing `/aa/status`, `/sync/runs`).

## 10. Architecture decisions

- **ADR-AA-001** Provider-neutral AA adapter architecture — done (`server/aa/interface.js` + registry).
- **ADR-AA-002** Local Mock AA as the default development environment — done (falls back to `mock`).
- **ADR-AA-003** ReBIT → WealthCore canonical normalization layer — done (`rebit-normalizer.js`).
- **ADR-AA-004** Provider-specific cryptography isolated behind a crypto abstraction — planned (see §11).
- **ADR-AA-005** Consent lifecycle as an explicit state machine — done (`consent-state-machine.js`).
- **ADR-AA-006** Financial records carry source/provenance metadata — done.

## 11. Product decision

> WealthCore supports AA providers through a provider-neutral integration layer. The
> canonical financial model is **not** coupled to any specific AA provider. The local
> Mock AA is the default development/test provider; external AA providers are optional
> integration environments.

## 12. Finvu & Setu — pending provider confirmation

- **Finvu** endpoints/headers verified from official docs (`aauat.finvu.in/API/V1`,
  `/Consent`, `/Consent/handle/{h}`, `/Consent/{id}`, `/FI/request`, `/FI/fetch/{s}`,
  `/Consent/Notification`, `client_api_key`/`fip_api_key` + `x-jws-signature`). The
  adapter marks live calls `PENDING PROVIDER CONFIRMATION` for:
  exact JWS canonical input, `alg`/`kid`, RSA registration, ECDH/Curve25519 key
  generation, AES-GCM params, exact KDF, key lifecycle.
- **Setu** registered as a provider contract (`fiu-sandbox.setu.co`, `/consents`,
  `Authorization: Bearer` + `x-product-instance-id`). Live path pending
  access_token issuance, product-instance setup, webhook signature verification,
  and Rahasya/key-material decryption.

No secret, key, token, endpoint beyond verified docs, or live connectivity is fabricated.

## 13. Finvu exploratory-call checklist (preserved)

The 59-question checklist from the earlier provider research is preserved here. The
**critical unresolved items** are: UAT `client_api_key`; RSA/JWS registration;
current ReBIT version & required `ver`; auth headers; exact JWS signing input;
`alg`; `kid`; ECDH key generation; AES-GCM params; exact KDF; consent lifecycle;
data-ready mechanism; FI/FIP coverage; sandbox limits; UAT → production requirements;
FIU eligibility; production pricing; certification; central-registry onboarding.
All of these are marked **PENDING PROVIDER CONFIRMATION** and are never guessed.
