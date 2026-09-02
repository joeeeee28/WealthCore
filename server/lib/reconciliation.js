// WealthCore — Reconciliation Engine.
//
// Compares a provider-reported (source) balance against WealthCore's local
// balance for every connected account, classifies the result, records a run
// and per-item details, and surfaces differences. It never silently changes
// data to force a match (ABSOLUTE RULE: never hide discrepancies).
//
// Statuses:
//   MATCHED            source == local
//   DIFFERENCE         source != local (numeric difference)
//   MISSING_SOURCE_DATA no source balance provided yet
//   MISSING_LOCAL_DATA source exists but there are no local records
//   DUPLICATE          local duplicate transactions detected
//   REQUIRES_REVIEW    a difference or duplicate needs a human decision

import { config } from '../config.js';

const STATUSES = ['MATCHED', 'DIFFERENCE', 'MISSING_SOURCE_DATA', 'MISSING_LOCAL_DATA', 'DUPLICATE', 'REQUIRES_REVIEW'];

function classify(source, local, dupCount) {
  if (source == null) return 'MISSING_SOURCE_DATA';
  if (dupCount > 0) return 'DUPLICATE';
  if (local == null) return 'MISSING_LOCAL_DATA';
  if (Number(source) === Number(local)) return 'MATCHED';
  return 'DIFFERENCE';
}

/** Compute reconciliation for a single account (or a user's default). */
export function reconciliationForAccount(db, userId, accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId);
  if (!account) throw new Error('Account not found');

  const source = account.source_balance_minor;
  const local = account.balance_minor;

  const dupCount = Number(db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT dedup_key, COUNT(*) n FROM transactions
      WHERE user_id = ? AND account_id = ? AND status='active' AND dedup_key IS NOT NULL
      GROUP BY dedup_key HAVING n > 1
    )
  `).get(userId, accountId).c || 0);

  const status = classify(source, local, dupCount);
  const difference = source != null && local != null ? Number(source) - Number(local) : null;

  return {
    accountId: account.id,
    accountName: account.name,
    currency: account.currency,
    sourceBalanceMinor: source == null ? null : Number(source),
    localBalanceMinor: local == null ? null : Number(local),
    differenceMinor: difference,
    sourceTimestamp: account.source_balance_timestamp,
    lastSyncedAt: account.last_synced_at,
    status,
    duplicateCount: dupCount,
    sourceClass: source == null ? 'MISSING' : 'PRESENT',
    localClass: local == null ? 'MISSING' : 'PRESENT',
  };
}

/** Record a reconciliation run for one account and optionally save items. */
export function recordReconciliationRun(db, userId, accountId, asOf = new Date().toISOString()) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId);
  if (!account) throw new Error('Account not found');
  const rec = reconciliationForAccount(db, userId, accountId);

  const runInfo = db.prepare(`
    INSERT INTO reconciliation_runs
      (user_id, as_of, account_id, source_balance_minor, expected_balance_minor, net_worth_difference_minor, status, summary, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, asOf.slice(0, 10), accountId,
    rec.sourceBalanceMinor, rec.localBalanceMinor, rec.differenceMinor,
    rec.status, rec.status === 'MATCHED' ? 'Balances matched.' : 'Reconciliation requires review.',
    `recon-${Date.now()}`);

  const runId = runInfo.lastInsertRowid;

  // Build item-level detail rows.
  const items = [];
  if (['DIFFERENCE', 'REQUIRES_REVIEW'].includes(rec.status)) {
    const toInsert = db.prepare(`
      INSERT INTO reconciliation_items (run_id, kind, description, amount_minor, direction, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    if (rec.differenceMinor != null) {
      toInsert.run(runId, 'difference', 'Source vs local balance', Math.abs(rec.differenceMinor),
        rec.differenceMinor > 0 ? 'source_gt_local' : 'source_lt_local', rec.status);
      items.push({ kind: 'difference', amountMinor: Math.abs(rec.differenceMinor) });
    }
  }
  if (rec.duplicateCount > 0) {
    db.prepare(`INSERT INTO reconciliation_items (run_id, kind, description, status) VALUES (?, 'duplicate', 'Duplicate local transactions detected', 'DUPLICATE')`).run(runId);
    items.push({ kind: 'duplicate' });
  }

  return { runId, ...rec };
}

/** Run reconciliation across all connected (non-manual-intent) accounts. */
export function runAllReconciliations(db, userId, forceSave = false) {
  const accounts = db.prepare('SELECT id FROM accounts WHERE user_id = ?').all(userId);
  const results = accounts.map((a) => {
    const rec = reconciliationForAccount(db, userId, a.id);
    return rec;
  });
  // Save a run snapshot for the primary account (first) to establish history.
  if (forceSave && accounts.length) {
    recordReconciliationRun(db, userId, accounts[0].id);
  }
  const summary = {
    total: results.length,
    matched: results.filter((r) => r.status === 'MATCHED').length,
    difference: results.filter((r) => r.status === 'DIFFERENCE').length,
    missingSource: results.filter((r) => r.status === 'MISSING_SOURCE_DATA').length,
    duplicate: results.filter((r) => r.status === 'DUPLICATE').length,
    review: results.filter((r) => r.status === 'REQUIRES_REVIEW').length,
  };
  return { results, summary };
}

/** List reconciliation history. */
export function reconciliationHistory(db, userId, limit = 50) {
  return db.prepare(`
    SELECT r.*, a.name account_name FROM reconciliation_runs r
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ?
  `).all(userId, limit);
}

/** Manually resolve a reconsiliation (set local balance to source, or record). */
export function resolveReconciliation(db, userId, accountId, { setBalance = false, note } = {}) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId);
  if (!account) throw new Error('Account not found');
  if (setBalance && account.source_balance_minor != null) {
    db.prepare(`UPDATE accounts SET balance_minor = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(account.source_balance_minor, accountId);
  }
  const run = recordReconciliationRun(db, userId, accountId);
  return { ...run, note: note || null };
}

export default {
  STATUSES, reconciliationForAccount, recordReconciliationRun,
  runAllReconciliations, reconciliationHistory, resolveReconciliation,
};
