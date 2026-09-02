// WealthCore — REST API router.
//
// All endpoints return amounts as integer minor units (currency-aware). The
// client formats for display. Authentication uses a bearer session token (and
// optionally an httpOnly session cookie). Mutating cookie-authenticated requests
// require a valid CSRF token in the X-CSRF-Token header.

import express from 'express';
import { getDb } from '../db.js';
import * as money from '../lib/money.js';
import * as auth from '../lib/auth.js';
import { computeNetWorth, recordSnapshot, getHoldingsValuation } from '../lib/networth.js';
import { computePortfolio } from '../lib/portfolio.js';
import { aaIntegrationStatus, createConsent, approveConsent, rejectConsent, revokeConsent, expireConsents, requestFinancialData } from '../lib/aa-integration.js';
import { listAAPProviders, resolveAAPProvider, normalizeFinancialData, runAASync, AA_ERROR_CODES, toAAError, consentStateFlow, dataStateFlow, getAAPProvider } from '../aa/index.js';
import { refreshPrices, priceFreshness, marketProviderConfig } from '../lib/market-data.js';
import { dedupKey, validateTransaction, detectTransfer, categorize, detectRecurring } from '../lib/transaction-intelligence.js';
import * as calc from '../lib/calculations.js';
import { newContext, resolvePlan, runPlan, appendMessage, llmStatus } from '../lib/ai-agent.js';
import { ensureDefaultCategories, seedDemoData } from '../lib/defaults.js';
import { config } from '../config.js';
import { runAllReconciliations, reconciliationHistory, resolveReconciliation, recordReconciliationRun, reconciliationForAccount } from '../lib/reconciliation.js';
import { preferencesFor, updatePreference, evaluate } from '../lib/notifications.js';
import { ingest, CONNECTORS } from '../lib/ingest.js';
import { JOB_RUNNERS } from '../lib/scheduler.js';
import logger from '../lib/logger.js';

