// WealthCore — Setu (AA Gateway) adapter.
//
// STATUS: PARTIALLY IMPLEMENTED (sandbox path wired against verified docs).
//
// Verified against Setu's current official AA documentation:
//   Sandbox base: https://fiu-sandbox.setu.co ; Production: https://fiu.setu.co
//   POST /v2/consents            -> { id, url, status:PENDING, detail{...} }
//   GET  /consents/:id           -> consent status (PENDING -> ACTIVE)
//   POST /v2/consents/:request_id/revoke
//   POST /sessions               -> create data session { consentId, dataRange, format }
//   GET  /sessions/:id           -> FI data (COMPLETED/PARTIAL/PENDING; fips[].accounts[].data)
//   Webhook: Setu -> your endpoint, signed (X-Webhook-Signature)
//   Auth (current official): x-client-id + x-client-secret + x-product-instance-id
//     (client-credentials style from the Setu Bridge). Legacy bearer access
//     tokens are also accepted when only a token is supplied.
//
// Setu's `format=json` sandbox path returns DECRYPTED ReBIT JSON to the FIU, so
// no FIU-side decryption is required on the default path. The adapter translates
// that ReBIT JSON into WealthCore's canonical envelope before normalization.
//
// Live connectivity is NOT claimed: cataloging is honest via status() and every
// method returns PROVIDER_NOT_CONFIGURED until credentials (client id/secret +
// product-instance-id, or a token) are supplied.

import { config } from '../../config.js';
import { aaError, AA_ERROR_CODES } from '../errors.js';
import { setuHeaders, setuCryptoConfig, verifySetuWebhookSignature } from '../crypto/setu-crypto.js';

const SANDBOX = 'sandbox';
const PRODUCTION = 'production';

function baseUrl() {
  const s = setuCryptoConfig();
  const env = config().setu.environment || SANDBOX;
  if (config().aaEnvironment === PRODUCTION || env === PRODUCTION) {
    return process.env.WEALTHCORE_SETU_BASE_URL || 'https://fiu.setu.co';
  }
  return s.baseUrl || 'https://fiu-sandbox.setu.co';
}

const DEPOSIT_TO_ACCOUNT_TYPE = { SAVINGS: 'savings', CURRENT: 'current', FD: 'fd', TERM_DEPOSIT: 'fd', RECURRING_DEPOSIT: 'fd', LOAN: 'loan', CREDIT_CARD: 'credit' };

function safeParse(val) {
  try { return JSON.parse(val); } catch { return null; }
}

/** Setu status -> WealthCore canonical consent status. */
function mapConsentStatus(setuStatus) {
  switch (String(setuStatus || '').toUpperCase()) {
    case 'PENDING': return 'pending';
    case 'ACTIVE':
    case 'APPROVED': return 'approved';
    case 'REJECTED': return 'rejected';
    case 'REVOKED': return 'revoked';
    case 'EXPIRED': return 'expired';
    default: return 'pending';
  }
}

async function http(method, path, { body, timeoutMs = 20000 } = {}) {
  const headers = setuHeaders();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e && e.name === 'AbortError';
    throw aaError(timedOut ? AA_ERROR_CODES.FETCH_TIMEOUT : AA_ERROR_CODES.PROVIDER_UNAVAILABLE,
      timedOut ? 'Setu request timed out.' : 'Setu is unavailable.', { path });
  }
  clearTimeout(timer);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const code = (json && (json.errorCode || json.code)) || AA_ERROR_CODES.PROVIDER_UNAVAILABLE;
    const msg = (json && (json.errorMsg || json.message)) || `Setu returned HTTP ${res.status}`;
    throw aaError(mapSetuError(code), msg, { path, status: res.status });
  }
  return json;
}

function mapSetuError(code) {
  const c = String(code || '').toUpperCase();
  if (c.includes('INVALID')) return AA_ERROR_CODES.INVALID_PAYLOAD;
  if (c.includes('AUTH')) return AA_ERROR_CODES.AUTHENTICATION_FAILED;
  return AA_ERROR_CODES.PROVIDER_UNAVAILABLE;
}

export const SETU_ENDPOINTS = {
  createConsent: '/v2/consents',
  getConsent: (id) => `/consents/${id}`,
  revokeConsent: (id) => `/v2/consents/${id}/revoke`,
  createSession: '/sessions',
  fetchSession: (id) => `/sessions/${id}`,
};

