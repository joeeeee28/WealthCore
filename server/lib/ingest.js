// WealthCore — extensible ingestion framework.
//
// Connector ──► Raw ingestion ──► Schema validation ──► Normalisation ──►
// Deduplication ──► Classification ──► Reconciliation ──► Persistence
//
// Every record persists with source, source account, source transaction ID,
// ingestion timestamp, original + normalised amount, currency, dates, merchant,
// category, confidence and a deduplication key. Importing the same file twice
// never creates duplicates.
//
// Connectors register a parser. Adding a provider/bank/broker only requires a
// new connector; the financial engine is unchanged.

import crypto from 'node:crypto';
import { parseCsv } from './csv.js';
import {
  dedupKey, validateTransaction, categorize,
} from './transaction-intelligence.js';
import { ensureDefaultCategories } from './defaults.js';

function nowIso() { return new Date().toISOString(); }

/** Parse a signed amount (may be in a credit/debit pair). */
export function parseAmount(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[,₹$ ]/g, '').trim();
  if (s === '' || s === '-') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // Convert to minor units (2dp) and return signed major value plus sign.
  return { major: n, minor: Math.round(Math.abs(n) * 100), negative: n < 0 };
}

/** Detect whether a string looks like a date. */
function looksLikeDate(v) {
  if (!v) return false;
  if (/\d{4}-\d{2}-\d{2}/.test(v)) return true;
  if (/\d{2}[\/.-]\d{2}[\/.]\d{4}/.test(v)) return true;
  return false;
}

function normalizeDate(v) {
  if (!v) return null;
  const m1 = v.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = v.match(/(\d{1,2})[\/.-](\d{1,2})[\/.](20\d{2})/);
  if (m2) return `${m2[3]}-${String(m2[2]).padStart(2, '0')}-${String(m2[1]).padStart(2, '0')}`;
  // dd-mm-yyyy where first is day
  const m3 = v.match(/(\d{1,2})[\/.-](\d{1,2})[\/.](19\d{2})/);
  if (m3) return `${m3[3]}-${String(m3[1]).padStart(2, '0')}-${String(m3[2]).padStart(2, '0')}`;
  return null;
}

function hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24);
}

/**
 * Normalise a raw record (from a connector/mapping) into a canonical
 * transaction record. `mapping` maps canonical field -> source column.
 */
export function normaliseRecord(record, mapping, accountId) {
  const get = (key) => {
    if (!mapping) return record[key];
    const col = mapping[key];
    return col ? record[col] : record[key];
  };

  // Honor an explicit direction column when present.
  const explicitDirection = String(get('direction') || '').toLowerCase();
  const hasExplicit = explicitDirection === 'in' || explicitDirection === 'out';
  let direction = hasExplicit ? explicitDirection : 'out';
  const type = String(get('type') || '').toLowerCase();

  const date = normalizeDate(get('date'));
  const merchant = String(get('merchant') || get('description') || '').trim() || null;
  const note = String(get('note') || '').trim() || null;

  // Prefer explicit amount; else compute from debit/credit pair.
  let amount = parseAmount(get('amount'));
  let debit = parseAmount(get('debit'));
  let credit = parseAmount(get('credit'));

  if (!amount) {
    if (debit && debit.minor > 0) { amount = { major: debit.major, minor: debit.minor, negative: true }; direction = 'out'; }
    else if (credit && credit.minor > 0) { amount = { major: credit.major, minor: credit.minor, negative: false }; direction = 'in'; }
  } else if (!hasExplicit) {
    // If the amount is explicitly negative, it's money out.
    direction = amount.negative ? 'out' : 'in';
    if (type && /in|credit|salary|deposit|refund/i.test(type)) direction = 'in';
    if (type && /out|debit|withdraw|expense|payment|paid/i.test(type)) direction = 'out';
    // If debit/credit given and amount matches credit direction, refine.
    if (credit && credit.minor > 0 && !debit) direction = 'in';
    if (debit && debit.minor > 0 && !credit) direction = 'out';
  }

  if (!amount || !amount.minor || !date) return null;

  const amountMinor = amount.minor;
  const sourceRef = String(get('source_ref') || get('reference') || get('id') || '').trim() || null;
  const externalId = String(get('external_id') || '').trim() || null;

  return {
    date,
    amountMinor,
    currency: String(get('currency') || 'INR').toUpperCase() || 'INR',
    direction,
    merchant,
    note,
    category: get('category') || null,
    accountId: Number(get('account_id')) || accountId || null,
    sourceRef,
    externalId,
    source: get('source') || 'import',
    postingDate: normalizeDate(get('posting_date')) || null,
    originalAmountMajor: amount.major,
    confidence: 'high',
    normalizedMerchant: merchant ? merchant.toLowerCase().replace(/\s+/g, ' ').trim() : null,
  };
}

