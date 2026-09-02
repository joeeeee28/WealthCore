# DATA MODEL

All data lives in a single SQLite database (`data/wealthcore.db`). Amounts are stored as **integer minor units** (`*_minor` int columns). Foreign keys are enforced (`PRAGMA foreign_keys = ON`); WAL is enabled. Indexes are listed per table.

## Entity-relationship overview

```text
User (single)
 ├── Session
 ├── Setting
 ├── Account ──────────┬── Transaction
 │                     ├── Holding ──── Security
 │                     └── (asset/liability)
 ├── Category ─────────┬── Transaction
 │                     └── Budget
 ├── Goal
 ├── Consent
 ├── SyncRun
 ├── AiConversation ─── AiMessage
 ├── Snapshot
 ├── Notification
 └── AuditLog
```

## Users

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | autoincrement |
| email | TEXT | no | unique |
| name | TEXT | no | |
| password_hash | TEXT | no | scrypt hex |
| password_salt | TEXT | no | per-user random |
| created_at / updated_at | TEXT | no | |
| last_login_at | TEXT | yes | |

## Sessions

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| token | TEXT PK | no | opaque 64-hex |
| user_id | INTEGER FK | no | → users |
| created_at / expires_at | TEXT | no | 12h expiry |
| revoked | INTEGER | no | 0/1 |
| app_lock_enabled | INTEGER | no | 0/1 |
| app_lock_pin_hash / app_lock_pin_salt | TEXT | yes | scrypt |
| app_locked | INTEGER | no | 0/1 |

## Accounts

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | → users |
| name | TEXT | no | |
| type | TEXT | no | savings/current/credit/brokerage/mutual_fund/loan/fd/crypto/real_estate/other |
| institution | TEXT | yes | |
| currency | TEXT | no | default INR |
| balance_minor | INTEGER | no | |
| is_liability | INTEGER | no | 1 = loan/credit |
| source | TEXT | no | manual / provider |
| provider | TEXT | yes | AA provider |
| external_ref | TEXT | yes | provider reference |
| aa_status | TEXT | yes | LIVE / READY_FOR_CONFIGURATION ... |
| is_demo | INTEGER | no | 1 = sample data |
| last_synced_at | TEXT | yes | |
| created_at / updated_at | TEXT | no | |

## Categories

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| name | TEXT | no | unique per user |
| kind | TEXT | no | expense/income/savings/investment |
| color / icon | TEXT | yes | |
| is_demo | INTEGER | no | |

## Transactions

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| account_id | INTEGER FK | yes | → accounts (SET NULL on delete) |
| date | TEXT | no | ISO |
| amount_minor | INTEGER | no | > 0 |
| currency | TEXT | no | |
| direction | TEXT | no | in / out |
| kind | TEXT | no | expense/income/savings/investment |
| category_id | INTEGER FK | yes | → categories |
| merchant | TEXT | yes | |
| note | TEXT | yes | |
| source | TEXT | no | manual/provider |
| provider_ref / external_id | TEXT | yes | dedup refs |
| is_transfer | INTEGER | no | |
| transfer_account_id | INTEGER FK | yes | → accounts |
| is_recurring | INTEGER | no | |
| recurrence | TEXT | yes | |
| dedup_key | TEXT | yes | indexed; sha256 hash |
| status | TEXT | no | active/deleted |
| is_demo | INTEGER | no | |
| created_at / updated_at | TEXT | no | |

Indexes: `date`, `user_id`, `account_id`, `category_id`, `dedup_key`.

## Budgets

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| category_id | INTEGER FK | no | → categories |
| period | TEXT | no | monthly |
| amount_minor | INTEGER | no | |
| currency | TEXT | no | |
| is_demo | INTEGER | no | |

## Goals

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| name | TEXT | no | |
| target_amount_minor | INTEGER | no | |
| current_amount_minor | INTEGER | no | |
| currency | TEXT | no | |
| deadline | TEXT | yes | |
| status | TEXT | no | active etc. |
| is_demo | INTEGER | no | |

## Securities

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| ticker | TEXT | yes | |
| name | TEXT | no | |
| exchange | TEXT | yes | |
| asset_class | TEXT | no | equity/mutual_fund/etf/gold/silver/crypto/bond/real_estate/fd/other |
| currency | TEXT | no | |
| price_minor | INTEGER | yes | null = unpriced |
| price_timestamp | TEXT | yes | |
| price_status | TEXT | no | LIVE/DELAYED/LAST_AVAILABLE/MANUAL |
| provider | TEXT | yes | |
| is_demo | INTEGER | no | |