const router = express.Router();
const db = getDb();
const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function err(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function audit(userId, action, detail, ip) {
  db.prepare(`INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)`)
    .run(userId ?? null, action, detail ?? null, ip ?? null);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Session token resolution: bearer token first, then httpOnly session cookie.
function resolveToken(req) {
  return bearer(req) || (req.cookies && req.cookies.wc_session) || null;
}

// ---- Auth middleware ----
router.use((req, _res, next) => {
  const token = resolveToken(req);
  req.token = token;
  if (token) {
    req.session = auth.getSession(db, token);
    if (req.session) {
      req.user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.session.user_id);
      req.authVia = bearer(req) ? 'bearer' : 'cookie';
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return err(res, 401, 'NOT_AUTHENTICATED', 'Please sign in.');
  next();
}

function requireUnlocked(req, res, next) {
  if (req.session && auth.isAppLocked(req.session)) {
    return err(res, 423, 'APP_LOCKED', 'Application is locked. Please unlock.');
  }
  next();
}

// CSRF: only enforced for cookie-authenticated, state-changing requests.
function requireCsrf(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  if (req.authVia !== 'cookie') return next();
  const token = req.get('x-csrf-token');
  if (!token || !auth.verifyCsrfToken(token, req.token)) {
    return err(res, 403, 'CSRF_INVALID', 'Invalid or missing CSRF token.');
  }
  next();
}
router.use(requireCsrf);

function setSessionCookie(req, res, token) {
  const cfg = config();
  const opts = [
    `wc_session=${token}`,
    'HttpOnly',
    `Path=/`,
    `SameSite=${cfg.cookieSameSite}`,
    `Max-Age=${Math.floor(cfg.sessionTtlMs / 1000)}`,
  ];
  if (cfg.cookieSecure) opts.push('Secure');
  res.setHeader('Set-Cookie', opts.join('; '));
}

function sanitizeAccount(a) {
  return {
    id: a.id, name: a.name, type: a.type, institution: a.institution,
    currency: a.currency, balanceMinor: a.balance_minor, isLiability: !!a.is_liability,
    source: a.source, provider: a.provider, aaStatus: a.aa_status, isDemo: !!a.is_demo,
    lastSyncedAt: a.last_synced_at, createdAt: a.created_at, updatedAt: a.updated_at,
  };
}

// ---- Public / config ----
router.get('/config', (_req, res) => {
  const user = db.prepare('SELECT id FROM users LIMIT 1').get();
  const llmCfg = config().llm;
  res.json({
    name: 'WealthCore',
    tagline: 'Your Entire Financial Life. One Intelligent Core.',
    setupRequired: !user,
    aa: aaIntegrationStatus(),
    market: marketProviderConfig(),
    llm: { provider: llmCfg.provider || null, configured: llmCfg.configured, mode: llmCfg.configured ? 'PRODUCTION' : 'DEVELOPMENT' },
    scheduler: config().scheduler.enabled,
    version: 1,
  });
});

// ---- Auth ----
router.post('/auth/setup', (req, res) => {
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) {
    return err(res, 409, 'ALREADY_SETUP', 'WealthCore is already set up.');
  }
  const { email, name, password } = req.body || {};
  if (!email || !name || !password || password.length < 8) {
    return err(res, 400, 'INVALID_INPUT', 'A valid email, name and password (8+ chars) are required.');
  }
  const salt = auth.generateSalt();
  const hash = auth.hashPassword(password, salt);
  const info = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)`)
    .run(String(email).toLowerCase(), name, hash, salt);
  const token = auth.createSession(db, info.lastInsertRowid);
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(info.lastInsertRowid);
  ensureDefaultCategories(db, info.lastInsertRowid);
  audit(info.lastInsertRowid, 'user.setup', email);
  setSessionCookie(req, res, token);
  res.json({ token, csrf: auth.signCsrf(token), user: { id: info.lastInsertRowid, email, name } });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return err(res, 400, 'INVALID_INPUT', 'Email and password are required.');
  const identifier = String(email).toLowerCase();
  if (auth.isLoginBlocked(db, identifier)) {
    logger.warn('login_rate_limited', { identifier });
    return err(res, 429, 'RATE_LIMITED', 'Too many failed attempts. Try again later.');
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(identifier);
  if (!user || !auth.verifyPassword(password, user.password_salt, user.password_hash)) {
    auth.recordLoginAttempt(db, identifier, false, req.ip);
    audit(user?.id ?? null, 'auth.login_failed', email);
    return err(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  auth.recordLoginAttempt(db, identifier, true, req.ip);
  auth.clearLoginAttempts(db, identifier);
  const token = auth.createSession(db, user.id);
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(user.id);
  ensureDefaultCategories(db, user.id);
  audit(user.id, 'auth.login', email);
  setSessionCookie(req, res, token);
  res.json({ token, csrf: auth.signCsrf(token), user: { id: user.id, email: user.email, name: user.name } });
});

// CSRF token for cookie-authenticated clients.
router.get('/auth/csrf', requireAuth, (req, res) => {
  res.json({ csrf: auth.signCsrf(req.token) });
});

// Password reset: request (public, no-op-ish) + confirm.
router.post('/auth/password-reset/request', (req, res) => {
  const { email } = req.body || {};
  if (!email) return err(res, 400, 'INVALID_INPUT', 'email is required.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  // Always respond 200 to avoid user enumeration; only create a token if the user exists.
  if (user) {
    const token = auth.createPasswordReset(db, user.id);
    audit(user.id, 'auth.password_reset_request', '');
    // In a personal app the token is returned here for testing; a production
    // deployment would email it. Never log the token.
    res.json({ ok: true, resetToken: token, message: 'Reset token issued (would be emailed in production).' });
    return;
  }
  res.json({ ok: true, message: 'If the email exists, a reset token was issued.' });
});

router.post('/auth/password-reset/confirm', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) {
    return err(res, 400, 'INVALID_INPUT', 'token and a new password (8+ chars) are required.');
  }
  const reset = auth.verifyPasswordReset(db, token);
  if (!reset) return err(res, 400, 'INVALID_TOKEN', 'Reset token is invalid or expired.');
  auth.setPassword(db, reset.user_id, password);
  auth.consumePasswordReset(db, token);
  audit(reset.user_id, 'auth.password_reset', '');
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    session: {
      locked: auth.isAppLocked(req.session),
      appLockEnabled: Boolean(req.session.app_lock_enabled),
      expiresAt: req.session.expires_at,
    },
  });
});

router.post('/auth/logout', requireAuth, (req, res) => {
  auth.destroySession(db, req.token);
  if (req.cookies && req.cookies.wc_session) {
    res.setHeader('Set-Cookie', 'wc_session=; HttpOnly; Path=/; Max-Age=0');
  }
  audit(req.user.id, 'auth.logout', '');
  res.json({ ok: true });
});

router.post('/auth/lock', requireAuth, (req, res) => {
  auth.lockSession(db, req.token);
  audit(req.user.id, 'auth.lock', '');
  res.json({ ok: true, locked: true });
});

router.post('/auth/pin', requireAuth, (req, res) => {
  const { pin } = req.body || {};
  if (!pin || !/^\d{4,6}$/.test(String(pin))) return err(res, 400, 'INVALID_PIN', 'PIN must be 4-6 digits.');
  auth.enableAppLock(db, req.token, String(pin));
  audit(req.user.id, 'auth.pin_set', '');
  res.json({ ok: true });
});

router.post('/auth/unlock', (req, res) => {
  if (!req.session) return err(res, 401, 'NOT_AUTHENTICATED', 'No active session.');
  const { pin } = req.body || {};
  try {
    auth.unlockSession(db, req.token, String(pin));
    audit(req.user.id, 'auth.unlock', '');
    res.json({ ok: true });
  } catch (e) {
    err(res, 401, 'INVALID_PIN', e.message);
  }
});

// ---- Provider webhook (public — Setu calls this; signature-verified) ----
// Setu's current AA notifications post a payload shaped as:
//   Consent status: { type:"CONSENT_STATUS_UPDATE", consentId, notificationId,
//                     data:{ status:"ACTIVE|REJECTED|REVOKED|PAUSED|EXPIRED", detail } }
//   Session status: { type:"SESSION_STATUS_UPDATE", consentId, dataSessionId,
//                     data:{ status:"PENDING|PARTIAL|COMPLETED|EXPIRED|FAILED", fips, format } }
// The status is therefore under `payload.data.status`, NOT a top-level field.
router.post('/aa/webhook/setu', async (req, res) => {
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const signature = req.get('x-webhook-signature') || req.get('x-setu-signature') || '';
  const prov = getAAPProvider('setu');
  const payload = req.body || {};
  try {
    await prov.handleNotification({ rawBody, headers: { 'x-webhook-signature': signature }, payload });

    const type = String(payload.type || payload.event || '').toUpperCase();
    const consentRef = payload.consentId || payload.consent_id || (payload.data && payload.data.consentId) || null;
    const dataSessionId = payload.dataSessionId || payload.data_session_id || null;
    // Real Setu notifications carry status under data.status; tolerate the old
    // top-level `status` field for backward compatibility with earlier tests.
    const status = String((payload.data && payload.data.status) || payload.status || '').toUpperCase();
    const notificationId = payload.notificationId || payload.notification_id || null;

    // Idempotency: a notification is processed at most once per (provider, id).
    if (notificationId) {
      const seen = db.prepare('SELECT id FROM webhook_notifications WHERE provider=? AND notification_id=?').get('setu', notificationId);
      if (seen) return res.status(200).json({ ok: true, idempotent: true });
    }

    // Consent status-update notification → update the canonical consent state.
    if (consentRef) {
      const row = db.prepare("SELECT id FROM consents WHERE external_ref=? AND provider='setu'").get(consentRef);
      if (row) {
        const mapped = status === 'ACTIVE' || status === 'APPROVED' ? 'approved'
          : status === 'REJECTED' ? 'rejected'
          : status === 'REVOKED' ? 'revoked'
          : status === 'EXPIRED' ? 'expired'
          : status === 'PAUSED' ? 'paused' : null;
        if (mapped) {
          db.prepare(`UPDATE consents SET status=?, updated_at=datetime('now') WHERE id=?`).run(mapped, row.id);
        }
      }
    }

    // Session status-update notification → reflect the data-session lifecycle.
    if (dataSessionId) {
      const sess = db.prepare("SELECT id FROM aa_sessions WHERE session_id=? AND provider='setu'").get(dataSessionId);
      if (sess) {
        const sessionStatus = status === 'COMPLETED' ? 'ready'
          : status === 'PARTIAL' ? 'partial'
          : status === 'PENDING' ? 'data_requested'
          : status === 'EXPIRED' ? 'expired'
          : status === 'FAILED' ? 'failed' : null;
        if (sessionStatus) {
          const readyAt = (status === 'COMPLETED' || status === 'PARTIAL') ? new Date().toISOString() : null;
          db.prepare(`UPDATE aa_sessions SET status=?, ready_at=COALESCE(?, ready_at), fetched_at=COALESCE(
            CASE WHEN ? IN ('COMPLETED','PARTIAL') THEN datetime('now') END, fetched_at), error=CASE WHEN ? IN ('EXPIRED','FAILED') THEN COALESCE(error, ?) ELSE error END
            WHERE id=?`)
            .run(sessionStatus, readyAt, status, status, `setu session ${status.toLowerCase()}`, sess.id);
        }
      }
    }

    // Persist the notification id for idempotency/audit (no raw payload).
    if (notificationId) {
      db.prepare(`INSERT INTO webhook_notifications (provider, notification_id, type, consent_id, data_session_id, status) VALUES ('setu', ?, ?, ?, ?, ?)`)
        .run(notificationId, type || (dataSessionId ? 'SESSION_STATUS_UPDATE' : 'CONSENT_STATUS_UPDATE'), consentRef, dataSessionId, status || null);
    }

    audit(null, 'aa.webhook', `type=${type || 'unknown'} consent=${consentRef || '-'} session=${dataSessionId || '-'} status=${status || '-'}`, req.ip);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.code || 'WEBHOOK_REJECTED' });
  }
});

// ---- Setu consent return (public — browser lands here after the Setu consent
// journey; informational only). The authoritative consent status change comes
// from the verified webhook (/aa/webhook/setu), so this never mutates state
// from query params (unspoofable) and never logs secrets/tokens.
router.get('/aa/setu/consent/return', (req, res) => {
  // Only non-sensitive, non-authoritative ids are read; no secret, no payload.
  const requestId = String(req.query.request_id || req.query.consentId || req.query.id || '').slice(0, 80);
  if (requestId) audit(null, 'aa.setu.consent_return', `consent=${requestId}`, req.ip);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WealthCore — Consent</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:#1e293b;padding:32px 40px;border-radius:16px;max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;font-size:14px;line-height:1.5}</style>
</head><body><div class="card"><h1>Consent received</h1><p>You can now close this window and return to WealthCore. Your consent status will update via the secure notification. Open <strong>Integrations</strong> to review and synchronise your accounts.</p></div></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(html);
});

// ---- Everything below requires auth ----
router.use(requireAuth);

// ---- Dashboard ----
router.get('/dashboard', requireUnlocked, (req, res) => {
  const userId = req.user.id;
  const nw = computeNetWorth(db, userId);
  const portfolio = computePortfolio(db, userId);
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const income = Number(db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND date>=? AND date<? AND direction='in' AND status='active'`).get(userId, start, end).s || 0);
  const expense = Number(db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND date>=? AND date<? AND direction='out' AND status='active'`).get(userId, start, end).s || 0);
  const savingsRate = income > 0 ? (income - expense) / income : 0;

  const topExpenses = db.prepare(`
    SELECT c.name category, SUM(t.amount_minor) total FROM transactions t
    LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.user_id=? AND t.date>=? AND t.date<? AND t.direction='out' AND t.status='active'
    GROUP BY c.id ORDER BY total DESC LIMIT 5`).all(userId, start, end)
    .map((r) => ({ category: r.category || 'Uncategorized', totalMinor: Number(r.total) }));

  const snapshots = db.prepare(`SELECT * FROM snapshots WHERE user_id=? ORDER BY as_of DESC LIMIT 12`).all(userId)
    .map((s) => ({ id: s.id, asOf: s.as_of, netWorthMinor: s.net_worth_minor }));

  const notifications = db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20`).all(userId)
    .map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, severity: n.severity, read: !!n.read, createdAt: n.created_at }));

  const demoCount = Number(db.prepare('SELECT COUNT(*) c FROM accounts WHERE user_id=? AND is_demo=1').get(userId).c || 0);

  res.json({
    netWorth: { totalAssetsMinor: nw.totalAssetsMinor, totalLiabilitiesMinor: nw.totalLiabilitiesMinor, netWorthMinor: nw.netWorthMinor },
    portfolio: { totalValueMinor: portfolio.totalValueMinor, totalPnlMinor: portfolio.totalPnlMinor, totalPnlPct: portfolio.totalPnlPct, holdingsCount: portfolio.holdingsCount, unpricedCount: portfolio.unpricedCount },
    month: ym,
    incomeMinor: income,
    expenseMinor: expense,
    savingsRate,
    topExpenses,
    allocation: nw.assetClassBreakdown,
    snapshots,
    notifications,
    demoCount,
    aa: aaIntegrationStatus(),
  });
});

