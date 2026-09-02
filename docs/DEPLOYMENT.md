# DEPLOYMENT

## Local run (development / self-host)

```bash
cd WealthCore
npm install          # installs express, better-sqlite3
npm run dev          # starts on http://0.0.0.0:8080
npm test             # runs the test suite
```

Environment (all optional in dev):
- `PORT` (default `8080`)
- `HOST` (default `0.0.0.0`)
- `WEALTHCORE_DB` (default `./data/wealthcore.db`)

## First run

1. Open the app → **Setup** screen.
2. Create the single user (email + password ≥ 8).
3. Add accounts/transactions/investments, or load clearly-labelled sample data (Settings → Load sample data).

## Health / readiness

- `GET /api/v1/health` → `{ ok: true, service: 'wealthcore' }`.
- `GET /api/v1/config` → shows whether setup is required and AA/market provider state.

## Production recommendations

- Bind behind a reverse proxy with TLS (the app serves plain HTTP).
- Store the token in an httpOnly, SameSite cookie rather than `localStorage` (see `SECURITY.md`).
- Set `WEALTHCORE_AA_*` / `WEALTHCORE_MARKET_*` credentials in the environment (never in source).
- Back up via `GET /api/v1/export.json` or by copying `data/wealthcore.db`.
- Consider SQLCipher / disk encryption for the DB at rest.

## Reset / clean slate

Stop the app and remove the local database:
```bash
rm -f data/wealthcore.db
```
On next launch the Setup screen appears.

## Release notes
See `CHANGELOG.md`.

## v1.1 production configuration

Required in production (fail-fast if missing):
- `NODE_ENV=production`
- `WEALTHCORE_SESSION_SECRET` (32+ chars)
- `WEALTHCORE_ENCRYPTION_KEY` (32+ chars)
- `WEALTHCORE_COOKIE_SECURE=true` (HTTPS behind a proxy)

Optional: `WEALTHCORE_AA_*`, `WEALTHCORE_MARKET_*`, `WEALTHCORE_LLM_*`, `WEALTHCORE_SCHEDULER_ENABLED`, `WEALTHCORE_LOG_JSON`, `WEALTHCORE_DB`/`WEALTHCORE_DB_URL` (Postgres).

Run `npm run config:check` to validate. Migrations run automatically on startup. A reverse proxy with TLS is recommended; the app serves plain HTTP.

See `.env.example` for the full variable reference.
