# WealthCore

> **Your Entire Financial Life. One Intelligent Core.**

WealthCore is a **private, personal financial operating system**. It centralises bank accounts, credit cards, loans, investments, retirement, gold, crypto, real estate, income, expenses, budgets and goals into one application that answers:

> **What is my complete financial position right now, and what has changed?**

## What's inside

- **Central data environments** — one `WEALTHCORE_DATA_ENVIRONMENT` switch (`DEMO` default · `FINVU_SANDBOX` · `SETU_SANDBOX` · `PRODUCTION`) with fail-fast validation; PRODUCTION never falls back to demo. See [`docs/DATA_ENVIRONMENTS.md`](docs/DATA_ENVIRONMENTS.md).
- **Demo data environment** — a deterministic, clearly-labelled *synthetic* wealth profile (7 accounts, 12 holdings, 180 transactions, retirement, insurance, 6 goals) through the same AA provider architecture as real providers; no bank credentials, ever. See [`docs/DEMO_DATA.md`](docs/DEMO_DATA.md).
- **Single source of truth** for net worth and portfolio value across every surface.
- **Real, deterministic financial calculations** (EMI, SIP, FD, CAGR, XIRR) — never computed by an LLM.
- **Transaction intelligence** — validation, deduplication, auto-categorisation, transfer & recurring detection.
- **Reconciliation engine** — compares provider-reported vs local balances and surfaces differences (never hides them).
- **Automatic ingestion** — CSV/JSON/bank/Zerodha/Groww connectors with preview, mapping, dedup and a failed-record report (idempotent re-import).
- **Background synchronisation** — an in-process scheduler with retries/backoff (consents, market, notifications, monthly snapshots, reconciliation).
- **Notification engine** — 14 configurable alert types.
- **Account Aggregator / FIU integration** — consent lifecycle + provider adapter interface; live retrieval honestly reports `READY_FOR_CONFIGURATION` / `PROVIDER_NOT_CONFIGURED`.
- **Market-data freshness** — `LIVE / DELAYED / LAST_AVAILABLE / MANUAL / COST_BASIS / UNPRICED`, never falsely LIVE.
- **AI assistant** with 19 real-data tools, conversation context and no invented figures; LLM provider interface (`LLM_NOT_CONFIGURED` until a key is set).
- **Security hardening** — scrypt, httpOnly cookie sessions, CSRF, login rate limiting, password reset, config validation, redacted structured logs.
- **Full data control** — JSON/CSV export, app lock, revoke-connections, delete-all-data, no telemetry.

## Quick start

```bash
npm install
npm run dev        # http://0.0.0.0:8080
npm test           # 191 automated tests
npm audit:secrets  # secret scan (clean)
npm audit          # dependency audit (0 vulnerabilities)
```

1. Open the app → **Setup**.
2. Create your user account.
3. Explore instantly with **Settings → Load Demo Wealth Profile** — deterministic synthetic data (🧪 DEMO MODE); `WEALTHCORE_DATA_ENVIRONMENT` selects Finvu/Setu sandboxes or real providers for live connectivity.
4. Explore **Reconciliation**, **Import**, **Notifications**, **Integrations** and the **AI Assistant**.

## Architecture (summary)

```
Browser SPA (public/app.js)
   │  REST /api/v1  (bearer or httpOnly cookie + CSRF)
   ▼
Express (server/index.js)  ──► domain services (server/lib/*)  ──► SQLite (better-sqlite3)
                                              │                      └─ migrations + repository seam (Postgres-ready)
                                              └─ background scheduler
```

## Documentation

See [`docs/README.md`](docs/README.md). Key docs: [`BRD`](docs/BRD.md), [`FRD`](docs/FRD.md), [`ARCHITECTURE`](docs/ARCHITECTURE.md), [`DATA_MODEL`](docs/DATA_MODEL.md), [`API_SPECIFICATION`](docs/API_SPECIFICATION.md), [`SECURITY`](docs/SECURITY.md), [`OPERATIONS_RUNBOOK`](docs/OPERATIONS_RUNBOOK.md), [`FINAL_PRODUCTION_AUDIT`](FINAL_PRODUCTION_AUDIT.md).

## License

Private / non-commercial. Not for redistribution as a SaaS.