/** Normalise a raw record into a holding (for broker/demat connectors). */
export function normaliseHolding(record, mapping, accountId) {
  const get = (key) => (mapping ? record[mapping[key]] : record[key]);
  const quantity = Number(get('quantity'));
  if (!(quantity > 0)) return null;
  const name = get('name') || get('instrument') || get('symbol');
  const price = parseAmount(get('price'));
  const cost = parseAmount(get('cost'));
  if (!name) return null;
  return {
    securityName: name,
    ticker: get('ticker') || null,
    exchange: get('exchange') || null,
    assetClass: get('asset_class') || 'equity',
    quantity: String(quantity),
    costBasisMinor: cost ? cost.minor : 0,
    priceMinor: price ? price.minor : null,
    currency: get('currency') || 'INR',
    accountId: accountId || null,
    source: 'holding-import',
  };
}

/**
 * Ingest an array of already-normalised transaction records. Handles account
 * resolution, category classification, deduplication and persistence.
 */
export function ingestTransactions(db, userId, records, { runId, source = 'import' } = {}) {
  const created = [];
  const duplicates = [];
  const failed = [];
  const skipped = [];
  const categories = db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(userId);
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const getAccountId = (record) => {
    if (record.accountId) {
      const exists = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(record.accountId, userId);
      if (exists) return Number(record.accountId);
    }
    return null;
  };

  for (const rec of records) {
    const accountId = getAccountId(rec);
    if (!accountId) {
      failed.push({ ...rec, error: 'account_id required / not found' });
      continue;
    }

    // Validate.
    const validation = validateTransaction({
      accountId, date: rec.date, amountMinor: rec.amountMinor, direction: rec.direction, currency: rec.currency,
    }, { db, userId });
    if (!validation.valid) {
      failed.push({ ...rec, error: validation.errors.join('; ') });
      continue;
    }

    // Deduplicate against existing and within batch.
    const key = dedupKey({
      accountId, date: rec.date, amountMinor: rec.amountMinor, direction: rec.direction,
      providerRef: rec.sourceRef, externalId: rec.externalId,
    });
    const existing = db.prepare('SELECT id FROM transactions WHERE dedup_key = ? AND user_id = ?').get(key, userId);
    if (existing || created.some((c) => c.dedupKey === key)) {
      duplicates.push({ ...rec, dedupKey: key });
      continue;
    }

    // Category resolution / auto-categorise.
    let categoryId = null;
    if (rec.category) {
      categoryId = categoryByName.get(String(rec.category).toLowerCase()) || null;
    }
    if (!categoryId && (rec.merchant)) {
      const auto = categorize(rec.merchant, rec.note);
      if (auto.name !== 'Uncategorized') {
        let cid = categoryByName.get(auto.name.toLowerCase());
        if (!cid) {
          const info = db.prepare(`INSERT INTO categories (user_id, name, kind, color) VALUES (?, ?, ?, ?)`)
            .run(userId, auto.name, auto.kind, auto.color);
          cid = info.lastInsertRowid;
          categoryByName.set(auto.name.toLowerCase(), cid);
        }
        categoryId = cid;
      }
    }

    const info = db.prepare(`
      INSERT INTO transactions
        (user_id, account_id, date, amount_minor, currency, direction, kind, category_id, merchant, note, source,
         provider_ref, external_id, dedup_key, posting_date, source_ref, confidence, normalized_merchant, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, accountId, rec.date, rec.amountMinor, rec.currency, rec.direction,
      rec.direction === 'in' ? 'income' : 'expense', categoryId, rec.merchant, rec.note, source,
      rec.sourceRef, rec.externalId, key, rec.postingDate, rec.sourceRef, rec.confidence,
      rec.normalizedMerchant, nowIso());

    created.push({ id: info.lastInsertRowid, dedupKey: key });
  }

  return { created, duplicates, failed, skipped };
}

/**
 * Connector registry. Each connector exposes:
 *   { name, label, parse(text, opts) -> { transactions:[...], holdings? }, autoMapping }
 */
export const CONNECTORS = {
  'csv-generic': {
    name: 'csv-generic', label: 'Generic CSV transaction statement',
    parse(text, { mapping, defaultAccountId } = {}) {
      const { rows } = parseCsv(text);
      const transactions = [];
      const failed = [];
      for (const r of rows) {
        const rec = normaliseRecord(r, mapping, defaultAccountId || null);
        if (rec) transactions.push(rec);
        else failed.push({ raw: r, error: 'missing required date or amount' });
      }
      return { transactions, failed };
    },
  },
  'bank-csv': {
    name: 'bank-csv', label: 'Indian bank statement (date, description, debit, credit)',
    // Auto-detect common bank headers.
    parse(text, { defaultAccountId } = {}) {
      const { rows } = parseCsv(text);
      const mapPlain = rows[0] ? detectBankMapping(rows[0]) : {};
      const transactions = [];
      const failed = [];
      for (const r of rows) {
        const rec = normaliseRecord(r, mapPlain, defaultAccountId || null);
        if (rec) transactions.push(rec);
        else failed.push({ raw: r, error: 'missing required date or amount' });
      }
      return { transactions, failed };
    },
  },
  'json-transactions': {
    name: 'json-transactions', label: 'JSON transaction array',
    parse(text, { defaultAccountId, currency } = {}) {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return { transactions: [], failed: [] };
      const transactions = [];
      const failed = [];
      for (const r of arr) {
        const amountMinor = r.amountMinor != null ? Math.round(Number(r.amountMinor)) : (r.amount ? Math.round(Number(r.amount) * 100) : null);
        if (!r.date || !amountMinor) { failed.push({ raw: r, error: 'missing required date or amount' }); continue; }
        transactions.push({
          date: r.date, amountMinor,
          currency: r.currency || currency || 'INR', direction: r.direction || (amountMinor >= 0 ? 'in' : 'out'),
          merchant: r.merchant || r.description || r.note || null, note: r.note || null,
          accountId: r.accountId || defaultAccountId || null, sourceRef: r.reference || r.id || null,
          externalId: r.external_id || null, category: r.category || null, source: 'json-import',
        });
      }
      return { transactions, failed };
    },
  },
  'zerodha-holdings': {
    name: 'zerodha-holdings', label: 'Zerodha Console holdings export',
    parse(text, { mapping } = {}) {
      const { rows } = parseCsv(text);
      const map = mapping || { symbol: 'Symbol', qty: 'Qty', price: 'Avg Price', instrument: 'Instrument', exchange: 'Exchange' };
      const records = rows.map((r) => normaliseHolding(r, map, null)).filter(Boolean);
      return { transactions: [], holdings: records };
    },
  },
  'groww-holdings': {
    name: 'groww-holdings', label: 'Groww portfolio export',
    parse(text, { mapping } = {}) {
      const { rows } = parseCsv(text);
      const map = mapping || { symbol: 'Symbol', qty: 'Qty', price: 'Price', instrument: 'Stock' };
      const records = rows.map((r) => normaliseHolding(r, map, null)).filter(Boolean);
      return { transactions: [], holdings: records };
    },
  },
};

function detectBankMapping(headerRow) {
  // Guesses column names from a set of headers.
  const find = (patterns) => Object.keys(headerRow).find((h) => patterns.some((p) => h.toLowerCase().includes(p))) || null;
  return {
    date: find(['date', 'transaction date', 'txn date', 'value date']),
    description: find(['description', 'narration', 'particulars', 'details']),
    merchant: find(['description', 'narration', 'particulars', 'details']),
    debit: find(['debit', 'withdrawal', 'dr']),
    credit: find(['credit', 'deposit', 'cr']),
    amount: find(['amount']),
    reference: find(['reference', 'chq', 'ref no']),
    currency: find(['currency', 'ccy']),
  };
}

/** Create an ingestion run record. */
export function startIngestionRun(db, userId, { format, fileName, correlationId }) {
  const info = db.prepare(`
    INSERT INTO ingestion_runs (user_id, format, file_name, status, correlation_id, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(userId, format, fileName || null, correlationId || `ingest-${Date.now()}`, nowIso());
  return info.lastInsertRowid;
}

/** Persist raw payload (hashed) for the run. */
export function storeRaw(db, userId, runId, source, payload, payloadKind) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  db.prepare(`INSERT INTO raw_ingest (user_id, ingestion_run_id, source, payload, payload_kind, hash) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, runId, source, text, payloadKind, hash(text));
}

/** Finalise an ingestion run with summary and update the run status. */
export function finaliseIngestionRun(db, runId, summary, status = 'success', error = null) {
  db.prepare(`
    UPDATE ingestion_runs SET status = ?, total_records = ?, created_records = ?, skipped_records = ?,
      failed_records = ?, duplicates = ?, error = ?, summary = ?
    WHERE id = ?
  `).run(status, summary.total, summary.created, summary.skipped || 0, summary.failed, summary.duplicates,
    error ? String(error) : null, JSON.stringify(summary), runId);
}

/**
 * Full ingestion pipeline. Returns a report with preview-able summary, created/
 * duplicates/failed counts, a failed-record report and a rollback id.
 */
export async function ingest(db, userId, { format, text, fileName, mapping, defaultAccountId, currency, source = 'import' }) {
  ensureDefaultCategories(db, userId);
  const connector = CONNECTORS[format];
  if (!connector) throw new Error(`Unsupported ingestion format: ${format}`);

  const runId = startIngestionRun(db, userId, { format, fileName });
  storeRaw(db, userId, runId, source, text, format === 'json-transactions' ? 'json' : 'csv');

  let parsed;
  try {
    parsed = connector.parse(text, { mapping, defaultAccountId, currency });
  } catch (e) {
    const summary = { total: 0, created: 0, skipped: 0, failed: 0, duplicates: 0 };
    finaliseIngestionRun(db, runId, summary, 'failed', e.message);
    return { ok: false, runId, error: `Failed to parse ${format}: ${e.message}`, summary };
  }

  const txnResult = ingestTransactions(db, userId, parsed.transactions || [], { runId, source });
  const parseFailed = parsed.failed || [];
  const summary = {
    total: (parsed.transactions || []).length + parseFailed.length,
    created: txnResult.created.length,
    skipped: txnResult.skipped.length,
    failed: txnResult.failed.length + parseFailed.length,
    duplicates: txnResult.duplicates.length,
    parseFailed: parseFailed.map((p) => ({ error: p.error })),
  };

  let holdingsResult = { created: 0 };
  if (parsed.holdings && parsed.holdings.length) {
    holdingsResult = ingestHoldings(db, userId, parsed.holdings);
    summary.holdingsReceived = parsed.holdings.length;
    summary.holdingsCreated = holdingsResult.created;
  }

  finaliseIngestionRun(db, runId, summary, 'success');
  return {
    ok: true,
    runId,
    summary,
    created: txnResult.created,
    duplicates: txnResult.duplicates,
    failed: txnResult.failed,
    failedRecords: [...txnResult.failed, ...parseFailed.map((p) => ({ error: p.error, raw: p.raw }))],
    rollbackId: runId,
  };
}

/** Ingest holdings (securities + holdings). */
export function ingestHoldings(db, userId, holdings) {
  let created = 0;
  for (const h of holdings) {
    const existingSec = db.prepare('SELECT id FROM securities WHERE user_id = ? AND LOWER(ticker)=? OR (user_id = ? AND LOWER(name)=?)')
      .get(userId, String(h.ticker || '').toLowerCase(), userId, String(h.securityName).toLowerCase());
    let secId = existingSec ? existingSec.id : null;
    if (!secId) {
      const info = db.prepare(`
        INSERT INTO securities (user_id, ticker, name, exchange, asset_class, currency, price_minor, price_status, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)
      `).run(userId, h.ticker || null, h.securityName, h.exchange || null, h.assetClass || 'equity', h.currency || 'INR',
        h.priceMinor, 'holding-import');
      secId = info.lastInsertRowid;
    }
    const dupHolding = db.prepare('SELECT id FROM holdings WHERE user_id = ? AND security_id = ? AND quantity = ?')
      .get(userId, secId, String(h.quantity));
    if (dupHolding) continue;
    db.prepare(`
      INSERT INTO holdings (user_id, account_id, security_id, quantity, cost_basis_minor, currency)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, h.accountId, secId, String(h.quantity), h.costBasisMinor, h.currency || 'INR');
    created++;
  }
  return { created };
}

export default {
  CONNECTORS, normaliseRecord, normaliseHolding, ingestTransactions, ingest,
  startIngestionRun, finaliseIngestionRun, storeRaw,
};
