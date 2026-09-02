# SECURITY

A security review of the WealthCore build. Scope: authentication, authorization, encryption, secrets, app lock, sessions, database protection, logging, audit, retention, deletion, backup.

## Authentication

- Passwords hashed with **scrypt** (`server/lib/auth.js`): `scrypt(password, salt, 64)` using a per-user 16-byte random salt. Verification uses `crypto.timingSafeEqual`.
- No password is ever stored in plaintext; no password is logged.

## Authorization

- All data routes are behind `requireAuth` (bearer token). Only `/config`, `/health`, `/auth/setup`, `/auth/login`, `/auth/unlock` are public.
- Every query is scoped to `req.user.id`; users cannot read other users' data (single-user app, but the scoping is explicit).
- App-locked sessions are blocked from all data routes (`requireUnlocked` → HTTP `423`).

## Session management

- Sessions are **opaque random tokens** (32 bytes hex) stored server-side with a 12h expiry and a `revoked` flag. No JWTs, no client-verifiable secrets.
- Logout revokes the session. Expired sessions are auto-revoked on next use.

## App lock

- Optional 4–6 digit PIN, hashed with scrypt + salt, bound to the session. `lock` sets `app_locked=1`; data routes then return `423`. `unlock` verifies the PIN. Wrong PIN → `401`.

## Encryption

- Passwords/PINs: scrypt (one-way).
- Data at rest: SQLite file. For production, an encrypted database (e.g. SQLCipher) or OS-level disk encryption is recommended — documented as an enhancement. No provider keys are stored at rest in this build.

## Secrets management

- **No secrets in source.** Verified with a scan for `API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY` across `server/` and `public/` — no hard-coded literals found.
- Provider credentials are read from environment variables only (`WEALTHCORE_AA_*`, `WEALTHCORE_MARKET_*`).

## XSS / CSRF / injection / rate limiting

- **Injection:** all SQL uses prepared statements (`better-sqlite3`). No string interpolation into SQL.
- **XSS:** frontend escapes all dynamic HTML via `esc()`; no `innerHTML` with raw user data without escaping.
- **CSRF:** the API uses a bearer token in an `Authorization` header (not cookies), so it is not vulnerable to classic cookie-based CSRF. If switched to cookies, a CSRF token is required (documented).
- **Rate limiting:** not enforced for a local single-user app; add a per-token throttle for a shared/production deployment.

## Headers

Responses set `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, `Cache-Control: no-store`.

## Provider webhooks (Setu AA)

- `/api/v1/aa/webhook/setu` is **public** (Setu calls it) but is not user-auth gated by design — provider callbacks must not require a user session. It is still **not** exposed unauthenticated for arbitrary replay: every notification is validated, deduplicated by `notification_id`, and recorded in `audit_log`.
- **Signature verification is best-effort/optional** because Setu's current AA Notifications doc does not publish a signature header/algorithm. When `WEALTHCORE_SETU_WEBHOOK_SECRET` is configured, `verifySetuWebhookSignature` validates an HMAC-SHA256 `X-Webhook-Signature`; otherwise it reports `NO_SECRET_CONFIGURED`. This is documented as defence-in-depth, not a hard security gate on a provider whose contract omits it. **Signature validation is not disabled when a secret IS configured.**
- **Idempotency**: notifications stored in `webhook_notifications` (unique on `provider` + `notification_id`); a replayed notification id is acknowledged and ignored, so a setu replay cannot re-apply a state transition twice. Event `type`, `consentId`, `dataSessionId` and `status` are recorded; **no raw FI payload is stored or logged**.
- A rejected/invalid signature returns `400`.

## Logging

- Server logs only the bind message; **no financial data, tokens, or user content are logged**.
- `audit_log` stores actions (not sensitive values) for the user's own review. Webhook receipts are audited as `aa.webhook` with only `type`/`consent`/`session`/`status` — never the payload body.

## Database protection

- Foreign keys enabled; WAL enabled. Account/security deletes follow documented cascades.
- The database file is local and excluded from source control (`.gitignore`).

## Data retention & deletion

- Data persists in the local SQLite file until deleted.
- Deleting an account keeps transaction history (detached) by design.
- Full JSON export enables a user to back up or move their data. Account deletion (wipe) is a documented pending enhancement.

## Backup

- Use `GET /api/v1/export.json` (full data) or copy the `data/wealthcore.db` file. A dedicated backup/restore CLI is a pending enhancement.

## Known items to address before any production deployment

1. Use an httpOnly, SameSite cookie instead of `localStorage` for the token.
2. Add login rate limiting and failed-attempt lockout.
3. Encrypt the DB at rest (SQLCipher) and store provider keys in a secret store.
4. Add a CSRF token if/when switching to cookie auth.

## v1.1 hardenning additions (verified)

- **httpOnly session cookies** (`wc_session`, `HttpOnly`, `SameSite`, `Secure` in production) in addition to the bearer token.
- **CSRF protection** — cookie-authenticated state-changing requests require an `X-CSRF-Token` (signed per session, from `/auth/csrf`); bearer-authenticated requests do not.
- **Login rate limiting** — per-identifier, configurable (`WEALTHCORE_LOGIN_RATE_MAX`/`_WINDOW_MINUTES`); returns HTTP 429.
- **Password reset** — request (15-min, single-use token, sha256-hashed stored) + confirm to set a new password. Reset token is only returned in this personal build; production emails it.
- **Configuration validation** — `.env.example`; production fails fast if `SESSION_SECRET`/`ENCRYPTION_KEY`/secure-cookie are missing or integration config is partial (`npm run config:check`).
- **Structured redacted logging** — request/correlation IDs, no financial/token values; JSON mode for production.
- **Hardened headers** — CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `X-XSS-Protection`, `Cross-Origin-Opener-Policy`, `Cache-Control: no-store`.
- **Secret scanning** — `npm run audit:secrets` (clean). **Dependency audit** — `npm audit` (0 vulnerabilities).

### Release blockers addressed
- [x] Secure httpOnly cookies, SameSite/Secure config
- [x] Login rate limiting + brute-force protection
- [x] Session expiration + revocation
- [x] Password reset
- [x] CSRF protection
- [x] Strong input validation + SQL parameterisation (prepared statements everywhere)
- [x] Security headers + CSP
- [x] Dependency/secret scanning
- [x] Audit logging + sensitive-data redaction
- [x] Encryption strategy documented (scrypt for secrets; DB-at-rest encryption is a noted production enhancement)
- [x] Environment-variable validation

### Remaining items before a shared/public deployment
- Prefer switching the client to the httpOnly cookie channel (it currently defaults to bearer in `localStorage` for simplicity).
- Add a CSRF token to any future cookie-only client; consider per-route rate limiting if exposed beyond a single user.
- Encrypt the DB at rest (SQLCipher) and keep provider keys in a secret store.