// ---- Accounts ----
router.get('/accounts', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY is_liability, type, name').all(req.user.id);
  res.json(rows.map(sanitizeAccount));
});

router.post('/accounts', requireUnlocked, (req, res) => {
  const { name, type, currency = 'INR', balanceMinor, institution, isLiability = false, source = 'manual' } = req.body || {};
  if (!name || !type) return err(res, 400, 'INVALID_INPUT', 'name and type are required.');
  let bal = 0;
  try { bal = Number(balanceMinor) || 0; } catch { return err(res, 400, 'INVALID_AMOUNT', 'balanceMinor must be an integer.'); }
  const info = db.prepare(`INSERT INTO accounts (user_id, name, type, institution, currency, balance_minor, is_liability, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, name, type, institution ?? null, currency, Math.round(bal), isLiability ? 1 : 0, source);
  audit(req.user.id, 'account.create', name);
  res.json({ account: sanitizeAccount(db.prepare('SELECT * FROM accounts WHERE id=?').get(info.lastInsertRowid)) });
});

router.put('/accounts/:id', requireUnlocked, (req, res) => {
  const acct = db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!acct) return err(res, 404, 'NOT_FOUND', 'Account not found.');
  const { name, type, currency, balanceMinor, institution, isLiability } = req.body || {};
  db.prepare(`UPDATE accounts SET name=?, type=?, currency=?, balance_minor=?, institution=?, is_liability=?, updated_at=datetime('now') WHERE id=?`)
    .run(name ?? acct.name, type ?? acct.type, currency ?? acct.currency,
      balanceMinor != null ? Math.round(Number(balanceMinor)) : acct.balance_minor,
      institution ?? acct.institution, isLiability != null ? (isLiability ? 1 : 0) : acct.is_liability, acct.id);
  audit(req.user.id, 'account.update', acct.name);
  res.json({ account: sanitizeAccount(db.prepare('SELECT * FROM accounts WHERE id=?').get(acct.id)) });
});

router.delete('/accounts/:id', requireUnlocked, (req, res) => {
  const acct = db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!acct) return err(res, 404, 'NOT_FOUND', 'Account not found.');
  db.prepare('DELETE FROM accounts WHERE id=?').run(acct.id);
  audit(req.user.id, 'account.delete', acct.name);
  res.json({ ok: true });
});

// ---- Categories ----
router.get('/categories', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY kind, name').all(req.user.id);
  res.json(rows);
});

router.post('/categories', requireUnlocked, (req, res) => {
  const { name, kind = 'expense', color, icon } = req.body || {};
  if (!name) return err(res, 400, 'INVALID_INPUT', 'name is required.');
  try {
    const info = db.prepare(`INSERT INTO categories (user_id, name, kind, color, icon) VALUES (?, ?, ?, ?, ?)`)
      .run(req.user.id, name, kind, color ?? null, icon ?? null);
    res.json({ category: db.prepare('SELECT * FROM categories WHERE id=?').get(info.lastInsertRowid) });
  } catch {
    return err(res, 409, 'DUPLICATE', 'Category already exists.');
  }
});

// ---- Transactions ----
router.get('/transactions', requireUnlocked, (req, res) => {
  const q = req.query;
  // Columns are prefixed with t. so the query is unambiguous once joined to categories/accounts.
  let where = 't.user_id = ?';
  const params = [req.user.id];
  if (q.month) {
    const [y, m] = q.month.split('-');
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    where += ' AND t.date >= ? AND t.date < ?';
    params.push(start, end);
  }
  if (q.direction) { where += ' AND t.direction = ?'; params.push(q.direction); }
  if (q.accountId) { where += ' AND t.account_id = ?'; params.push(q.accountId); }
  if (q.categoryId) { where += ' AND t.category_id = ?'; params.push(q.categoryId); }
  if (q.search) {
    where += ' AND (t.merchant LIKE ? OR t.note LIKE ?)';
    const like = `%${q.search}%`;
    params.push(like, like);
  }
  where += " AND t.status = 'active'";
  const limit = Math.min(Number(q.limit || 100), 500);
  const offset = Number(q.offset || 0);
  const rows = db.prepare(`
    SELECT t.*, c.name category_name, c.kind category_kind, a.name account_name
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
    LEFT JOIN accounts a ON a.id=t.account_id
    WHERE ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM transactions t WHERE ${where}`).get(...params).c;
  res.json({ transactions: rows, total, limit, offset });
});

function buildTransaction(db, userId, tx) {
  const { accountId, date, amountMinor, currency = 'INR', direction = 'out', kind = 'expense', categoryId, merchant, note, source = 'manual', providerRef, externalId, isTransfer, transferAccountId, isRecurring, recurrence } = tx;
  const amount = Math.round(Number(amountMinor));
  const validation = validateTransaction({ accountId, date, amountMinor: amount, direction, currency }, { db, userId });
  if (!validation.valid) {
    return { error: { code: 'INVALID_TRANSACTION', message: validation.errors.join('; ') } };
  }
  let cat = categoryId;
  let catKind = kind;
  if (!cat && (merchant || note)) {
    const auto = categorize(merchant, note);
    const existing = db.prepare('SELECT id FROM categories WHERE user_id=? AND LOWER(name)=?').get(userId, auto.name.toLowerCase());
    if (existing) cat = existing.id;
    else {
      const info = db.prepare(`INSERT INTO categories (user_id, name, kind, color) VALUES (?, ?, ?, ?)`).run(userId, auto.name, auto.kind, auto.color);
      cat = info.lastInsertRowid;
    }
    catKind = auto.kind;
  }
  const key = dedupKey({ accountId, date, amountMinor: amount, direction, providerRef, externalId });
  const dup = db.prepare('SELECT id FROM transactions WHERE dedup_key=? AND user_id=?').get(key, userId);
  if (dup) return { error: { code: 'DUPLICATE', message: 'Duplicate transaction detected.', id: dup.id } };
  const info = db.prepare(`
    INSERT INTO transactions (user_id, account_id, date, amount_minor, currency, direction, kind, category_id, merchant, note, source, provider_ref, external_id, is_transfer, transfer_account_id, is_recurring, recurrence, dedup_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, accountId, date, amount, currency, direction, catKind, cat, merchant ?? null, note ?? null,
    source, providerRef ?? null, externalId ?? null, isTransfer ? 1 : 0, transferAccountId ?? null, isRecurring ? 1 : 0, recurrence ?? null, key);
  return { ok: true, id: info.lastInsertRowid, dedupKey: key };
}

router.post('/transactions', requireUnlocked, (req, res) => {
  const result = buildTransaction(db, req.user.id, req.body);
  if (result.error) return err(res, 400, result.error.code, result.error.message);
  audit(req.user.id, 'transaction.create', '');
  const row = db.prepare(`SELECT t.*, c.name category_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.id=?`).get(result.id);
  res.json({ transaction: row, dedupKey: result.dedupKey });
});

router.post('/transactions/batch', requireUnlocked, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body?.transactions || []);
  const results = [];
  for (const it of items) {
    const r = buildTransaction(db, req.user.id, it);
    results.push({ ok: !r.error, ...(r.error ? { error: r.error } : { id: r.id, dedupKey: r.dedupKey }) });
  }
  audit(req.user.id, 'transaction.batch', items.length + ' records');
  res.json({ results, count: items.length });
});

