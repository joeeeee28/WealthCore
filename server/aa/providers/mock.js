// WealthCore — Mock AA provider (fully local, no credentials).
//
// TEST DATA — NOT REAL FINANCIAL DATA.
// Simulates the entire AA lifecycle: discover → create consent → approve →
// request FI → data ready → fetch → normalize. Works entirely in-process.
// Deterministic so tests and repeated imports are stable.

import crypto from 'node:crypto';
import { config } from '../../config.js';
import { aaError, AA_ERROR_CODES } from '../errors.js';
import { buildMockFinancialData } from '../fixtures/mock-data.js';

const CONSENT_STORE = new Map(); // consentId -> { status, dataStatus }

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }

export const MockAAProvider = {
  name: 'mock',
  mode: 'MOCK',
  configured: true,
  requiresCredentials: false,

  status() {
    return {
      configured: true,
      mode: 'MOCK',
      requiresCredentials: false,
      detail: 'Demo / simulation provider. No real financial data.',
    };
  },

  getSupportedFIs() {
    return ['NMB0000001', 'NMB0000002', 'NMB0000003', 'NMB0000004'];
  },

  getSupportedFITypes() {
    return [
      'DEPOSIT', 'TERM_DEPOSIT', 'RECURRING_DEPOSIT', 'EQUITIES', 'MUTUAL_FUNDS',
      'ETF', 'BONDS', 'GOLD', 'INSURANCE_POLICIES', 'NPS', 'EPF', 'PPF', 'LOAN',
    ];
  },

  supportsFIType(fiType) {
    return this.getSupportedFITypes().includes(fiType);
  },

  async discoverAccounts({ customerHandle } = {}) {
    // Deterministic — always returns the same mock FIP list.
    return buildMockFinancialData().fips;
  },

  async createConsent({ provider, fiType, purpose, fiTypes, dataRange, frequency, customerHandle } = {}) {
    const requestedFiTypes = Array.isArray(fiTypes) && fiTypes.length ? fiTypes : [fiType || 'DEPOSIT'];
    const consentId = uuid();
    const consentHandle = uuid();
    const now = nowIso();
    CONSENT_STORE.set(consentId, { status: 'pending', dataStatus: 'idle', createdAt: now });
    return {
      consent: {
        consentId,
        consentHandle,
        customerHandle: customerHandle || 'mock-customer@mock',
        provider: 'mock',
        status: 'pending',
        dataStatus: 'idle',
        purpose: purpose || 'Personal financial management',
        fiTypes: requestedFiTypes,
        dataRange: dataRange || { from: '2026-01-01T00:00:00.000Z', to: '2026-08-31T23:59:59.000Z' },
        frequency: frequency || { unit: 'MONTH', value: 1 },
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
    // State machine: only approved / active can be revoked (never pending).
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
    const sid = sessionId || uuid();
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
    if (s.dataStatus === 'data_requested') {
      // For the mock, treat a fetch as immediately ready after a natural delay.
      s.dataStatus = 'data_ready';
    }
    if (s.dataStatus !== 'data_ready') throw aaError(AA_ERROR_CODES.DATA_NOT_READY, 'Data is not ready', { sessionId, dataStatus: s.dataStatus });
    s.dataStatus = 'fetched';
    return buildMockFinancialData();
  },

  async handleNotification(notification) {
    // Mock supports a data-ready notification trigger.
    if (notification && notification.event === 'DATA_READY' && notification.consentId) {
      await this.markDataReady({ consentId: notification.consentId });
      return { ok: true, handled: true };
    }
    return { ok: true, handled: false };
  },

  normalizeFinancialData(data) {
    // The canonical normalizer (rebit-normalizer) owns mapping; mock returns as-is.
    return data;
  },

  _store: CONSENT_STORE,
};

export default MockAAProvider;
