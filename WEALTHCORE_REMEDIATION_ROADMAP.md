# WEALTHCORE REMEDIATION ROADMAP

Execution phases tied to verification. Each phase lists objectives and acceptance criteria. Scope is limited to issues **actually identified** by the audit (see `WEALTHCORE_DEFECT_REGISTER.md` and `TEST_GAP_ANALYSIS.md`).

## Phase 1 — Critical Financial Correctness (P0)
**Goal:** zero financial-integrity errors.
- D-001: currency-aware valuation + FX (or per-currency segregation); apply in `networth`, `portfolio`, `ai-tools`.
- D-006: fix unpriced-holding validation false-positive.
- **Accept:** P0 tests assert a USD holding does not inflate INR totals; unpriced qty≠1 invariant holds.

## Phase 2 — Data Integrity
- D-008: unique dedup guard (schema + migration).
- D-009: dedup key includes account.
- D-003: real import rollback (guarded by run id + user id).
- **Accept:** re-import and rollback tests pass; no duplicate inserts.

## Phase 3 — FinBoom Parity (user-facing)
- D-005: validate holdings ownership.
- MF-02 realized P&L; MF-07 loan dashboard; MF-11 split; MF-12 clone/bulk; MF-13 broker/security grouping; MF-14 goal sub-targets/projections; MF-15 step-up SIP; MF-16 emergency-fund/retirement; MF-18 annotations; MF-19 budget/goal allocation; MF-20 privacy mode; MF-21 pagination/caching.

## Phase 4 — Automation & Integrations
- AA adapter success path + fixture tests (MF-03).
- Market provider adapter + retry/timeout/error record (D-010) + fixture tests (MF-04).
- Notification types EMI-due/low-balance/portfolio-movement/concentration/unusual-spending (D-021).
- SAFE Excel import + CAS/MFCentral (MF-06, MF-10).
- Scheduler manual-run status fix (D-020).

## Phase 5 — AI
- D-002: fix compare-month anchor.
- Real LLM tool-calling loop over existing `TOOL_SCHEMAS` (MF-05) with `LLM_NOT_CONFIGURED` remain honest.
- "Why"/explainability (MF-09, differentiator #8).
- **Accept:** 3-step chain (spend → compare → why) returns correct, sourced answers.

## Phase 6 — Better-than-FinBoom
- Financial data-health score (#9).
- Net-worth attribution (#10).
- Predictive cash flow (#12).
- Explainable AI provenance (#13).

## Phase 7 — Production
- D-004: adopt repository seam + Postgres adapter + CI matrix.
- At-rest encryption (D-019).
- Cursor pagination + read caching (D-021/MF-21).
- Coverage tooling (`--experimental-test-coverage`) + threshold (G-08).
- Backup/restore CLI; browser-based E2E harness (G-10).

## Do not change (already correct)
- Deterministic financial engine (`calculations.js`) — reference-validated.
- Single-source-of-truth net worth design (fix the currency bug, don't re-derive per surface).
- Auth (scrypt/sessions/app-lock/CSRF/rate-limit/password-reset).
- Honest integration status (never fake LIVE).
- Release-blocking security posture (headers, SQL paramisation, secret/dep scans).
