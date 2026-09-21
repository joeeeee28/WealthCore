// WealthCore — configuration & environment validation.
//
// Loads and validates configuration for development / test / production.
// In production the app fails fast if required secrets/integrations are missing,
// so it never accidentally runs with default or unsafe settings.

const BOOLEAN_TRUE = ['1', 'true', 'yes', 'on'];

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return BOOLEAN_TRUE.includes(String(v).toLowerCase());
}

function num(v, def) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

// Central data environment. WEALTHCORE_DATA_ENVIRONMENT selects which data
// provider family the application resolves by default. DEMO is the default so
// the product is always explorable with clearly-labelled synthetic data.
// PRODUCTION must NEVER fall back to DEMO automatically or silently.
export const DATA_ENVIRONMENTS = Object.freeze(['DEMO', 'FINVU_SANDBOX', 'SETU_SANDBOX', 'PRODUCTION']);
export const DEFAULT_DATA_ENVIRONMENT = 'DEMO';

/** Normalize the raw WEALTHCORE_DATA_ENVIRONMENT value (never throws). */
export function parseDataEnvironment(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { value: DEFAULT_DATA_ENVIRONMENT, valid: true, raw: null };
  }
  const value = String(raw).trim().toUpperCase();
  if (DATA_ENVIRONMENTS.includes(value)) return { value, valid: true, raw };
  return { value: null, valid: false, raw };
}

// Read a Setu config value, preferring the canonical WEALTHCORE_SETU_* namespace
// then the short SETU_* alias. Never returns the secret value in logs.
function setuVal(canonical, alias, def = null) {
  const v = process.env[canonical] || process.env[alias];
  return (v === undefined || v === '') ? def : v;
}

/** Build the Setu config group from environment (both namespaces). */
function buildSetuConfig() {
  const clientId = setuVal('WEALTHCORE_SETU_CLIENT_ID', 'SETU_CLIENT_ID');
  const clientSecret = setuVal('WEALTHCORE_SETU_CLIENT_SECRET', 'SETU_CLIENT_SECRET');
  const productInstanceId = setuVal('WEALTHCORE_SETU_PRODUCT_INSTANCE_ID', 'SETU_PRODUCT_INSTANCE_ID');
  const token = setuVal('WEALTHCORE_SETU_TOKEN', 'SETU_TOKEN');
  const baseUrl = setuVal('WEALTHCORE_SETU_BASE_URL', 'SETU_BASE_URL', 'https://fiu-sandbox.setu.co');
  const webhookSecret = setuVal('WEALTHCORE_SETU_WEBHOOK_SECRET', 'SETU_WEBHOOK_SECRET');
  const signingPublicKey = setuVal('WEALTHCORE_SETU_SIGNING_PUBLIC_KEY', 'SETU_SIGNING_PUBLIC_KEY');
  const tokenUrl = setuVal('WEALTHCORE_SETU_TOKEN_URL', 'SETU_TOKEN_URL');
  const redirectUrl = setuVal('WEALTHCORE_SETU_REDIRECT_URL', 'SETU_REDIRECT_URL');
  // Webhook/callback URL is the public base WealthCore exposes to Setu.
  const webhookUrl = setuVal('WEALTHCORE_SETU_WEBHOOK_URL', 'SETU_WEBHOOK_URL');
  const environment = setuVal('SETU_ENVIRONMENT', 'WEALTHCORE_SETU_ENVIRONMENT', setuVal('SETU_ENV', 'WEALTHCORE_SETU_ENV', 'sandbox'));
  return {
    clientId,
    clientSecret,
    productInstanceId,
    token,
    tokenUrl,
    baseUrl,
    redirectUrl,
    webhookUrl,
    webhookSecret,
    signingPublicKey,
    environment,
    configured: Boolean(
      (clientId && clientSecret && productInstanceId) ||
      (token && productInstanceId),
    ),
  };
}

