# OPERATIONS RUNBOOK

## Start / stop

```bash
npm install
npm run dev          # start (port 8080 by default, binds 0.0.0.0)
# or
NODE_ENV=production WEALTHCORE_SESSION_SECRET=... WEALTHCORE_ENCRYPTION_KEY=... npm start
```

Stop: send `SIGTERM`/`SIGINT` (the process closes the DB and exits). Logs go to stdout.

## Health & readiness

- `GET /api/v1/health` — liveness (`{status, service, version, uptime}`).
- `GET /api/v1/ready` — readiness with per-component status (`database`, `aa`, `market`, `llm`). An optional provider being unavailable does **not** make the app un-ready.

## Configuration

Config is read from environment variables (see `.env.example`). In production the app fails fast if required secrets are missing (`npm run config:check`). Manage config via the platform's secret store or `.env`.

## Scheduled jobs

The scheduler (enabled unless `WEALTHCORE_SCHEDULER_ENABLED=false`) runs background jobs. View status:
- `GET /api/v1/jobs` — status, attempts, last/next run.
- `POST /api/v1/jobs/<name>/run` — trigger a job.

Jobs: `expire-consents`, `market-refresh`, `notify-evaluate`, `monthly-networth-snapshot`, `reconciliation-scan`. Failures apply exponential backoff and are recorded in `jobs.error`.

## Migration & data

- Migrations run automatically on startup (idempotent). To inspect applied migrations: `SELECT * FROM schema_migrations;`
- Database file: `data/wealthcore.db` (SQLite) by default; set `WEALTHCORE_DB` or `WEALTHCORE_DB_URL` (Postgres).

## Backup

- `GET /api/v1/export.json` (full data) — recommended daily.
- Or copy the SQLite file (`data/wealthcore.db`). For Postgres use `pg_dump`.

## Common operational tasks

- **Rotate session secret**: set a new `WEALTHCORE_SESSION_SECRET` (32+ chars) and restart; existing sessions remain valid (they are DB tokens), new CSRF signatures use the new secret.
- **Load sample data**: Settings → Load sample data (clearly-labelled MANUAL/SANDBOX).
- **Reset demo**: stop the app, delete `data/wealthcore.db`, restart, run Setup.

## Monitoring

- Watch `/ready` for component state.
- The structured logger emits `http`, `job_completed`, `job_failed`, `server_error` events. In production set `WEALTHCORE_LOG_JSON=true` to get JSON lines for ingestion.
- The `audit` API (`GET /api/v1/audit`) records user actions for review.
