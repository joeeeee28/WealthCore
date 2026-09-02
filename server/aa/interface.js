// WealthCore — Provider-neutral Account Aggregator interface & registry.
//
// WealthCore's UI and domain logic must NEVER call a provider-specific API
// directly. Every AA provider (Mock, Finvu, Setu, OneMoney, ...) implements
// the AAProvider contract and registers itself here. Selection is driven by
// configuration (AA_PROVIDER), never hard-coded.
//
// Every method returns provider-neutral data: consents, sessions and a
// canonical FinancialData envelope. Provider-specific translation happens
// inside the adapter's parse/normalize step.

import { config } from '../config.js';

/**
 * @typedef {Object} AAProvider
 * @property {string} name                provider id (mock, finvu, setu, onemoney, ...)
 * @property {'MOCK'|'SANDBOX'|'PRODUCTION'} mode
 * @property {boolean} configured         true when usable in this environment
 * @property {boolean} requiresCredentials true when it needs external secrets to go live
 * @property {() => {configured:boolean, mode:string, requiresCredentials:boolean, detail:string}} status
 * @property {(req:Object)=>Promise<Object>} createConsent
 * @property {(consentId:string)=>Promise<Object>} getConsent
 * @property {(consentId:string)=>Promise<Object>} getConsentStatus
 * @property {(consentId:string)=>Promise<Object>} revokeConsent
 * @property {(req:Object)=>Promise<Object>} requestFIData
 * @property {(sessionId:string)=>Promise<Object>} getFIData
 * @property {(notification:Object)=>Promise<Object>} handleNotification
 * @property {(data:Object)=>Object} normalizeFinancialData
 * @property {(fiType:string)=>boolean} supportsFIType
 * @property {()=>string[]} getSupportedFITypes
 * @property {()=>string[]} getSupportedFIs
 */

const REGISTRY = new Map();

export function registerAAPProvider(provider) {
  if (!provider || !provider.name) throw new Error('AA provider must have a name');
  REGISTRY.set(provider.name, provider);
}

export function getAAPProvider(name) {
  return REGISTRY.get(name) || null;
}

export function listAAPProviders() {
  return [...REGISTRY.values()];
}

/**
 * Resolve the active AA provider based on configuration (or an explicit
 * override passed by the caller). Falls back to `mock` so the application is
 * always demonstrable with no external credentials. Never fabricates a live
 * provider that isn't configured.
 */
export function resolveAAPProvider(override) {
  const cfg = config();
  const configured = (override && override.provider) || cfg.aa.provider || 'mock';
  const provider = REGISTRY.get(configured);
  if (provider) return provider;

  // Unknown provider id — degrade to a clearly-labelled not-configured stub.
  return {
    name: configured,
    mode: cfg.aa.configured ? 'PRODUCTION' : 'SANDBOX',
    configured: false,
    requiresCredentials: true,
    status: () => ({
      configured: false,
      mode: 'SANDBOX',
      requiresCredentials: true,
      detail: 'READY_FOR_CONFIGURATION — provider credentials required',
    }),
    createConsent: async () => { throw aaError('PROVIDER_NOT_CONFIGURED', 'AA provider is not configured'); },
    getConsent: async () => { throw aaError('PROVIDER_NOT_CONFIGURED', 'AA provider is not configured'); },
    getConsentStatus: async () => { throw aaError('PROVIDER_NOT_CONFIGURED', 'AA provider is not configured'); },
    revokeConsent: async () => { throw aaError('PROVIDER_NOT_CONFIGURED', 'AA provider is not configured'); },
    requestFIData: async () => { throw aaError('PROVIDER_NOT_CONFIGURED', 'AA provider is not configured'); },
    getFIData: async () => { throw aaError('PROVIDER_NOT_CONFIGURED', 'AA provider is not configured'); },
    handleNotification: async () => { throw aaError('PROVIDER_NOT_CONFIGURED', 'AA provider is not configured'); },
    normalizeFinancialData: (d) => d,
    supportsFIType: () => false,
    getSupportedFITypes: () => [],
    getSupportedFIs: () => [],
  };
}

import { aaError } from './errors.js';

export default {
  registerAAPProvider, getAAPProvider, listAAPProviders, resolveAAPProvider,
};
