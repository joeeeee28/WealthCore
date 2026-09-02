# DEFECT MANAGEMENT LOG

Severity: **CRITICAL** · **HIGH** · **MEDIUM** · **LOW**. No known unresolved CRITICAL/HIGH defects remain.

## Resolved during the production-readiness pass

| ID | Severity | Component | Description | Root cause | Fix | Regression test | Status |
| -- | -------- | --------- | ----------- | ---------- | --- | --------------- | ------ |
| D-101 | HIGH | Scheduler | `isDue` called `.getTime()` on a number → `now.getTime is not a function` on first tick | `now` was `Date.now()` (number), wrongly treated as a Date | Compare with the ms number directly | scheduler test | ✅ Fixed |
| D-102 | HIGH | Market data | `priceFreshness` returned `LAST_AVAILABLE` regardless of age, never marking stale | Status check returned before age check | Check age for `LAST_AVAILABLE`; return `STALE` > 24h | adapters test | ✅ Fixed |
| D-103 | HIGH | Ingestion | Importing the same file created duplicates (dedup failed) | Connectors did not pass `defaultAccountId`, so records had no account | Pass defaultAccountId to normaliseRecord | ingest tests | ✅ Fixed |
| D-104 | MEDIUM | Ingestion | Row direction inferred from amount sign overwrote an explicit `direction` column | Ordering bug: explicit direction not honored | Respect explicit direction; infer only when absent | ingest tests | ✅ Fixed |
| D-105 | MEDIUM | Ingestion | Malformed rows silently dropped, hiding import failures | normaliseRecord returned null and parse discarded them | Connectors return `failed[]`; counted in summary + failed-record report | ingest tests | ✅ Fixed |
| D-106 | MEDIUM | Auth | Login rate limiting never triggered (timestamp format mismatch) | `datetime('now')` (space) vs ISO `toISOString()` (T) string comparison | Store `created_at` in ISO in login_attempts | security test | ✅ Fixed |
| D-107 | LOW | AI | "How is reconciliation looking?" not recognized | `\breconcil\b` required a word boundary after "reconcil" | Match the `reconcil` prefix | ai-agent / manual | ✅ Fixed |
| D-108 | LOW | AI | "List my holdings" routed to portfolio (tool unused) | holdings branch ordered after portfolio | Recognize holdings before portfolio | manual / manual | ✅ Fixed |

## Open / known limitations (not blocking)

| ID | Severity | Component | Effect | Planned fix |
| -- | -------- | --------- | ------ | ----------- |
| D-201 | HIGH | AA/market/LLM | Live data unavailable without credentials | Provision credentials (adapter ready) |
| D-202 | MEDIUM | Import | Excel (.xlsx) unsupported | Vendor a safe parser |
| D-203 | MEDIUM | Performance | No cursor pagination/caching for large histories | Add pagination + cache |
| D-204 | LOW | Scheduler | In-process single-instance | Durable queue for multi-instance |

## Severity policy
- CRITICAL: data loss / security breach — none unresolved.
- HIGH: core workflow broken or blocked — all resolved; the only remaining HIGH-class items are credential-blocked integrations (not defects).
- MEDIUM/LOW: documented.