## Holdings

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| account_id | INTEGER FK | yes | → accounts |
| security_id | INTEGER FK | no | → securities |
| quantity | TEXT | no | stored as string (unbounded) |
| cost_basis_minor | INTEGER | no | |
| currency | TEXT | no | |
| is_demo | INTEGER | no | |

## Consents

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| provider | TEXT | no | |
| fi_type | TEXT | no | |
| purpose | TEXT | no | |
| status | TEXT | no | pending/approved/rejected/expired/revoked |
| external_ref | TEXT | yes | |
| approved_at / expires_at / revoked_at | TEXT | yes | |

## SyncRuns

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| provider | TEXT | no | |
| status | TEXT | no | |
| started_at / finished_at | TEXT | yes | |
| records_processed | INTEGER | no | |
| errors | TEXT | yes | JSON |

## AiConversations / AiMessages

- `ai_conversations(id, user_id, title, created_at, updated_at)`
- `ai_messages(id, conversation_id FK, role IN (user,assistant,tool,system), content, tool_calls JSON, created_at)`

## Snapshots

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| as_of | TEXT | no | |
| total_assets_minor / total_liabilities_minor / net_worth_minor | INTEGER | no | |
| data | TEXT | yes | JSON breakdown |

## Notifications

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | |
| type / title / body | TEXT | no/yes | |
| severity | TEXT | no | info/warn/error |
| read | INTEGER | no | |
| created_at | TEXT | no | |

## AuditLog

| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | yes | |
| action | TEXT | no | |
| detail | TEXT | yes | |
| ip | TEXT | yes | |
| created_at | TEXT | no | |

## Reconciliation

### reconciliation_runs
| Field | Type | Null | Notes |
| ----- | ---- | ---- | ----- |
| id | INTEGER PK | no | |
| user_id | INTEGER FK | no | → users |
| as_of | TEXT | no | |
| account_id | INTEGER FK | yes | → accounts |
| source_balance_minor | INTEGER | yes | provider-reported |
| expected_balance_minor | INTEGER | yes | local |
| net_worth_difference_minor | INTEGER | yes | |
| status | TEXT | no | MATCHED/DIFFERENCE/MISSING_SOURCE_DATA/MISSING_LOCAL_DATA/DUPLICATE/REQUIRES_REVIEW |
| summary | TEXT | yes | |
| correlation_id | TEXT | yes | |
| created_at | TEXT | no | |

### reconciliation_items
`id, run_id FK, kind, transaction_id, description, amount_minor, direction, status, created_at`

## Scheduler

### jobs
`id, user_id FK(NULL=global), name, schedule, status, last_run_at, next_run_at, last_duration_ms, attempts, max_attempts, error, correlation_id, created_at, updated_at`. Unique `(user_id, name, schedule)`.

## Ingestion

### ingestion_runs
`id, user_id, format, file_name, status, total_records, created_records, skipped_records, failed_records, duplicates, error, summary, correlation_id, created_at`.

### raw_ingest
`id, user_id, ingestion_run_id FK, source, payload, payload_kind, hash, created_at`. Stores raw payload (hashed) for audit/replay.

## Notifications & preferences

### notification_preferences
`id, user_id, type, enabled, threshold_minor, min_severity, created_at, updated_at`. Unique `(user_id, type)`.

`notifications` gained `source`, `dismissed`, `data`.

## Market data history

### market_price_history
`id, security_id FK, price_minor, currency, price_status, provider, observed_at`. Unique `(security_id, observed_at)`.

## Security

### password_resets
`id, user_id, token_hash, expires_at, used, created_at`. Unique `token_hash`.

### login_attempts
`id, identifier, success, ip, created_at`. Indexed `(identifier, created_at)`.

## Migration metadata

### schema_migrations
`id, name, applied_at`. The migration runner (`server/db/migrations.js`) applies numbered, idempotent migrations on startup.

## Lifecycle notes

- Deleting an `Account` does **not** delete its transactions; it sets `account_id = NULL` (history retained).
- Deleting a `Security` cascades to its `Holdings`.
- Deleting a user cascades to all owned records (personal single-user app).
- Amounts are always integer minor units; currency is stored per record.
- Migrations are forward-only and idempotent; the schema is created then upgraded by `server/db/migrations.js`.
