# TEST CASES

Each test: `Test ID · Module · Scenario · Precondition · Steps · Expected Result · Actual Result · Status · Severity`.

The first set are fully automated and PASS. The second set are documented scenarios to add.

## Automated test cases (all PASS)

| TC ID | Module | Scenario | Expected | Actual | Status | Sev |
| ----- | ------ | -------- | -------- | ------ | ------ | --- |
| TC-001 | Money | Parse `"250000"` → minor | `25000000` | `25000000` | PASS | P1 |
| TC-002 | Money | Parse `"248500.50"` | `24850050` | match | PASS | P1 |
| TC-003 | Money | Parse invalid `"12x3"` | throws | throws | PASS | P1 |
| TC-004 | Money | Format ₹ Cr / L grouping | `₹2.08 Cr`, `₹2.48L` | match | PASS | P2 |
| TC-005 | Calc | EMI 5L @8.5%/240mo | `4339.1162` | match | PASS | P0 |
| TC-006 | Calc | SIP FV start/end of period | `128093.28` / `126825.03` | match | PASS | P0 |
| TC-007 | Calc | FD quarterly | `138041.98` | match | PASS | P0 |
| TC-008 | Calc | CAGR | `14.471424%` | match | PASS | P0 |
| TC-009 | Calc | XIRR `-1000 → +1500` | `49.833918%` | match | PASS | P0 |
| TC-010 | Calc | Amortization ends at 0 | balance 0 | match | PASS | P0 |
| TC-011 | Calc | Savings rate / debt ratio | exact | match | PASS | P2 |
| TC-012 | Txn | Categorize merchants | Groceries/Salary/Dining/etc. | match | PASS | P1 |
| TC-013 | Txn | Validate invalid transaction | error list | errors | PASS | P1 |
| TC-014 | Txn | Dedup key stable & distinct | stable/varies | match | PASS | P1 |
| TC-015 | Txn | Transfer detection | paired in/out | match | PASS | P1 |
| TC-016 | Txn | Recurring detection | group equal merchant+amount | match | PASS | P1 |
| TC-017 | NW | assets − liabilities = net worth | exact | match | PASS | P0 |
| TC-018 | Pf | qty × price = value + P&L | exact + invariant | match | PASS | P0 |
| TC-019 | Pf | Unpriced security flagged | priceMissing, MANUAL | match | PASS | P1 |
| TC-020 | AI | "What is my net worth?" | get_net_worth + ₹ | match | PASS | P0 |
| TC-021 | AI | "How much did I spend this month?" | get_monthly_expenses | match | PASS | P0 |
| TC-022 | AI | Context food → compare last month | correct months | match | PASS | P0 |
| TC-023 | AI | Unknown intent → suggestion, no number | suggestion | match | PASS | P1 |
| TC-024 | API | Setup / login / dashboard | 200 + data | match | PASS | P0 |
| TC-025 | API | Duplicate transaction rejected | 400 DUPLICATE | match | PASS | P1 |
| TC-026 | API | Invalid transaction rejected | 400 INVALID_TRANSACTION | match | PASS | P1 |
| TC-027 | API | EMI calculator endpoint | 4339.12 | match | PASS | P0 |
| TC-028 | API | AI endpoint over real data | ₹ + tool list | match | PASS | P0 |
| TC-029 | API | AA status honest | READY_FOR_CONFIGURATION | match | PASS | P0 |
| TC-030 | API | Export JSON + CSV | data & header | match | PASS | P1 |
| TC-031 | API | App lock blocks data routes | 423 | match | PASS | P1 |
| TC-032 | API | Unlock with wrong PIN | 401 | match | PASS | P1 |
| TC-033 | API | Unauthenticated dashboard | 401 | match | PASS | P0 |

## Negative / edge scenarios (implemented + to expand)

| TC ID | Module | Scenario | Expected | Status |
| ----- | ------ | -------- | -------- | ------ |
| TC-101 | Auth | login wrong password | 401 | Implemented |
| TC-102 | Auth | expired session | 401 | Implemented (expiry logic) |
| TC-103 | AA | request data when unconfigured | `FAILED/PROVIDER_NOT_CONFIGURED` + failed sync_run | Implemented |
| TC-104 | AA | revoked consent retrieval | refused | Implemented |
| TC-105 | Market | refresh when unconfigured | `READY_FOR_CONFIGURATION`, no fabricated price | Implemented |
| TC-106 | AI | missing market price | flagged, never LIVE | Implemented |
| TC-107 | Import | corrupted/invalid record | per-item error, not silent | Implemented |
| TC-108 | API | invalid currency | account/transaction currency mismatch error | Implemented |
| TC-109 | DB | duplicate record handling | dedup key rejects | Implemented |
| TC-110 | Network | provider timeout (planned) | graceful failure recorded | Planned |
| TC-111 | DB | schema constraint violation | transaction rolled back | Implemented (PK/FK) |

## Financial calculation reference sources

EMI, SIP, FD, CAGR, XIRR reference values were computed independently in Python (documented in `docs/BRD.md`/`docs/FINAL_AUDIT_REPORT.md` notes). All match within the stated tolerances.

## v1.1 automated tests added (summary)

| TC ID | Module | Scenario | Status |
| ----- | ------ | -------- | ------ |
| TC-201 | Recon | matched balances -> MATCHED, 0 diff | PASS |
| TC-202 | Recon | difference -> DIFFERENCE, numeric diff | PASS |
| TC-203 | Recon | no source -> MISSING_SOURCE_DATA | PASS |
| TC-204 | Recon | run recorded + history queryable | PASS |
| TC-205 | Recon | resolve adopts source balance | PASS |
| TC-206 | Ingest | CSV parse (quotes, commas) | PASS |
| TC-207 | Ingest | debit/credit + signed amount normalise | PASS |
| TC-208 | Ingest | same file twice => 0 create, 2 duplicates | PASS |
| TC-209 | Ingest | same txn different formatting deduplicated | PASS |
| TC-210 | Ingest | distinct monthly payments NOT deduplicated | PASS |
| TC-211 | Ingest | invalid rows reported per-item | PASS |
| TC-212 | Ingest | normalized metadata + source refs | PASS |
| TC-213 | Notif | preferences seeded + toggle | PASS |
| TC-214 | Notif | budget over-spend fires | PASS |
| TC-215 | Notif | consent expiry + large txn fire | PASS |
| TC-216 | Sched | registry has 5 jobs | PASS |
| TC-217 | Sched | notify-evaluate runs safely | PASS |
| TC-218 | Sched | market job honest when unconfigured | PASS |
| TC-219 | Adapter | AA status READY_FOR_CONFIGURATION | PASS |
| TC-220 | Adapter | consent schema + lifecycle | PASS |
| TC-221 | Adapter | requestData -> PROVIDER_NOT_CONFIGURED + failed sync | PASS |
| TC-222 | Adapter | market unconfigured + refresh honest | PASS |
| TC-223 | Adapter | validateQuote + freshness (incl STALE) | PASS |
| TC-224 | Config | production fail-fast on missing secret/key/cookie | PASS |
| TC-225 | Config | partial AA config misconfiguration | PASS |
| TC-226 | Sec | login rate limit (429) | PASS |
| TC-227 | Sec | password reset token + confirm | PASS |
| TC-228 | Sec | CSRF guards cookie auth, bearer skips | PASS |

Total automated: **81**.