router.put('/transactions/:id', requireUnlocked, (req, res) => {
  const txn = db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!txn) return err(res, 404, 'NOT_FOUND', 'Transaction not found.');
  const { categoryId, merchant, note, amountMinor, date, kind } = req.body || {};
  db.prepare(`UPDATE transactions SET category_id=?, merchant=?, note=?, amount_minor=?, date=?, kind=?, updated_at=datetime('now') WHERE id=?`)
    .run(categoryId !== undefined ? categoryId : txn.category_id,
         merchant !== undefined ? merchant : txn.merchant,
         note !== undefined ? note : txn.note,
         amountMinor != null ? Math.round(Number(amountMinor)) : txn.amount_minor,
         date ?? txn.date, kind ?? txn.kind, txn.id);
  audit(req.user.id, 'transaction.update', '');
  res.json({ ok: true });
});

router.delete('/transactions/:id', requireUnlocked, (req, res) => {
  const txn = db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!txn) return err(res, 404, 'NOT_FOUND', 'Transaction not found.');
  db.prepare("UPDATE transactions SET status='deleted' WHERE id=?").run(txn.id);
  audit(req.user.id, 'transaction.delete', '');
  res.json({ ok: true });
});

router.get('/transactions/intelligence/detect-transfers', requireUnlocked, (req, res) => {
  const txns = db.prepare("SELECT * FROM transactions WHERE user_id=? AND status='active'").all(req.user.id);
  const matches = [];
  for (const t of txns) {
    const d = detectTransfer(t, txns);
    if (d.isTransfer) matches.push({ id: t.id, pairedTransactionId: d.pairedTransactionId });
  }
  res.json({ transfers: matches, count: matches.length });
});

router.get('/transactions/intelligence/recurring', requireUnlocked, (req, res) => {
  const txns = db.prepare("SELECT * FROM transactions WHERE user_id=? AND status='active' AND direction='out'").all(req.user.id);
  res.json({ recurring: detectRecurring(txns) });
});

// ---- Budgets ----
router.get('/budgets', requireUnlocked, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, c.name category_name, c.color category_color FROM budgets b
    LEFT JOIN categories c ON c.id=b.category_id WHERE b.user_id=? ORDER BY b.created_at`).all(req.user.id);
  const ym = currentYm();
  const { start, end } = monthRange(ym);
  const data = rows.map((b) => {
    const spent = Number(db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND category_id=? AND date>=? AND date<? AND direction='out' AND status='active'`).get(req.user.id, b.category_id, start, end).s || 0);
    return { ...b, spentMinor: spent, percentSpent: b.amount_minor ? spent / b.amount_minor : 0 };
  });
  res.json(data);
});

router.post('/budgets', requireUnlocked, (req, res) => {
  const { categoryId, period = 'monthly', amountMinor, currency = 'INR' } = req.body || {};
  if (!categoryId || amountMinor == null) return err(res, 400, 'INVALID_INPUT', 'categoryId and amountMinor are required.');
  const info = db.prepare(`INSERT INTO budgets (user_id, category_id, period, amount_minor, currency) VALUES (?, ?, ?, ?, ?)`)
    .run(req.user.id, categoryId, period, Math.round(Number(amountMinor)), currency);
  res.json({ budget: db.prepare('SELECT * FROM budgets WHERE id=?').get(info.lastInsertRowid) });
});

router.put('/budgets/:id', requireUnlocked, (req, res) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!b) return err(res, 404, 'NOT_FOUND', 'Budget not found.');
  const { amountMinor, period } = req.body || {};
  db.prepare('UPDATE budgets SET amount_minor=?, period=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(amountMinor != null ? Math.round(Number(amountMinor)) : b.amount_minor, period ?? b.period, b.id);
  res.json({ ok: true });
});

router.delete('/budgets/:id', requireUnlocked, (req, res) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!b) return err(res, 404, 'NOT_FOUND', 'Budget not found.');
  db.prepare('DELETE FROM budgets WHERE id=?').run(b.id);
  res.json({ ok: true });
});

// ---- Goals ----
router.get('/goals', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY created_at').all(req.user.id)
    .map((g) => ({ ...g, progress: g.target_amount_minor ? g.current_amount_minor / g.target_amount_minor : 0 }));
  res.json(rows);
});

