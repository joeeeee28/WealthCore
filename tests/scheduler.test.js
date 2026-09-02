// Scheduler test: jobs are registered, initialised, and a manual run of a job
// executes without error. Does not start the scheduler timer (no background
// blocking), it verifies the job registry and manual execution contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { JOB_RUNNERS } = await import('../server/lib/scheduler.js');
import { config } from '../server/config.js';

function setup() {
  const db = getDb();
  db.exec('DELETE FROM jobs; DELETE FROM users;');
  const u = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES ('s','S','x','y')`).run();
  return { db, userId: u.lastInsertRowid };
}

test('job registry includes the required jobs', () => {
  const names = Object.keys(JOB_RUNNERS);
  for (const required of ['expire-consents', 'market-refresh', 'notify-evaluate', 'monthly-networth-snapshot', 'reconciliation-scan']) {
    assert.ok(names.includes(required), `missing job ${required}`);
  }
});

test('scheduler config exposes enabled and intervals', () => {
  const c = config().scheduler;
  assert.ok(Object.hasOwn(c, 'enabled'));
  assert.ok(c.intervalSeconds > 0);
});

test('running the notify-evaluate job over real data is safe and non-throwing', async () => {
  const { db, userId } = setup();
  // Prime a little data + categories so the evaluator has something to see.
  db.prepare(`INSERT INTO categories (user_id, name, kind) VALUES (?, 'Groceries', 'expense')`).run(userId);
  const acct = db.prepare(`INSERT INTO accounts (user_id, name, type, currency, balance_minor, source) VALUES (?,?,'savings','INR',0,'manual')`).run(userId, 'A').lastInsertRowid;
  db.prepare(`INSERT INTO transactions (user_id, account_id, date, amount_minor, currency, direction, merchant) VALUES (?,?,date('now'),100000,'INR','out','Big')`).run(userId, acct);
  const runner = JOB_RUNNERS['notify-evaluate'];
  const result = await runner.run(db);
  assert.equal(result.ok, true);
  assert.ok(Number.isInteger(result.records));
});

test('market-refresh job is honest when no provider is configured', async () => {
  const { db } = setup();
  const runner = JOB_RUNNERS['market-refresh'];
  const result = await runner.run(db);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'not_configured');
});
