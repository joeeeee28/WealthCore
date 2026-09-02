# FUNCTIONAL REQUIREMENTS DOCUMENT (FRD)

This FRD describes every functional module of WealthCore. Requirements are identified by `FR-<MODULE>-###`. The format is defined by the full example (`FR-ACCOUNT-001`) and every module below lists its requirements with acceptance criteria.

## Standard requirement template

```text
Requirement ID
Title
Description
Preconditions
Inputs
Processing
Outputs
Business Rules
Validation
Error Conditions
Dependencies
Acceptance Criteria
```

## Module index

`FR-AUTH`, `FR-USER`, `FR-DASHBOARD`, `FR-ACCOUNTS`, `FR-AA`, `FR-CONSENT`, `FR-SYNC`, `FR-TRANSACTIONS`, `FR-CATEGORIES`, `FR-MERCHANTS`, `FR-TRANSFERS`, `FR-RECURRING`, `FR-INCOME`, `FR-EXPENSE`, `FR-BUDGET`, `FR-GOALS`, `FR-INVESTMENTS`, `FR-STOCKS`, `FR-MUTUAL-FUNDS`, `FR-ETF`, `FR-GOLD`, `FR-CRYPTO`, `FR-RETIREMENT`, `FR-REAL-ESTATE`, `FR-LIABILITIES`, `FR-LOANS`, `FR-PORTFOLIO`, `FR-NET-WORTH`, `FR-CASH-FLOW`, `FR-ALLOCATION`, `FR-SNAPSHOTS`, `FR-HEALTH`, `FR-INSIGHTS`, `FR-NOTIFICATIONS`, `FR-SEARCH`, `FR-TAGS`, `FR-IMPORT`, `FR-EXPORT`, `FR-REPORTS`, `FR-CALCULATORS`, `FR-AI`, `FR-SECURITY`, `FR-PRIVACY`, `FR-AUDIT`.

---

## FR-ACCOUNT-001 — Connect / add financial account (detailed example)

**Title:** Connect Financial Account (AA) / Add Account (manual)

**Description:** The user shall be able to connect an eligible financial account through the configured AA/FIU integration, or add an account manually. The account appears in WealthCore with its source recorded.

**Preconditions:** AA integration is configured (or user is authenticated for manual entry).

**Process:**
1. User selects Connect Account.
2. WealthCore initiates a consent request (`POST /api/v1/aa/consent`).
3. User approves the consent (`POST /api/v1/aa/consent/:id/approve`).
4. Financial-institution account information becomes available.
5. WealthCore retrieves the permitted information (`requestFinancialData`) — **live retrieval requires provider credentials; otherwise it reports `FAILED / PROVIDER_NOT_CONFIGURED`.**
6. Data is normalised.
7. Account is created.
8. Dashboard is recalculated.

**Acceptance Criteria:**
```text
Given an authenticated user
When the account is added (manually or via an approved consent)
Then the account should be persisted
And the source should be recorded (manual / provider)
And the AA status should be reflected honestly (never LIVE unless live data retrieved)
And the net worth / dashboard should recalculate from the single source of truth
```

---

## FR-AUTH

- **FR-AUTH-001 — Setup:** Given no user exists, when the user submits email/name/password (8+ chars), then a single user is created, default categories are seeded, and a session token is returned.
- **FR-AUTH-002 — Login:** Given a valid email + password, when the user signs in, then a session token is returned and `last_login_at` is updated; invalid credentials return `401 INVALID_CREDENTIALS`.
- **FR-AUTH-003 — Logout:** When the user signs out, the current session is revoked.
- **FR-AUTH-004 — Session expiry:** Sessions expire after 12 hours; expired sessions are revoked and return `401` on next use.
- **FR-AUTH-005 — App lock PIN:** The user may set a 4–6 digit PIN; locking returns `423 APP_LOCKED` for data routes; unlocking with the wrong PIN returns `401`.

## FR-USER

- **FR-USER-001 — Profile:** The current user's email/name is readable via `GET /api/v1/auth/me`.

## FR-DASHBOARD

- **FR-DASHBOARD-001 — Overview:** `GET /api/v1/dashboard` returns net worth, assets, liabilities, monthly income/expense, savings rate, top expenses, allocation, portfolio snapshot, recent snapshots and notifications — all computed from the single source of truth.

## FR-ACCOUNTS

