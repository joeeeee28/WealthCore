# UAT — USER ACCEPTANCE TESTING

These are real personal workflows a user performs, with the expected outcome in WealthCore.

## Workflows

### U-01 — Set up WealthCore
1. Open the app → Setup screen.
2. Enter name/email/password (8+) → **Create**.
**PASS:** single user created, default categories seeded, dashboard appears.

### U-02 — Sign in
**PASS:** valid credentials → dashboard; invalid → `Invalid email or password`.

### U-03 — Connect / add a bank account
**PASS:** Add account → type savings, balance, institution → saved; appears in Accounts and Dashboard; net worth updates.

### U-04 — Verify dashboard position
**PASS:** Net worth = assets − liabilities; savings rate = (income−expense)/income; allocation donut reflects accounts + holdings.

### U-05 — Review & categorize transactions
**PASS:** Add a transaction with a merchant → auto-categorized; editable; appears in the month's list.

### U-06 — Add a liability
**PASS:** Add a credit card/loan (is_liability) → counted in liabilities; net worth decreases accordingly.

### U-07 — Add investments & verify holdings
**PASS:** Add a security (with a manual/status price) + a holding → portfolio shows quantity, cost, value, P&L, and the invariant check.

### U-08 — Calculate net worth
**PASS:** Net Worth screen shows assets, liabilities, net worth, and snapshots; records a snapshot on demand.

### U-09 — Create a budget
**PASS:** Budget per category → shows budget vs spent and an over/under indicator.

### U-10 — Create a goal
**PASS:** Goal with target/current → shows progress; can update progress.

### U-11 — Ask the AI
**PASS:** "How much did I spend this month?" → real total; "How much was food?" → food total; "Compare that with last month." → comparison; all from real data, with tool names shown.

### U-12 — Check integrations
**PASS:** Integrations shows `READY_FOR_CONFIGURATION` for AA (provider credentials required); consents can be created/approved in the state machine; market data shows honest status.

### U-13 — Generate a report
**PASS:** Reports → cash flow by month and net-worth trend.

### U-14 — Export data
**PASS:** Settings → Export JSON/CSV downloads a file with the user's data.

### U-15 — Lock the application
**PASS:** Set a PIN → Lock → all screens block with `APP_LOCKED`; unlock with the PIN.

### U-16 — Sign out
**PASS:** Sign out → returns to the login screen; session revoked.

## Sign-off criteria
- All workflows above complete without error.
- Financial figures are internally consistent and match the deterministic engine.
- No fake LIVE/real-time status anywhere.
- The AI never returns a number it did not compute from real data.

## v1.1 added UAT workflows

### U-17 — Reconcile an account
**PASS:** Reconciliation screen shows source vs local balance, status (MATCHED/DIFFERENCE/MISSING_SOURCE_DATA), a numeric difference when present, and a Resolve action (adopt source balance or record for review). Differences are never auto-hidden.

### U-18 — Import transactions (CSV)
**PASS:** Import → paste CSV → Preview shows parsed rows → Import returns created/duplicates/failed counts; re-importing the same file does not duplicate.

### U-19 — Evaluate notifications
**PASS:** Notifications → Evaluate now creates alerts; preferences can toggle types; notifications can be read/dismissed.

### U-20 — View provider / freshness state
**PASS:** Integrations shows AA (`READY_FOR_CONFIGURATION`), market data status, LLM status (`LLM_NOT_CONFIGURED`), and data freshness. Nothing is presented as LIVE without a provider.

### U-21 — Privacy control
**PASS:** Settings → Revoke connections and Delete all data work and are confirmed before running.

### U-22 — Health / readiness
**PASS:** `/health` and `/ready` are publicly reachable; `/ready` shows per-component status and stays available when optional providers are unconfigured.