function computeConfig() {
  const env = NODE_ENV;
  const db = process.env.WEALTHCORE_DB || (env === 'test' ? ':memory:' : 'data/wealthcore.db');

  return {
    env,
    isProd: env === 'production',
    isTest: env === 'test',

    host: process.env.HOST || '0.0.0.0',
    port: num(process.env.PORT, 8080),

    db,

    // Sessions / cookies
    cookieSecure: bool(process.env.WEALTHCORE_COOKIE_SECURE, env === 'production'),
    cookieSameSite: process.env.WEALTHCORE_COOKIE_SAMESITE || 'lax',
    sessionTtlMs: num(process.env.WEALTHCORE_SESSION_TTL_HOURS, 12) * 3600 * 1000,
    sessionSecret: process.env.WEALTHCORE_SESSION_SECRET || null,

    // Login rate limiting
    rateLoginMax: num(process.env.WEALTHCORE_LOGIN_RATE_MAX, 10),
    rateLoginWindowMs: num(process.env.WEALTHCORE_LOGIN_RATE_WINDOW_MINUTES, 15) * 60 * 1000,

    // App lock / encryption
    encryptionKey: process.env.WEALTHCORE_ENCRYPTION_KEY || null,

    // AA / FIU — provider is selectable via AA_PROVIDER or WEALTHCORE_AA_PROVIDER.
    aa: {
      provider: process.env.AA_PROVIDER || process.env.WEALTHCORE_AA_PROVIDER || null,
      clientId: process.env.WEALTHCORE_AA_CLIENT_ID || null,
      secret: process.env.WEALTHCORE_AA_SECRET || null,
      baseUrl: process.env.WEALTHCORE_AA_BASE_URL || null,
      configured: Boolean(process.env.WEALTHCORE_AA_PROVIDER && process.env.WEALTHCORE_AA_CLIENT_ID && process.env.WEALTHCORE_AA_SECRET && process.env.WEALTHCORE_AA_BASE_URL),
    },

    // Setu (AA gateway) — optional credentials group.
    // Two env namespaces are accepted (WEALTHCORE_SETU_* is the canonical one;
    // the short SETU_* forms are read as aliases so the documented Setu config
    // naming works unchanged). No value is ever logged.
    setu: buildSetuConfig(),

    // AA environment mode (mock | sandbox | production).
    aaEnvironment: process.env.AA_ENVIRONMENT || process.env.WEALTHCORE_AA_ENVIRONMENT || 'development',

    // Central data environment: DEMO (default) | FINVU_SANDBOX | SETU_SANDBOX |
    // PRODUCTION. Invalid values are flagged and rejected by validateConfig —
    // resolution code must consult `dataEnvironment` only when it is valid.
    ...(() => {
      const parsed = parseDataEnvironment(process.env.WEALTHCORE_DATA_ENVIRONMENT);
      return {
        dataEnvironment: parsed.value,
        dataEnvironmentValid: parsed.valid,
        dataEnvironmentRaw: parsed.raw,
      };
    })(),

    // Market data
    market: {
      provider: process.env.WEALTHCORE_MARKET_PROVIDER || null,
      apiKey: process.env.WEALTHCORE_MARKET_API_KEY || null,
      baseUrl: process.env.WEALTHCORE_MARKET_BASE_URL || null,
      configured: Boolean(process.env.WEALTHCORE_MARKET_PROVIDER && process.env.WEALTHCORE_MARKET_API_KEY),
    },

    // LLM / AI
    llm: {
      provider: process.env.WEALTHCORE_LLM_PROVIDER || null,
      apiKey: process.env.WEALTHCORE_LLM_API_KEY || null,
      baseUrl: process.env.WEALTHCORE_LLM_BASE_URL || null,
      model: process.env.WEALTHCORE_LLM_MODEL || null,
      configured: Boolean(process.env.WEALTHCORE_LLM_PROVIDER && process.env.WEALTHCORE_LLM_API_KEY),
    },

    // Scheduler
    scheduler: {
      enabled: bool(process.env.WEALTHCORE_SCHEDULER_ENABLED, env !== 'test'),
      intervalSeconds: num(process.env.WEALTHCORE_SCHEDULER_INTERVAL_SECONDS, 60),
      marketRefreshMinutes: num(process.env.WEALTHCORE_MARKET_REFRESH_MINUTES, 60),
    },

    logging: {
      level: process.env.WEALTHCORE_LOG_LEVEL || (env === 'production' ? 'info' : 'debug'),
      json: bool(process.env.WEALTHCORE_LOG_JSON, env === 'production'),
    },
  };
}

let cached;
export function config() {
  if (!cached) cached = computeConfig();
  return cached;
}

/** Invalidate the cached config (used by tests that set env later). */
export function resetConfig() {
  cached = undefined;
}

/**
 * Validate required production settings. Throws a descriptive error so startup
 * fails clearly when required configuration is missing in production.
 * Returns { errors: [] } when valid.
 */
/**
 * Setu-specific configuration report. Returns presence/absence only — never the
 * secret value, token, or any credential. Used by `npm run config:setu`.
 */