- **FR-ACCOUNTS-001 — List:** `GET /api/v1/accounts` returns all accounts with balance, type, currency, source and liability flag.
- **FR-ACCOUNTS-002 — Create:** `POST /api/v1/accounts` adds an account (asset or liability) and recalculates the dashboard.
- **FR-ACCOUNTS-003 — Update/Delete:** `PUT`/`DELETE /api/v1/accounts/:id` edit or remove an account; deleting an account detaches its transactions.
- **FR-ACCOUNTS-004 — Validation:** name and type are required; balance must be a valid integer minor unit.

## FR-AA / FR-CONSENT / FR-SYNC

- **FR-AA-001 — Status:** `GET /api/v1/aa/status` returns `READY_FOR_CONFIGURATION` when no provider is configured, and the true `integration/status`.
- **FR-CONSENT-001 — Lifecycle:** `create → approve → reject → revoke → expire` states are modelled in the DB and exposed over the API; only `pending` can be approved/rejected; expired approved consents are auto-marked.
- **FR-CONSENT-002 — Honest retrieval:** `requestFinancialData` returns `FAILED / PROVIDER_NOT_CONFIGURED` (and records a failed `sync_run`) until a real provider is configured; it never fabricates data.
- **FR-SYNC-001 — Sync runs:** `GET /api/v1/sync/runs` returns recent sync attempts, including failed ones (no silent failures).

## FR-TRANSACTIONS / FR-CATEGORIES / FR-MERCHANTS / FR-TRANSFERS / FR-RECURRING / FR-INCOME / FR-EXPENSE

- **FR-TRANSACTIONS-001 — CRUD & filters:** `GET/POST/PUT/DELETE /api/v1/transactions` support month, direction, account, category and search filters.
- **FR-TRANSACTIONS-002 — Validation:** amount > 0, valid date, valid account, `direction in {in,out}`, currency match. Invalid input returns `400 INVALID_TRANSACTION`.
- **FR-TRANSACTIONS-003 — Deduplication:** duplicate transactions (same account/date/amount/direction/ref) are rejected with `400 DUPLICATE`.
- **FR-TRANSACTIONS-004 — Batch:** `POST /api/v1/transactions/batch` adds many transactions and returns per-record results.
- **FR-CATEGORIES-001 — Auto-categorise:** a merchant/note is mapped to a category by rules; default categories are seeded on setup.
- **FR-MERCHANTS-001 — Merchant capture:** merchant text is stored with each transaction.
- **FR-TRANSFERS-001 — Transfer detection:** paired in/out transactions of equal amount/date across accounts are flagged.
- **FR-RECURRING-001 — Recurring detection:** same merchant+amount across ≥2 distinct months is flagged as recurring.
- **FR-INCOME/EXPENSE-001 — Direction semantics:** `direction=in` is income, `direction=out` is expense; magnitude is always positive.

## FR-BUDGET

- **FR-BUDGET-001 — CRUD & progress:** budgets are created per category/monthly; the API returns budget vs spent and percent.

## FR-GOALS

- **FR-GOALS-001 — CRUD & progress:** goals record target/current/currency/deadline and expose progress percentage.

## FR-INVESTMENTS / FR-STOCKS / FR-MUTUAL-FUNDS / FR-ETF / FR-GOLD / FR-CRYPTO / FR-RETIREMENT / FR-REAL-ESTATE

- **FR-INVESTMENTS-001 — Securities:** a security records ticker, name, exchange, asset_class, currency, price, price_status, provider.
- **FR-INVESTMENTS-002 — Holdings:** a holding records quantity, cost_basis, currency, linked account and security.
- **FR-INVESTMENTS-003 — Asset classes:** asset_class supports equity, mutual_fund, etf, gold, silver, crypto, bond, real_estate, fd, other.

## FR-LIABILITIES / FR-LOANS

- **FR-LIABILITIES-001 — Liabilities:** liability accounts (credit, loan) carry an outstanding balance; net worth subtracts them.

## FR-PORTFOLIO

- **FR-PORTFOLIO-001 — Compute:** `GET /api/v1/portfolio` computes per-holding value (qty × price), P&L, and portfolio total; it reports the validation invariant and any unpriced holdings (shown at cost, never faked as live).

## FR-NET-WORTH / FR-CASH-FLOW / FR-ALLOCATION / FR-SNAPSHOTS

- **FR-NET-WORTH-001 — Compute:** `GET /api/v1/net-worth` returns assets − liabilities with an allocation breakdown.
- **FR-NET-WORTH-002 — Single source:** every surface uses the same `computeNetWorth()`.
- **FR-SNAPSHOTS-001 — Record/read:** `POST /api/v1/net-worth/snapshot` and `GET /api/v1/net-worth/snapshots`.
- **FR-CASH-FLOW-001 — Report:** `GET /api/v1/reports/cashflow?year=` returns 12 months of income/expense.
- **FR-ALLOCATION-001 — Report:** `GET /api/v1/reports/allocations` returns breakdown by asset class/type.

