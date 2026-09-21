// WealthCore — Demo data-environment AA provider (fully local, no credentials).
//
// ##########################################################################
// # DEMO DATA — ALL FINANCIAL INFORMATION IS SYNTHETIC.                    #
// # NOT REAL FINANCIAL DATA. NO REAL BANK ACCOUNTS. NO REAL CREDENTIALS.   #
// ##########################################################################
//
// The Demo provider implements the SAME AAProvider contract as every other
// Account Aggregator adapter (mock / finvu / setu / ...) and resolves through
// the same registry. It requires NO bank credentials and ALL data it returns
// is deterministic synthetic data from ../fixtures/demo-data.js, clearly
// labelled (source=DEMO, synthetic=true, DEMO-* identifiers; is_demo=1 in DB).
//
// Lifecycle (identical to the real AA flow):
//   createConsent → approveConsent → requestFIData → markDataReady
//   → getFIData → normalizeFinancialData (canonical envelope → normalizer)

import { aaError, AA_ERROR_CODES } from '../errors.js';
import { buildDemoFinancialData, DEMO_FIPS } from '../fixtures/demo-data.js';

const CONSENT_STORE = new Map(); // consentId -> { status, dataStatus, sessionId }
let SEQUENCE = 0; // per-process counter → DEMO-CONSENT-0001 / DEMO-SESSION-0001 (deterministic ids)

function nowIso() { return new Date().toISOString(); }
function nextId(kind) { SEQUENCE += 1; return `DEMO-${kind}-${String(SEQUENCE).padStart(4, '0')}`; }

const SUPPORTED_FI_TYPES = [
  'DEPOSIT', 'TERM_DEPOSIT', 'RECURRING_DEPOSIT', 'EQUITIES', 'MUTUAL_FUNDS',
  'ETF', 'BONDS', 'GOLD', 'INSURANCE_POLICIES', 'NPS', 'EPF', 'PPF', 'LOAN',
  'SIP', 'CREDIT_CARD',
];

