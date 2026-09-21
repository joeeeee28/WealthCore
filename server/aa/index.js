// WealthCore — Account Aggregator module (public entry).
//
// Registers the built-in providers (Mock, Finvu, Setu, OneMoney, Anumati, INK,
// Saafe, NADL, Protean) into the provider-neutral registry and re-exports the
// public API used by routes, sync and AI tools.

import { registerAAPProvider, getAAPProvider, listAAPProviders, resolveAAPProvider } from './interface.js';
import MockAAProvider from './providers/mock.js';
import FinvuProvider from './providers/finvu.js';
import SetuProvider from './providers/setu.js';
import DemoProvider from './providers/demo.js';
import { aaError, AAError, AA_ERROR_CODES, toAAError } from './errors.js';
import { normalizeFinancialData, capabilityError } from './rebit-normalizer.js';
import { runAASync } from './sync.js';
import {
  DATA_ENVIRONMENTS, DEFAULT_DATA_ENVIRONMENT, ENVIRONMENT_PROVIDER,
  getDataEnvironment, getActiveProvider, environmentProviderName,
  describeDataEnvironment, describeDataEnvironments, assertDemoAllowed,
} from './data-environment.js';
import {
  CONSENT_STATES, DATA_STATES, consentStateFlow, dataStateFlow,
  canTransitionConsent, canTransitionData, transitionConsentStatus, transitionDataStatus,
} from './consent-state-machine.js';

// Build a generic "not configured" provider for AAs we haven't wired live.
function notConfiguredProvider(name, detail) {
  return {
    name,
    mode: 'SANDBOX',
    configured: false,
    requiresCredentials: true,
    status: () => ({ configured: false, mode: 'SANDBOX', requiresCredentials: true, detail }),
    getSupportedFIs: () => [],
    getSupportedFITypes: () => [],
    supportsFIType: () => false,
    createConsent: async () => { throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, `${name} credentials required.`); },
    getConsent: async () => { throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, `${name} credentials required.`); },
    getConsentStatus: async () => { throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, `${name} credentials required.`); },
    revokeConsent: async () => { throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, `${name} credentials required.`); },
    requestFIData: async () => { throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, `${name} credentials required.`); },
    getFIData: async () => { throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, `${name} credentials required.`); },
    handleNotification: async (n) => ({ ok: true, handled: false }),
    normalizeFinancialData: (d) => d,
  };
}

// Register all providers on module load.
registerAAPProvider(MockAAProvider);
registerAAPProvider(FinvuProvider);
registerAAPProvider(SetuProvider);
registerAAPProvider(DemoProvider);
registerAAPProvider(notConfiguredProvider('onemoney', 'OneMoney credentials required. developer.onemoney.in'));
registerAAPProvider(notConfiguredProvider('anumati', 'Anumati/Perfios credentials required.'));
registerAAPProvider(notConfiguredProvider('ink', 'INK AA credentials required.'));
registerAAPProvider(notConfiguredProvider('saafe', 'Saafe credentials required.'));
registerAAPProvider(notConfiguredProvider('nadl', 'NADL credentials required.'));
registerAAPProvider(notConfiguredProvider('protean', 'Protean SurakshAA credentials required.'));
// 'mock' is also the fallback when AA_PROVIDER is unset.

export {
  registerAAPProvider, getAAPProvider, listAAPProviders, resolveAAPProvider,
  MockAAProvider, FinvuProvider, SetuProvider, DemoProvider,
  aaError, AAError, AA_ERROR_CODES, toAAError,
  normalizeFinancialData, capabilityError,
  runAASync,
  CONSENT_STATES, DATA_STATES, consentStateFlow, dataStateFlow,
  canTransitionConsent, canTransitionData, transitionConsentStatus, transitionDataStatus,
  DATA_ENVIRONMENTS, DEFAULT_DATA_ENVIRONMENT, ENVIRONMENT_PROVIDER,
  getDataEnvironment, getActiveProvider, environmentProviderName,
  describeDataEnvironment, describeDataEnvironments, assertDemoAllowed,
};

export default {
  registerAAPProvider, getAAPProvider, listAAPProviders, resolveAAPProvider,
  MockAAProvider, FinvuProvider, SetuProvider, DemoProvider,
  aaError, AAError, AA_ERROR_CODES, toAAError,
  normalizeFinancialData, capabilityError,
  runAASync,
  CONSENT_STATES, DATA_STATES,
  getDataEnvironment, getActiveProvider, describeDataEnvironments, assertDemoAllowed,
};