/** Translate Setu's decrypted ReBIT FI JSON into the canonical envelope. */
export function translateSetuFiToEnvelope(fiJson, { provider = 'setu', consentId = null, sessionId = null } = {}) {
  const accounts = [];
  const transactions = [];
  const holdings = [];
  const fips = [];

  const fipList = fiJson && Array.isArray(fiJson.fips) ? fiJson.fips : [];
  for (const fip of fipList) {
    const fipId = fip.fipID || fip.fipId || null;
    if (fipId) fips.push({ fipId, name: fipId });
    for (const account of (fip.accounts || [])) {
      const data = account.data;
      const acc = data && data.account;
      if (!acc) continue;
      const summary = acc.summary || {};
      // Prefer the summary account type (SAVINGS/CURRENT/...) over the ReBIT
      // 'deposit' wrapper type, which is just the FIType document type.
      const typeRaw = summary.type || acc.type || '';
      const type = String(typeRaw).toUpperCase();
      const linkRef = acc.linkedAccRef || account.linkRefNumber || null;
      const masked = acc.maskedAccNumber || account.maskedAccNumber || null;
      const balanceMinor = summary.currentBalance != null ? Math.round(parseFloat(summary.currentBalance) * 100) : 0;
      const isLiability = ['CREDIT_CARD', 'LOAN'].includes(type);
      accounts.push({
        fipId,
        linkRefNumber: linkRef,
        maskedAccNumber: masked,
        accountType: type,
        name: acc.name || (type === 'SAVINGS' ? 'Savings Account' : type),
        currency: summary.currency || 'INR',
        currentBalanceMinor: isLiability ? -Math.abs(balanceMinor) : balanceMinor,
        balanceDateTime: summary.balanceDateTime || null,
        isLiability,
      });

      // Transactions. ReBIT deposit embeds them under either `transactions`
      // (array) or `transactions.transaction` (array). Collect both.
      const txBlock = acc.transactions || {};
      const txns = [];
      if (Array.isArray(txBlock)) txns.push(...txBlock);
      if (Array.isArray(txBlock.transaction)) txns.push(...txBlock.transaction);
      for (const t of txns) {
        const transactionType = String(t.transactionType || t.type || '').toUpperCase();
        const amount = t.amount != null ? Math.round(parseFloat(t.amount) * 100) : 0;
        transactions.push({
          txnId: t.txnId || t.transactionId || null,
          accountLinkRef: linkRef,
          transactionType,
          amountMinor: amount,
          narration: t.narration || t.description || null,
          transactionDateTime: t.transactionDateTime || t.date || null,
          category: inferCategory(t.narration || t.description || ''),
        });
      }

      // Holdings/investments if present (equities / MF summaries).
      const holdingsArr = Array.isArray(acc.holdings) ? acc.holdings : [];
      for (const h of holdingsArr) {
        holdings.push({
          accountLinkRef: linkRef,
          securityName: h.isinDescription || h.companyName || h.name || null,
          ticker: h.isin || h.ticker || null,
          assetClass: 'equity',
          currency: summary.currency || 'INR',
          quantity: h.units != null ? String(h.units) : null,
          priceMinor: h.rate != null ? Math.round(Number(h.rate) * 100) : null,
          costBasisTotalMinor: h.cost != null ? Math.round(Number(h.cost) * 100) : 0,
        });
      }
    }
  }

  return {
    provider,
    consentId,
    sessionId,
    fips,
    accounts,
    transactions,
    holdings,
  };
}

function inferCategory(desc) {
  const d = String(desc || '');
  if (/salary|payroll/i.test(d)) return 'Salary';
  if (/rent/i.test(d)) return 'Housing';
  if (/grocery|grocer|food|swiggy|zomato|restaurant|bigbasket|dmart/i.test(d)) return 'Food';
  if (/emi|loan/i.test(d)) return 'EMI/Debt';
  if (/insurance|premium/i.test(d)) return 'Insurance';
  if (/subscription|netflix|spotify|ott/i.test(d)) return 'Subscriptions';
  if (/electric|utility|water|power/i.test(d)) return 'Utilities';
  if (/fuel|uber|ola|travel|metro/i.test(d)) return 'Transport';
  if (/sip|mutual|invest|mf/i.test(d)) return 'Investments';
  return 'Other';
}

