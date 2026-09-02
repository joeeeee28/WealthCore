# MARKET DATA

## Purpose

Provide current prices for securities so portfolio values and P&L reflect the latest known value.

## Price freshness model (ABSOLUTE RULE 18)

Every security stores `price_minor`, `price_timestamp`, `price_status` and `provider`. Status values:

| Status | Meaning |
| ------ | ------- |
| `LIVE` | real-time quote from a real provider |
| `DELAYED` | delayed quote from a real provider |
| `LAST_AVAILABLE` | cached quote from a real provider (possibly stale) |
| `MANUAL` | price entered/computed by the user (no provider) |

**WealthCore never reports `LIVE` without a real provider.** `server/lib/market-data.js` defines the enums and the freshness function.

## Provider configuration

Set `WEALTHCORE_MARKET_PROVIDER` and `WEALTHCORE_MARKET_API_KEY`. `marketProviderConfig().configured` becomes true only when both are present. Otherwise the mode is `DEVELOPMENT`.

## Refresh flow

`POST /api/v1/market/refresh`:
- If **not configured** → returns `{ status: "READY_FOR_CONFIGURATION", message: "Market data provider credentials are required to fetch live prices.", syncFailed: true }`. It **does not fabricate values**.
- If **configured** → returns `{ status: "IN_PROGRESS", provider, ... }` (the provider adapter runs here).

## Unpriced securities

A security with `price_minor = NULL` is **unpriced**. In the portfolio engine its value falls back to cost basis as a **conservative, clearly-flagged** estimate (`priceMissing = true`, `priceStatus = 'MANUAL'`). The UI shows "no price" and never implies a live value.

## Freshness classification

`priceFreshness(timestamp, status)`:
- `LIVE → LIVE`, `DELAYED → DELAYED`, `MANUAL → MANUAL`, `LAST_AVAILABLE → LAST_AVAILABLE`,
- `LAST_AVAILABLE` older than 24h → `STALE`, no timestamp → `UNKNOWN`.

## Current state in this build

**No provider configured.** All seeded/demo prices are `MANUAL` or `LAST_AVAILABLE`; no security is `LIVE`. This is honest and reflected in the UI.

## Recommended next steps

1. Add a market-data provider and the retrieval adapter.
2. Map provider quotes to `securities` by ticker/exchange.
3. On each refresh, update `price_minor`, `price_timestamp`, and set `price_status` truthfully.
4. Add stale-price notifications.

## v1.1 — provider interface & extended states

- `PRICE_STATUS` now includes `LIVE`, `DELAYED`, `LAST_AVAILABLE`, `MANUAL`, **`COST_BASIS`** (holding valued at cost because no price), **`UNPRICED`** (no price, no cost basis).
- `resolveProvider()` returns the configured provider driver (or null). `recordPriceHistory()` writes to `market_price_history`. `validateQuote()` bounds-checks a provider payload.
- `priceFreshness()` marks a `LAST_AVAILABLE` quote older than 24h as `STALE`.
- `GET /market/status` returns provider config plus a `priceStatusBreakdown`.
- A configured provider is required for any `LIVE`/`DELAYED` price. Without one, `refreshPrices` returns `READY_FOR_CONFIGURATION` and never fabricates a price.

## Current state in this build
No provider configured; prices are `MANUAL`/`LAST_AVAILABLE`; no security is ever `LIVE`.
