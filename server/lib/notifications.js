// WealthCore — Notification engine.
//
// Evaluates the user's data against event rules and creates notifications for
// events such as budget thresholds, unusual/large spending, goal milestones or
// falling behind, consent expiry, failed sync, reconciliation differences and
// stale market data. Preferences control which types are enabled and at what
// threshold/severity. Creating a notification never throws on a single rule.

import { currentMonth } from './ai-tools.js';
import * as money from './money.js';

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export const NOTIFICATION_TYPES = [
  'budget_threshold', 'unusual_spending', 'large_transaction', 'goal_milestone',
  'goal_behind', 'emi_due', 'credit_card_due', 'low_balance', 'portfolio_movement',
  'concentration_warning', 'failed_sync', 'reconciliation_difference',
  'consent_expiry', 'stale_market_data',
];

function ensurePreferences(db, userId) {
  const insert = db.prepare(`INSERT OR IGNORE INTO notification_preferences (user_id, type, enabled, min_severity) VALUES (?, ?, 1, 'info')`);
  for (const t of NOTIFICATION_TYPES) insert.run(userId, t);
}

export function preferencesFor(db, userId) {
  ensurePreferences(db, userId);
  return db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').all(userId);
}

export function updatePreference(db, userId, type, { enabled, thresholdMinor, minSeverity } = {}) {
  ensurePreferences(db, userId);
  const existing = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ? AND type = ?').get(userId, type);
  if (!existing) throw new Error('Unknown notification type');
  db.prepare(`
    UPDATE notification_preferences SET enabled = ?, threshold_minor = ?, min_severity = ?, updated_at = datetime('now')
    WHERE user_id = ? AND type = ?
  `).run(enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    thresholdMinor !== undefined ? thresholdMinor : existing.threshold_minor,
    minSeverity || existing.min_severity, userId, type);
  return db.prepare('SELECT * FROM notification_preferences WHERE user_id = ? AND type = ?').get(userId, type);
}

function enabledTypes(db, userId) {
  ensurePreferences(db, userId);
  const rows = db.prepare(`SELECT * FROM notification_preferences WHERE user_id = ? AND enabled = 1`).all(userId);
  return new Set(rows.map((r) => r.type));
}

/** Insert a notification without failing the whole evaluation. */
export function emit(db, userId, type, title, body, { severity = 'info', source = 'engine', data = null } = {}) {
  const row = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, severity, source, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, type, title, body, severity, source, data ? JSON.stringify(data) : null);
  return row.lastInsertRowid;
}

function monthSpendByCategory(db, userId, start, end) {
  return db.prepare(`
    SELECT c.name category, COALESCE(SUM(t.amount_minor),0) total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.direction='out' AND t.status='active'
    GROUP BY c.id
  `).all(userId, start, end);
}

