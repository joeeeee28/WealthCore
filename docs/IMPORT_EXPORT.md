# IMPORT / EXPORT

## Export

### JSON (`GET /api/v1/export.json`)
Full data export (attachment) containing: accounts, transactions, securities, holdings, goals, budgets, categories, plus `exportedAt`. This is the recommended full backup.

### CSV (`GET /api/v1/export.csv`)
Transactions export with columns: `id, date, amount_minor, currency, direction, kind, merchant, note, account_id, category_id, source, provider_ref, created_at`. Amounts are integer minor units.

Both require an authenticated session (bearer token).

## Import

### JSON (`POST /api/v1/import`)
Body: `{ "transactions": [ { accountId, date, amountMinor, direction, currency?, merchant?, note?, ... } ] }`.
Each record is run through the **same validation, categorisation and dedup logic** as manual entry. Response: `{ results: [{ ok, id|error }], created, failed }`. Duplicate and invalid records are reported per-item, never silently dropped.

### Transaction batch (`POST /api/v1/transactions/batch`)
Identical semantics; accepts a JSON array.

## Pending import format support (documented in ROADMAP)
- CSV / Excel templates
- Zerodha Console export
- Groww portfolio export

## Money format
All exports use integer minor units with a `currency` field. The client/backend formats for display.

## v1.1 — ingestion framework

The ingestion pipeline: Connector → Raw ingestion → Schema validation → Normalisation → Deduplication → Classification → Reconciliation → Persistence.

### Import (POST /ingest)
Supported connectors (`GET /ingest/connectors`): `csv-generic`, `bank-csv`, `json-transactions`, `zerodha-holdings`, `groww-holdings`. Each accepts pasted `text` (CSV/JSON), optional `mapping` (canonical column → source column), and `defaultAccountId`.

Workflow:
1. **Validate** the file/format and parse rows; unparseable rows are reported as failed records (not silently dropped).
2. **Preview** via `POST /ingest/preview` (10 rows) before committing.
3. **Column mapping** (canonical field → source column) for non-standard files.
4. **Deduplication** by `dedupKey` (source ref/account/date/amount/direction) — importing the same file twice yields duplicates counted, not inserted.
5. **Normalisation** — merchant, note, category, currency, direction, posting_date, confidence, normalized_merchant, source_ref, ingested_at.
6. **Classification** — auto-categorise by merchant rules.
7. **Summary + failed-record report** returned; persisted per run (`ingestion_runs`, `raw_ingest` hashed).

Every imported transaction carries source, source account, source transaction ID (if any), ingestion timestamp, original amount, normalized amount, currency, transaction date, posting date, merchant, category, confidence and a deduplication key.

### Export
`GET /export.json` now also includes consents, reconciliation runs, notifications, snapshots and audit. `GET /export.csv` exports transactions.

### Excel note
`.xlsx` is intentionally **not** enabled: the `xlsx` package has a no-fix high-severity advisory. Use CSV/JSON, or convert to CSV. A safe Excel connector is a planned enhancement.
