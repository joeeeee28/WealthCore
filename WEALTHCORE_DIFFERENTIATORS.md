# WEALTHCORE DIFFERENTIATORS

Capabilities that make WealthCore **materially better than FinBoom** (which is manual-import-first). These are grounded in what WealthCore already does well plus the highest-value additions.

## Already present (confirmed in code)

1. **Automated ingestion framework** — Connector → Raw ingestion → Validation → Normalisation → Deduplication → Classification → Persistence (CSV/JSON/bank/Zerodha/Groww), with preview, column mapping, per-item failed-report, and **idempotent re-import**. FinBoom is manual/upload-first; WealthCore is ingestion-first with a real pipeline.

2. **Reconciliation subsystem** — compares a provider/source balance vs local balance, classifies `MATCHED / DIFFERENCE / MISSING_SOURCE_DATA / MISSING_LOCAL_DATA / DUPLICATE / REQUIRES_REVIEW`, persists history, and **never hides a difference**. Not present in FinBoom.

3. **Background scheduler** — daily/monthly/interval jobs (consent expiry, market refresh, notification evaluation, monthly net-worth snapshot, reconciliation scan) with retries + exponential backoff and `jobs` status. FinBoom does not automate this.

4. **Honest integration state** — AA (`READY_FOR_CONFIGURATION`), market (`READY_FOR_CONFIGURATION`), AI (`LLM_NOT_CONFIGURED`) are truthfully represented; no fake LIVE. This is a trust differentiator.

5. **Single source of truth** for net worth / portfolio across dashboard, reports, snapshots, AI — enforced (modulo the currency-mixing bug, which is the honest caveat).

6. **Deterministic financial engine** — all calculations closed-form/solver; **no LLM computes money**. Transparency + correctness.

7. **Privacy-first** — local SQLite, no telemetry/scripts, full export, revoke-connections, delete-all, redacted structured logs.

## Proposed (highest-value, from the gap list)

8. **AI Financial Copilot (explainable)** — natural language "Why did my expenses increase?" / "What changed in my portfolio?" / "Which goals are at risk?" / "How much can I safely invest this month?" backed by **real** tool calls and a deterministic engine, with every answer traceable to a data source + date range + calculation + freshness. (Requires the real LLM tool-calling loop + the compare/why fixes.)

9. **Financial Data Health** —
   ```
   WealthCore Data Health  87 / 100
   Transactions categorized   98%
   Accounts reconciled        94%
   Investments priced         91%
   Stale prices                 3
   Duplicate transactions      0
   Missing cost basis          2
   ```
   This single score builds more trust than FinBoom's dashboard.

10. **Net-Worth Attribution** — explain exactly why net worth changed (income − spending as expected, plus investment P&L, plus asset revaluation). FinBoom shows a trend but not the "why".

11. **Automated Reconciliation with explanations** — detect and explain mismatches rather than just reporting a difference.

12. **Predictive Cash Flow** — forecast income, expenses, EMI, SIP, bills and cash balance over the next N months so the user can plan.

13. **Explainable AI provenance** — every AI financial answer includes `source`, `date range`, `formula`, `freshness`.

## Positioning
WealthCore's differentiators are **automation, integrity, honesty, and intelligence**, not visual polish or feature breadth. The fastest path to exceeding FinBoom is: (a) fix the multi-currency correctness bug, (b) add the data-health score + net-worth attribution, (c) wire a genuinely LLM-backed explainable copilot.
