# PRODUCT REQUIREMENTS DOCUMENT (PRD)

## Product

**WealthCore** — a private, personal financial operating system. Tagline: *Your Entire Financial Life. One Intelligent Core.*

## Concept

A single source of truth for the user's whole financial life, made tangible through one elegant dashboard, an accurate calculation engine, and an AI assistant grounded in the user's real data.

## Primary user journeys

1. **Set up** → create the single user account; default categories are seeded.
2. **Add accounts** → add bank/credit/loan/investment accounts (manually now; via AA when configured).
3. **Snapshot position** → dashboard shows net worth, assets/liabilities, income vs expense, allocation, portfolio P&L.
4. **Track spend** → add transactions; they are categorised, deduplicated and transfer/recurrence-flagged.
5. **Invest** → register securities + holdings; see market value, cost, P&L and the quantity×price invariant.
6. **Plan** → set budgets and goals; track progress.
7. **Ask the AI** → "What is my net worth?", "How much did I spend this month?", "How much was food?", "Compare that with last month."
8. **Export/control** → export JSON/CSV, set an app-lock PIN, load clearly-labelled sample data.

## Key screens

| Screen | Purpose | API |
| ------ | ------- | --- |
| Dashboard | Position, trend, cash flow, allocation, portfolio | `GET /dashboard` |
| Accounts | Asset/liability list + CRUD | `GET/POST/PUT/DELETE /accounts` |
| Transactions | Filterable list + add/edit | `.../transactions` |
| Portfolio | Holdings, prices, P&L | `GET /portfolio` |
| Net Worth | Assets − liabilities + snapshots | `GET /net-worth` |
| Budgets | Category limits + spend | `.../budgets` |
| Goals | Targets + progress | `.../goals` |
| Reports | Cash flow, allocation | `.../reports/*` |
| Calculators | EMI / SIP / FD / CAGR / XIRR | `.../calculators/*` |
| AI Assistant | Natural-language Q&A over real data | `POST /ai/message` |
| Integrations | AA state, consents, market data | `.../aa/*`, `.../market/*` |
| Settings | App lock, export, sample data | `.../auth/*`, `.../export.*` |

## Brand & visual language

Inspired by premium financial-technology aesthetics (Identity Collaboration reference): royal blue, deep navy, purple, blue/purple gradients, white, clean gray surfaces, premium cards, strong typography, security-focus. WealthCore keeps its **own identity**, distinct from any reference.

## Design principles

- **Single source of truth** for every financial figure.
- **No fake live status** — integrations show their real state.
- **No AI-computed money** — the LLM never calculates.
- **Privacy-first** — local data, no telemetry, full export.
- **Graceful failure** — every failure state is surfaced, never silent.

## Functional scope for v1

Implemented: auth + app lock; accounts; categories; transactions (CRUD, validation, dedup, auto-categorisation, batch, import); budgets; goals; securities + holdings; portfolio; net worth; snapshots; reports; calculators (EMI/SIP/FD/CAGR/XIRR); AI agent (real-data tool calling + context); import/export; AA consent lifecycle; market-data status; notifications list; audit log.

Not in v1 (documented in ROADMAP): live AA retrieval, live market prices, LLM provider, auto-sync scheduler, CSV/Excel/Zerodha/Groww parsers, FX feed, complex tags.

## v1.1 scope additions

New screens: **Reconciliation** (source vs local balance, history, resolve), **Import** (format select, preview, summary, runs), **Notifications** (preferences, activity, dismiss, evaluate). Enhanced **Integrations** (AA + market + LLM status + freshness). Enhanced **Settings** (privacy: revoke connections, delete all data). Background scheduler, provider adapters, security hardening (rate limiting, password reset, CSRF, httpOnly cookies), health/readiness, and expanded AI tools.

## Explicitly provider-gated (not faked)
Live AA data, live market prices, and LLM-backed answers require credentials. In-app status shows `READY_FOR_CONFIGURATION` / `PROVIDER_NOT_CONFIGURED` / `LLM_NOT_CONFIGURED`.