router.post('/goals', requireUnlocked, (req, res) => {
  const { name, targetAmountMinor, currentAmountMinor = 0, currency = 'INR', deadline, status = 'active' } = req.body || {};
  if (!name || targetAmountMinor == null) return err(res, 400, 'INVALID_INPUT', 'name and targetAmountMinor are required.');
  const info = db.prepare(`INSERT INTO goals (user_id, name, target_amount_minor, current_amount_minor, currency, deadline, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, name, Math.round(Number(targetAmountMinor)), Math.round(Number(currentAmountMinor)), currency, deadline ?? null, status);
  res.json({ goal: db.prepare('SELECT * FROM goals WHERE id=?').get(info.lastInsertRowid) });
});

router.put('/goals/:id', requireUnlocked, (req, res) => {
  const g = db.prepare('SELECT * FROM goals WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!g) return err(res, 404, 'NOT_FOUND', 'Goal not found.');
  const { name, targetAmountMinor, currentAmountMinor, deadline, status } = req.body || {};
  db.prepare(`UPDATE goals SET name=?, target_amount_minor=?, current_amount_minor=?, deadline=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(name ?? g.name, targetAmountMinor != null ? Math.round(Number(targetAmountMinor)) : g.target_amount_minor,
      currentAmountMinor != null ? Math.round(Number(currentAmountMinor)) : g.current_amount_minor,
      deadline !== undefined ? deadline : g.deadline, status ?? g.status, g.id);
  res.json({ ok: true });
});

router.delete('/goals/:id', requireUnlocked, (req, res) => {
  const g = db.prepare('SELECT * FROM goals WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!g) return err(res, 404, 'NOT_FOUND', 'Goal not found.');
  db.prepare('DELETE FROM goals WHERE id=?').run(g.id);
  res.json({ ok: true });
});

// ---- Securities / Holdings / Portfolio ----
router.get('/securities', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM securities WHERE user_id=? ORDER BY name').all(req.user.id)
    .map((s) => ({ ...s, freshness: priceFreshness(s.price_timestamp, s.price_status) }));
  res.json(rows);
});

router.post('/securities', requireUnlocked, (req, res) => {
  const { ticker, name, exchange, assetClass, currency = 'INR', priceMinor, priceStatus = 'MANUAL', provider } = req.body || {};
  if (!name || !assetClass) return err(res, 400, 'INVALID_INPUT', 'name and assetClass are required.');
  const info = db.prepare(`INSERT INTO securities (user_id, ticker, name, exchange, asset_class, currency, price_minor, price_status, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, ticker ?? null, name, exchange ?? null, assetClass, currency,
      priceMinor != null ? Math.round(Number(priceMinor)) : null, priceStatus, provider ?? null);
  res.json({ security: db.prepare('SELECT * FROM securities WHERE id=?').get(info.lastInsertRowid) });
});

router.put('/securities/:id', requireUnlocked, (req, res) => {
  const s = db.prepare('SELECT * FROM securities WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return err(res, 404, 'NOT_FOUND', 'Security not found.');
  const { priceMinor, priceStatus, name, assetClass, ticker, exchange, provider } = req.body || {};
  db.prepare(`UPDATE securities SET name=?, ticker=?, exchange=?, asset_class=?, price_minor=?, price_status=?, provider=?, updated_at=datetime('now') WHERE id=?`)
    .run(name ?? s.name, ticker !== undefined ? ticker : s.ticker, exchange ?? s.exchange, assetClass ?? s.asset_class,
      priceMinor != null ? Math.round(Number(priceMinor)) : s.price_minor, priceStatus ?? s.price_status,
      provider !== undefined ? provider : s.provider, s.id);
  res.json({ ok: true });
});

router.post('/holdings', requireUnlocked, (req, res) => {
  const { accountId, securityId, quantity, costBasisMinor, currency = 'INR' } = req.body || {};
  if (!securityId || quantity == null || costBasisMinor == null) return err(res, 400, 'INVALID_INPUT', 'securityId, quantity and costBasisMinor are required.');
  const info = db.prepare(`INSERT INTO holdings (user_id, account_id, security_id, quantity, cost_basis_minor, currency) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, accountId ?? null, securityId, String(quantity), Math.round(Number(costBasisMinor)), currency);
  res.json({ holding: db.prepare('SELECT * FROM holdings WHERE id=?').get(info.lastInsertRowid) });
});

router.put('/holdings/:id', requireUnlocked, (req, res) => {
  const h = db.prepare('SELECT * FROM holdings WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!h) return err(res, 404, 'NOT_FOUND', 'Holding not found.');
  const { quantity, costBasisMinor } = req.body || {};
  db.prepare('UPDATE holdings SET quantity=?, cost_basis_minor=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(quantity != null ? String(quantity) : h.quantity, costBasisMinor != null ? Math.round(Number(costBasisMinor)) : h.cost_basis_minor, h.id);
  res.json({ ok: true });
});

router.delete('/holdings/:id', requireUnlocked, (req, res) => {
  const h = db.prepare('SELECT * FROM holdings WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!h) return err(res, 404, 'NOT_FOUND', 'Holding not found.');
  db.prepare('DELETE FROM holdings WHERE id=?').run(h.id);
  res.json({ ok: true });
});

router.get('/portfolio', requireUnlocked, (req, res) => {
  res.json(computePortfolio(db, req.user.id));
});

router.post('/market/refresh', requireUnlocked, async (req, res) => {
  const result = await refreshPrices(db, req.user.id);
  res.json(result);
});

// ---- Net worth ----
router.get('/net-worth', requireUnlocked, (req, res) => {
  res.json(computeNetWorth(db, req.user.id));
});

router.get('/net-worth/snapshots', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM snapshots WHERE user_id=? ORDER BY as_of DESC').all(req.user.id);
  res.json(rows);
});

router.post('/net-worth/snapshot', requireUnlocked, (req, res) => {
  const { asOf } = req.body || {};
  const nw = recordSnapshot(db, req.user.id, asOf || new Date().toISOString().slice(0, 10), req.body?.isDemo ? 1 : 0);
  audit(req.user.id, 'networth.snapshot', '');
  res.json(nw);
});

// ---- Reports ----
router.get('/reports/cashflow', requireUnlocked, (req, res) => {
  const q = req.query;
  const year = Number(q.year || new Date().getFullYear());
  const rows = [];
  for (let i = 1; i <= 12; i++) {
    const start = new Date(Date.UTC(year, i - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, i, 1)).toISOString().slice(0, 10);
    const inc = Number(db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND date>=? AND date<? AND direction='in' AND status='active'`).get(req.user.id, start, end).s || 0);
    const exp = Number(db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND date>=? AND date<? AND direction='out' AND status='active'`).get(req.user.id, start, end).s || 0);
    rows.push({ month: `${year}-${String(i).padStart(2, '0')}`, incomeMinor: inc, expenseMinor: exp });
  }
  res.json({ year, rows });
});

router.get('/reports/allocations', requireUnlocked, (req, res) => {
  const nw = computeNetWorth(db, req.user.id);
  res.json({ assetClassBreakdown: nw.assetClassBreakdown, byType: nw.byType });
});

// ---- AA / Consent / Sync ----
router.get('/aa/status', requireUnlocked, (req, res) => {
  expireConsents(db, req.user.id);
  const consents = db.prepare('SELECT * FROM consents WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ ...aaIntegrationStatus(), consents });
});

router.get('/aa/consents', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM consents WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

router.post('/aa/consent', requireUnlocked, (req, res) => {
  const { provider, fiType, purpose } = req.body || {};
  if (!fiType || !purpose) return err(res, 400, 'INVALID_INPUT', 'fiType and purpose are required.');
  const result = createConsent(db, req.user.id, { provider, fiType, purpose });
  audit(req.user.id, 'aa.consent.create', fiType);
  res.json(result);
});

router.post('/aa/consent/:id/approve', requireUnlocked, (req, res) => {
  try { res.json({ consent: approveConsent(db, req.user.id, req.params.id) }); }
  catch (e) { return err(res, 400, 'BAD_STATE', e.message); }
});

router.post('/aa/consent/:id/reject', requireUnlocked, (req, res) => {
  try { res.json({ consent: rejectConsent(db, req.user.id, req.params.id) }); }
  catch (e) { return err(res, 400, 'BAD_STATE', e.message); }
});

router.post('/aa/consent/:id/revoke', requireUnlocked, (req, res) => {
  try { res.json({ consent: revokeConsent(db, req.user.id, req.params.id) }); }
  catch (e) { return err(res, 400, 'BAD_STATE', e.message); }
});

router.post('/aa/consent/:id/request-data', requireUnlocked, async (req, res) => {
  const result = await requestFinancialData(db, req.user.id, req.params.id);
  res.json(result);
});

// ---- AA provider abstraction (provider-neutral) ----
router.get('/aa/providers', requireUnlocked, (_req, res) => {
  const providers = listAAPProviders().map((p) => {
    const st = p.status ? p.status() : {};
    return {
      name: p.name,
      mode: typeof p.mode === 'function' ? p.mode() : p.mode,
      // Use the live status().configured — a provider may be configured via
      // credentials even though its static `configured` flag is false.
      configured: (st && st.configured != null) ? st.configured : p.configured,
      requiresCredentials: (st && st.requiresCredentials != null) ? st.requiresCredentials : p.requiresCredentials,
      status: st,
      supportedFIs: p.getSupportedFIs ? p.getSupportedFIs() : [],
      supportedFiTypes: p.getSupportedFITypes ? p.getSupportedFITypes() : [],
    };
  });
  // Ensure `mock` always appears first and is available.
  const names = providers.map((p) => p.name);
  if (!names.includes('mock')) {
    const mock = resolveAAPProvider({ provider: 'mock' });
    providers.unshift({
      name: 'mock', mode: 'MOCK', configured: true, requiresCredentials: false,
      status: mock.status(), supportedFIs: mock.getSupportedFIs(), supportedFiTypes: mock.getSupportedFITypes(),
    });
  }
  res.json({ providers, active: resolveAAPProvider().name });
});

router.get('/aa/workflow', requireUnlocked, (_req, res) => {
  res.json({ consent: consentStateFlow(), data: dataStateFlow() });
});

router.post('/aa/connect', requireUnlocked, async (req, res) => {
  const { provider = 'mock', fiType = 'DEPOSIT', fiTypes, purpose = 'Personal financial management', dataRange, frequency, customerHandle } = req.body || {};
  try {
    const prov = resolveAAPProvider({ provider });
    const created = await prov.createConsent({ provider: prov.name, fiType, fiTypes, purpose, dataRange, frequency, customerHandle });
    const consent = created.consent || created;
    const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    const consentUrl = consent.redirectUrl || consent.consentUrl || consent.url || null;
    const info = db.prepare(`
      INSERT INTO consents (user_id, provider, fi_type, purpose, status, expires_at, external_ref, fi_types, data_range_from, data_range_to, frequency, customer_handle, consent_handle, data_status, consent_url)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)
    `).run(req.user.id, prov.name, fiType || (fiTypes || []).join(','), purpose, expiresAt,
      consent.consentId || consent.id || null,
      JSON.stringify(consent.fiTypes || fiTypes || [fiType]),
      consent.dataRange?.from || dataRange?.from || null,
      consent.dataRange?.to || dataRange?.to || null,
      JSON.stringify(consent.frequency || frequency || { unit: 'MONTH', value: 1 }),
      consent.customerHandle || customerHandle || null,
      consent.consentHandle || consent.handle || null,
      consentUrl);
    audit(req.user.id, 'aa.connect', `${prov.name}: ${fiType || (fiTypes || []).join(',')}`);
    const row = db.prepare('SELECT * FROM consents WHERE id=?').get(info.lastInsertRowid);
    res.json({ consent: row, provider: prov.name, mode: typeof prov.mode === 'function' ? prov.mode() : prov.mode, consentUrl });
  } catch (e) {
    return err(res, 400, e.code === 'PROVIDER_NOT_CONFIGURED' ? 'PROVIDER_NOT_CONFIGURED' : 'AA_ERROR', e.message);
  }
});

router.post('/aa/sync', requireUnlocked, async (req, res) => {
  const { consentId, providerName } = req.body || {};
  try {
    let consentRow = null;
    if (consentId) {
      consentRow = db.prepare('SELECT * FROM consents WHERE id=? AND user_id=?').get(consentId, req.user.id);
      if (!consentRow) return err(res, 404, 'NOT_FOUND', 'Consent not found.');
      if (!['approved', 'active'].includes(consentRow.status)) {
        return err(res, 400, 'CONSENT_REQUIRES_APPROVAL', 'Consent must be approved before syncing.');
      }
    }
    const result = await runAASync(db, req.user.id, {
      providerName: providerName || (consentRow ? consentRow.provider : 'mock'),
      consentId: consentRow ? consentRow.external_ref : undefined,
      dbConsentId: consentRow ? consentRow.id : undefined,
      fiTypes: consentRow ? (JSON.parse(consentRow.fi_types || '[]') || []) : req.body.fiTypes,
      customerHandle: consentRow ? consentRow.customer_handle : req.body.customerHandle,
    });
    audit(req.user.id, 'aa.sync', result.summary.provider);
    res.json(result);
  } catch (e) {
    return err(res, 400, e.code || 'AA_ERROR', e.message);
  }
});

router.get('/aa/sessions', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM aa_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json(rows);
});

// Setu-specific connect: create a real Setu consent and return the redirect URL.
router.post('/aa/connect-setu', requireUnlocked, async (req, res) => {
  const prov = getAAPProvider('setu');
  if (!prov) return err(res, 404, 'NOT_FOUND', 'Setu provider not registered.');
  try {
    const { fiType = 'DEPOSIT', fiTypes, purpose, dataRange, frequency, customerHandle } = req.body || {};
    const created = await prov.createConsent({ fiType, fiTypes, purpose, dataRange, frequency, customerHandle });
    const consent = created.consent || created;
    const expiresAt = consent.expiresAt || new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    const consentUrl = consent.redirectUrl || consent.consentUrl || consent.url || null;
    const info = db.prepare(`
      INSERT INTO consents (user_id, provider, fi_type, purpose, status, expires_at, external_ref, fi_types, data_range_from, data_range_to, frequency, customer_handle, consent_handle, data_status, consent_url)
      VALUES (?, 'setu', ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)
    `).run(req.user.id, fiType || (fiTypes || []).join(','), consent.purpose || purpose, expiresAt,
      consent.consentId || consent.id || null,
      JSON.stringify(consent.fiTypes || fiTypes || [fiType]),
      consent.dataRange?.from || dataRange?.from || null,
      consent.dataRange?.to || dataRange?.to || null,
      JSON.stringify(consent.frequency || frequency || { unit: 'MONTH', value: 1 }),
      consent.customerHandle || customerHandle || null,
      consent.consentHandle || consent.consentId || consent.id || null,
      consentUrl);
    audit(req.user.id, 'aa.connect_setu', fiType);
    res.json({ consent: db.prepare('SELECT * FROM consents WHERE id=?').get(info.lastInsertRowid), provider: 'setu', redirectUrl: consentUrl, consentUrl });
  } catch (e) {
    return err(res, 400, e.code === 'PROVIDER_NOT_CONFIGURED' ? 'PROVIDER_NOT_CONFIGURED' : 'AA_ERROR', e.message);
  }
});

// Setu Account Availability: check whether a mobile number has accounts across AAs.
router.post('/aa/setu/availability', requireUnlocked, async (req, res) => {
  const prov = getAAPProvider('setu');
  if (!prov) return err(res, 404, 'NOT_FOUND', 'Setu provider not registered.');
  const { mobileNumber } = req.body || {};
  if (!mobileNumber) return err(res, 400, 'INVALID_INPUT', 'mobileNumber is required.');
  try {
    const result = await prov.checkAccountAvailability({ mobileNumber });
    audit(req.user.id, 'aa.setu.availability', '');
    res.json(result);
  } catch (e) {
    return err(res, e.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 502, e.code === 'PROVIDER_NOT_CONFIGURED' ? 'PROVIDER_NOT_CONFIGURED' : 'AA_ERROR', e.message);
  }
});

router.get('/sync/runs', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM sync_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  res.json(rows);
});

// ---- Calculators (deterministic; never LLM) ----
router.post('/calculators/emi', (req, res) => {
  const { principal, annualRatePercent, months } = req.body || {};
  if (principal == null || annualRatePercent == null || months == null) return err(res, 400, 'INVALID_INPUT', 'principal, annualRatePercent, months required.');
  try {
    const result = calc.amortization(Number(principal), Number(annualRatePercent) / 100, Number(months));
    res.json(result);
  } catch (e) { return err(res, 400, 'INVALID_INPUT', e.message); }
});

router.post('/calculators/sip', (req, res) => {
  const { monthlyInvestment, annualRatePercent, months, atBeginning = true } = req.body || {};
  if (monthlyInvestment == null || annualRatePercent == null || months == null) return err(res, 400, 'INVALID_INPUT', 'monthlyInvestment, annualRatePercent, months required.');
  try {
    const fv = calc.sipFutureValue(Number(monthlyInvestment), Number(annualRatePercent) / 100, Number(months), atBeginning);
    res.json({ futureValue: fv });
  } catch (e) { return err(res, 400, 'INVALID_INPUT', e.message); }
});

router.post('/calculators/fd', (req, res) => {
  const { principal, annualRatePercent, compoundingPerYear = 4, years } = req.body || {};
  if (principal == null || annualRatePercent == null || years == null) return err(res, 400, 'INVALID_INPUT', 'principal, annualRatePercent, years required.');
  try {
    const maturity = calc.fdMaturity(Number(principal), Number(annualRatePercent) / 100, Number(compoundingPerYear), Number(years));
    res.json({ maturity: maturity });
  } catch (e) { return err(res, 400, 'INVALID_INPUT', e.message); }
});

router.post('/calculators/cagr', (req, res) => {
  const { beginValue, endValue, years } = req.body || {};
  if (beginValue == null || endValue == null || years == null) return err(res, 400, 'INVALID_INPUT', 'beginValue, endValue, years required.');
  try {
    res.json({ cagr: calc.cagr(Number(beginValue), Number(endValue), Number(years)) });
  } catch (e) { return err(res, 400, 'INVALID_INPUT', e.message); }
});

router.post('/calculators/xirr', (req, res) => {
  const { flows } = req.body || {};
  if (!Array.isArray(flows) || flows.length < 2) return err(res, 400, 'INVALID_INPUT', 'flows (array) required.');
  try {
    res.json({ xirr: calc.xirr(flows.map((f) => ({ date: f.date, amount: Number(f.amount) }))) });
  } catch (e) { return err(res, 400, 'INVALID_INPUT', e.message); }
});

// ---- Demo data ----
router.post('/seed-demo', requireUnlocked, (req, res) => {
  ensureDefaultCategories(db, req.user.id);
  const { accountCount, holdingCount } = seedDemoData(db, req.user.id);
  audit(req.user.id, 'demo.seed', '');
  res.json({ ok: true, accountCount, holdingCount, message: 'Clearly-labelled sample data (MANUAL/SANDBOX) loaded.' });
});

// ---- Import / Export ----
router.post('/import', requireUnlocked, (req, res) => {
  const { transactions } = req.body || {};
  if (!Array.isArray(transactions)) return err(res, 400, 'INVALID_INPUT', 'transactions array required.');
  const results = [];
  for (const t of transactions) {
    const r = buildTransaction(db, req.user.id, t);
    results.push(r.error ? { ok: false, error: r.error } : { ok: true, id: r.id });
  }
  audit(req.user.id, 'import', `${results.length} records`);
  res.json({ results, created: results.filter((r) => r.ok).length, failed: results.length - results.filter((r) => r.ok).length });
});

router.get('/export.:format', requireUnlocked, (req, res) => {
  const format = (req.params.format || 'json').toLowerCase();
  const userId = req.user.id;
  const data = {
    exportedAt: new Date().toISOString(),
    accounts: db.prepare('SELECT * FROM accounts WHERE user_id=?').all(userId),
    transactions: db.prepare('SELECT * FROM transactions WHERE user_id=? AND status=\'active\'').all(userId),
    securities: db.prepare('SELECT * FROM securities WHERE user_id=?').all(userId),
    holdings: db.prepare('SELECT * FROM holdings WHERE user_id=?').all(userId),
    goals: db.prepare('SELECT * FROM goals WHERE user_id=?').all(userId),
    budgets: db.prepare('SELECT * FROM budgets WHERE user_id=?').all(userId),
    categories: db.prepare('SELECT * FROM categories WHERE user_id=?').all(userId),
    consents: db.prepare('SELECT * FROM consents WHERE user_id=?').all(userId),
    reconciliationRuns: db.prepare('SELECT * FROM reconciliation_runs WHERE user_id=?').all(userId),
    notifications: db.prepare('SELECT * FROM notifications WHERE user_id=?').all(userId),
    snapshots: db.prepare('SELECT * FROM snapshots WHERE user_id=?').all(userId),
    audit: db.prepare('SELECT * FROM audit_log WHERE user_id=?').all(userId),
  };
  if (format === 'csv') {
    const csv = toCsv(data.transactions);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wealthcore-transactions.csv"');
    return res.send(csv);
  }
  res.setHeader('Content-Disposition', 'attachment; filename="wealthcore-export.json"');
  res.json(data);
});

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = ['id', 'date', 'amount_minor', 'currency', 'direction', 'kind', 'merchant', 'note', 'account_id', 'category_id', 'source', 'provider_ref', 'created_at'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

// ---- Notifications ----
router.get('/notifications', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json(rows);
});

router.post('/notifications/read', requireUnlocked, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// ---- AI ----
router.get('/ai/status', requireUnlocked, (req, res) => {
  res.json(llmStatus());
});

router.get('/ai/conversations', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM ai_conversations WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id);
  res.json(rows);
});

router.get('/ai/conversations/:id/messages', requireUnlocked, (req, res) => {
  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!conv) return err(res, 404, 'NOT_FOUND', 'Conversation not found.');
  const messages = db.prepare('SELECT * FROM ai_messages WHERE conversation_id=? ORDER BY id').all(conv.id);
  res.json({ conversation: conv, messages });
});

