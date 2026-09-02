# ARCHITECTURE

## High-level overview

WealthCore is a **single-process Node.js application** with a thin REST API over a SQLite database and a static (vanilla-JS) single-page client. There is no build step, no external telemetry, and no multi-tenant layer.

```text
Browser (public/app.js SPA)
        │  REST /api/v1  (+ Bearer token)
        ▼
Express server (server/index.js)
        ├── server/routes/api.js      (REST endpoints, auth middleware)
        └── domain services (server/lib/*)
                ├── calculations.js   deterministic finance math
                ├── networth.js       single source of truth
                ├── portfolio.js      holdings × price = value, P&L
                ├── transaction-intelligence.js  dedup/category/transfer/recurring/validate
                ├── market-data.js    price freshness + provider config
                ├── aa-integration.js AA/FIU consent lifecycle
                ├── ai-tools.js       tool layer reading real data
                ├── ai-agent.js       context + resolver + execution
                ├── auth.js           scrypt hashing + session + app lock
                └── defaults.js       default categories + demo data
                ▼
        SQLite (better-sqlite3) — server/db.js (schema in server/db.js)
```

## Data flow (the WealthCore pipeline)

```text
ACCOUNT AGGREGATOR (AA/FIU)        ←— real feeds require provider credentials
        ↓
FINANCIAL DATA → NORMALISATION → VALIDATION → DEDUPLICATION → TRANSACTION INTELLIGENCE
        ↓
PORTFOLIO ENGINE → NET WORTH ENGINE → ANALYTICS → AI
```

Manual entry is a first-class fallback: `POST /accounts`, `POST /transactions`, etc. write directly into the same database the pipeline writes to, so there is one source of truth regardless of how data arrives.

## Layers

1. **Presentation** — `public/index.html`, `public/styles.css`, `public/app.js`. No frameworks. All state is client-side; money is integer minor units.
2. **API** — `server/routes/api.js`. Express router mounted at `/api/v1`. Bearer-token auth middleware. Amounts are integer minor units. Errors are `{ error: { code, message } }`.
3. **Domain** — the `server/lib/*` modules. Pure functions and DB-backed services. All financial math is here and is deterministic.
4. **Persistence** — `server/db.js`. SQLite via `better-sqlite3`, WAL, foreign keys, prepared statements, indexes.

## Consistency & single source of truth

- `computeNetWorth(db, userId)` is the **only** net-worth computation. Dashboard, portfolio, net-worth view, reports and AI all call it. Removing/re-deriving net-worth logic elsewhere is forbidden.
- `computePortfolio(db, userId)` is the **only** portfolio value/P&L computation.
- Amounts are stored as integer minor units to avoid floating-point errors.

## Auth model

- Password hashing: `scrypt(password, salt)` with a 64-byte key and a per-user 16-byte random salt.
- Sessions: opaque 64-hex token, stored server-side, 12h expiry, revocation flag.
- App lock: optional PIN (`scrypt`) over a session; locked sessions return HTTP `423`.
- Client stores the token in `localStorage` (acceptable for this local single-user app; a production deployment should use an httpOnly cookie — documented in `SECURITY.md`).

## Concurrency & scaling

- Single SQLite connection (synchronous) is sufficient for a personal app.
- Reads are indexed (`transactions(date)`, `transactions(user_id)`, `transactions(account_id)`, `transactions(category_id)`, `transactions(dedup_key)`, `securities(user_id)`, `holdings(user_id)`).
- Background sync/scheduler is **not** yet implemented (see `ROADMAP.md`).

## Configuration (env)

| Variable | Purpose | Example |
| -------- | ------- | ------- |
| `PORT` | Server port | `8080` |
| `HOST` | Bind address | `0.0.0.0` |
| `WEALTHCORE_DB` | SQLite path | `./data/wealthcore.db` |
| `WEALTHCORE_AA_PROVIDER` / `_CLIENT_ID` / `_SECRET` / `_BASE_URL` | AA/FIU creds | unset in dev |
| `WEALTHCORE_MARKET_PROVIDER` / `_API_KEY` | Market data | unset in dev |
| `WEALTHCORE_LLM_PROVIDER` / `_API_KEY` | AI model | unset in dev |

