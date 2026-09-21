// WealthCore — AA sync orchestration.
//
// Runs the complete lifecycle end-to-end and persists normalized data into the
// EXISTING WealthCore tables (accounts, transactions, securities, holdings)
// with idempotency and provenance. Records each run in `sync_runs`.
//
//   Connect → Consent → Approve → Request FI → Data Ready → Fetch FI
//   → Normalize → Deduplicate → Store → (dashboard recalculates from DB)
//
// A DB consent row (provider + consent handle) is the source of truth for the
// consent lifecycle; this module consumes it to fetch + normalize data.

import * as money from '../lib/money.js';
import { dedupKey } from '../lib/transaction-intelligence.js';
import { ensureDefaultCategories } from '../lib/defaults.js';
import { computeNetWorth } from '../lib/networth.js';
import { computePortfolio } from '../lib/portfolio.js';
import { resolveAAPProvider } from './interface.js';
import { normalizeFinancialData } from './rebit-normalizer.js';
import { aaError, AA_ERROR_CODES } from './errors.js';
import MockAAProvider from './providers/mock.js';
import logger from '../lib/logger.js';

function nowIso() { return new Date().toISOString(); }

function categoryId(db, userId, name, kind) {
  if (!name) return null;
  const existing = db.prepare('SELECT id FROM categories WHERE user_id=? AND LOWER(name)=?').get(userId, name.toLowerCase());
  if (existing) return existing.id;
  const color = { income: '#3b82f6', savings: '#22c55e', expense: '#ef4444', transfer: '#94a3b8' }[kind] || '#8b5cf6';
  const info = db.prepare('INSERT INTO categories (user_id, name, kind, color) VALUES (?, ?, ?, ?)').run(userId, name, kind, color);
  return info.lastInsertRowid;
}

function upsertAccount(db, userId, account, source = 'aa') {
  if (!account.external_ref) return { id: null, created: false };
  const existing = db.prepare('SELECT * FROM accounts WHERE user_id=? AND external_ref=?').get(userId, account.external_ref);
  if (existing) return { id: existing.id, created: false };
  const info = db.prepare(`
    INSERT INTO accounts (user_id, name, type, institution, currency, balance_minor, is_liability, source, provider, external_ref, aa_status, is_demo, last_synced_at, masked_account_number, provider_ref, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', 1, ?, ?, ?, ?)
  `).run(userId, account.name, account.type, account.fip || null, account.currency,
    account.balanceMinor, account.isLiability ? 1 : 0, source, account.provider || account.fip || 'mock',
    account.external_ref, nowIso(), account.maskedAccountNumber || null, account.external_ref, `sync-${Date.now()}`);
  return { id: info.lastInsertRowid, created: true };
}