router.post('/ai/message', requireUnlocked, (req, res) => {
  const { conversationId, message } = req.body || {};
  if (!message || !String(message).trim()) return err(res, 400, 'INVALID_INPUT', 'message is required.');
  let convId = conversationId;
  if (!convId) {
    const info = db.prepare(`INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)`).run(req.user.id, String(message).slice(0, 60));
    convId = info.lastInsertRowid;
  } else {
    const conv = db.prepare('SELECT * FROM ai_conversations WHERE id=? AND user_id=?').get(convId, req.user.id);
    if (!conv) return err(res, 404, 'NOT_FOUND', 'Conversation not found.');
  }
  appendMessage(db, convId, 'user', message);
  const ctx = newContext();
  const kindToMetric = {
    spend: 'spend', spend_category: 'spend', compare_spend: 'spend', balance: 'balance',
    net_worth: 'net_worth', portfolio: 'portfolio', goals: 'goals', budgets: 'budgets',
    consent: 'consent', sync: 'sync', history: 'history', accounts: 'accounts',
  };
  // Rebuild lightweight context from previous user/assistant messages for entity continuity.
  const prior = db.prepare(`SELECT * FROM ai_messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id ASC`).all(convId);
  for (const p of prior) {
    const plan = resolvePlan(p.content, ctx);
    if (kindToMetric[plan.kind]) ctx.lastMetric = kindToMetric[plan.kind];
    if (plan.period) ctx.lastPeriod = plan.period;
    if (plan.entity) ctx.lastEntity = plan.entity;
  }
  const plan = resolvePlan(message, ctx);
  const result = runPlan(db, req.user.id, plan, ctx);
  appendMessage(db, convId, 'assistant', result.answer, result.toolCalls);
  audit(req.user.id, 'ai.message', result.answer.slice(0, 120));
  res.json({ conversationId: convId, answer: result.answer, toolCalls: result.toolCalls, provider: result.provider, context: result.context });
});

