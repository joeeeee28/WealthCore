# AI ARCHITECTURE

## Principles

- **No hallucinated data.** The AI answers only from real database values.
- **No LLM financial math.** All numbers come from deterministic engines (`server/lib/calculations.js`, `networth.js`, `portfolio.js`).
- **Transparent provider.** Default is an offline, rule-based resolver. An LLM path can be enabled via provider config using the same tool schemas.

## System architecture

```text
User message
   → resolvePlan(text, context)      (offline intent+entity resolver)
        OR
   → LLM function-calling (when provider configured; offers TOOL_SCHEMAS)
   → executeToolCall(db, user, tool, args)   ← reads REAL data
        → deterministic engines (networth / portfolio / transactions / goals / budgets / consents / sync)
   → composeAnswer(plan, results)   ← builds the reply from returned data only
```

## Tools

Defined in `server/lib/ai-tools.js` and registered in `TOOLS`:

`get_net_worth`, `get_accounts`, `get_account_balance`, `get_transaction_total`, `get_portfolio`, `get_monthly_expenses`, `get_goals`, `get_budgets`, `get_consent_status`, `get_sync_status`, `get_net_worth_history`.

Each tool takes `(db, userId, args)` and returns real figures plus a `_display` string. The `TOOL_SCHEMAS` array is the JSON-schema contract offered to an LLM.

## Context management

`server/lib/ai-agent.js` keeps per-conversation context:
- `lastPeriod` — resolved month from the prior turn (`"this month"` → `2026-08`).
- `lastEntity` — entity just asked about (e.g. `"food"`).
- `lastMetric` — metric type (spend / net_worth / portfolio / ...).
- `lastValue` — last returned value.

### Example continuity

```
User: How much did I spend this month?      → get_monthly_expenses(month=2026-08)
User: How much was food?                    → get_transaction_total(month=2026-08, category=food)   [uses lastPeriod]
User: Compare that with last month.        → get_transaction_total(2026-08) + get_transaction_total(2026-07)
```

## Hallucination prevention

- Resolver only emits known tool calls; unknown intents return a **suggestion** with no tool calls (no invented number).
- The LLM path (when active) is constrained to the provided `TOOL_SCHEMAS`; the agent still executes tool output and composes the answer from those values.
- Financial calculation boundaries are enforced: the agent **never** computes P&L/XIRR etc. It calls the engines.

## Permissions & data access

- All tools are scoped to the authenticated `userId` and the request `db` instance.
- No tool returns data outside the user's own records.

## Auditability

Every AI turn is persisted (`ai_messages` with role, content and `tool_calls` JSON) and written to `audit_log`.

## Failure handling

- Unknown intent → suggestion.
- Tool error → surfaced as a message, no partial/incorrect number.
- Missing provider → `provider: 'offline-deterministic'` returned; `llmConfigured` indicates whether a real model is wired.

## Current state

Provider = `offline-deterministic` (no model key configured). The function-calling tool schemas are ready; wiring a real model only requires setting the provider env vars and implementing the chat-completion call in `runPlan`'s LLM branch.

## v1.1 — provider interface & expanded tools

### LLM provider
- `llmProviderConfig()` and `llmStatus()` (in `server/lib/ai-agent.js`) read `WEALTHCORE_LLM_PROVIDER`/`_API_KEY`/`_BASE_URL`/`_MODEL`.
- When configured, the agent can present `TOOL_SCHEMAS` to a model and execute returned function calls against the same real data. When not configured, `/ai/status` returns `LLM_NOT_CONFIGURED` and the offline-deterministic resolver is active — it never pretends to be live.
- The LLM **never computes** financial figures; all values come from the deterministic engines.

### Tool registry (19 tools)
`get_net_worth`, `get_accounts`, `get_account_balance`, `get_transaction_total`, `get_portfolio`, `get_monthly_expenses`, `get_goals`, `get_budgets`, `get_consent_status`, `get_sync_status`, `get_net_worth_history`, `get_income`, `get_expenses`, `get_budget`, `get_holdings`, `get_market_price`, `get_reconciliation`, `get_data_freshness`, `compare_periods`, `calculate`.

### Intent coverage
net worth, history, balances, accounts, spending, income, portfolio, holdings, budgets, goals, consents, sync, reconciliation, data freshness, market price, calculators (emi/sip/fd/cagr/xirr), compare periods.

### Context & follow-ups
`lastPeriod`/`lastEntity`/`lastMetric`/`lastValue` persist per conversation (reconstructed from history). Follow-ups like "how much was food?" and "compare that with last month." resolve the correct period/entity.