## FR-HEALTH / FR-INSIGHTS / FR-NOTIFICATIONS

- **FR-INSIGHTS-001 — Savings rate & allocation:** the dashboard exposes savings rate and allocation (health score/essentials check is a pending enhancement).
- **FR-NOTIFICATIONS-001 — List/read:** `GET /api/v1/notifications` and `POST /api/v1/notifications/read`.

## FR-SEARCH / FR-TAGS

- **FR-SEARCH-001 — Filter:** transactions support merchant/note search and structured filters.
- **FR-TAGS-001 — (pending):** tag model is not yet implemented.

## FR-IMPORT / FR-EXPORT / FR-REPORTS

- **FR-IMPORT-001 — JSON import:** `POST /api/v1/import` inserts transactions via the normal validation/dedup path.
- **FR-EXPORT-001 — JSON/CSV export:** `GET /api/v1/export.json` and `/export.csv`.
- **FR-REPORTS-001 — Cashflow/allocation** as above.

## FR-CALCULATORS

- **FR-CALCULATORS-001 — Deterministic:** EMI, SIP, FD, CAGR, XIRR endpoints are closed-form/solver; results match authoritative reference values.

## FR-AI

- **FR-AI-001 — Real-data answers:** `POST /api/v1/ai/message` returns an answer based only on real DB values from tool calls.
- **FR-AI-002 — No hallucination:** the AI never fabricates numbers; unknown intents return a suggestion and no tool calls.
- **FR-AI-003 — Conversation context:** follow-ups ("how much was food?", "compare that with last month.") resolve from prior turn context.
- **FR-AI-004 — Tool layer:** net worth, balances, spending, portfolio, goals, budgets, consents, sync and history tools.

## FR-SECURITY / FR-PRIVACY / FR-AUDIT

- **FR-SECURITY-001 — Authentication & authorization:** bearer-token auth on all data routes.
- **FR-SECURITY-002 — Password hashing & sessions:** scrypt + server-side sessions.
- **FR-PRIVACY-001 — No telemetry:** no analytics or third-party scripts; minimal, data-free logs.
- **FR-AUDIT-001 — Audit log:** `GET /api/v1/audit` returns the user's audit trail.

## v1.1 functional requirements added

- **FR-RECONCILE-001** — Reconciliation: given connected accounts, the user can run a reconciliation that compares the provider-reported source balance against the local balance, classifies the result (`MATCHED / DIFFERENCE / MISSING_SOURCE_DATA / MISSING_LOCAL_DATA / DUPLICATE / REQUIRES_REVIEW`), records history, and never hides differences.
- **FR-RECONCILE-002** — Manual resolution: the user can adopt the source balance or record the difference for review; both are audited.
- **FR-SCHEDULER-001** — Background jobs: expire consents, refresh market data, evaluate notifications, monthly net-worth snapshot and reconciliation scan run off the request path with retries/backoff and status reporting (`/jobs`).
- **FR-INGEST-001** — Ingestion: CSV/JSON/bank/Zerodha/Groww connectors validate, normalise, deduplicate, classify and persist records with source metadata, a preview, a summary and a failed-record report; re-import is idempotent.
- **FR-NOTIF-001** — Notification engine: evaluates 14 event types, honours per-type preferences and severity, supports read/unread and dismissal.
- **FR-AUTH-RATE-001** — Login rate limiting returns HTTP 429 after too many failures.
- **FR-AUTH-RESET-001** — Password reset via a single-use, expiring token.
- **FR-AUTH-CSRF-001** — Cookie-authenticated mutations require a valid CSRF token.
- **FR-MARKET-001** — Prices classified as LIVE/DELAYED/LAST_AVAILABLE/MANUAL/COST_BASIS/UNPRICED; stale detection; history.
- **FR-AA-001** — AA provider adapter interface with config validation, correlation IDs, raw-payload store and honest `PROVIDER_NOT_CONFIGURED`.
- **FR-AI-LLM-001** — AI provider interface with `LLM_NOT_CONFIGURED` status; offline-deterministic fallback.
- **FR-HEALTH-001** — `/health` (liveness) and `/ready` (readiness with database/AA/market/LLM component status).
- **FR-PRIVACY-001** — Revoke connections and delete all data.
