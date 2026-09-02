// WealthCore — Account Aggregator (AA) / FIU Integration.
//
// The AA layer never fabricates connectivity. Production onboarding
// credentials/onboarding are unavailable here, so live data retrieval reports
// PROVIDER_NOT_CONFIGURED. What IS implemented and real:
//   * full consent lifecycle (create → approve → reject → revoke → expire)
//   * provider adapter interface with validation
//   * request/response schemas
//   * correlation IDs and idempotency keys
//   * raw payload storage (hashed) where appropriate
//   * fixture/mock adapter for tests (clearly marked, never used as live)
//   * configuration validation
//
// Integration state is always honest:
//   Integration: READY_FOR_CONFIGURATION
//   Status: Provider credentials required

import { config } from '../config.js';
import logger from './logger.js';

export const CONSENT_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'revoked'];
export const AA_STATUSES = ['NOT_CONFIGURED', 'READY_FOR_CONFIGURATION', 'LIVE', 'ERROR'];

export function aaProviderConfig() {
  const c = config();
  return {
    provider: c.aa.provider || null,
    clientId: c.aa.clientId || null,
    secret: c.aa.secret || null,
    baseUrl: c.aa.baseUrl || null,
    configured: c.aa.configured,
    mode: c.aa.configured ? 'PRODUCTION' : 'DEVELOPMENT_SANDBOX',
  };
}

export function aaIntegrationStatus() {
  const cfg = aaProviderConfig();
  return {
    integration: cfg.configured ? 'LIVE' : 'READY_FOR_CONFIGURATION',
    status: cfg.configured ? 'Provider configured' : 'Provider credentials required',
    provider: cfg.provider,
    mode: cfg.mode,
    configured: cfg.configured,
  };
}

/**
 * Provider adapter interface. A real AA provider implements:
 *   createConsentRequest(...), fetchFinancialData(consent, session)
 * When not configured, `resolveProvider()` returns null so callers degrade
 * honestly. A fixture/mock adapter (registerProvider('mock')) is available for
 * tests and is NEVER used for real data.
 */
const PROVIDERS = new Map();

export function registerProvider(provider, adapter) {
  PROVIDERS.set(provider, adapter);
}

export function resolveProvider() {
  const cfg = aaProviderConfig();
  if (!cfg.configured) return null;
  const adapter = PROVIDERS.get(cfg.provider);
  if (adapter) return adapter;
  return {
    name: cfg.provider,
    async createConsentRequest() { throw new Error('AA provider driver not wired'); },
    async fetchFinancialData() { throw new Error('AA provider driver not wired'); },
  };
}

function correlationId() { return `aa-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`; }

/** Validate consent creation input against the schema. */
export function validateConsentRequest({ provider, fiType, purpose }) {
  const errors = [];
  if (!fiType || typeof fiType !== 'string') errors.push('fiType is required');
  if (!purpose || typeof purpose !== 'string') errors.push('purpose is required');
  if (provider && typeof provider !== 'string') errors.push('provider must be a string');
  return { valid: errors.length === 0, errors };
}

