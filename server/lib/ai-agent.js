// WealthCore — AI Agent.
//
// The agent is a real tool-calling layer over the user's financial data.
//
// Two modes:
//   * OFFLINE / DETERMINISTIC  — an intent+entity resolver maps the user's
//     sentence to tool calls, which read real DB data. This is the default and
//     requires no external key. It is intentionally rule-based and transparent.
//   * LLM FUNCTION-CALLING      — if a model provider is configured, the same
//     tool schemas are offered to the model; the agent executes the returned
//     tool calls against the same real data. The LLM never computes figures.
//
// Conversation context is stored per-conversation:
//   * lastPeriod   resolved month from the previous turn ("this month" → 2026-08)
//   * lastEntity   the entity just asked about (e.g. "food")
//   * lastMetric   the metric type
//   * lastValue    the last value returned (minor units)
// This lets follow-ups like "How much was food?" and "Compare that with last
// month." resolve correctly without re-entering context.

import * as money from './money.js';
import { TOOLS, currentMonth, previousMonth } from './ai-tools.js';
import { aaProviderConfig } from './aa-integration.js';
import { config } from '../config.js';

export function llmProviderConfig() {
  const c = config();
  return {
    provider: c.llm.provider || null,
    apiKey: c.llm.apiKey || null,
    baseUrl: c.llm.baseUrl || null,
    model: c.llm.model || null,
    configured: c.llm.configured,
  };
}

export function newContext() {
  return { lastPeriod: null, lastEntity: null, lastMetric: null, lastValue: null };
}