function upsertTransaction(db, userId, tx, source = 'aa') {
  if (!tx.sourceTxnId && !tx.accountId) return { created: false };
  const bySource = tx.sourceTxnId
    ? db.prepare('SELECT id FROM transactions WHERE user_id=? AND source_txn_id=?').get(userId, tx.sourceTxnId)
    : null;
  if (bySource) return { created: false, id: bySource.id };

  const key = dedupKey({ accountId: tx.accountId, date: tx.date, amountMinor: tx.amountMinor, direction: tx.direction, providerRef: tx.sourceTxnId });
  const byKey = db.prepare('SELECT id FROM transactions WHERE user_id=? AND dedup_key=?').get(userId, key);
  if (byKey) return { created: false, id: byKey.id };

  const cid = categoryId(db, userId, tx.category, tx.kind);
  const info = db.prepare(`
    INSERT INTO transactions (user_id, account_id, date, amount_minor, currency, direction, kind, category_id, merchant, note, source, provider_ref, external_id, dedup_key, source_txn_id, fip, ingested_at, is_demo)
    VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(userId, tx.accountId, tx.date, tx.amountMinor, tx.direction, tx.kind, cid,
    tx.merchant, null, source, tx.sourceTxnId, tx.sourceTxnId, key, tx.sourceTxnId, tx.fip, nowIso());
  return { created: true, id: info.lastInsertRowid };
}

function upsertHolding(db, userId, holding, providerName = 'mock') {
  if (!holding.securityName) return { created: false };
  let secId = db.prepare('SELECT id FROM securities WHERE user_id=? AND LOWER(name)=LOWER(?)').get(userId, holding.securityName)?.id;
  if (!secId) {
    const info = db.prepare(`
      INSERT INTO securities (user_id, ticker, name, exchange, asset_class, currency, price_minor, price_status, provider, is_demo)
      VALUES (?, ?, ?, NULL, ?, ?, ?, 'MANUAL', ?, 1)
    `).run(userId, holding.ticker || null, holding.securityName, holding.assetClass || 'equity', holding.currency || 'INR', holding.priceMinor || null, providerName);
    secId = info.lastInsertRowid;
  }
  const existing = db.prepare('SELECT id FROM holdings WHERE user_id=? AND security_id=? AND quantity=?').get(userId, secId, holding.quantity);
  if (existing) return { created: false, id: existing.id };
  const info = db.prepare(`
    INSERT INTO holdings (user_id, account_id, security_id, quantity, cost_basis_minor, currency, is_demo)
    VALUES (?, NULL, ?, ?, ?, ?, 1)
  `).run(userId, secId, holding.quantity, holding.costBasisTotalMinor, holding.currency || 'INR');
  return { created: true, id: info.lastInsertRowid };
}

/**
 * Run a full sync for a user with the selected provider.
 * `consentRow` (optional) is the DB consent row (provider + external_ref). If no
 * consentId is supplied, a Mock consent is created + approved.
 * Returns a detailed run summary and the recalculated net worth/portfolio.
 */
export async function runAASync(db, userId, { providerName, consentId, customerHandle, fiTypes, purpose, dataRange, frequency, dbConsentId } = {}) {
  ensureDefaultCategories(db, userId);
  const provider = resolveAAPProvider({ provider: providerName || 'mock' });
  const runStart = nowIso();
  let useProviderConsentId = consentId;

  if (!useProviderConsentId) {
    const created = await provider.createConsent({
      provider: provider.name, fiTypes, purpose, dataRange, frequency, customerHandle,
    });
    useProviderConsentId = created.consent ? created.consent.consentId : created.consentId;
    // Documented contract (see header): a consent created implicitly during a
    // sync is created AND approved — the demo/mock providers complete the
    // approval step locally; real providers always come through an explicit,
    // already-approved DB consent (the branch below), never this path.
    if (provider.approveConsent) {
      const approved = await provider.approveConsent(useProviderConsentId);
      if (!approved || (approved.status !== 'approved' && approved.status !== 'active')) {
        throw aaError(AA_ERROR_CODES.CONSENT_REJECTED, 'Consent could not be approved', { consentId: useProviderConsentId });
      }
    }
  } else {
    const st = await provider.getConsentStatus(useProviderConsentId);
    if (!st) throw aaError(AA_ERROR_CODES.CONSENT_NOT_FOUND, 'Consent not found on provider', { consentId: useProviderConsentId });
    if (st.status === 'rejected') throw aaError(AA_ERROR_CODES.CONSENT_REJECTED, 'Consent was rejected', { consentId: useProviderConsentId });
    if (st.status === 'revoked') throw aaError(AA_ERROR_CODES.CONSENT_REVOKED, 'Consent was revoked', { consentId: useProviderConsentId });
    if (st.status === 'expired') throw aaError(AA_ERROR_CODES.CONSENT_EXPIRED, 'Consent has expired', { consentId: useProviderConsentId });
    if (st.status !== 'approved' && st.status !== 'active') {
      const approved = await provider.approveConsent(useProviderConsentId);
      if (!approved || (approved.status !== 'approved' && approved.status !== 'active')) {
        throw aaError(AA_ERROR_CODES.CONSENT_REJECTED, 'Consent could not be approved', { consentId: useProviderConsentId });
      }
    }
  }

  const fiReq = await provider.requestFIData({ consentId: useProviderConsentId });
  const sessionId = fiReq.sessionId;
  if (provider.markDataReady) await provider.markDataReady({ consentId: useProviderConsentId });
  const fetched = await provider.getFIData(sessionId);
  // Provider-specific adapters translate their raw response into the canonical
  // envelope; the shared rebit-normalizer then maps it to domain rows. Mock does
  // this trivially (returns the envelope unchanged); Setu translates ReBIT JSON.
  const envelope = provider.normalizeFinancialData
    ? provider.normalizeFinancialData(fetched)
    : fetched;
  const normalized = normalizeFinancialData(envelope);

  // Synthetic (demo) providers mark every persisted record source='DEMO';
  // all other providers keep the standard 'aa' provenance. Never changed for
  // mock/finvu/setu — existing behaviour is preserved.
  const recordSource = provider.synthetic ? 'DEMO' : 'aa';

  const accountByRef = new Map();
  let accountsCreated = 0, accountsUpdated = 0;
  for (const a of normalized.accounts) {
    const res = upsertAccount(db, userId, { ...a, provider: provider.name }, recordSource);
    if (res.id) { accountByRef.set(a.external_ref, res.id); if (res.created) accountsCreated++; else accountsUpdated++; }
  }
  for (const a of normalized.accounts) {
    if (a.external_ref && !accountByRef.has(a.external_ref)) {
      const row = db.prepare('SELECT id FROM accounts WHERE user_id=? AND external_ref=?').get(userId, a.external_ref);
      if (row) accountByRef.set(a.external_ref, row.id);
    }
  }

  let txCreated = 0, txDuplicates = 0;
  for (const t of normalized.transactions) {
    t.accountId = t.accountId || accountByRef.get(t.accountExternalRef) || null;
    const res = upsertTransaction(db, userId, t, recordSource);
    if (res.created) txCreated++; else txDuplicates++;
  }

  let holdingsCreated = 0, holdingsDuplicates = 0;
  for (const h of normalized.holdings) {
    const res = upsertHolding(db, userId, h, provider.name);
    if (res.created) holdingsCreated++; else holdingsDuplicates++;
  }

  const syncedAt = nowIso();
  db.prepare(`UPDATE accounts SET last_synced_at=? WHERE user_id=? AND source=?`).run(syncedAt, userId, recordSource);

  // Record the FI data session for provenance. A provider may reuse a session id
  // across repeated syncs in a sandbox; treat that as idempotent (update, don't
  // fail), so a re-sync never hard-fails purely on session persistence.
  const existingSession = db.prepare('SELECT id FROM aa_sessions WHERE user_id=? AND provider=? AND session_id=?').get(userId, provider.name, sessionId);
  if (existingSession) {
    db.prepare(`UPDATE aa_sessions SET status='fetched', ready_at=?, fetched_at=?, correlation_id=?, consent_id=COALESCE(?, consent_id) WHERE id=?`)
      .run(syncedAt, syncedAt, `sync-${Date.now()}`, dbConsentId || null, existingSession.id);
  } else {
    db.prepare(`
      INSERT INTO aa_sessions (user_id, consent_id, provider, session_id, status, requested_at, ready_at, fetched_at, correlation_id)
      VALUES (?, ?, ?, ?, 'fetched', ?, ?, ?, ?)
    `).run(userId, dbConsentId || null, provider.name, sessionId, runStart, syncedAt, syncedAt, `sync-${Date.now()}`);
  }

  const summary = {
    totalAccounts: normalized.accounts.length,
    accountsCreated, accountsUpdated,
    totalTransactions: normalized.transactions.length,
    transactionsCreated: txCreated,
    transactionsDuplicates: txDuplicates,
    totalHoldings: normalized.holdings.length,
    holdingsCreated,
    holdingsDuplicates,
    provider: provider.name,
    mode: provider.mode,
    sessionId,
    consentId: useProviderConsentId,
    syncedAt,
  };

  db.prepare(`INSERT INTO sync_runs (user_id, provider, status, started_at, finished_at, records_processed, errors)
    VALUES (?, ?, 'success', ?, ?, ?, ?)`)
    .run(userId, provider.name, runStart, syncedAt, summary.transactionsCreated + summary.accountsCreated + summary.holdingsCreated, null);

  logger.info('aa_sync_completed', { userId, provider: provider.name, ...summary });

  const netWorth = computeNetWorth(db, userId);
  const portfolio = computePortfolio(db, userId);
  return { ok: true, summary, recalculated: { netWorth, portfolio } };
}

export default { runAASync };