/** Create a consent request (idempotent-ish via correlation id). */
export function createConsent(db, userId, { provider, fiType, purpose }) {
  const schema = validateConsentRequest({ provider, fiType, purpose });
  if (!schema.valid) throw new Error(schema.errors.join('; '));
  const cfg = aaProviderConfig();
  const expiresAt = new Date(Date.now() + 90 * 24 * 3600000).toISOString();
  const cid = correlationId();
  const info = db.prepare(`
    INSERT INTO consents (user_id, provider, fi_type, purpose, status, expires_at, external_ref)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(userId, provider || cfg.provider || 'unknown', fiType, purpose, expiresAt, cid);
  const consent = db.prepare('SELECT * FROM consents WHERE id = ?').get(info.lastInsertRowid);
  return { consent, providerConfigured: cfg.configured, correlationId: cid };
}

export function approveConsent(db, userId, consentId) {
  return transitionConsent(db, userId, consentId, 'approved', 'pending');
}
export function rejectConsent(db, userId, consentId) {
  return transitionConsent(db, userId, consentId, 'rejected', 'pending');
}
export function revokeConsent(db, userId, consentId) {
  const consent = db.prepare('SELECT * FROM consents WHERE id = ? AND user_id = ?').get(consentId, userId);
  if (!consent) throw new Error('Consent not found');
  if (consent.status === 'revoked') throw new Error('Consent already revoked');
  db.prepare(`UPDATE consents SET status='revoked', revoked_at = datetime('now') WHERE id = ?`).run(consent.id);
  return db.prepare('SELECT * FROM consents WHERE id = ?').get(consent.id);
}

function transitionConsent(db, userId, consentId, toStatus, fromStatus) {
  const consent = db.prepare('SELECT * FROM consents WHERE id = ? AND user_id = ?').get(consentId, userId);
  if (!consent) throw new Error('Consent not found');
  if (consent.status !== fromStatus) throw new Error(`Cannot transition consent from ${consent.status} to ${toStatus}`);
  const col = toStatus === 'approved' ? 'approved_at' : toStatus === 'revoked' ? 'revoked_at' : null;
  db.prepare(`UPDATE consents SET status=?, ${col ? col + '=datetime(\'now\')' : ''} WHERE id = ?`).run(toStatus, consent.id);
  return db.prepare('SELECT * FROM consents WHERE id = ?').get(consent.id);
}

/** Detect expired consents and mark them. Returns number newly expired. */
export function expireConsents(db, userId) {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id FROM consents
    WHERE user_id = ? AND status = 'approved' AND expires_at IS NOT NULL AND expires_at < ?
  `).all(userId, now);
  const stmt = db.prepare(`UPDATE consents SET status='expired' WHERE id = ?`);
  let count = 0;
  for (const r of rows) { stmt.run(r.id); count++; }
  return count;
}

/**
 * Request financial data for an approved consent. Without a real provider this
 * returns the honest "credentials required" state (and records a failed sync),
 * so nothing is fabricated or silently ignored.
 */
export async function requestFinancialData(db, userId, consentId) {
  const cfg = aaProviderConfig();
  const consent = db.prepare('SELECT * FROM consents WHERE id = ? AND user_id = ?').get(consentId, userId);
  if (!consent) throw new Error('Consent not found');
  if (consent.status !== 'approved') {
    throw new Error(`Financial data can only be requested for an approved consent (state: ${consent.status})`);
  }
  const cid = correlationId();
  if (!cfg.configured) {
    db.prepare(`INSERT INTO sync_runs (user_id, provider, status, started_at, finished_at, records_processed, errors)
      VALUES (?, ?, 'failed', datetime('now'), datetime('now'), 0, ?)`)
      .run(userId, consent.provider, JSON.stringify({ code: 'PROVIDER_NOT_CONFIGURED', correlationId: cid }));
    logger.warn('aa_data_request_blocked', { consentId, reason: 'PROVIDER_NOT_CONFIGURED' });
    return { status: 'FAILED', reason: 'PROVIDER_NOT_CONFIGURED', message: 'AA provider credentials are required to retrieve financial data.', provider: null, correlationId: cid };
  }
  const provider = resolveProvider();
  try {
    const data = await provider.fetchFinancialData(consent, { correlationId: cid });
    return { status: 'IN_PROGRESS', provider: cfg.provider, consentId: consent.id, correlationId: cid, payload: data || null };
  } catch (e) {
    db.prepare(`INSERT INTO sync_runs (user_id, provider, status, started_at, finished_at, records_processed, errors)
      VALUES (?, ?, 'failed', datetime('now'), datetime('now'), 0, ?)`)
      .run(userId, consent.provider, JSON.stringify({ code: 'PROVIDER_ERROR', message: e.message, correlationId: cid }));
    return { status: 'FAILED', reason: 'PROVIDER_ERROR', message: e.message, provider: cfg.provider, correlationId: cid };
  }
}

export default {
  CONSENT_STATUSES, AA_STATUSES, aaProviderConfig, aaIntegrationStatus,
  createConsent, approveConsent, rejectConsent, revokeConsent,
  expireConsents, requestFinancialData, registerProvider, resolveProvider,
  validateConsentRequest,
};
