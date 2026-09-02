# DISASTER RECOVERY

## Recovery objective (RPO / RTO)

For a personal financial app, data loss is the primary risk. Aim: RPO ≤ daily (backups), RTO ≤ a few minutes (restore from export or DB file).

## What to back up

1. **Full data**: `GET /api/v1/export.json` (accounts, transactions, securities, holdings, goals, budgets, categories, consents, reconciliation runs, notifications, snapshots, audit). This is the most reliable, human-readable backup and can re-create the dataset.
2. **Database snapshot**: copy `data/wealthcore.db` (SQLite). For Postgres, `pg_dump`.

## Restore procedure

### From JSON export
The JSON export is a full data dump. A restore tool is documented here as intended usage: import the JSON via the ingestion/API to recreate records. (A one-shot restore CLI is a planned enhancement; the export format is stable.)

### From DB snapshot
1. Stop the app.
2. Replace `data/wealthcore.db` (and any `-wal`/`-shm`) with the backup.
3. Start the app — migrations run automatically and are idempotent.

## Failure scenarios

| Failure | Detection | Resolution |
| ------- | --------- | ---------- |
| DB corrupt / won't open | App fails to start or `/ready` reports db unavailable | Restore from DB snapshot; if unavailable, restore from JSON export |
| Accidental data deletion | User action logged in `audit`; `/privacy/delete-data` | Restore from backup |
| Lost provider credential | `/ready` shows provider not_configured | Re-supply credentials via env |
| Scheduler job repeatedly failing | `jobs.error`, `job_failed` logs | Inspect the job; fix provider/credentials; it retries with backoff |
| Migration failed | Startup throws | Restore pre-migration DB; report the migration id; run `schema_migrations` review |

## Preventative measures

- Schedule a daily export (e.g. cron calling `GET /api/v1/export.json` with a token) and store it off-device.
- Keep `data/wealthcore.db` out of anything that auto-syncs without the user's consent (it contains sensitive finance data).
- Document `.env` values; never back up `.env` with real secrets alongside data.
