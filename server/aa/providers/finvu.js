// WealthCore — Finvu AA adapter (architectural; NOT live).
//
// STATUS: PARTIALLY IMPLEMENTED / PLANNED.
// This adapter encodes the *verified* Finvu UAT contract (base URL, endpoints,
// auth headers, ReBIT message shapes) so a real integration can be enabled by
// supplying credentials. It is NOT connected to any live Finvu environment here.
//
// PENDING PROVIDER CONFIRMATION (do NOT guess — confirm with Finvu):
//   * exact JWS canonical signing input (raw body vs canonical headers)
//   * required x-jws-signature alg (RS256) and kid handling
//   * RSA key registration flow for the FIU module
//   * ECDH (Curve25519) key generation per FI request
//   * AES-GCM mode/params and exact key-derivation (KDF) from ECDH
//   * key lifecycle/rotation and response decryption contract
//
// When WEALTHCORE_AA_PROVIDER=finvu AND credentials are present, an implementer
// supplies the crypto path. Until then this provider reports READY_FOR_CONFIGURATION.

import { config } from '../../config.js';
import { aaError, AA_ERROR_CODES } from '../errors.js';

export const FINVU_BASE_URL = 'https://aauat.finvu.in/API/V1';
export const FINVU_ENDPOINTS = {
  createConsent: '/Consent',
  consentStatus: (handle) => `/Consent/handle/${handle}`,
  consentDetail: (id) => `/Consent/${id}`,
  requestFI: '/FI/request',
  fetchFI: (sessionId) => `/FI/fetch/${sessionId}`,
  notification: '/Consent/Notification',
};

export const FinvuProvider = {
  name: 'finvu',
  mode: () => (config().aa.configured ? 'PRODUCTION' : 'SANDBOX'),
  configured: false,
  requiresCredentials: true,

  status() {
    const cfg = config().aa;
    return {
      configured: cfg.configured,
      mode: cfg.configured ? 'PRODUCTION' : 'SANDBOX',
      requiresCredentials: true,
      detail: cfg.configured ? 'Finvu credentials configured (crypto path pending).' : 'READY_FOR_CONFIGURATION — Finvu credentials required. contact support@cookiejar.co.in',
    };
  },

  getSupportedFIs() {
    return ['BANK', 'BROKER', 'MF_RTA', 'INSURER', 'PENSION'];
  },

  getSupportedFITypes() {
    return ['DEPOSIT', 'TERM_DEPOSIT', 'RECURRING_DEPOSIT', 'EQUITIES', 'MUTUAL_FUNDS', 'ETF', 'BONDS', 'GOLD', 'INSURANCE_POLICIES', 'NPS', 'GOVT_SECURITIES', 'SIP'];
  },

  supportsFIType(fiType) { return this.getSupportedFITypes().includes(fiType); },

  async _guard() {
    const cfg = config().aa;
    if (!cfg.configured || cfg.provider !== 'finvu') {
      throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, 'Finvu credentials are required (client_api_key + FIU key material).');
    }
    // Crypto/JWS is not verified — surface honestly.
    throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, 'Finvu live path is not enabled: JWS/encryption integration points are PENDING_PROVIDER_CONFIRMATION.');
  },

  createConsent: async () => FinvuProvider._guard(),
  getConsent: async () => FinvuProvider._guard(),
  getConsentStatus: async () => FinvuProvider._guard(),
  revokeConsent: async () => FinvuProvider._guard(),
  requestFIData: async () => FinvuProvider._guard(),
  getFIData: async () => FinvuProvider._guard(),
  handleNotification: async (n) => ({ ok: true, handled: false }),

  normalizeFinancialData(data) {
    // PENDING PROVIDER CONFIRMATION: translate Finvu/ReBIT block into the
    // canonical envelope consumed by rebit-normalizer.
    return data;
  },
};

export default FinvuProvider;