export const DemoProvider = {
  name: 'demo',
  mode: 'DEMO',
  configured: true,
  synthetic: true,
  requiresCredentials: false,

  status() {
    return {
      configured: true,
      mode: 'DEMO',
      requiresCredentials: false,
      synthetic: true,
      status: 'READY',
      detail: 'DEMO — deterministic synthetic data only. Never real bank data; no credentials required.',
    };
  },

  getSupportedFIs() {
    return DEMO_FIPS.map((f) => f.fipId);
  },

  getSupportedFITypes() {
    return SUPPORTED_FI_TYPES;
  },

  supportsFIType(fiType) {
    return SUPPORTED_FI_TYPES.includes(fiType);
  },

  async discoverAccounts() {
    return buildDemoFinancialData().fips;
  },

  async createConsent({ provider, fiType, purpose, fiTypes, dataRange, frequency, customerHandle } = {}) {
    const requestedFiTypes = Array.isArray(fiTypes) && fiTypes.length ? fiTypes : [fiType || 'DEPOSIT'];
    const consentId = nextId('CONSENT');
    const consentHandle = nextId('HANDLE');
    const now = nowIso();
    CONSENT_STORE.set(consentId, { status: 'pending', dataStatus: 'idle', createdAt: now });
    return {
      consent: {
        consentId,
        consentHandle,
        customerHandle: customerHandle || 'demo-customer@demo',
        provider: 'demo',
        status: 'pending',
        dataStatus: 'idle',
        purpose: purpose || 'Personal financial management (demo)',
        fiTypes: requestedFiTypes,
        dataRange: dataRange || { from: '2026-04-01T00:00:00.000Z', to: '2026-09-30T23:59:59.000Z' },
        frequency: frequency || { unit: 'MONTH', value: 1 },
        source: 'DEMO',
        synthetic: true,
        createdAt: now,
        approvedAt: null,
        expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        revokedAt: null,
      },
    };
  },

  async getConsent(consentId) {
    const s = CONSENT_STORE.get(consentId);
    if (!s) return null;
    return { consentId, status: s.status, dataStatus: s.dataStatus, createdAt: s.createdAt };
  },

  async getConsentStatus(consentId) {
    const s = CONSENT_STORE.get(consentId);
    if (!s) throw aaError(AA_ERROR_CODES.CONSENT_NOT_FOUND, 'Consent not found', { consentId });
    return { consentId, status: s.status, dataStatus: s.dataStatus };
  },

  async approveConsent(consentId) {
    const s = CONSENT_STORE.get(consentId);
    if (!s) throw aaError(AA_ERROR_CODES.CONSENT_NOT_FOUND, 'Consent not found', { consentId });
    if (s.status !== 'pending') throw aaError(AA_ERROR_CODES.INVALID_TRANSITION, 'Consent is not pending', { consentId, status: s.status });
    s.status = 'approved';
    return { consentId, status: s.status };
  },

  async rejectConsent(consentId) {
    const s = CONSENT_STORE.get(consentId);
    if (!s) throw aaError(AA_ERROR_CODES.CONSENT_NOT_FOUND, 'Consent not found', { consentId });
    if (s.status !== 'pending') throw aaError(AA_ERROR_CODES.INVALID_TRANSITION, 'Consent is not pending', { consentId, status: s.status });
    s.status = 'rejected';
    return { consentId, status: s.status };
  },

  async revokeConsent(consentId) {
    const s = CONSENT_STORE.get(consentId);
    if (!s) throw aaError(AA_ERROR_CODES.CONSENT_NOT_FOUND, 'Consent not found', { consentId });
    if (s.status === 'revoked') throw aaError(AA_ERROR_CODES.INVALID_TRANSITION, 'Consent already revoked', { consentId });
    if (s.status !== 'approved' && s.status !== 'active') {
      throw aaError(AA_ERROR_CODES.INVALID_TRANSITION, 'Consent must be approved before it can be revoked', { consentId, status: s.status });
    }
    s.status = 'revoked';
    return { consentId, status: s.status };
  },

  async requestFIData({ consentId, sessionId } = {}) {
    const s = CONSENT_STORE.get(consentId);
    if (!s) throw aaError(AA_ERROR_CODES.CONSENT_NOT_FOUND, 'Consent not found', { consentId });
    if (s.status === 'revoked') throw aaError(AA_ERROR_CODES.CONSENT_REVOKED, 'Consent revoked', { consentId });
    if (s.status === 'expired') throw aaError(AA_ERROR_CODES.CONSENT_EXPIRED, 'Consent expired', { consentId });
    if (s.status !== 'approved' && s.status !== 'active') {
      throw aaError(AA_ERROR_CODES.CONSENT_REJECTED, 'Consent must be approved before requesting data', { consentId, status: s.status });
    }
    const sid = sessionId || nextId('SESSION');
    s.dataStatus = 'data_requested';
    s.sessionId = sid;
    return { consentId, sessionId: sid, status: 'data_requested' };
  },

  async markDataReady({ consentId }) {
    const s = CONSENT_STORE.get(consentId);
    if (!s) throw aaError(AA_ERROR_CODES.CONSENT_NOT_FOUND, 'Consent not found', { consentId });
    s.dataStatus = 'data_ready';
    return { consentId, dataStatus: 'data_ready' };
  },

  async getFIData(sessionId) {
    const entry = [...CONSENT_STORE.entries()].find(([, v]) => v.sessionId === sessionId);
    if (!entry) throw aaError(AA_ERROR_CODES.DATA_NOT_READY, 'No data session found', { sessionId });
    const [, s] = entry;
    if (s.status === 'revoked') throw aaError(AA_ERROR_CODES.CONSENT_REVOKED, 'Consent revoked', { consentId: entry[0] });
    if (s.dataStatus === 'data_requested') s.dataStatus = 'data_ready'; // demo fetch is immediately ready
    if (s.dataStatus !== 'data_ready') throw aaError(AA_ERROR_CODES.DATA_NOT_READY, 'Data is not ready', { sessionId, dataStatus: s.dataStatus });
    s.dataStatus = 'fetched';
    return buildDemoFinancialData();
  },

  async handleNotification(notification) {
    if (notification && notification.event === 'DATA_READY' && notification.consentId) {
      await this.markDataReady({ consentId: notification.consentId });
      return { ok: true, handled: true };
    }
    return { ok: true, handled: false };
  },

  normalizeFinancialData(data) {
    // Demo returns the canonical envelope directly; the shared rebit-normalizer
    // owns mapping into domain rows (same contract as the mock adapter).
    return data;
  },

  _store: CONSENT_STORE,
};

export default DemoProvider;
