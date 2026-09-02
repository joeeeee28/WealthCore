# BUSINESS REQUIREMENTS DOCUMENT (BRD)

## 32.1 Executive Summary

WealthCore is a **private, personal financial operating system**. It centralises a single user's complete financial life — bank accounts, credit cards, loans, investments, retirement, gold, crypto, real estate, income, expenses, budgets, and goals — into one application that answers the user's core question: *"What is my complete financial position right now, and what has changed?"*

WealthCore replaces the need to open multiple bank, brokerage, and mutual-fund apps, spreadsheets, statement files, and separate expense trackers. It is built for a single user, is non-commercial, and stores data locally.

## 32.2 Product Vision

> **Your Entire Financial Life. One Intelligent Core.**

A premium-feeling, security-first personal financial OS that automatically acquires permitted financial data (where integrations are available), maintains accurate financial calculations, provides an interactive AI over the user's real data, and gives complete visibility and control.

## 32.3 Problem Statement

A person's financial information is fragmented across:
- multiple bank and credit-card portals
- brokerage and mutual-fund applications
- loans and insurance providers
- spreadsheets and statement files (PDFs, CSVs)
- standalone expense trackers

This fragmentation means users cannot answer even a simple question like "what is my net worth?" or "how much did I spend on food last month?" without manual effort. Errors, stale data, and privacy leakage across third-party trackers are common.

## 32.4 Product Objective

Centralise the user's financial information into a single, private, automatically-synchronised operating system with accurate calculations and an AI assistant over real data.

## 32.5 Goals

1. **Centralised financial visibility** — one place for every asset, liability, income and expense.
2. **Automated data acquisition** — acquire permitted data via supported integrations (falling back to manual entry).
3. **Accurate net worth** — a single, validated calculation for net worth, assets and liabilities.
4. **Investment tracking** — holdings, market value, cost basis, P&L.
5. **Transaction intelligence** — categorization, dedup, transfer & recurring detection.
6. **Financial insights** — budgets, goals, reports, savings rate, allocation.
7. **AI assistance** — an AI that answers from the user's real data without inventing figures.
8. **Privacy & control** — local storage, no telemetry, full export, app lock.

## 32.6 Non-Goals

WealthCore explicitly does **NOT** (unless separately implemented and authorised):
- commercial SaaS / multi-tenant administration / billing / subscription management
- customer/team/org management or sales CRM
- financial transaction execution (it does not place trades or move money)
- banking or lending services
- investment advisory or regulated financial advice
- family/business shared profiles (out of scope for the private single-user product)

## 32.7 Stakeholders

**Primary:** a single personal user (the sole owner and operator).
Secondary: (none in this build — intentional).

## 32.8 User Personas

**Primary — Personal Wealth Manager / Individual User:** tracks income, expenses, investments, loans, and goals; wants a fast, accurate, private view of their financial position and a natural-language way to ask questions about it.

## 32.9 Business Requirements (capability-level)

| BR ID | Requirement |
| ----- | ----------- |
| BR-01 | The product shall maintain a single non-commercial user account. |
| BR-02 | The product shall let the user record financial accounts (bank, credit, loan, brokerage, deposits, crypto, real estate). |
| BR-03 | The product shall record income and expense transactions with categorisation, deduplication and transfer/recurring detection. |
| BR-04 | The product shall track investments (holdings, securities) and compute market value, cost and P&L. |
| BR-05 | The product shall compute net worth as the single source of truth shared by all surfaces. |
| BR-06 | The product shall support budgets, goals, reports, calculators and snapshots. |
| BR-07 | The product shall acquire permitted financial data via an Account Aggregator/FIU integration where configured, and report the real integration state (never fake live). |
| BR-08 | The product shall expose market-data freshness (LIVE / DELAYED / LAST_AVAILABLE / MANUAL) honestly. |
| BR-09 | The product shall provide an AI assistant that answers only from the user's real data via tool calls. |
| BR-10 | The product shall support full data import/export and local privacy controls (app lock, no telemetry). |

## 32.10 Assumptions

- The user is comfortable running a local Node.js application.
- The user will supply any required provider credentials (AA/FIU, market data, optional LLM key).
- Amounts are handled in minor currency units with currency labels (default INR).
- A single database lives on the user's device (SQLite).

## 32.11 Constraints

- Personal / non-commercial: no SaaS, billing, or multi-tenancy.
- Financial calculations must be deterministic and never produced by an LLM.
- No hard-coded production credentials.
- No fabricated live status.

## 32.12 Dependencies

- Runtime: Node.js ≥ 18; `better-sqlite3`; `express`.
- Optional: AA/FIU provider credentials; market-data provider; LLM provider key.
- No third-party telemetry or analytics.

## 32.13 Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Provider credentials unavailable | High | Medium | Integrations expose real `READY_FOR_CONFIGURATION` state; manual entry fallback |
| LLM hallucination | Medium | High | Tool-calling agent reads only real DB data; LLM never computes figures |
| System loses real-time pricing | Medium | Low | Honest status labels; manual price updates |
| Local data loss | Low | Medium | Full JSON export; documented backups |

## 32.14 Success Criteria

- A user can add accounts, transactions and investments and immediately see correct net worth and portfolio P&L.
- Net worth / portfolio / reports / AI all agree (same backend calculation service).
- AA and market-data integrations represent their true state (no fake LIVE).
- The AI answers from real data and never invents values.
- All deterministic calculators produce reference-accurate results, verified by tests.
- The full documentation set matches the built product.
