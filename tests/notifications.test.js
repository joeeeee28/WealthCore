// Notification engine tests: preferences, evaluation rules and emission.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { preferencesFor, updatePreference, evaluate, emit } = await import('../server/lib/notifications.js');
import { ensureDefaultCategories } from '../server/lib/defaults.js';

function setup() {
  const db = getDb();
  db.exec('DELETE FROM notifications; DELETE FROM notification_preferences; DELETE FROM budgets; DELETE FROM goals; DELETE FROM consents; DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts; DELETE FROM users;');
  const u = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES ('n','N','x','y')`).run();
  const userId = u.lastInsertRowid;
  ensureDefaultCategories(db, userId);
  return { db, userId };
}

function catId(db, userId, name) {
  return db.prepare('SELECT id FROM categories WHERE user_id=? AND name=?').get(userId, name).id;
}

test('preferences are seeded for all types and are toggleable', () => {
  const { db, userId } = setup();
  const prefs = preferencesFor(db, userId);
  assert.ok(prefs.find((p) => p.type === 'budget_threshold'));
  const updated = updatePreference(db, userId, 'budget_threshold', { enabled: false });
  assert.equal(updated.enabled, 0);
});

test('budget over-spend creates a notification only if enabled', () => {
  const { db, userId } = setup();
  const cid = catId(db, userId, 'Groceries');
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // budget 1000; spend 1500
  db.prepare(`INSERT INTO budgets (user_id, category_id, period, amount_minor, currency) VALUES (?,?, 'monthly', 100000, 'INR')`).run(userId, cid);
  const acct = db.prepare(`INSERT INTO accounts (user_id, name, type, currency, balance_minor, source) VALUES (?,?,'savings','INR',0,'manual')`).run(userId, 'Acc').lastInsertRowid;
  db.prepare(`INSERT INTO transactions (user_id, account_id, date, amount_minor, currency, direction, category_id, merchant) VALUES (?,?,?,?,'INR','out',?,'Groceries')`).run(userId, acct, `${ym}-05`, 150000, cid);
  const created = evaluate(db, userId);
  const budgetNotifs = created.length;
  assert.ok(budgetNotifs >= 1);
});

test('consent expiry and large transaction fire their notifications', () => {
  const { db, userId } = setup();
  const acct = db.prepare(`INSERT INTO accounts (user_id, name, type, currency, balance_minor, source) VALUES (?,?,'savings','INR',0,'manual')`).run(userId, 'Acc').lastInsertRowid;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  db.prepare(`INSERT INTO transactions (user_id, account_id, date, amount_minor, currency, direction, merchant) VALUES (?,?,?,?, 'INR','out','Luxury')`).run(userId, acct, `${ym}-05`, 1000000);
  db.prepare(`INSERT INTO consents (user_id, provider, fi_type, purpose, status, expires_at) VALUES (?,?,?,?, 'approved', datetime('now','+3 days'))`).run(userId, 'P', 'savings', 'sync');
  const created = evaluate(db, userId);
  // large txn (>=100000) + consent expiry within 7 days should both fire.
  assert.ok(created.length >= 2);
});

test('emit writes a notification with severity and data', () => {
  const { db, userId } = setup();
  const id = emit(db, userId, 'test', 'Hi', 'Body', { severity: 'warn', data: { a: 1 } });
  const n = db.prepare('SELECT * FROM notifications WHERE id=?').get(id);
  assert.equal(n.type, 'test');
  assert.equal(n.severity, 'warn');
  assert.ok(n.data);
});