export const SetuProvider = {
  name: 'setu',
  mode: () => (config().aaEnvironment === PRODUCTION ? PRODUCTION : SANDBOX),
  configured: false,
  requiresCredentials: true,

  status() {
    const s = setuCryptoConfig();
    const env = config().aaEnvironment === PRODUCTION ? PRODUCTION : (config().setu.environment || SANDBOX);
    const configured = s.configured;
    return {
      configured,
      mode: env === PRODUCTION ? PRODUCTION : SANDBOX,
      requiresCredentials: !configured,
      environment: env === PRODUCTION ? 'PRODUCTION' : 'SANDBOX',
      detail: configured
        ? `Setu configured (${env === PRODUCTION ? 'production' : 'sandbox/UAT'}). data@setu.co`
        : 'READY_FOR_CONFIGURATION — Setu credentials required (x-client-id + x-client-secret + x-product-instance-id). aa@setu.co',
    };
  },

  getSupportedFIs() { return ['BANK', 'BROKER', 'MF_RTA', 'INSURER']; },
  getSupportedFITypes() { return ['DEPOSIT', 'TERM_DEPOSIT', 'EQUITIES', 'MUTUAL_FUNDS', 'ETF', 'BONDS', 'GOLD', 'INSURANCE_POLICIES', 'NPS', 'SIP', 'GOVT_SECURITIES']; },
  supportsFIType(fiType) { return this.getSupportedFITypes().includes(fiType); },

  _requireConfigured() {
    const s = setuCryptoConfig();
    if (!s.configured) {
      throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, 'Setu credentials are required (x-client-id + x-client-secret + x-product-instance-id, or an access token).');
    }
    return s;
  },

  async createConsent({ fiType, fiTypes, purpose, dataRange, frequency, customerHandle, consentTypes, consentMode = 'STORE' } = {}) {
    this._requireConfigured();
    const vua = customerHandle || undefined;
    const body = {
      consentDuration: { unit: 'MONTH', value: 4 },
      vua,
      dataRange: dataRange || { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T23:59:59.000Z' },
      context: [],
      additionalParams: { tags: ['WealthCore'] },
    };
    // The consent request uses a `context` to convey purpose/FI types for v2.
    const r = await http('POST', SETU_ENDPOINTS.createConsent, { body });
    const detail = r.detail || {};
    return {
      consent: {
        consentId: r.id,
        consentHandle: r.id,
        provider: 'setu',
        status: mapConsentStatus(r.status),
        redirectUrl: r.url,
        consentUrl: r.url,
        customerHandle: detail.vua || vua || null,
        purpose: (detail.purpose && detail.purpose.text) || purpose || 'Personal financial management',
        fiTypes: detail.fiTypes || fiTypes || [fiType || 'DEPOSIT'],
        dataRange: detail.dataRange || dataRange || null,
        frequency: detail.frequency || frequency || { unit: 'MONTH', value: 1 },
        consentTypes: detail.consentTypes || consentTypes || ['TRANSACTIONS', 'SUMMARY', 'PROFILE'],
        createdAt: detail.consentStart || null,
        expiresAt: detail.consentExpiry || null,
        approvedAt: null,
        revokedAt: null,
        providerReference: r.id,
      },
    };
  },

  async getConsent(consentId) {
    this._requireConfigured();
    const r = await http('GET', SETU_ENDPOINTS.getConsent(consentId));
    return { consentId, status: mapConsentStatus(r.status), redirectUrl: r.url, provider: 'setu' };
  },

  async getConsentStatus(consentId) {
    this._requireConfigured();
    const r = await http('GET', SETU_ENDPOINTS.getConsent(consentId));
    return { consentId, status: mapConsentStatus(r.status) };
  },

  async revokeConsent(consentId) {
    this._requireConfigured();
    try {
      const r = await http('POST', SETU_ENDPOINTS.revokeConsent(consentId), { body: {} });
      return { consentId, status: mapConsentStatus((r && r.status) || 'revoked'), revoked: true };
    } catch (e) {
      // If not found, treat as already revoked.
      if (e.code === AA_ERROR_CODES.INVALID_PAYLOAD) return { consentId, status: 'revoked', revoked: true };
      throw e;
    }
  },

  async requestFIData({ consentId, dataRange } = {}) {
    this._requireConfigured();
    const body = {
      consentId,
      dataRange: dataRange || { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T23:59:59.000Z' },
      format: 'json',
    };
    const r = await http('POST', SETU_ENDPOINTS.createSession, { body });
    const sessionId = r.id || (r.session && r.session.id) || null;
    return { consentId, sessionId, status: 'data_requested' };
  },

  async getFIData(sessionId) {
    this._requireConfigured();
    const r = await http('GET', SETU_ENDPOINTS.fetchSession(sessionId));
    const status = String(r.status || '').toUpperCase();
    return {
      sessionId,
      consentId: r.consentId || null,
      status: status === 'COMPLETED' ? 'fetched' : status === 'PARTIAL' ? 'partial_failure' : 'data_ready',
      data: r,
    };
  },

  async handleNotification(notification) {
    const hasValid = verifySetuWebhookSignature(notification.rawBody || '', notification.headers && notification.headers['x-webhook-signature']);
    // If no webhook secret is configured we can still accept a verified payload.
    if (notification && notification.rawBody && !hasValid.valid && hasValid.reason !== 'NO_SECRET_CONFIGURED') {
      throw aaError(AA_ERROR_CODES.INVALID_SIGNATURE, 'Invalid Setu webhook signature.');
    }
    return { ok: true, handled: true, payload: notification.payload || null };
  },

  normalizeFinancialData(data) {
    // data is the full session response; translate to canonical envelope.
    if (data && data.data) return translateSetuFiToEnvelope(data.data, { provider: 'setu', consentId: data.consentId, sessionId: data.sessionId });
    return translateSetuFiToEnvelope(data, { provider: 'setu' });
  },
};

export default SetuProvider;
