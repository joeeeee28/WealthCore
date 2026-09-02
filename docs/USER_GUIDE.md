# USER GUIDE

## What is WealthCore?

A private, single-user app that gives you **one intelligent core** for your entire financial life — bank accounts, credit cards, loans, investments, gold, crypto, real estate, income, expenses, budgets, goals, and an AI assistant grounded in your real data.

## Getting started

1. **Set up** — create your user account (email + password).
2. **Add accounts** — go to **Accounts → Add account**. Choose a type (savings, current, credit, loan, brokerage, mutual fund, FD, crypto, real estate, other), a balance, and whether it is a liability.
3. **Add investments** — **Portfolio → Add security** to register a stock/fund/gold/crypto asset, then **Add holding** for a quantity + cost basis.
4. **Add transactions** — **Transactions → Add transaction**. Merchants are auto-categorised; duplicates are rejected; transfers/recurring are flagged.

## The Dashboard

Shows your **net worth** (assets − liabilities), total assets, liabilities, **savings rate**, net-worth trend, monthly cash flow, asset allocation, top expenses, and a portfolio summary. Every figure comes from a single backend calculation service, so it is always consistent.

## Portfolio & Net Worth

- **Portfolio** lists each holding with quantity, cost, current price, value and P&L. The invariant `quantity × price = value` is validated automatically. If a price is unknown it is shown as **MANUAL / no price** and valued at cost — never faked as live.
- **Net Worth** shows assets, liabilities and the difference, plus snapshots you can record over time.

## Budgets & Goals

- **Budgets**: set a monthly limit per category; the app compares it to what you've spent.
- **Goals**: define a target and track progress (e.g. Emergency Fund, Retirement, Child Education).

## AI Assistant

Ask natural-language questions and get answers computed from **your** data — never invented:
- "What is my net worth?"
- "How much did I spend this month?"
- "How much was food?"
- "Compare that with last month."

The assistant uses tool calls (shown under each answer) and keeps context across turns.

## Calculators

EMI, SIP future value, FD maturity, CAGR and XIRR — all deterministic and reference-accurate.

## Integrations

**Account Aggregator / market data** are shown in their **true current state**:
- If no provider credentials are configured, the integration shows `READY_FOR_CONFIGURATION` / `Provider credentials required`. It does not pretend to be live.
- You can model the consent lifecycle (create → approve → reject → revoke → expire) even before a live provider is connected.

## Privacy & data

- Data stays in a local SQLite file on your device. No telemetry, no analytics, no third-party scripts.
- **Export** your data as JSON or CSV (Settings → Export).
- **Lock** the app with a 4–6 digit PIN (Settings → Enable app lock → Lock).
- **Sign out** to revoke your session.

## Sample data

If you want to explore the product before entering real data, load clearly-labelled **sample data** from Settings. It is always shown as MANUAL/SANDBOX and never as your real or live data.

## Reset

To start fresh, stop the app and delete `data/wealthcore.db` (see `DEPLOYMENT.md`).

## New in v1.1

- **Reconciliation** — shows how your provider-reported balance compares to WealthCore's local balance for each account. Differences are displayed and can be resolved (adopt the source balance, or record for review). Differences are never hidden.
- **Import** — paste CSV/JSON, pick a format, preview, map columns if needed, and import. Re-importing the same file is safe (duplicates are counted, not created).
- **Notifications** — view configurable alerts, toggle preferences, evaluate rules, and dismiss items.
- **Integrations** — see the honest state of AA (`READY_FOR_CONFIGURATION`), market-data provider, AI provider (`LLM_NOT_CONFIGURED`), and data freshness.
- **Settings → Privacy** — revoke connections and, with confirmation, delete all your financial data.
- **Health / readiness** — `/health` and `/ready` report app and component status.

## Safety
- Integrations are **not** claimed to be live unless a provider is configured.
- AI answers only from your real data and never computes figures itself.
- You can export JSON/CSV at any time and control connections/deletion.
