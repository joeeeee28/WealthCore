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
//   Auth (CURRENT OFFICIAL): Bridge provides client_id + client_secret +
//     x-product-instance-id. The access token is obtained via Setu's Generate
//     Token API (POST https://uat.setu.co/api/v2/auth/token in sandbox; token
//     returned as data.token) in setu-auth.js. Setu AA APIs require
//     `Authorization: Bearer <access_token>` + `x-product-instance-id`. The
//     client secret is NEVER sent as a request header on AA APIs. An auth
//     manager caches/renews the token.
//
// Setu's `format=json` sandbox path returns DECRYPTED ReBIT JSON to the FIU, so
// no FIU-side decryption is required on the default path. The adapter translates
// that ReBIT JSON into WealthCore's canonical envelope before normalization.
//
// Live connectivity is NOT claimed: cataloging is honest via status() and every
// method returns PROVIDER_NOT_CONFIGURED until credentials are supplied.

import { config } from '../../config.js';
import { aaError, AA_ERROR_CODES } from '../errors.js';
import { setuCryptoConfig, setuAuthHeaders, verifySetuWebhookSignature } from '../crypto/setu-crypto.js';
import { baseUrl as setuBaseUrl } from './setu-auth.js';

const SANDBOX = 'sandbox';
const PRODUCTION = 'production';

// baseUrl() is imported from setu-auth.js (setuBaseUrl) so the adapter and the
// auth manager always agree on the environment.
const baseUrl = setuBaseUrl;

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