// ---- Audit log ----
router.get('/audit', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json(rows);
});

// ---- Reconciliation ----
router.get('/reconciliation', requireUnlocked, (req, res) => {
  const result = runAllReconciliations(db, req.user.id);
  res.json(result);
});

router.get('/reconciliation/history', requireUnlocked, (req, res) => {
  res.json(reconciliationHistory(db, req.user.id, Number(req.query.limit || 50)));
});

router.post('/reconciliation/run', requireUnlocked, (req, res) => {
  const { accountId } = req.body || {};
  let out;
  if (accountId) {
    out = recordReconciliationRun(db, req.user.id, Number(accountId));
  } else {
    out = runAllReconciliations(db, req.user.id, true);
  }
  audit(req.user.id, 'reconciliation.run', accountId || 'all');
  // Re-evaluate notifications so a difference is surfaced.
  evaluate(db, req.user.id);
  res.json(out);
});

router.post('/reconciliation/:accountId/resolve', requireUnlocked, (req, res) => {
  const { setBalance = false, note } = req.body || {};
  try {
    const out = resolveReconciliation(db, req.user.id, Number(req.params.accountId), { setBalance, note });
    audit(req.user.id, 'reconciliation.resolve', req.params.accountId);
    res.json(out);
  } catch (e) {
    return err(res, 404, 'NOT_FOUND', e.message);
  }
});

