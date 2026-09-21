// WealthCore — central data environment & provider resolution.
//
// SINGLE SOURCE OF TRUTH for "which data world is WealthCore running against".
// Application code must NEVER read WEALTHCORE_DATA_ENVIRONMENT directly or
// duplicate environment-selection logic; it calls getDataEnvironment() /
// getActiveProvider() here, which delegate to the provider-neutral registry
// (resolveAAPProvider) so there is exactly one resolution path.
//
// Environments:
//   DEMO           → Demo provider (deterministic synthetic data, no credentials)
//   FINVU_SANDBOX  → Finvu AA provider (sandbox/UAT credentials)
//   SETU_SANDBOX   → Setu AA provider (sandbox credentials)
//   PRODUCTION     → the explicitly configured real AA provider (via AA_PROVIDER
//                    + credentials). PRODUCTION must NEVER fall back to DEMO —
//                    not automatically, not silently. When no real provider is
//                    configured, resolution returns a NOT-CONFIGURED production
//                    stub instead of any synthetic provider.

import { config, DATA_ENVIRONMENTS, DEFAULT_DATA_ENVIRONMENT, parseDataEnvironment } from '../config.js';
import { resolveAAPProvider, getAAPProvider, listAAPProviders } from './interface.js';
import { aaError, AA_ERROR_CODES } from './errors.js';

export { DATA_ENVIRONMENTS, DEFAULT_DATA_ENVIRONMENT, parseDataEnvironment };

/** Map a non-production data environment to its registry provider name. */
export const ENVIRONMENT_PROVIDER = Object.freeze({
  DEMO: 'demo',
  FINVU_SANDBOX: 'finvu',
  SETU_SANDBOX: 'setu',
  // PRODUCTION intentionally has no static mapping: the production provider is
  // whatever the operator explicitly configured (AA_PROVIDER), never demo.
});

const ENV_META = Object.freeze({
  DEMO: { label: 'DEMO MODE', icon: '\u{1F9EA}', synthetic: true, sandbox: false },
  FINVU_SANDBOX: { label: 'FINVU SANDBOX', icon: '\u{1F52C}', synthetic: false, sandbox: true },
  SETU_SANDBOX: { label: 'SETU SANDBOX', icon: '\u{1F52C}', synthetic: false, sandbox: true },
  PRODUCTION: { label: 'PRODUCTION', icon: '\u{1F510}', synthetic: false, sandbox: false },
});

/**
 * The active data environment. Reads normalized config; when the operator set
 * an unrecognised WEALTHCORE_DATA_ENVIRONMENT this THROWS — validation must
 * fail loudly rather than quietly resolving against some guessed environment.
 */
export function getDataEnvironment() {
  const cfg = config();
  if (cfg.dataEnvironmentValid === false) {
    throw aaError(AA_ERROR_CODES.INVALID_PAYLOAD,
      `WEALTHCORE_DATA_ENVIRONMENT must be one of ${DATA_ENVIRONMENTS.join(', ')}.`,
      { setting: 'WEALTHCORE_DATA_ENVIRONMENT', code_: 'INVALID_DATA_ENVIRONMENT' });
  }
  return cfg.dataEnvironment || DEFAULT_DATA_ENVIRONMENT;
}

/** The provider name an environment resolves to (null = none-configured for PRODUCTION). */
export function environmentProviderName(env, cfg = config()) {
  if (env === 'PRODUCTION') {
    const p = String(cfg.aa.provider || '').trim().toLowerCase();
    if (!p || p === 'demo' || p === 'mock') return null; // never demo/mock in production
    return p;
  }
  return ENVIRONMENT_PROVIDER[env] || null;
}

