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
    setu: {
      // Current official model: x-client-id + x-client-secret + x-product-instance-id.
      clientId: process.env.WEALTHCORE_SETU_CLIENT_ID || null,
      clientSecret: process.env.WEALTHCORE_SETU_CLIENT_SECRET || null,
      productInstanceId: process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID || null,
      // Legacy access token (accepted when client-credentials are not supplied).
      token: process.env.WEALTHCORE_SETU_TOKEN || null,
      baseUrl: process.env.WEALTHCORE_SETU_BASE_URL || 'https://fiu-sandbox.setu.co',
      webhookSecret: process.env.WEALTHCORE_SETU_WEBHOOK_SECRET || null,
      signingPublicKey: process.env.WEALTHCORE_SETU_SIGNING_PUBLIC_KEY || null,
      environment: process.env.SETU_ENVIRONMENT || process.env.WEALTHCORE_SETU_ENVIRONMENT || 'sandbox',
      configured: Boolean((process.env.WEALTHCORE_SETU_CLIENT_ID && process.env.WEALTHCORE_SETU_CLIENT_SECRET && process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID) || (process.env.WEALTHCORE_SETU_TOKEN && process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID)),
    },

    // AA environment mode (mock | sandbox | production).
    aaEnvironment: process.env.AA_ENVIRONMENT || process.env.WEALTHCORE_AA_ENVIRONMENT || 'development',

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

  return { valid: errors.length === 0, errors };
}

export default { config, validateConfig, resetConfig };
