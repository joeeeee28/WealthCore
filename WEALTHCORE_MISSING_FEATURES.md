# WEALTHCORE — MISSING FEATURES

Features that are absent or only partially present, each with user value, complexity, dependency and priority. This is the verified gap list; nothing here is implemented that I did not find in code.

## P0 — Financial correctness (blocking)

| ID | Feature | Detail | Why it matters | Complexity | Dependency |
| -- | ------- | ------ | -------------- | ---------- | ---------- |
| MF-01 | **Multi-currency valuation + FX** | Holdings/assets/spend summed across currencies with no FX conversion (confirmed: USD BTC added to INR totals). | Net worth, portfolio value, P&L, income/expense and allocation are **wrong** whenever a non-INR asset exists. | Medium | FX rate feed (or per-currency segregation) |
| MF-02 | Realized P&L | Only unrealized is modelled. | Users cannot see sold/realized gains. | Medium | — |

## P1 — Important product capability

| ID | Feature | Complexity | Dependency | Priority |
| -- | ------- | ---------- | ---------- | -------- |
| MF-03 | Live AA/FIU data retrieval (FI session, fetch, decrypt, normalise) | High | FIU credentials | High |
| MF-04 | Live market-data provider (quotes, history, retries/timeout) | Medium | Market API key | High |
| MF-05 | Real LLM tool-calling agent (function-call dispatch over `TOOL_SCHEMAS`) | Medium | LLM API key | High |
| MF-06 | CAS / MFCentral import for mutual-fund statements | Medium | — | High |
| MF-07 | Loan dashboard (payoff, amortization chart, due dates) | Medium | — | High |
| MF-08 | Financial health / essentials score | Medium | — | High |
| MF-09 | Fix AI compare-month anchor bug + "why" explainability | Low | — | High |
| MF-10 | Excel (.xlsx) import with a **safe** parser | Medium | Safe xlsx lib | High |

## P2 — Parity / enrichment

| ID | Feature | Complexity | Priority |
| -- | ------- | ---------- | -------- |
| MF-11 | Split transaction | Medium | Med |
| MF-12 | Transaction clone + bulk categorize/delete | Medium | Med |
| MF-13 | Broker grouping + security grouping views | Low | Med |
| MF-14 | Goal sub-targets/milestones, asset-linking, inflation projection | Medium | Med |
| MF-15 | Step-up SIP | Low | Med |
| MF-16 | Emergency-fund health + retirement planner | Medium | Med |
| MF-17 | Notification types: EMI due, credit-card due, low balance, portfolio movement, concentration warning, unusual spending | Low–Medium | Med |
| MF-18 | Net-worth annotations / notes on snapshots | Low | Med |
| MF-19 | Budget percent-of-income + goal allocation views | Low | Med |
| MF-20 | Privacy mode (hide sensitive amounts, blur screen) | Low | Med |
| MF-21 | Cursor pagination + read caching for large histories | Medium | Med |
| MF-22 | Per-entity data-freshness indicators in UI | Low | Med |

## Differently-implemented (not missing but differs)

- **Multiple profiles / family / shared access** — intentionally **not applicable** (single-user non-commercial product).
- **Telemetry/analytics** — deliberately absent (privacy-first).

## Honesty note

The documented "rollback on import", "PostgreSQL adapter-ready" and "real LLM tool calling" are **not** actually implemented (see main audit §§14, 6, 15). They are listed here as intended-but-unverified claims rather than working features.
