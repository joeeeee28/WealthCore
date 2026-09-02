// Ingestion framework tests: CSV/JSON parsing, deduplication, idempotency,
// summary, failed records and normalized metadata.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { ingest, CONNECTORS, normaliseRecord } = await import('../server/lib/ingest.js');
const { parseCsv } = await import('../server/lib/csv.js');
import { ensureDefaultCategories } from '../server/lib/defaults.js';

function setup() {
  const db = getDb();
  db.exec('DELETE FROM raw_ingest; DELETE FROM ingestion_runs; DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts; DELETE FROM users;');
  const u = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES ('i','I','x','y')`).run();
  const userId = u.lastInsertRowid;
  ensureDefaultCategories(db, userId);
  const acct = db.prepare(`INSERT INTO accounts (user_id, name, type, currency, balance_minor, is_liability, source) VALUES (?,?,'savings','INR',0,0,'manual')`).run(userId, 'HDFC').lastInsertRowid;
  return { db, userId, acct };
}

test('parseCsv handles quoted fields, commas and newlines', () => {
  const { headers, rows } = parseCsv('date,merchant,amount\n2026-08-01,"BigBasket, Groceries",1240.00\n2026-08-02,"He said ""hi""",500.00');
  assert.deepEqual(headers, ['date', 'merchant', 'amount']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].merchant, 'BigBasket, Groceries');
  assert.equal(rows[1].merchant, 'He said "hi"');
});

test('normaliseRecord parses signed amounts and debit/credit pairs', () => {
  const r = normaliseRecord({ date: '01/08/2026', debit: '1,240.00', description: 'Groceries' }, null, null);
  assert.equal(r.direction, 'out');
  assert.equal(r.amountMinor, 124000);
  assert.equal(r.date, '2026-08-01');
  const credit = normaliseRecord({ date: '2026-08-02', credit: '5000.00', description: 'Salary' }, null, null);
  assert.equal(credit.direction, 'in');
  assert.equal(credit.amountMinor, 500000);
});

test('importing the same CSV twice does not create duplicates', async () => {
  const { db, userId, acct } = setup();
  const csv = 'date,merchant,amount,direction\n2026-08-01,BigBasket Groceries,1240.00,out\n2026-08-02,Salary,150000.00,in\n';
  const first = await ingest(db, userId, { format: 'csv-generic', text: csv, defaultAccountId: acct });
  assert.equal(first.ok, true);
  assert.equal(first.summary.created, 2);
  const second = await ingest(db, userId, { format: 'csv-generic', text: csv, defaultAccountId: acct });
  assert.equal(second.ok, true);
  assert.equal(second.summary.created, 0);
  assert.equal(second.summary.duplicates, 2);
  const total = db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id=?').get(userId).c;
  assert.equal(total, 2);
});

test('same transaction with different formatting is still deduplicated', async () => {
  const { db, userId, acct } = setup();
  const a = await ingest(db, userId, { format: 'csv-generic', text: 'date,merchant,amount,direction\n2026-08-01,BigBasket Groceries,1240.00,out\n', defaultAccountId: acct });
  assert.equal(a.summary.created, 1);
  // Same logical txn, different amount formatting sign / decimal points.
  const b = await ingest(db, userId, { format: 'csv-generic', text: 'date,merchant,amount,direction\n2026-08-01,BigBasket Groceries,-1240.00,out\n', defaultAccountId: acct });
  assert.equal(b.summary.created, 0);
  assert.equal(b.summary.duplicates, 1);
});

test('legitimate distinct monthly payments are NOT deduplicated', async () => {
  const { db, userId, acct } = setup();
  const csv = 'date,merchant,amount,direction\n2026-06-01,Rent,18000.00,out\n2026-07-01,Rent,18000.00,out\n';
  const r = await ingest(db, userId, { format: 'csv-generic', text: csv, defaultAccountId: acct });
  assert.equal(r.summary.created, 2);
  assert.equal(r.summary.duplicates, 0);
});

test('invalid records are reported per-item and never silently dropped', async () => {
  const { db, userId, acct } = setup();
  const csv = 'date,merchant,amount,direction\n2026-08-01,Groceries,1240.00,out\nnot-a-date,Bad,100.00,out\n2026-08-03,NoAmount,xxx,out\n';
  const r = await ingest(db, userId, { format: 'csv-generic', text: csv, defaultAccountId: acct });
  assert.equal(r.summary.created, 1);
  assert.equal(r.summary.failed, 2);
  const failedRefs = db.prepare('SELECT COUNT(*) c FROM ingestion_runs').get().c;
  assert.ok(failedRefs >= 1);
});

test('records carry normalized metadata and source references', async () => {
  const { db, userId, acct } = setup();
  const csv = 'date,merchant,amount,direction,reference\n2026-08-01,BigBasket Groceries,1240.00,out,REF-123\n';
  const r = await ingest(db, userId, { format: 'csv-generic', text: csv, defaultAccountId: acct, source: 'bank-export' });
  assert.equal(r.summary.created, 1);
  const t = db.prepare('SELECT * FROM transactions WHERE user_id=?').get(userId);
  assert.equal(t.provider_ref, 'REF-123');
  assert.equal(t.source, 'bank-export');
  assert.ok(t.normalized_merchant);
  assert.ok(t.ingested_at);
  assert.equal(t.source_ref, 'REF-123');
});

test('connectors register generic CSV, bank CSV, JSON, zerodha and groww', () => {
  assert.ok(CONNECTORS['csv-generic']);
  assert.ok(CONNECTORS['bank-csv']);
  assert.ok(CONNECTORS['json-transactions']);
  assert.ok(CONNECTORS['zerodha-holdings']);
  assert.ok(CONNECTORS['groww-holdings']);
});