export function validateSetuConfig(cfg = config()) {
  const s = cfg.setu || {};
  const items = [
    { key: 'SETU_CLIENT_ID', present: Boolean(s.clientId) },
    { key: 'SETU_CLIENT_SECRET', present: Boolean(s.clientSecret) },
    { key: 'SETU_PRODUCT_INSTANCE_ID', present: Boolean(s.productInstanceId) },
    { key: 'SETU_BASE_URL', present: Boolean(s.baseUrl) },
    { key: 'SETU_TOKEN_URL', present: Boolean(s.tokenUrl) },
    { key: 'SETU_REDIRECT_URL', present: Boolean(s.redirectUrl) },
    { key: 'SETU_WEBHOOK_URL', present: Boolean(s.webhookUrl) },
  ];
  const required = ['SETU_CLIENT_ID', 'SETU_CLIENT_SECRET', 'SETU_PRODUCT_INSTANCE_ID'];
  const missing = required.filter((k) => !items.find((i) => i.key === k).present);
  const environment = String(s.environment || 'sandbox').toUpperCase();
  return {
    valid: missing.length === 0,
    environment,
    configured: Boolean(s.configured),
    configuredFields: items,
    missing,
    // Never include clientSecret/token/accessToken values.
  };
}

export function validateConfig(cfg = config()) {
  const errors = [];

  if (cfg.isProd) {
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) {
      errors.push('WEALTHCORE_SESSION_SECRET must be set to a 32+ char random value in production.');
    }
    if (!cfg.encryptionKey || cfg.encryptionKey.length < 32) {
      errors.push('WEALTHCORE_ENCRYPTION_KEY must be set to a 32+ char random value in production.');
    }
    if (!cfg.cookieSecure) {
      errors.push('WEALTHCORE_COOKIE_SECURE must be "true" in production (HTTPS).');
    }
  }

  // Integration credential groups: if partially configured, that's a misconfiguration.
  for (const [label, group] of [['AA/FIU', cfg.aa], ['Market data', cfg.market], ['LLM/AI', cfg.llm]]) {
    const vals = Object.values(group).filter((v) => typeof v === 'boolean');
    const setKeys = Object.entries(group).filter(([k, v]) => typeof v !== 'boolean' && v);
    if (setKeys.length > 0 && !group.configured) {
      errors.push(`${label} integration is partially configured (${setKeys.map(([k]) => k).join(', ')}). Supply all required credentials or none.`);
    }
  }

  if (cfg.aa.configured && !cfg.aa.baseUrl) {
    errors.push('AA/FIU baseUrl is required when AA is configured.');
  }

  // Production safety: never silently fall back to mock data when the user has
  // explicitly configured a real AA provider and selected production.
  const providerSelected = cfg.aa.provider || process.env.AA_PROVIDER || 'mock';
  if (cfg.isProd && cfg.aaEnvironment !== 'production') {
    errors.push('AA_ENVIRONMENT must be "production" in production mode.');
  }
  if (cfg.aaEnvironment === 'production' && providerSelected && providerSelected !== 'mock') {
    const setuCfg = cfg.setu || {};
    if (!setuCfg.configured && !cfg.aa.configured) {
      errors.push(`Production AA requires valid credentials for provider "${providerSelected}" (Setu token + product-instance-id, or AA credentials).`);
    }
  }

  // Central data environment validation. An unrecognised value is a hard
  // configuration error — failing validation is the ONLY response, never a
  // guess or a default substitution after the operator made an explicit choice.
  if (cfg.dataEnvironmentValid === false) {
    errors.push(`WEALTHCORE_DATA_ENVIRONMENT must be one of ${DATA_ENVIRONMENTS.join(', ')} (received an unrecognised value).`);
  }

  // PRODUCTION data environment: NEVER fall back to demo — automatically or
  // silently. Production requires explicit, configured real-provider
  // credentials (Setu or generic AA/FIU); otherwise startup validation fails.
  if (cfg.dataEnvironment === 'PRODUCTION') {
    const prodProvider = String(cfg.aa.provider || '').toLowerCase();
    if (prodProvider === 'demo' || prodProvider === 'mock') {
      errors.push('AA_PROVIDER must not be the demo/mock provider when WEALTHCORE_DATA_ENVIRONMENT=PRODUCTION.');
    }
    if (!cfg.aa.configured && !(cfg.setu && cfg.setu.configured)) {
      errors.push('WEALTHCORE_DATA_ENVIRONMENT=PRODUCTION requires configured Finvu (AA) or Setu credentials — production never falls back to the demo environment.');
    }
  }

  return { valid: errors.length === 0, errors };
}

export default { config, validateConfig, validateSetuConfig, resetConfig, DATA_ENVIRONMENTS, DEFAULT_DATA_ENVIRONMENT, parseDataEnvironment };
