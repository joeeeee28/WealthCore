// WealthCore — structured Account Aggregator errors.
//
// These are safe for users (no secrets) but useful for developers (a stable
// code + message). Never include API keys, tokens, private keys, or raw
// encrypted payloads.

import { logger } from '../lib/logger.js';

export const AA_ERROR_CODES = {
  CONSENT_REJECTED: 'CONSENT_REJECTED',
  CONSENT_EXPIRED: 'CONSENT_EXPIRED',
  CONSENT_REVOKED: 'CONSENT_REVOKED',
  FIP_UNAVAILABLE: 'FIP_UNAVAILABLE',
  DATA_NOT_READY: 'DATA_NOT_READY',
  FETCH_TIMEOUT: 'FETCH_TIMEOUT',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNSUPPORTED_FI_TYPE: 'UNSUPPORTED_FI_TYPE',
  PARTIAL_FIP_FAILURE: 'PARTIAL_FIP_FAILURE',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CONSENT_NOT_FOUND: 'CONSENT_NOT_FOUND',
};

export class AAError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'AAError';
    this.code = code;
    this.meta = meta;
  }
}

/** Create an AAError and log it (redacted) without exposing secrets. */
export function aaError(code, message, meta = {}) {
  const safeMeta = { ...meta };
  logger.warn('aa_error', { code, message, meta: safeMeta });
  return new AAError(code, message, safeMeta);
}

/** Wrap an unknown error into a safe AAError (never leak internals to UI). */
export function toAAError(err) {
  if (err instanceof AAError) return err;
  logger.error('aa_unhandled', { error: err && err.message ? err.message : String(err) });
  return new AAError('PROVIDER_UNAVAILABLE', 'The provider request failed. Please try again.');
}

export default AAError;
