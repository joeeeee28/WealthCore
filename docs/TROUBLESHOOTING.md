# TROUBLESHOOTING

## App won't start

- **Production config missing**: start fails with a list of missing vars. Set `WEALTHCORE_SESSION_SECRET`, `WEALTHCORE_ENCRYPTION_KEY`, and `WEALTHCORE_COOKIE_SECURE=true`. Run `npm run config:check`.
- **Port in use**: set `PORT` to a free port.
- **DB locked**: ensure only one instance; on SQLite WAL, the `-wal`/`-shm` files must be writable.

## Login / authentication

- **401 Invalid credentials**: check email/password. After 3 failed attempts within 15 min, login is rate-limited (429). Wait or reset via the password-reset flow.
- **APP_LOCKED (423)**: the app is PIN-locked. Unlock with the PIN (or sign out in the lock screen).
- **CSRF_INVALID (403)**: mutating cookie-authenticated requests require the `X-CSRF-Token` header. Use `/auth/csrf` to fetch a token (bearer-authenticated requests do not need CSRF).

## Dashboard shows wrong numbers

- Ensure net worth/portfolio come from the single source of truth (`computeNetWorth`/`computePortfolio`). Refresh the page; if data was just imported, take a net-worth snapshot.
- Unpriced holdings are shown at cost and flagged; add a manual price to value them.

## Reconciliation differences

- Reconciliation compares the provider-reported `source_balance_minor` against the local `balance_minor`. If no source balance is set, status is `MISSING_SOURCE_DATA`. Resolve from the Reconciliation screen (adopt source or record for review). Differences are **never** auto-hidden.

## Import failures

- Format must be one of the supported connectors (`GET /api/v1/ingest/connectors`). Rows missing a valid date or amount are reported as failed records, not silently dropped. Importing the same file twice is idempotent (duplicates counted, not inserted).

## AI doesn't answer precisely

- The assistant is offline-deterministic unless an LLM provider is configured (`/ai/status` → `LLM_NOT_CONFIGURED`). It supports net worth, balances, spending, income, portfolio, holdings, goals, budgets, reconciliation, data freshness, consents and calculators. It never invents figures.

## Market prices / AA never LIVE

- By design nothing is `LIVE` without a configured provider. `/market/status` shows the state; `/aa/status` shows `READY_FOR_CONFIGURATION`. Supply credentials to go live.

## Notifications not appearing

- Notifications are created by evaluating rules (`POST /notifications/evaluate` or the scheduler's `notify-evaluate` job). Each type has a preference toggle. Check preferences.

## Jobs not running

- Confirm `WEALTHCORE_SCHEDULER_ENABLED` is true (default). Jobs are scheduled to run daily/monthly/interval; `GET /api/v1/jobs` shows next run. Trigger manually with `POST /api/v1/jobs/<name>/run`.