/** A clearly-labelled, NOT-configured production stub — never demo data. */
function productionNotConfiguredProvider() {
  const stub = {
    name: 'production',
    mode: 'PRODUCTION',
    configured: false,
    synthetic: false,
    requiresCredentials: true,
    status: () => ({
      configured: false,
      mode: 'PRODUCTION',
      requiresCredentials: true,
      synthetic: false,
      status: 'NOT_CONFIGURED',
      detail: 'PRODUCTION data environment selected without configured Finvu/Setu credentials. Demo data is NEVER substituted in production.',
    }),
    getSupportedFIs: () => [],
    getSupportedFITypes: () => [],
    supportsFIType: () => false,
    normalizeFinancialData: (d) => d,
    handleNotification: async () => ({ ok: true, handled: false }),
  };
  const blocked = async () => {
    throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      'PRODUCTION data environment requires configured Finvu/Setu credentials. Demo data is never used as a fallback.');
  };
  stub.createConsent = blocked;
  stub.getConsent = async () => null;
  stub.getConsentStatus = blocked;
  stub.revokeConsent = blocked;
  stub.requestFIData = blocked;
  stub.getFIData = blocked;
  return stub;
}

/**
 * Resolve the active AA provider for the current data environment (or an
 * explicit caller override). Non-production environments map through
 * ENVIRONMENT_PROVIDER → registry; PRODUCTION resolves ONLY an explicitly
 * configured real provider and degrades to a not-configured production stub —
 * it can never return the demo (or mock) provider.
 */
export function getActiveProvider(override = {}) {
  const env = override.environment
    ? (parseDataEnvironment(override.environment).value || getDataEnvironment())
    : getDataEnvironment();

  if (env === 'PRODUCTION') {
    const name = override.provider
      ? String(override.provider).toLowerCase()
      : environmentProviderName('PRODUCTION');
    if (!name || name === 'demo' || name === 'mock') return productionNotConfiguredProvider();
    return resolveAAPProvider({ provider: name });
  }

  const name = override.provider || environmentProviderName(env);
  return resolveAAPProvider({ provider: name });
}

/** Describe one environment for APIs/UI (labels, icon, synthetic flag). */
export function describeDataEnvironment(env, cfg = config()) {
  const meta = ENV_META[env] || { label: env, icon: '', synthetic: false, sandbox: false };
  const providerName = environmentProviderName(env, cfg);
  const provider = providerName ? getAAPProvider(providerName) : null;
  const st = provider && provider.status ? provider.status() : null;
  return {
    value: env,
    label: meta.label,
    icon: meta.icon,
    synthetic: meta.synthetic,
    sandbox: meta.sandbox,
    provider: providerName,
    providerConfigured: st ? Boolean(st.configured) : Boolean(provider && provider.configured),
    requiresCredentials: st ? Boolean(st.requiresCredentials) : true,
  };
}

/** Describe all supported environments, marking the active one. */
export function describeDataEnvironments() {
  let active;
  try { active = getDataEnvironment(); } catch { active = null; }
  return DATA_ENVIRONMENTS.map((env) => ({ ...describeDataEnvironment(env), active: env === active }));
}

/**
 * Guard used by every demo-data mutation: demo (synthetic) data may be loaded
 * in any environment EXCEPT production. This is the belt-and-braces runtime
 * check behind "production can never fall back to demo": even an explicit API
 * call cannot inject synthetic records when the operator selected PRODUCTION.
 */
export function assertDemoAllowed() {
  if (getDataEnvironment() === 'PRODUCTION') {
    const e = new Error('Demo (synthetic) data cannot be loaded while WEALTHCORE_DATA_ENVIRONMENT=PRODUCTION.');
    e.code = 'DEMO_DISABLED_IN_PRODUCTION';
    throw e;
  }
}

/** number of registered providers exposed for diagnostics/tests. */
export function registeredProviderNames() {
  return listAAPProviders().map((p) => p.name);
}

export default {
  DATA_ENVIRONMENTS,
  DEFAULT_DATA_ENVIRONMENT,
  ENVIRONMENT_PROVIDER,
  getDataEnvironment,
  getActiveProvider,
  environmentProviderName,
  describeDataEnvironment,
  describeDataEnvironments,
  assertDemoAllowed,
  registeredProviderNames,
};