async function http(method, path, { body, timeoutMs = 30000 } = {}) {
  // Uses the CURRENT OFFICIAL model: `Authorization: Bearer <access_token>`
  // (acquired from client credentials via setu-auth.js) + x-product-instance-id.
  const headers = await setuAuthHeaders();
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

async function httpWithTokenRefresh(method, path, opts = {}) {
  try {
    return await http(method, path, opts);
  } catch (e) {
    // A single retry on a confirmed authentication failure is safe and avoids a
    // token storm. Never retry on consent/data/validation errors.
    if (e && (e.code === AA_ERROR_CODES.AUTHENTICATION_FAILED || e.code === AA_ERROR_CODES.PROVIDER_AUTHENTICATION_FAILED)) {
      const { invalidateAccessToken, setuCreds } = await import('./setu-auth.js');
      invalidateAccessToken(setuCreds().clientId);
      return http(method, path, opts);
    }
    throw e;
  }
}

export const SETU_ENDPOINTS = {
  createConsent: '/v2/consents',
  getConsent: (id) => `/consents/${id}`,
  revokeConsent: (id) => `/v2/consents/${id}/revoke`,
  createSession: '/sessions',
  fetchSession: (id) => `/sessions/${id}`,
  getDataSessions: (consentId) => `/v2/consents/${consentId}/data-sessions`,
  accountAvailability: '/v2/account-availability',
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
      // Product instance ID is non-sensitive configuration (Setu product id) and may
      // be shown in the UI. The client secret / access token are never exposed here.
      productInstanceId: s.productInstanceId || null,
      product: 'Account Aggregator Data',
      detail: configured
        ? `Setu configured (${env === PRODUCTION ? 'production' : 'sandbox/UAT'}). data@setu.co`
        : 'READY_FOR_CONFIGURATION — Setu credentials required (client_id + client_secret + x-product-instance-id from the Setu Bridge). aa@setu.co',
    };
  },

  getSupportedFIs() { return ['BANK', 'BROKER', 'MF_RTA', 'INSURER']; },
  getSupportedFITypes() { return ['DEPOSIT', 'TERM_DEPOSIT', 'EQUITIES', 'MUTUAL_FUNDS', 'ETF', 'BONDS', 'GOLD', 'INSURANCE_POLICIES', 'NPS', 'SIP', 'GOVT_SECURITIES']; },
  supportsFIType(fiType) { return this.getSupportedFITypes().includes(fiType); },

  _requireConfigured() {
    const s = setuCryptoConfig();
    if (!s.configured) {
      throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, 'Setu credentials are required (client_id + client_secret + x-product-instance-id from the Setu Bridge).');
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
    const r = await httpWithTokenRefresh('POST', SETU_ENDPOINTS.createConsent, { body });
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
    const r = await httpWithTokenRefresh('GET', SETU_ENDPOINTS.getConsent(consentId));
    return { consentId, status: mapConsentStatus(r.status), redirectUrl: r.url, provider: 'setu' };
  },

  async getConsentStatus(consentId) {
    this._requireConfigured();
    const r = await httpWithTokenRefresh('GET', SETU_ENDPOINTS.getConsent(consentId));
    return { consentId, status: mapConsentStatus(r.status) };
  },

  async revokeConsent(consentId) {
    this._requireConfigured();
    try {
      const r = await httpWithTokenRefresh('POST', SETU_ENDPOINTS.revokeConsent(consentId), { body: {} });
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
    const r = await httpWithTokenRefresh('POST', SETU_ENDPOINTS.createSession, { body });
    const sessionId = r.id || (r.session && r.session.id) || null;
    return { consentId, sessionId, status: 'data_requested' };
  },

  async getFIData(sessionId) {
    this._requireConfigured();
    const r = await httpWithTokenRefresh('GET', SETU_ENDPOINTS.fetchSession(sessionId));
    const status = String(r.status || '').toUpperCase();
    return {
      sessionId,
      consentId: r.consentId || null,
      status: status === 'COMPLETED' ? 'fetched' : status === 'PARTIAL' ? 'partial_failure' : 'data_ready',
      data: r,
    };
  },

  /** Setu Account Availability: verify a customer's accounts exist across AAs. */
  async checkAccountAvailability({ mobileNumber } = {}) {
    this._requireConfigured();
    if (!mobileNumber) throw aaError(AA_ERROR_CODES.INVALID_PAYLOAD, 'mobileNumber is required for account availability.');
    const r = await httpWithTokenRefresh('POST', SETU_ENDPOINTS.accountAvailability, { body: { mobileNumber } });
    return { accounts: r.accounts || [], traceId: r.traceId || null };
  },

  /** List data sessions for a consent (used for recovery/polling). */
  async getDataSessionStatus(consentId) {
    this._requireConfigured();
    const r = await httpWithTokenRefresh('GET', SETU_ENDPOINTS.getDataSessions(consentId));
    return { consentId, dataSessions: r.dataSessions || [] };
  },

  async handleNotification(notification) {
    const hasValid = verifySetuWebhookSignature(notification.rawBody || '', notification.headers && notification.headers['x-webhook-signature']);
    // If no webhook secret is configured we can still accept a verified payload.
    // Setu's current AA notifications API does not publish a signature header
    // contract, so verification is best-effort/optional (defence-in-depth) and is
    // only enforced when a signing secret is configured on the Bridge.
    if (notification && notification.rawBody && !hasValid.valid && hasValid.reason !== 'NO_SECRET_CONFIGURED') {
      throw aaError(AA_ERROR_CODES.INVALID_SIGNATURE, 'Invalid Setu webhook signature.');
    }

    // Parse the canonical Setu notification envelope (see the Setu Notifications
    // doc). WealthCore processes exactly these fields; never the raw FI payload.
    const p = notification.payload || {};
    const data = p.data || {};
    return {
      ok: true,
      handled: true,
      signatureValid: hasValid.valid,
      signatureReason: hasValid.reason,
      type: String(p.type || p.event || '').toUpperCase(),
      consentId: p.consentId || p.consent_id || data.consentId || null,
      dataSessionId: p.dataSessionId || p.data_session_id || null,
      notificationId: p.notificationId || p.notification_id || null,
      status: String(data.status || p.status || '').toUpperCase() || null,
      success: p.success !== false,
      errorCode: (p.error && (p.error.code || p.error.message)) || null,
    };
  },

  normalizeFinancialData(data) {
    // data is the full session response; translate to canonical envelope.
    if (data && data.data) return translateSetuFiToEnvelope(data.data, { provider: 'setu', consentId: data.consentId, sessionId: data.sessionId });
    return translateSetuFiToEnvelope(data, { provider: 'setu' });
  },
};

export default SetuProvider;
