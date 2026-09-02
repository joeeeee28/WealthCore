# FINBOOM FEATURE PARITY MATRIX

> Direction: FinBoom (https://www.finboom.app/ — personal finance dashboard, net worth, income/expense, 20+ asset classes, goals, snapshots, exports, privacy). WealthCore reproduces capability organically (no code/asset/brand copying) and adds automatic ingestion, reconciliation and background sync.
> Status legend: **COMPLETE** · **PARTIAL** · **MISSING** · **DIFFERENT** · **BETTER** · **N/A** (non-goal).

## Dashboard

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Net worth display | ✓ | `GET /net-worth` + dashboard card | COMPLETE | Currency mixing (P0) | P0 |
| Net worth over time | ✓ | snapshots + line chart | COMPLETE | snapshot via scheduler/on-demand | P2 |
| Total assets | ✓ | `computeNetWorth` | COMPLETE | currency mixing | P0 |
| Liabilities | ✓ | liability accounts | COMPLETE | — | |
| Income | ✓ | monthly in total | COMPLETE | currency mixing | P0 |
| Expenses | ✓ | monthly out total | COMPLETE | currency mixing | P0 |
| Savings rate | ✓ | `savingsRate()` | COMPLETE | — | |
| Cash flow | ✓ | `/reports/cashflow` | COMPLETE | — | |
| Allocation | ✓ | donut by asset class | COMPLETE | currency mixing | P0 |
| Top expenses | ✓ | `topExpenses` | COMPLETE | — | |
| Goals summary | ✓ | progress cards | COMPLETE | no sub-targets | P2 |
| Recent transactions | ✓ | transactions screen | COMPLETE | — | |
| Portfolio summary | ✓ | portfolio card | COMPLETE | currency mixing | P0 |
| Account summary | ✓ | accounts screen | COMPLETE | — | |
| Financial health | ✓ (essentials check) | notification engine only | PARTIAL | no health score | P1 |
| Alerts | ✓ | notification engine | PARTIAL | 8/14 types fire | P2 |
| Data freshness | ✓ (live prices) | `/ready` + Integrations | PARTIAL | no per-entity freshness UI | P2 |

## Transactions

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Manual entry | ✓ | `/transactions` POST | COMPLETE | — | |
| Import | ✓ (CSV/Excel, Zerodha/Groww) | CSV/JSON/Zerodha/Groww | PARTIAL | no Excel/CAS | P1 |
| Search / filter | ✓ | month, direction, account, category, search | COMPLETE | no cursor pagination | P2 |
| Categories | ✓ | auto-categorise + defaults | COMPLETE | — | |
| Transfer detection | ✓ | intelligence endpoint | COMPLETE | — | |
| Recurring detection | ✓ | intelligence endpoint | COMPLETE | no auto-create | P2 |
| Duplicate detection | ✓ | dedup + idempotent import | COMPLETE | dup key not UNIQUE | P2 |
| Bulk operations | ✓ | batch endpoint | PARTIAL | no bulk categorize/delete | P2 |
| Split transaction | ✓ | — | MISSING | — | P2 |
| Clone transaction | ✓ | — | MISSING | — | P3 |
| Edit / delete | ✓ | CRUD | COMPLETE | — | |
| Notes | ✓ | note field | COMPLETE | — | |
| Currency handling | ✓ | per-account | PARTIAL | sums mix currencies | P0 |

## Investments

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Securities / holdings | ✓ | securities + holdings | COMPLETE | — | |
| Broker grouping | ✓ | account grouping only | PARTIAL | no explicit broker view | P2 |
| Security grouping | ✓ | by asset class | PARTIAL | — | P2 |
| Allocation | ✓ | by asset class | COMPLETE | currency mixing | P0 |
| P&L (unrealized) | ✓ | per-holding + portfolio | COMPLETE | currency mixing | P0 |
| P&L (realized) | ✓ (where supported) | — | MISSING | — | P1 |
| Price freshness | ✓ (live) | LIVE/DELAYED/LAST_AVAILABLE/MANUAL/COST_BASIS/UNPRICED | COMPLETE | no provider wired | P0 |
| Investment insights | ✓ | — | MISSING | — | P2 |

## Goals

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Targets | ✓ | target/current | COMPLETE | — | |
| Sub-targets / milestones | ✓ | — | MISSING | — | P2 |
| Progress | ✓ | progress % | COMPLETE | — | |
| Allocation to assets | ✓ | — | MISSING | link assets | P2 |
| Projections | ✓ | — | MISSING | inflation-adjusted | P2 |

## Loans

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| EMI calculation | ✓ | `calculators/emi` + amortization schedule | COMPLETE | — | |
| Principal/interest split | ✓ | amortization schedule | COMPLETE | — | |
| Payoff tracking | ✓ | — | MISSING | — | P2 |
| Loan dashboard | ✓ | — | MISSING | — | P1 |

## Financial Planning

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| SIP | ✓ | `calculators/sip` | COMPLETE | no step-up SIP | P2 |
| Step-up SIP | ✓ | — | MISSING | — | P2 |
| Emergency-fund health | ✓ | — | MISSING | — | P1 |
| CAGR | ✓ | `calculators/cagr` | COMPLETE | — | |
| XIRR | ✓ | `calculators/xirr` | COMPLETE | — | |
| FD | ✓ | `calculators/fd` | COMPLETE | — | |
| EMI | ✓ | `calculators/emi` | COMPLETE | — | |
| Retirement planner | ✓ | — | MISSING | — | P2 |

## Imports

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Bank statements | ✓ | bank-CSV | PARTIAL | no other bank formats | P1 |
| Broker statements | ✓ | Zerodha/Groww | PARTIAL | — | P2 |
| CAS / MFCentral | ✓ | — | MISSING | — | P1 |
| Mutual-fund statements | ✓ | — | MISSING | — | P1 |
| Excel | ✓ | — | MISSING (dependency CVE) | — | P2 |
| Preview/mapping/dedup/report | — | ✓ | BETTER | — | |

## Multi-currency

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Currencies | ✓ (45+) | 7 currency symbols | PARTIAL | — | P2 |
| FX conversion | ✓ (live) | — | MISSING/BROKEN | **values summed without FX** | **P0** |
| Foreign assets | ✓ | supported fields | PARTIAL | currency mixing | P0 |
| Cross-currency transfers | ✓ | — | MISSING | — | P2 |

## Privacy

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Privacy mode | ✓ | — | MISSING | — | P2 |
| Export | ✓ | JSON/CSV | COMPLETE | — | |
| Deletion | ✓ | privacy/delete-data | COMPLETE | — | |
| Local/privacy controls | ✓ | no telemetry, local SQLite | COMPLETE | — | |

## Profiles / Sharing

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Multiple profiles | ✓ (Pro) | — | N/A | single-user non-goal | — |
| Family view | ✓ (Pro) | — | N/A | non-goal | — |
| Shared access | ✓ (Pro) | — | N/A | non-goal | — |

## Notifications

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Notification center | ✓ | `/notifications` | PARTIAL | — | |
| Alerts (budget, large, goal, consent, stale) | ✓ | rule-based | PARTIAL | E/EMI/low-balance etc absent | P2 |
| Recurring reminders | ✓ | — | MISSING | — | P2 |
| Financial events | ✓ | some rules | PARTIAL | — | P2 |

## Historical Data

| Feature | FinBoom | WealthCore | Status | Gap | Priority |
| ------- | ------- | ---------- | ------ | --- | -------- |
| Snapshots | ✓ | `snapshots` | COMPLETE | — | |
| Historical net worth | ✓ | trend chart | COMPLETE | — | |
| Annotations | ✓ | — | MISSING | — | P2 |
| Trend analysis | ✓ | cashflow/allocation | PARTIAL | — | P2 |

## Beyond FinBoom (WealthCore differentiators)

| Feature | Status |
| ------- | ------ |
| Reconciliation (source vs local, never hidden) | **BETTER** (FinBoom has no reconciliation) |
| Automatic ingestion framework with preview/mapping/dedup | **BETTER** |
| Background scheduler (sync, snapshots, notifications) | **BETTER** |
| Honest integration state (never fake LIVE) | **BETTER** |
| Deterministic financial engine (no LLM math) | **BETTER** |

## Parity verdict

WealthCore reaches strong functional parity on the core (dashboard, transactions, investments, planning, privacy) and **exceeds** FinBoom on automation/reconciliation/honest-integrations. The single largest **regression risk** is the **multi-currency defect** (a finance app must not sum across currencies), followed by **no live FX**, **no Excel/CAS import**, **no realized P&L / loan dashboard / health score**, and **AI that is not yet LLM-backed**.
