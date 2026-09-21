// WealthCore — Demo wealth-profile operations (load / refresh / reset / status).
//
// ##########################################################################
// # DEMO DATA — ALL FINANCIAL INFORMATION IS SYNTHETIC.                    #
// # NOT REAL FINANCIAL DATA. NO REAL BANK CREDENTIALS ARE EVER USED.       #
// ##########################################################################
//
// The demo load REUSES the existing AA synchronisation pipeline
// (runAASync → DemoProvider → rebit-normalizer → idempotent upserts) for the
// 7 AA-linked accounts, 12 holdings and 180 transactions, then persists the
// demo-only extras the AA pipeline does not model (retirement assets,
// insurance records, goals, budgets) with the same deterministic,
// clearly-labelled, user-scoped, idempotent semantics:
//
//   * every row is user_id-scoped  — one user's demo data is never visible to another;
//   * every row is clearly synthetic — source='DEMO', provider='demo',
//     is_demo=1, DEMO-* external refs, DEMO-TXN-#### transaction ids;
//   * load/refresh are idempotent  — repeated runs create ZERO duplicates
//     (upserts keyed on external_ref / source_txn_id / dedup_key / names);
//   * reset deletes ONLY demo rows of the calling user (real data untouched);
//   * totals are NEVER hard-coded — all derived values come from the existing
//     WealthCore financial engines (computeNetWorth / computePortfolio).
//
// Demo operations are blocked outright when WEALTHCORE_DATA_ENVIRONMENT=
// PRODUCTION (see assertDemoAllowed) — production can never fall back to demo.

import '../aa/index.js'; // provider self-registration side effect (demo/finvu/setu/mock)
import { runAASync } from '../aa/sync.js';
import { assertDemoAllowed, describeDataEnvironment, getDataEnvironment } from '../aa/data-environment.js';
import { DEMO_RETIREMENT, DEMO_INSURANCE, DEMO_GOALS, DEMO_BUDGETS } from '../aa/fixtures/demo-data.js';
import { ensureDefaultCategories } from './defaults.js';
import { computeNetWorth, recordSnapshot } from './networth.js';
import { computePortfolio } from './portfolio.js';
import logger from './logger.js';

export const DEMO_TXN_PREFIX = 'DEMO-TXN-';
export const DEMO_REF_PREFIX = 'DEMO-';
export const DEMO_GOAL_PREFIX = 'Demo \u25B8 '; // visible "Demo ▸ …" name prefix

function nowIso() { return new Date().toISOString(); }

// ---------------------------------------------------------------------------
// Demo-only extras (outside the AA account pipeline), upserted idempotently.
// ---------------------------------------------------------------------------
function upsertExtraAccount(db, userId, { externalRef, name, type, institution, balanceMinor, isLiability = 0 }) {
  const existing = db.prepare('SELECT id FROM accounts WHERE user_id=? AND external_ref=?').get(userId, externalRef);
  if (existing) return { id: existing.id, created: false };
  const info = db.prepare(`
    INSERT INTO accounts (user_id, name, type, institution, currency, balance_minor, is_liability, source, provider, external_ref, aa_status, is_demo, last_synced_at)
    VALUES (?, ?, ?, ?, 'INR', ?, ?, 'DEMO', 'demo', ?, 'SYNCED', 1, ?)
  `).run(userId, name, type, institution, balanceMinor, isLiability, externalRef, nowIso());
  return { id: info.lastInsertRowid, created: true };
}

