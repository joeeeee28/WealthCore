# PRIVACY

WealthCore handles extremely sensitive financial information. This document describes how the data is kept private (ABSOLUTE RULE 7).

## Data location

- All financial data lives in the user's local SQLite database (`data/wealthcore.db`). It is excluded from source control (`.gitignore`).
- No data is sent to any third-party server for storage, analytics, or monetisation.

## What never leaves the app

- Account balances, transactions, investments, income, expenses, goals, budgets, net worth — none are transmitted anywhere except being returned to the user's own browser.
- No analytics, no telemetry, no third-party scripts, no CDNs, no external fonts. The frontend is self-contained.

## Where data could go (and is controlled)

- **AA/FIU (optional):** if the user configures a provider, permitted data is requested from that provider and stored locally. Nothing is sent to WealthCore servers (there are none).
- **Market data (optional):** price requests go to the user's configured market-data provider; secrets are env-based.
- **LLM (optional):** if the user enables an LLM provider, the AI tool outputs are handled locally; a future implementation should send only the tool result, never raw sensitive values, and this is a documented boundary.

## Logs

- Server logs contain **no** financial data or tokens. Only a bind message is printed.
- `audit_log` records actions (e.g. `account.create`, `networth.snapshot`) but not sensitive values.

## URLs and errors

- No financial data is placed in URLs (filter parameters are merchant/search terms only, never balances).
- Error messages do not echo balances or account secrets; they return sanitised `{ code, message }`.

## Export & control

- Full export as JSON/CSV via `GET /api/v1/export.*`.
- The user controls all data; deletion/reset is documented.

## Screenshots & debug

- No debug screenshots are generated or stored.
- No `console.log` of financial data exists in the client or server source.

## Demo data

- Sample data (if loaded) is flagged `is_demo=1`, `source='manual'`, classified as `MANUAL`/`SANDBOX`, and shown with a UI banner. It is never presented as the user's real financial data.

## Recommendations

- Back up regularly via the JSON export.
- In production, prefer an httpOnly, SameSite cookie for the token.
- Keep the local database file outside any shared/synced folder unless the user accepts the risk.

## v1.1 privacy additions

- **Revoke connections** (`POST /privacy/revoke-connections`) — revokes approved/pending consents and detaches accounts from providers.
- **Delete all data** (`POST /privacy/delete-data`) — removes accounts, transactions, holdings, securities, budgets, goals, consents, snapshots and notifications for the user.
- Raw ingestion payloads are stored **hashed** and per-run (`raw_ingest`) — the raw text is kept only for the current run and is never included in logs.
- Reconciliation/audit/reconciliation history records are user-owned and exportable.
- Reports/data-freshness indicators never expose raw provider credentials.

## Data collected & why
- Accounts/transactions/investments/liabilities — to compute your financial position.
- Goals/budgets — to track planning.
- Use/audit events — for your own review (no telemetry).
- Provider metadata (consents) — to model data acquisition; never logged with secrets.

## Where it is stored
- Local SQLite file (`data/wealthcore.db`), excluded from source control. Optional Postgres via `WEALTHCORE_DB_URL`.

## Retention & deletion
- Data persists until deleted. You can export, revoke connections, delete individual records, and delete all data in-app.

## External providers
- AA/FIU (optional, credential-gated), market data (optional, key-gated), LLM (optional, key-gated). Each is **not configured** unless credentials are provided; nothing is sent to WealthCore servers (there are none).
