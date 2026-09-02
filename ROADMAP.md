# WEALTHCORE ROADMAP

## Phase 1 — Foundation ✅
Repository, Express + SQLite stack, auth (scrypt, sessions, app lock), REST API, deterministic calculator engine, net worth/portfolio engines, 41 tests.

## Phase 2 — Financial aggregation 🔄 (mostly done)
- AA/FIU consent lifecycle + provider adapter interface + config validation + correlation IDs + raw-payload store. **Done.**
- Ingestion framework (CSV/JSON/bank/Zerodha/Groww, preview, mapping, dedup, summary, failed report). **Done.**
- Reconciliation engine + API + UI. **Done.**
- Background scheduler (5 jobs, retries/backoff). **Done.**
- AA live retrieval. **△ Need provider credentials.**
- Synchronised monthly snapshots. **△ Via scheduler when enabled.**

## Phase 3 — Investment intelligence 🔄 (mostly done)
- Holdings × price = value; P&L; invariant validation. **Done.**
- Market-data provider interface + `COST_BASIS`/`UNPRICED` + history + stale detection. **Done.**
- Autoprices live. **△ Need market provider key.** FX live rates **△.**

## Phase 4 — Automation 🔄
- Notification engine (14 types, preferences, dismiss). **Done.**
- Auto monthly snapshots, budget/goal evaluation, consent expiry, stale-price warnings. **Done (scheduler).**
- Recurring expense auto-creation. **Pending.**

## Phase 5 — AI 🔄 (core done)
- Real-data tool layer (19 tools), conversation context, no hallucination, no LLM math. **Done.**
- LLM provider interface + `LLM_NOT_CONFIGURED`. **△ Need model key.**
- Broader intent + report generation. **Partial.**

## Phase 6 — Advanced analytics (partial)
- Cash-flow/allocation reports, snapshots. **Done.**
- Financial-health score, inflation-adjusted goals, goal-linked assets. **Pending.**

## Phase 7 — Optimisation (pending)
- Cursor pagination + caching for large histories.
- Durable job queue for multi-instance.
- Backup/restore CLI.

## Continuous
Keep FinBoom parity audit current; re-audit after each change; update BRD/FRD/docs/tests in lockstep.