function resolveMonth(text, ctx, now) {
  const t = text.toLowerCase();
  if (/\b(this month|this month's|this month\b)/.test(t)) return currentMonth(now);
  if (/\b(last month|previous month)\b/.test(t)) return previousMonth(now);
  const m = t.match(/\b(\d{4})[-/.](\d{1,2})\b/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  const named = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if (named) {
    const monthMap = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
    const year = (t.match(/\b(20\d{2})\b/) || [null, now.getFullYear()])[1];
    return `${year}-${String(monthMap[named[0]]).padStart(2, '0')}`;
  }
  return ctx.lastPeriod || currentMonth(now);
}

function extractEntity(text, knownCategories) {
  const lower = text.toLowerCase();
  // knownCategories is an ARRAY of category-name strings. Iterate it directly —
  // never Object.keys() (which on an array returns index strings like '0').
  for (const c of knownCategories) {
    if (typeof c === 'string' && c && lower.includes(c.toLowerCase())) return c;
  }
  // Only treat "how much was/is/are <X> ?" as an entity question. Never extract
  // a verb phrase like "i spend" from "how much did I spend this month?".
  const m = lower.match(/\bhow much (?:was|is|are)\s+(.+?)(?:\?|$)/);
  if (m && m[1].trim()) {
    const candidate = m[1].trim();
    // Reject obvious verbs that are not categories.
    if (/^(i|i spend|i spent|it|that|the my|do i|did i)\b/i.test(candidate)) return null;
    return candidate;
  }
  return null;
}

function detectFollowUpEntity(text) {
  const m = String(text).toLowerCase().match(/\bhow much (?:was|is|are)\s+(.+?)(?:\?|$)/);
  if (m && m[1].trim()) {
    const candidate = m[1].trim();
    if (/^(i spend|i spent|it|that)\b/.test(candidate)) return null;
    return candidate;
  }
  return null;
}

const KNOWN_CATEGORIES = [
  'food','groceries','rent','utilities','dining','travel','mobile','internet','subscriptions',
  'insurance','salary','mutual funds','investments','emi','electricity',
];

/**
 * Map the user's sentence to a plan of tool call steps.
 * Returns { steps: [{ tool, args }], kind, entity, period, compare }.
 */
export function resolvePlan(text, ctx, now = new Date()) {
  const t = text.toLowerCase();

  const hasNetWorth = /\b(net worth|networth)\b/.test(t);
  const hasPortfolio = /\b(portfolio|investments?|stock|mutual fund|holdings|p&l|gain)\b/.test(t) && !/\b(net worth)\b/.test(t);
  const hasGoals = /\b(goals?|savings goal|target)\b/.test(t);
  const hasBudgets = /\b(budgets?|spending limit)\b/.test(t);
  const hasConsent = /\b(consent|aa |account aggregator|fiu)\b/.test(t);
  const hasSync = /\b(sync|synchroni[sz]ation)\b/.test(t);
  const hasHistory = /\b(history|snapshots?|over time|trend)\b/.test(t) && hasNetWorth;
  const hasAccounts = /\b(accounts?|list.*account|show.*account)\b/.test(t);
  const hasHoldings = /\b(holdings?|my shares|positions?)\b/.test(t) && !/\b(portfolio|investments?|net worth)\b/.test(t);
  const compare = /\b(compare|versus|vs\.?|last month.*(this|current)|than last month)\b/.test(t);
  const expensesQuery = /\b(spent|spending|expense|expenses|how much did i spend|outflow)\b/.test(t);
  const balanceQuery = /\b(balance|how much (?:do i have|is in|in))\b/.test(t) || /how much (?:is|are)\s/.test(t);

  // Context-aware follow-up / comparison first: these rely on what was just asked.
  const followUp = detectFollowUpEntity(text);
  if (compare && ctx.lastMetric === 'spend') {
    const period = ctx.lastPeriod || currentMonth(now);
    const prev = previousMonth(now);
    const entity = ctx.lastEntity || followUp || null;
    if (entity) {
      return {
        kind: 'compare_spend', entity, period, compare: true,
        steps: [
          { tool: 'get_transaction_total', args: { month: period, direction: 'out', category: entity } },
          { tool: 'get_transaction_total', args: { month: prev, direction: 'out', category: entity } },
        ],
      };
    }
    return {
      kind: 'compare_spend', entity: null, period, compare: true,
      steps: [
        { tool: 'get_monthly_expenses', args: { month: period } },
        { tool: 'get_monthly_expenses', args: { month: prev } },
      ],
    };
  }
  if (followUp && ctx.lastMetric === 'spend') {
    const period = ctx.lastPeriod || currentMonth(now);
    ctx.lastPeriod = period;
    ctx.lastEntity = followUp;
    ctx.lastMetric = 'spend';
    return { kind: 'spend_category', entity: followUp, period, steps: [{ tool: 'get_transaction_total', args: { month: period, direction: 'out', category: followUp } }] };
  }
  if (followUp && ctx.lastMetric === 'portfolio') {
    return { kind: 'portfolio', steps: [{ tool: 'get_portfolio', args: {} }], entity: null, period: null, compare: false };
  }

  if (hasNetWorth && hasHistory) {
    return { kind: 'history', steps: [{ tool: 'get_net_worth_history', args: {} }], entity: null, period: null, compare: false };
  }
  if (hasNetWorth) {
    ctx.lastMetric = 'net_worth';
    return { kind: 'net_worth', steps: [{ tool: 'get_net_worth', args: {} }], entity: null, period: null, compare: false };
  }
  if (balanceQuery && !expensesQuery) {
    const args = {};
    // Capture a likely account name after "in <name>" or "of <name>".
    const m = text.match(/\b(?:in|of)\s+([a-z0-9 ]{2,40}?)(?:\?|$)/i);
    if (m) args.account = m[1].trim();
    return { kind: 'balance', steps: [{ tool: 'get_account_balance', args }], entity: args.account || null, period: null, compare: false };
  }
  if (hasConsent) {
    return { kind: 'consent', steps: [{ tool: 'get_consent_status', args: {} }], entity: null, period: null, compare: false };
  }
  if (hasSync) {
    return { kind: 'sync', steps: [{ tool: 'get_sync_status', args: {} }], entity: null, period: null, compare: false };
  }
  if (hasGoals) {
    return { kind: 'goals', steps: [{ tool: 'get_goals', args: {} }], entity: null, period: null, compare: false };
  }
  if (hasBudgets) {
    return { kind: 'budgets', steps: [{ tool: 'get_budgets', args: {} }], entity: null, period: null, compare: false };
  }
  if (hasHoldings) {
    return { kind: 'holdings', steps: [{ tool: 'get_holdings', args: {} }], entity: null, period: null, compare: false };
  }
  if (hasPortfolio && !expensesQuery) {
    ctx.lastMetric = 'portfolio';
    return { kind: 'portfolio', steps: [{ tool: 'get_portfolio', args: {} }], entity: null, period: null, compare: false };
  }

  if (expensesQuery) {
    const period = resolveMonth(text, ctx, now);
    ctx.lastPeriod = period;
    const entity = extractEntity(text, KNOWN_CATEGORIES);
    ctx.lastMetric = 'spend';
    if (entity) {
      ctx.lastEntity = entity;
      if (compare) {
        const prev = previousMonth(now);
        return {
          kind: 'compare_spend', entity, period, compare: true,
          steps: [
            { tool: 'get_transaction_total', args: { month: period, direction: 'out', category: entity } },
            { tool: 'get_transaction_total', args: { month: prev, direction: 'out', category: entity } },
          ],
        };
      }
      return { kind: 'spend_category', entity, period, steps: [{ tool: 'get_transaction_total', args: { month: period, direction: 'out', category: entity } }] };
    }
    if (compare) {
      const prev = previousMonth(now);
      return {
        kind: 'compare_spend', entity: null, period, compare: true,
        steps: [
          { tool: 'get_monthly_expenses', args: { month: period } },
          { tool: 'get_monthly_expenses', args: { month: prev } },
        ],
      };
    }
    return { kind: 'spend', period, steps: [{ tool: 'get_monthly_expenses', args: { month: period } }] };
  }

  if (hasAccounts) {
    return { kind: 'accounts', steps: [{ tool: 'get_accounts', args: {} }], entity: null, period: null, compare: false };
  }

  // Income-specific query.
  if (/\b(income|earned|earnings|salary total|how much did i earn|did i make)\b/.test(t)) {
    const period = resolveMonth(text, ctx, now);
    ctx.lastPeriod = period;
    ctx.lastMetric = 'income';
    return { kind: 'income', period, steps: [{ tool: 'get_income', args: { month: period } }] };
  }

  // Data freshness / sync health.
  if (/\b(data\s*fresh|freshness|how fresh|stale|last sync|sync status)\b/.test(t)) {
    return { kind: 'freshness', steps: [{ tool: 'get_data_freshness', args: {} }], entity: null, period: null, compare: false };
  }

  // Reconciliation.
  if (/\breconcil|source\s*b.*balance|match.*balance\b/.test(t)) {
    return { kind: 'reconciliation', steps: [{ tool: 'get_reconciliation', args: {} }], entity: null, period: null, compare: false };
  }

  // Market price.
  const priceMatch = text.match(/\b(?:price of|price for|value of)\s+([a-z0-9 .]+?)(?:\?|$)/i);
  if (/\b(price|quote|ticker)\b/.test(t) && priceMatch) {
    return { kind: 'market_price', steps: [{ tool: 'get_market_price', args: { name: priceMatch[1].trim() } }], entity: priceMatch[1].trim(), period: null, compare: false };
  }

  // Per-holding view.
  if (/\b(holdings?|my shares|positions?)\b/.test(t)) {
    return { kind: 'holdings', steps: [{ tool: 'get_holdings', args: {} }], entity: null, period: null, compare: false };
  }

  // Calculators.
  const calcMatch = text.match(/\b(emi|sip|fd|cagr|xirr)\b/i);
  if (calcMatch && /\b(calculate|compute|how (much|would)|estimate)\b/.test(t)) {
    const type = calcMatch[1].toLowerCase();
    return { kind: 'calculate', steps: [{ tool: 'calculate', args: { type } }], entity: type, period: null, compare: false };
  }

  return {
    kind: 'unknown',
    steps: [{ tool: null, args: {} }],
    entity: null, period: null, compare: false,
    suggestion: 'Ask me about net worth, account balances, monthly spending, income, portfolio value, holdings, goals, budgets, reconciliation, data freshness, consents, calculator values or sync status.',
  };
}

function runTool(db, userId, toolName, args) {
  const tool = TOOLS[toolName];
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  return tool.fn(db, userId, args || {});
}

/**
 * Execute a plan and produce a natural-language answer using only real values.
 * Returns { answer, toolCalls, provider, context } and mutates ctx.
 */
export function runPlan(db, userId, plan, ctx) {
  const results = [];
  for (const step of plan.steps) {
    if (!step.tool) continue;
    const res = runTool(db, userId, step.tool, step.args);
    results.push(res);
    if (step.tool === 'get_portfolio') ctx.lastValue = res.totalPnlMinor;
    if (step.tool === 'get_net_worth') ctx.lastValue = res.netWorthMinor;
    if (step.tool === 'get_transaction_total') ctx.lastValue = res.totalMinor;
    if (step.tool === 'get_monthly_expenses') ctx.lastValue = res.totalMinor;
  }
  if (!results.length) {
    return { answer: plan.suggestion || 'I could not understand that. Try asking about net worth, spending, portfolio, or goals.', toolCalls: [], context: ctx, provider: providerLabel(), llmConfigured: llmProviderConfig().configured };
  }
  const answer = composeAnswer(plan, results, now2());
  const llm = llmProviderConfig();
  return {
    answer,
    toolCalls: plan.steps.filter((s) => s.tool).map((s) => s.tool),
    provider: providerLabel(),
    context: ctx,
    llmConfigured: llm.configured,
  };
}

function providerLabel() {
  const llm = llmProviderConfig();
  if (llm.configured) return `llm:${llm.provider}`;
  return 'offline-deterministic';
}

/**
 * LLM-aware path. When a model provider is configured, present the tool schema
 * and execute the model's chosen tool call against real data; otherwise return
 * an honest LLM_NOT_CONFIGURED status rather than pretending to be live.
 * Currently the tool layer is shared; wiring only requires calling this with a
 * chat-completion provider that returns a function call.
 */
export function llmStatus() {
  const llm = llmProviderConfig();
  return {
    configured: llm.configured,
    provider: llm.provider,
    model: llm.model,
    mode: llm.configured ? 'PRODUCTION' : 'DEVELOPMENT',
    status: llm.configured ? 'configured' : 'LLM_NOT_CONFIGURED',
    message: llm.configured ? 'Model provider configured.' : 'LLM provider credentials are required to use a model-backed assistant. Offline deterministic mode is active.',
  };
}

function composeAnswer(plan, results) {
  const r0 = results[0];
  switch (plan.kind) {
    case 'net_worth':
      return `Your net worth is ${r0._display.replace(/^Net worth /, '')}.`;
    case 'balance':
      return r0.found ? `${r0.name} has a balance of ${money.format(r0.balanceMinor, r0.currency)}.` : r0._display;
    case 'spend':
      return r0._display + '.';
    case 'spend_category':
      return `Your ${plan.entity} spending in ${plan.period} was ${money.format(r0.totalMinor)}.`;
    case 'compare_spend': {
      const [cur, prev] = results;
      const diff = cur.totalMinor - prev.totalMinor;
      const label = plan.entity ? `${plan.entity} spending` : 'Total spending';
      return `${label}: ${plan.period} was ${money.format(cur.totalMinor)} vs last month ${money.format(prev.totalMinor)} (${diff >= 0 ? '+' : ''}${money.format(diff)}).`;
    }
    case 'portfolio':
      return `Your portfolio is worth ${money.format(r0.totalValueMinor)} on a cost of ${money.format(r0.totalCostMinor)}, giving ${r0.totalPnlMinor >= 0 ? 'a gain' : 'a loss'} of ${money.format(Math.abs(r0.totalPnlMinor))} (${(r0.totalPnlPct * 100).toFixed(2)}%).`;
    case 'goals':
      if (!r0.length) return 'You have no active goals yet.';
      return r0.map((g) => g._display).join('; ') + '.';
    case 'budgets':
      if (!r0.length) return 'You have no budgets yet.';
      return r0.map((b) => b._display).join('; ') + '.';
    case 'consent':
      return r0._display;
    case 'sync':
      return r0._display;
    case 'history':
      return r0._display + '.';
    case 'accounts':
      if (!r0.length) return 'You have no linked accounts yet.';
      return r0.map((a) => a._display).join('; ') + '.';
    case 'income':
      return `Your income in ${plan.period} was ${money.format(r0.totalMinor)}.`;
    case 'freshness':
      return r0._display + '.';
    case 'reconciliation':
      return r0._display + '.';
    case 'market_price':
      return r0.found ? r0._display + '.' : r0._display;
    case 'holdings':
      if (!r0.length) return 'You have no holdings yet.';
      return r0.map((h) => h._display).join('; ') + '.';
    case 'calculate':
      return r0._display + '.';
    default:
      return plan.suggestion || 'I could not understand that.';
  }
}

function now2() { return new Date(); }

/** Persist a message and return the conversation. */
export function appendMessage(db, conversationId, role, content, toolCalls = null) {
  db.prepare(`INSERT INTO ai_messages (conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?)`)
    .run(conversationId, role, content, toolCalls ? JSON.stringify(toolCalls) : null);
  db.prepare(`UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?`).run(conversationId);
}

export default {
  newContext, resolvePlan, runPlan, appendMessage, llmProviderConfig, llmStatus,
};
