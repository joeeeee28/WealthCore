# GOOD-TO-HAVE ENHANCEMENTS

Enhancements not strictly required for parity but which would materially improve WealthCore. Each: user value (1–5), implementation complexity (Low/Med/High), dependency, priority.

| Enhancement | User value | Complexity | Dependency | Priority |
| ----------- | ---------- | ---------- | ---------- | -------- |
| Subscription detection (auto-flag recurring subscriptions) | 5 | Med | none | High |
| Anomaly detection (unusual spending spikes) | 4 | Med | none | Med |
| Cash-flow forecast (income/expense/EMI/SIP/bills over N months) | 5 | Med | none | High |
| Financial health score (categorized %, reconciled %, priced %, stale prices, dupes, missing cost) | 5 | Low | none | High |
| Retirement planner (corpus, monthly need, FIRE) | 5 | Med | none | Med |
| Debt optimization (avalanche vs snowball, payoff plan) | 4 | Med | none | Med |
| Tax-aware insights (ELSS/80C, capital-gains grouping) | 4 | Med | tax rules | Med |
| Portfolio risk score + concentration risk | 4 | Med | price data | Med |
| Emergency-fund health (months of expenses covered) | 5 | Low | none | High |
| Liquidity score | 3 | Low | none | Med |
| Spending-behavior analysis (category trends, weekday/month patterns) | 4 | Med | none | Med |
| Recurring-expense forecast (auto-created recurring items) | 4 | Low | none | Med |
| Net-worth attribution ("why did my net worth change") | 5 | Med | none | High |
| Financial data-health report | 5 | Low | none | High |
| Automatic reconciliation suggestions | 4 | Med | none | Med |
| Intelligent categorization (ML/custom rules) | 3 | High | none | Low |
| AI-generated monthly financial review | 5 | Med | LLM | High |
| AI financial coach (goal nudges, savings tips from real data) | 5 | Med | LLM | High |
| Scenario simulation / what-if analysis (SIP changes, rate changes) | 4 | Med | none | Med |
| Goal probability (likelihood of hitting target by deadline) | 4 | Med | none | Med |
| FIRE planning | 3 | Med | none | Low |
| Insurance tracking (policies, premiums, cover) | 3 | Low | none | Med |
| Bill tracking & reminders | 4 | Low | none | High |
| Subscription-cancellation insights (what you pay annually) | 4 | Low | none | Med |
| Merchant intelligence (normalize merchant names, group variants) | 3 | Med | none | Med |
| Financial calendar (EMI/due/SIP dates) | 4 | Low | none | High |

## Note on ordering
The highest-value, lowest-dependency items to implement first (beyond the P0 currency fix):
1. **Financial data-health score** (cheap, huge trust value).
2. **Cash-flow forecast** and **calendar**.
3. **Net-worth attribution** ("why did it change") — pairs with fix MF-09.
4. **Emergency-fund health**.
All of these use existing data (transactions, holdings, goals, budgets) — no external dependency.