## v1.1 architecture additions

```
Browser SPA (public/app.js)
   │  REST /api/v1  (bearer OR httpOnly cookie + CSRF)
   ▼
Express server (server/index.js)
   ├─ request/correlation IDs + structured redacted logger (server/lib/logger.js)
   ├─ /health (liveness) + /ready (component readiness)  (server/lib/health.js)
   ├─ config module + validation (server/config.js, .env.example)
   ├─ REST router (server/routes/api.js)
   │     └─ auth (scrypt/sessions/cookie/CSRF/rate limit/password reset)
   │     └─ reconciliation, ingestion, notifications, jobs, privacy, health
   └─ background scheduler (server/lib/scheduler.js)  ── jobs: expire-consents,
        market-refresh, notify-evaluate, monthly-networth-snapshot, reconciliation-scan
        └─ retries / backoff / status in `jobs`
Domain services (server/lib/*)
   ├─ calculations.js      deterministic math
   ├─ networth.js          single source of truth
   ├─ portfolio.js         holdings × price = value, P&L
   ├─ transaction-intelligence.js   dedup/category/transfer/recurring/validate
   ├─ reconciliation.js    source vs local balance
   ├─ ingest.js + csv.js   connectors (CSV/JSON/bank/Zerodha/Groww)
   ├─ notifications.js     14 event types, preferences, evaluate
   ├─ market-data.js       provider interface, freshness, history
   ├─ aa-integration.js    provider adapter interface, consent lifecycle
   ├─ ai-tools.js / ai-agent.js   19 tools, LLM provider interface, context
   ├─ auth.js              scrypt/sessions/app lock/rate limit/reset/CSRF
   └─ logger.js / health.js / config.js
Persistence (server/db.js + server/db/*)
   └─ migrations.js (idempotent), connector.js (SQLite now, Postgres adapter-ready)
```

### Repository & migrations
- `server/db/migrations.js` applies numbered, idempotent migrations on startup (`schema_migrations`).
- `server/db/connector.js` abstracts SQLite `?` vs Postgres `$1..$n` (`toPostgresParams`) and exposes `all/get/run/transaction`, so business logic is not tied to SQLite-specific quirks. Setting `WEALTHCORE_DB_URL` selects the Postgres dialect.

### Scheduler
- Runs in-process, off the request path; `WEALTHCORE_SCHEDULER_ENABLED` gates it. Jobs record status, attempts, last/next run, duration and errors.

### Observability
- Structured, redacted logs; request/correlation IDs in headers; `/health` and `/ready` (database/AA/market/LLM component status); 503 only when the database is unavailable (optional providers are `not_configured`, not failures).

### v1.3 — Setu adapter layer
`server/aa/providers/setu.js` (Setu v2 contract), `server/aa/crypto/setu-crypto.js`
(signature/auth), `server/aa/sync.js` (provider-agnostic fetch/normalize),
`server/aa/webhook/setu` (public, signature-verified). Environment separation
`AA_PROVIDER` + `AA_ENVIRONMENT` (mock | sandbox | production) with a production
safety guard in `config.js`. See `docs/SETU_INTEGRATION.md`.

### ADR-AA-007
Setu is wired as the first real AA provider behind the existing `AAProvider`
interface; WealthCore's canonical model stays provider-neutral. Sandbox/UAT is the
target; production requires credentials + onboarding and is never assumed.

### v1.3.1 — Setu auth contract update
`server/aa/crypto/setu-crypto.js` emits the current official Setu auth headers
(`x-client-id`, `x-client-secret`, `x-product-instance-id`). A credential-gated
external integration test (`tests/setu-external.test.js`, `npm run test:setu:sandbox`)
targets the real sandbox and is excluded from `npm test`. See `docs/SETU_INTEGRATION.md`.