function upsertDemoExtras(db, userId) {
  let created = 0;
  let skipped = 0;
  const bump = (res) => { if (res.created) created += 1; else skipped += 1; };

  // Retirement assets (EPF / PPF / NPS) — deterministic external refs.
  for (const ret of DEMO_RETIREMENT) {
    bump(upsertExtraAccount(db, userId, {
      externalRef: ret.externalRef,
      name: ret.name,
      type: 'other',
      institution: 'Demo Retirement Trust (synthetic)',
      balanceMinor: ret.currentBalanceMinor,
    }));
  }

  // Insurance records — term/health carry no asset value; the ULIP carries its
  // (synthetic) fund value so net worth treats it consistently.
  for (const ins of DEMO_INSURANCE) {
    bump(upsertExtraAccount(db, userId, {
      externalRef: ins.externalRef,
      name: ins.name,
      type: 'insurance',
      institution: 'Demo Insurance Co (synthetic)',
      balanceMinor: ins.cashValueMinor || 0,
    }));
  }

  // Goals — deterministic names; upsert by (user_id, name).
  for (const g of DEMO_GOALS) {
    const demoName = `${DEMO_GOAL_PREFIX}${g.name}`;
    const existing = db.prepare('SELECT id FROM goals WHERE user_id=? AND name=?').get(userId, demoName);
    if (existing) { skipped += 1; continue; }
    db.prepare(`INSERT INTO goals (user_id, name, target_amount_minor, current_amount_minor, currency, deadline, status, is_demo)
      VALUES (?, ?, ?, ?, 'INR', ?, 'active', 1)`)
      .run(userId, demoName, g.targetMinor, g.currentMinor, g.deadline || null);
    created += 1;
  }

  // Budgets — upsert by (user_id, category_id, is_demo).
  for (const b of DEMO_BUDGETS) {
    const cat = db.prepare('SELECT id FROM categories WHERE user_id=? AND LOWER(name)=?').get(userId, b.categoryName.toLowerCase());
    if (!cat) { continue; }
    const existing = db.prepare('SELECT id FROM budgets WHERE user_id=? AND category_id=? AND is_demo=1').get(userId, cat.id);
    if (existing) { skipped += 1; continue; }
    db.prepare(`INSERT INTO budgets (user_id, category_id, period, amount_minor, currency, is_demo)
      VALUES (?, ?, 'monthly', ?, 'INR', 1)`).run(userId, cat.id, b.amountMinor);
    created += 1;
  }

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Status — strictly demo-environment rows, scoped to the calling user.
// ---------------------------------------------------------------------------
export function demoStatus(db, userId) {
  const accounts = Number(db.prepare(`SELECT COUNT(*) c FROM accounts WHERE user_id=? AND provider='demo'`).get(userId).c || 0);
  const transactions = Number(db.prepare(`SELECT COUNT(*) c FROM transactions WHERE user_id=? AND source_txn_id LIKE 'DEMO-TXN-%'`).get(userId).c || 0);
  const securities = Number(db.prepare(`SELECT COUNT(*) c FROM securities WHERE user_id=? AND provider='demo'`).get(userId).c || 0);
  const holdings = Number(db.prepare(`
    SELECT COUNT(*) c FROM holdings h JOIN securities s ON s.id=h.security_id
    WHERE h.user_id=? AND s.provider='demo'`).get(userId).c || 0);
  const goals = Number(db.prepare('SELECT COUNT(*) c FROM goals WHERE user_id=? AND name LIKE ? AND is_demo=1').get(userId, `${DEMO_GOAL_PREFIX}%`).c || 0);
  const budgets = Number(db.prepare(`SELECT COUNT(*) c FROM budgets WHERE user_id=? AND is_demo=1`).get(userId).c || 0);
  const lastSync = db.prepare(`SELECT finished_at FROM sync_runs WHERE user_id=? AND provider='demo' AND status='success' ORDER BY id DESC LIMIT 1`).get(userId);
  const loaded = accounts > 0 || transactions > 0;

  let environment = null;
  try { environment = describeDataEnvironment(getDataEnvironment()); } catch { environment = null; }

  return {
    environment,
    synthetic: true,
    notice: 'DEMO DATA — All financial information shown is synthetic.',
    loaded,
    lastLoadedAt: lastSync ? lastSync.finished_at : null,
    counts: { accounts, transactions, securities, holdings, goals, budgets },
  };
}

// ---------------------------------------------------------------------------
// Load / refresh. Idempotent: re-runs dedup on the deterministic ids.
// ---------------------------------------------------------------------------
export async function loadDemoProfile(db, userId, { reason = 'load' } = {}) {
  assertDemoAllowed();
  ensureDefaultCategories(db, userId);

  // 1. Full AA sync through the existing pipeline with the Demo provider.
  const sync = await runAASync(db, userId, {
    providerName: 'demo',
    purpose: 'WealthCore demo wealth profile (synthetic data)',
    customerHandle: 'demo-customer@demo',
  });

  // 2. Demo-only extras (retirement, insurance, goals, budgets).
  const extras = upsertDemoExtras(db, userId);

  // 3. Replace the demo notice notification (never accumulates on refresh).
  db.prepare(`DELETE FROM notifications WHERE user_id=? AND type='demo'`).run(userId);
  db.prepare(`INSERT INTO notifications (user_id, type, title, body, severity) VALUES (?, 'demo', 'Demo wealth profile loaded', 'DEMO DATA — all financial information shown is synthetic (source=DEMO, provider=demo, is_demo=1, ids DEMO-*). It is never real bank data.', 'info')`).run(userId);

  // 4. Snapshot + engine recalculation (financial values are engine-derived).
  const netWorth = recordSnapshot(db, userId, nowIso().slice(0, 10), 1);
  const portfolio = computePortfolio(db, userId);

  const status = demoStatus(db, userId);
  const result = {
    ok: true,
    provider: 'demo',
    mode: 'DEMO',
    synthetic: true,
    notice: status.notice,
    reason,
    summary: {
      accountsCreated: sync.summary.accountsCreated,
      accountsUpdated: sync.summary.accountsUpdated,
      totalAccounts: sync.summary.totalAccounts,
      transactionsCreated: sync.summary.transactionsCreated,
      transactionsDuplicates: sync.summary.transactionsDuplicates,
      totalTransactions: sync.summary.totalTransactions,
      holdingsCreated: sync.summary.holdingsCreated,
      holdingsDuplicates: sync.summary.holdingsDuplicates,
      totalHoldings: sync.summary.totalHoldings,
      extrasCreated: extras.created,
      extrasSkipped: extras.skipped,
      sessionId: sync.summary.sessionId,
      consentId: sync.summary.consentId,
      syncedAt: sync.summary.syncedAt,
    },
    counts: status.counts,
    recalculated: { netWorth, portfolio },
  };
  logger.info('demo_profile_loaded', { userId, reason, summary: { ...result.summary, sessionId: undefined, consentId: undefined } });
  return result;
}

export function refreshDemoProfile(db, userId) {
  return loadDemoProfile(db, userId, { reason: 'refresh' });
}

// ---------------------------------------------------------------------------
// Reset — deletes ONLY the calling user's demo rows (real data untouched).
// ---------------------------------------------------------------------------
export function resetDemoProfile(db, userId) {
  assertDemoAllowed();

  const counts = {
    holdings: db.prepare(`SELECT COUNT(*) c FROM holdings WHERE user_id=? AND (is_demo=1 OR security_id IN (SELECT id FROM securities WHERE provider='demo') OR account_id IN (SELECT id FROM accounts WHERE provider='demo'))`).get(userId).c,
    transactions: db.prepare(`SELECT COUNT(*) c FROM transactions WHERE user_id=? AND (source_txn_id LIKE 'DEMO-TXN-%' OR provider_ref LIKE 'DEMO-TXN-%' OR is_demo=1)`).get(userId).c,
    securities: db.prepare(`SELECT COUNT(*) c FROM securities WHERE user_id=? AND (provider='demo' OR is_demo=1)`).get(userId).c,
    goals: db.prepare('SELECT COUNT(*) c FROM goals WHERE user_id=? AND (is_demo=1 OR name LIKE ?)').get(userId, `${DEMO_GOAL_PREFIX}%`).c,
    budgets: db.prepare(`SELECT COUNT(*) c FROM budgets WHERE user_id=? AND is_demo=1`).get(userId).c,
    snapshots: db.prepare(`SELECT COUNT(*) c FROM snapshots WHERE user_id=? AND is_demo=1`).get(userId).c,
    accounts: db.prepare(`SELECT COUNT(*) c FROM accounts WHERE user_id=? AND (provider='demo' OR external_ref LIKE 'DEMO-%' OR is_demo=1)`).get(userId).c,
    sessions: db.prepare(`SELECT COUNT(*) c FROM aa_sessions WHERE user_id=? AND provider='demo'`).get(userId).c,
  };

  db.transaction(() => {
    db.prepare(`DELETE FROM holdings WHERE user_id=? AND (is_demo=1 OR security_id IN (SELECT id FROM securities WHERE provider='demo') OR account_id IN (SELECT id FROM accounts WHERE provider='demo'))`).run(userId);
    db.prepare(`DELETE FROM transactions WHERE user_id=? AND (source_txn_id LIKE 'DEMO-TXN-%' OR provider_ref LIKE 'DEMO-TXN-%' OR is_demo=1)`).run(userId);
    db.prepare(`DELETE FROM securities WHERE user_id=? AND (provider='demo' OR is_demo=1)`).run(userId);
    db.prepare(`DELETE FROM budgets WHERE user_id=? AND is_demo=1`).run(userId);
    db.prepare('DELETE FROM goals WHERE user_id=? AND (is_demo=1 OR name LIKE ?)').run(userId, `${DEMO_GOAL_PREFIX}%`);
    db.prepare(`DELETE FROM snapshots WHERE user_id=? AND is_demo=1`).run(userId);
    db.prepare(`DELETE FROM notifications WHERE user_id=? AND type='demo'`).run(userId);
    db.prepare(`DELETE FROM accounts WHERE user_id=? AND (provider='demo' OR external_ref LIKE 'DEMO-%' OR is_demo=1)`).run(userId);
    db.prepare(`DELETE FROM aa_sessions WHERE user_id=? AND provider='demo'`).run(userId);
  })();

  logger.info('demo_profile_reset', { userId, counts });
  return { ok: true, deleted: counts };
}

export default { demoStatus, loadDemoProfile, refreshDemoProfile, resetDemoProfile, DEMO_TXN_PREFIX, DEMO_REF_PREFIX };
