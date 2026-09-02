# TEST STRATEGY

## Overview

WealthCore uses Node's built-in test runner (`node --test`). All layers are covered:

| Layer | Tool | Status |
| ----- | ---- | ------ |
| Financial calculations | `node:test` | ✅ Implemented |
| Money/decimal | `node:test` | ✅ Implemented |
| Transaction intelligence | `node:test` | ✅ Implemented |
| Net worth / portfolio (DB-backed) | `node:test` + `better-sqlite3` (in-memory) | ✅ Implemented |
| AI agent (real data + context) | `node:test` + in-memory DB | ✅ Implemented |
| API / E2E HTTP | `node:test` + real `app.listen` + `fetch` | ✅ Implemented |

## How to run

```bash
npm install
npm test          # runs all tests
npm run dev       # start the app
```

## Test principles

1. **Deterministic financial values** — asserted against independently computed references (Python), never against the function under test.
2. **Real database** — DB-backed tests use an in-memory SQLite instance (`WEALTHCORE_DB=:memory:`).
3. **Close the loop** — API tests exercise the full HTTP stack (auth → CRUD → calculation → AI → export → lock).
4. **Negative paths** — invalid amounts, duplicate transactions, wrong PIN, unauthenticated access, unconfigured AA, unknown AI intent.
5. **Honesty** — tests assert that AA/market state is reported truthfully (e.g. `READY_FOR_CONFIGURATION`), never `LIVE`.

## Test categories

### Unit
`calculations`, `money`, `transaction-intelligence`.

### Integration (DB)
`networth-portfolio` — verifies `assets − liabilities`, `qty × price = value`, P&L, unpriced handling, allocation.

### E2E / API
`api` — boot the server, run the real HTTP flow:
`config → setup → dashboard → accounts → transactions (validation/dedup) → calculators → AI → AA status → export → app lock (lock/block/unlock) → negative cases`.

### AI
`ai-agent` — net worth question, monthly spending, conversation context (food → compare), and no-hallucination (unknown intent → suggestion).

## Financial calculation validation

- EMI, SIP, FD, CAGR, XIRR computed with authoritative reference values (documented in `TEST_CASES.md`).
- Amortization invariant: final balance = 0; principal payments sum to principal.
- Portfolio invariant: `SUM(qty × price) = total value`; mismatches counted.
- Net worth invariant: `assets − liabilities = net worth`, consistent across surfaces.

## Security testing
- Unauthenticated access returns `401`; locked session returns `423`; wrong PIN returns `401`.
- Secret scan (grep for `API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY`) returns no hard-coded literals.

## Coverage for future
- Add CSV import parsing tests, FX, background sync tests, performance/pagination tests.

## v1.1 test expansion (81 tests)

Additional suites:
- `tests/reconciliation.test.js` — matching/difference/missing-source classification, run recording, history, resolve.
- `tests/ingest.test.js` — CSV parsing, amount/debit-credit normalisation, idempotent re-import, formatting-insensitive dedup, distinct monthly payments not deduped, failed-record reporting, metadata.
- `tests/notifications.test.js` — preferences, budget over-spend, consent expiry, large transaction, emit.
- `tests/scheduler.test.js` — registry, config, safe manual job run, honest market job.
- `tests/adapters.test.js` — AA/market status honesty, consent schema/lifecycle, `PROVIDER_NOT_CONFIGURED`, quote/freshness validation.
- `tests/config.test.js` — production fail-fast, partial-integration misconfiguration.
- `tests/security.test.js` — rate limiting, password reset, CSRF, cookie vs bearer auth.

### Coverage target
81 tests across unit, DB integration, adapters, scheduler and HTTP E2E + negative cases. Critical-path E2E is covered by `tests/api.test.js` plus `tests/security.test.js`.