/** Evaluate all notification rules for a user; returns created ids. */
export function evaluate(db, userId) {
  const enabled = enabledTypes(db, userId);
  const created = [];
  const now = new Date();
  const ym = currentMonth(now);
  const { start, end } = monthRange(ym);

  const tryEmit = (type, title, body, extra) => {
    if (!enabled.has(type)) return;
    try { created.push(emit(db, userId, type, title, body, extra)); }
    catch (e) { /* a broken rule must not break evaluation */ }
  };

  // 1. Budget thresholds
  const budgets = db.prepare(`SELECT b.*, c.name category FROM budgets b LEFT JOIN categories c ON c.id = b.category_id WHERE b.user_id = ?`).all(userId);
  const spendByCat = new Map(monthSpendByCategory(db, userId, start, end).map((r) => [r.category || 'Uncategorized', Number(r.total)]));
  for (const b of budgets) {
    const spent = spendByCat.get(b.category || 'Uncategorized') || 0;
    if (b.amount_minor > 0 && spent >= b.amount_minor) {
      tryEmit('budget_threshold', `${b.category || 'Budget'} reached`,
        `Spent ${money.format(spent, 'INR')} against a ${money.format(b.amount_minor, 'INR')} ${b.period} budget.`, { severity: 'warn', data: { category: b.category, spent, budget: b.amount_minor } });
    }
  }

  // 2. Large transaction (>= 1,00,000 minor = ₹1,000 by default threshold)
  const large = db.prepare(`
    SELECT * FROM transactions WHERE user_id=? AND date >= ? AND date < ? AND amount_minor >= ? AND direction='out' AND status='active'
  `).all(userId, start, end, Number(process.env.WEALTHCORE_LARGE_TXN_MINOR || 100000));
  for (const t of large) {
    tryEmit('large_transaction', 'Large expense',
      `A ${money.format(t.amount_minor, t.currency || 'INR')} transaction (${t.merchant || 'unknown'}) was posted.`, { severity: 'info', data: { id: t.id } });
  }

  // 3. Goal milestones / behind schedule
  const goals = db.prepare(`SELECT * FROM goals WHERE user_id = ? AND status = 'active'`).all(userId);
  for (const g of goals) {
    const progress = g.target_amount_minor ? g.current_amount_minor / g.target_amount_minor : 0;
    if (progress >= 1) {
      tryEmit('goal_milestone', `${g.name} reached`, `${money.format(g.current_amount_minor, g.currency)} of ${money.format(g.target_amount_minor, g.currency)}.`, { severity: 'success', data: { id: g.id } });
    } else if (g.deadline) {
      const deadline = new Date(g.deadline).getTime();
      if (deadline < now.getTime()) {
        tryEmit('goal_behind', `${g.name} is overdue`, `The deadline (${g.deadline}) has passed at ${(progress * 100).toFixed(0)}% progress.`, { severity: 'warn', data: { id: g.id } });
      }
    }
  }

  // 4. Consent expiry (within 7 days)
  const soon = db.prepare(`
    SELECT * FROM consents WHERE user_id = ? AND status = 'approved' AND expires_at IS NOT NULL AND expires_at < datetime('now', '+7 days')
  `).all(userId);
  for (const c of soon) {
    tryEmit('consent_expiry', `Consent expiring`, `Consent for ${c.fi_type} (${c.provider}) expires ${c.expires_at}.`, { severity: 'warn', data: { id: c.id } });
  }

  // 5. Failed sync
  const failedSync = db.prepare(`SELECT * FROM sync_runs WHERE user_id = ? AND status = 'failed' AND created_at >= datetime('now', '-24 hours') ORDER BY id DESC`).get(userId);
  if (failedSync) {
    tryEmit('failed_sync', 'Synchronisation failed', `Sync for ${failedSync.provider} failed: ${failedSync.errors || 'unknown error'}.`, { severity: 'error', data: { id: failedSync.id } });
  }

  // 6. Reconciliation difference
  const reconDiff = db.prepare(`SELECT * FROM reconciliation_runs WHERE user_id = ? AND status IN ('DIFFERENCE','REQUIRES_REVIEW') AND created_at >= datetime('now', '-24 hours') ORDER BY id DESC`).get(userId);
  if (reconDiff && reconDiff.net_worth_difference_minor) {
    tryEmit('reconciliation_difference', 'Reconciliation difference', `${money.format(reconDiff.net_worth_difference_minor, 'INR')} difference detected. Requires review.`, { severity: 'warn', data: { id: reconDiff.id } });
  }

  // 7. Stale market data
  const stale = db.prepare(`SELECT * FROM securities WHERE user_id = ? AND price_status = 'LAST_AVAILABLE' AND price_timestamp IS NOT NULL AND price_timestamp < datetime('now', '-24 hours') LIMIT 1`).get(userId);
  if (stale) {
    tryEmit('stale_market_data', 'Market data is stale', `Price for ${stale.name} is older than 24 hours (${stale.price_status}).`, { severity: 'warn', data: { id: stale.id } });
  }

  return created;
}

export default {
  NOTIFICATION_TYPES, preferencesFor, updatePreference, evaluate, emit,
};
