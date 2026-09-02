// AI agent tests: tool-calling against REAL data, conversation context, and
// the guarantee that the AI never invents figures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { newContext, resolvePlan, runPlan } = await import('../server/lib/ai-agent.js');
import { currentMonth, previousMonth } from '../server/lib/ai-tools.js';

function setup() {
  const db = getDb();
  db.exec('DELETE FROM ai_messages; DELETE FROM ai_conversations; DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts; DELETE FROM users;');
  const u = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES ('t','T','x','y')`).run();
  const userId = u.lastInsertRowid;
  const acct = db.prepare(`INSERT INTO accounts (user_id, name, type, currency, balance_minor, source) VALUES (?,?,?,'INR',?, 'manual')`)
    .run(userId, 'Salary Account', 'savings', 40000000).lastInsertRowid;
  const cat = (name, kind) => db.prepare(`INSERT INTO categories (user_id, name, kind) VALUES (?,?,?)`).run(userId, name, kind).lastInsertRowid;
  const foodCat = cat('Food', 'expense');
  const rentCat = cat('Rent', 'expense');
  const salaryCat = cat('Salary', 'income');
  const addTx = (date, amountMinor, dir, cid, merchant) => db.prepare(
    `INSERT INTO transactions (user_id, account_id, date, amount_minor, currency, direction, category_id, merchant, source) VALUES (?,?,?,?,'INR',?,?,?, 'manual')`)
    .run(userId, acct, date, amountMinor, dir, cid, merchant);
  const now = new Date();
  const ym = currentMonth(now);
  const lm = previousMonth(now);
  addTx(`${ym}-05`, 15000000, 'in', salaryCat, 'ACME Salary');
  addTx(`${ym}-10`, 3000000, 'out', foodCat, 'Food Mart');
  addTx(`${ym}-12`, 500000, 'out', rentCat, 'Landlord Rent');
  addTx(`${lm}-05`, 15000000, 'in', salaryCat, 'ACME Salary');
  addTx(`${lm}-10`, 2500000, 'out', foodCat, 'Food Mart');
  return { db, userId, ym, lm };
}

test('resolvePlan maps net worth question to get_net_worth', () => {
  const { db, userId } = setup();
  const ctx = newContext();
  const plan = resolvePlan('What is my net worth?', ctx);
  assert.equal(plan.kind, 'net_worth');
  assert.deepEqual(plan.steps.map((s) => s.tool), ['get_net_worth']);
  const result = runPlan(db, userId, plan, ctx);
  assert.match(result.answer, /net worth/i);
  assert.ok(result.answer.includes('₹'));
  assert.equal(JSON.stringify(result.toolCalls), JSON.stringify(['get_net_worth']));
});

test('AI reports real monthly spending', () => {
  const { db, userId, ym } = setup();
  const plan = resolvePlan('How much did I spend this month?', newContext());
  const result = runPlan(db, userId, plan, newContext());
  // Spending this month = food 3000 + rent 500 = 3500 => ₹3,500.00 (or compact)
  assert.match(result.answer, /Total spending in/);
  assert.match(result.answer, new RegExp(ym));
  assert.match(result.answer, /₹/);
});

test('conversation context resolves "food" then "compare with last month"', () => {
  const { db, userId, ym, lm } = setup();
  const ctx = newContext();
  // Turn 1: set the month context
  const p1 = resolvePlan('How much did I spend this month?', ctx);
  runPlan(db, userId, p1, ctx);
  assert.equal(ctx.lastPeriod, ym);

  // Turn 2: "How much was food?" should reuse the period from context
  const p2 = resolvePlan('How much was food?', ctx);
  assert.equal(p2.kind, 'spend_category');
  assert.equal(p2.period, ym);
  assert.equal(p2.entity, 'food');
  const r2 = runPlan(db, userId, p2, ctx);
  assert.match(r2.answer, /food/i);
  assert.match(r2.answer, /₹/);

  // Turn 3: comparison against last month
  const p3 = resolvePlan('Compare that with last month.', ctx);
  assert.equal(p3.kind, 'compare_spend');
  assert.equal(p3.steps.length, 2);
  const r3 = runPlan(db, userId, p3, ctx);
  assert.match(r3.answer, /food spending/i); // "that" resolved to food
  assert.match(r3.answer, /vs last month/i); // comparison against last month
  assert.match(r3.answer, new RegExp(ym));   // current month carries through
});

test('entity extraction never mistakes digits/amounts for categories', () => {
  const { db, userId } = setup();
  // An assistant-style reply containing numbers must not yield a digit entity.
  const plan = resolvePlan('Total spending in 2026-08: \u20B989,390.00.', newContext());
  assert.ok(!plan.entity, `entity should be null, got ${plan.entity}`);
  assert.equal(plan.kind, 'spend');
});

test('AI never invents data: unknown intent returns a suggestion, not a number', () => {
  const { db, userId } = setup();
  const plan = resolvePlan('What color is the sky?', newContext());
  const result = runPlan(db, userId, plan, newContext());
  assert.deepEqual(result.toolCalls, []);
  assert.match(result.answer, /Ask me about/i);
});
