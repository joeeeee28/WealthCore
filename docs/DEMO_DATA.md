# WealthCore — Demo Data Environment

> **DEMO DATA — All financial information produced by the demo environment is
> synthetic.** It is never real bank data, it uses no real bank credentials,
> and it contains no secrets of any kind.

## What it is

The demo environment is a complete, deterministic, *synthetic* wealth profile
that lets anyone explore WealthCore end-to-end — dashboard, portfolio, net
worth, budgets, goals, reconciliation, notifications and the AI assistant —
without connecting a single real account.

It is produced by the **Demo AA provider** (`server/aa/providers/demo.js`),
which implements the exact same provider contract as the real Account
Aggregator adapters (Finvu, Setu). Demo data flows through the same consent
lifecycle, the same ReBIT normalizer and the same idempotent sync pipeline as
real AA data:

```
DemoProvider.createConsent → approveConsent → requestFIData → markDataReady
  → getFIData → normalizeFinancialData → runAASync (idempotent upserts)
```

Nothing about the demo path bypasses the AA architecture. Provider resolution
is centralised in `server/aa/data-environment.js` (`getDataEnvironment()` /
`getActiveProvider()` / `resolveAAPProvider()`).

## The data set (deterministic)

`server/aa/fixtures/demo-data.js` generates the entire profile from a single
fixed PRNG seed (`DEMO_SEED = 'wealthcore-demo-v1'`, xmur3 → mulberry32), so
every load produces byte-identical data:

| Entity | Count | Notes |
| ------ | ----- | ----- |
| AA-linked accounts | **7** | savings, current, FD, RD, brokerage (assets) + credit card, home loan (**2 liabilities**) |
| Investment holdings | **12** | equity / mutual fund / ETF / gold / silver / bond (all synthetic tickers) |
| Retirement assets | 3 | EPF, PPF, NPS |
| Insurance records | 3 | term life, family health, ULIP (with fund value) |
| Financial goals | 6 | emergency fund, retirement corpus, education, trip, down payment, car |
| Budgets | 4 | food, transport, utilities, shopping |
| Transactions | **180** | ids `DEMO-TXN-0001 … DEMO-TXN-0180`, chronological |
| History window | ~6 months | April 2026 → September 2026 |

## How records identify themselves as synthetic

Every layer carries explicit markers:

* Fixture / envelope: `provider: 'demo'`, `source: 'DEMO'`, `synthetic: true`,
  every record annotated `source: 'DEMO'`, `synthetic: true`.
* Database: `provider = 'demo'`, `source = 'DEMO'`, `is_demo = 1`,
  account `external_ref` prefixes `DEMO-`, transaction ids
  `DEMO-TXN-####`, goal names prefixed `Demo ▸`.
* API: `synthetic: true` and
  `notice: 'DEMO DATA — All financial information shown is synthetic.'` on the
  demo endpoints; the `/data-environment` descriptor flags `synthetic: true`.
* UI: persistent 🧪 **DEMO MODE** chip and a banner
  *“DEMO DATA — All financial information shown is synthetic.”* on every view.

Account numbers are masked (`XXXXXX9001`), tickers are fictional
(`DRLI`, `DHDB`, …) and merchants are fictional (`Demo Mart Groceries`).

## Financial correctness (nothing is hard-coded)

Responses are always computed by the existing engines —
`computeNetWorth()` / `computePortfolio()` / the reconciliation engine — never
by hard-coded totals. The fixtures only define *inputs* (opening balances,
prices, quantities, transaction amounts) that satisfy strict invariants,
verified in `tests/demo-financial-calculations.test.js` and
`tests/demo-reconciliation.test.js`:

* `opening balance + credits − debits = closing balance` (per account),
* `quantity × price = market value` (per holding and portfolio total),
* `assets − liabilities = net worth`,
* portfolio totals reconcile with individual holdings,
* debt metrics reconcile with the two liability records.

## Demo operations

All endpoints are authenticated and **user-scoped** (`user_id`).

| Endpoint | Behaviour |
| -------- | --------- |
| `GET /api/v1/demo/status` | loaded flag, per-entity demo counts, last load time, environment descriptor |
| `POST /api/v1/demo/load` | runs the demo sync pipeline + demos extras, records snapshot + notification |
| `POST /api/v1/demo/refresh` | same as load; idempotent — reports duplicates instead of creating any |
| `POST /api/v1/demo/reset` | deletes **only the calling user's** demo rows (`DEMO-*`, `provider='demo'`, `is_demo=1`) |

These coexist with the older `POST /api/v1/seed-demo` sample-data seeder
(`server/lib/defaults.js`), which predates the data-environment architecture
and is unchanged. The richer, deterministic, environment-aware path is the
`/api/v1/demo/*` family documented here.

### User isolation

Demo rows are ordinary WealthCore rows: every query filters by `user_id`, so
one user's demo profile can never appear in another user's data. Reset is a
single transaction that touches only the calling user's demo rows; real data
is never touched by any demo operation.

### Idempotency

Deterministic ids make loads naturally idempotent:

* accounts upsert by `external_ref` (`DEMO-LINK-*`, `DEMO-RETIREMENT-*`, `DEMO-INSURANCE-*`),
* transactions upsert by `source_txn_id` (`DEMO-TXN-####`) + `dedup_key`,
* securities/holdings upsert by name/quantity,
* goals/budgets upsert by name/category,
* refresh therefore creates **zero** duplicates (verified by tests).

## Loading from the UI

Settings → **Demo wealth profile** shows the current status (record counts,
last load) and provides **Load / Refresh / Reset Demo Wealth Profile**
controls. While the demo environment is active the persistent 🧪 DEMO MODE
chip and the synthetic-data banner are displayed everywhere.

## Production safety

`WEALTHCORE_DATA_ENVIRONMENT=PRODUCTION` **hard-blocks** every demo mutation
(`assertDemoAllowed()` → `DEMO_DISABLED_IN_PRODUCTION`), fails configuration
validation when no real Finvu/Setu credentials are configured, and can never
resolve the demo provider through `getActiveProvider()`. There is no automatic
or silent fallback from PRODUCTION to DEMO.

See `docs/DATA_ENVIRONMENTS.md` for the environment architecture.