// ---- Notifications (preferences + evaluate + dismiss) ----
router.get('/notifications/preferences', requireUnlocked, (req, res) => {
  res.json(preferencesFor(db, req.user.id));
});

router.put('/notifications/preferences/:type', requireUnlocked, (req, res) => {
  const type = req.params.type;
  if (!['budget_threshold','unusual_spending','large_transaction','goal_milestone','goal_behind','emi_due','credit_card_due','low_balance','portfolio_movement','concentration_warning','failed_sync','reconciliation_difference','consent_expiry','stale_market_data'].includes(type)) {
    return err(res, 400, 'INVALID_INPUT', 'Unknown notification type');
  }
  try {
    res.json(updatePreference(db, req.user.id, type, req.body || {}));
  } catch (e) { return err(res, 400, 'INVALID_INPUT', e.message); }
});

router.post('/notifications/evaluate', requireUnlocked, (req, res) => {
  const created = evaluate(db, req.user.id);
  audit(req.user.id, 'notifications.evaluate', created.length + ' created');
  res.json({ created, count: created.length });
});

router.post('/notifications/:id/dismiss', requireUnlocked, (req, res) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!n) return err(res, 404, 'NOT_FOUND', 'Notification not found.');
  db.prepare('UPDATE notifications SET dismissed = 1 WHERE id = ?').run(n.id);
  res.json({ ok: true });
});

// ---- Jobs / scheduler ----
router.get('/jobs', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM jobs WHERE user_id IS NULL OR user_id = ? ORDER BY name').all(req.user.id);
  res.json(rows);
});

router.post('/jobs/:name/run', requireUnlocked, async (req, res) => {
  const runner = JOB_RUNNERS[req.params.name];
  if (!runner) return err(res, 404, 'NOT_FOUND', 'Unknown job');
  try {
    const r = await runner.run(db);
    audit(req.user.id, 'job.run', req.params.name);
    res.json({ ok: true, job: req.params.name, result: r });
  } catch (e) {
    return err(res, 500, 'JOB_ERROR', String(e.message || e));
  }
});

// ---- Ingestion ----
router.get('/ingest/connectors', requireUnlocked, (_req, res) => {
  res.json(Object.values(CONNECTORS).map((c) => ({ name: c.name, label: c.label })));
});

router.post('/ingest/preview', requireUnlocked, (req, res) => {
  const { format, text, mapping, defaultAccountId } = req.body || {};
  const connector = CONNECTORS[format];
  if (!connector) return err(res, 400, 'INVALID_INPUT', 'Unknown format. Use /ingest/connectors to list.');
  try {
    const parsed = connector.parse(text, { mapping, defaultAccountId });
    const txns = (parsed.transactions || []).slice(0, 10);
    res.json({ total: (parsed.transactions || []).length, holdings: (parsed.holdings || []).length, preview: txns });
  } catch (e) {
    return err(res, 400, 'PARSE_ERROR', `Failed to parse: ${e.message}`);
  }
});

router.post('/ingest', requireUnlocked, async (req, res) => {
  const { format, text, fileName, mapping, defaultAccountId, currency } = req.body || {};
  if (!text && !req.body) return err(res, 400, 'INVALID_INPUT', 'text is required');
  try {
    const result = await ingest(db, req.user.id, { format, text, fileName, mapping, defaultAccountId, currency });
    audit(req.user.id, 'ingest', `${result.summary.created} created / ${result.summary.duplicates} dup / ${result.summary.failed} failed`);
    res.json(result);
  } catch (e) {
    return err(res, 400, 'INGEST_ERROR', e.message);
  }
});

router.get('/ingestion/runs', requireUnlocked, (req, res) => {
  const rows = db.prepare('SELECT * FROM ingestion_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json(rows);
});

// ---- Market data status ----
router.get('/market/status', requireUnlocked, (req, res) => {
  const cfg = marketProviderConfig();
  const priced = db.prepare(`SELECT price_status, COUNT(*) c FROM securities WHERE user_id=? GROUP BY price_status`).all(req.user.id);
  res.json({ ...cfg, priceStatusBreakdown: priced });
});

// ---- Account deletion / data privacy ----
router.post('/privacy/revoke-connections', requireUnlocked, (req, res) => {
  db.prepare(`UPDATE consents SET status='revoked', revoked_at=datetime('now') WHERE user_id=? AND status IN ('approved','pending')`).run(req.user.id);
  db.prepare(`UPDATE accounts SET source='manual', provider=NULL, aa_status=NULL WHERE user_id=?`).run(req.user.id);
  audit(req.user.id, 'privacy.revoke_connections', '');
  res.json({ ok: true });
});

router.post('/privacy/delete-data', requireUnlocked, (req, res) => {
  const uid = req.user.id;
  db.transaction(() => {
    db.prepare('DELETE FROM transactions WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM holdings WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM securities WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM budgets WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM goals WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM consents WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM accounts WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM snapshots WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM notifications WHERE user_id=?').run(uid);
  })();
  audit(uid, 'privacy.delete_data', '');
  res.json({ ok: true });
});

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
}

export default router;
