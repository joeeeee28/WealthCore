// WealthCore — health & readiness.
//
// `/health` reports whether the application process is alive (liveness).
// `/ready` reports whether the app can serve requests meaningfully (readiness),
// distinguishing application, database, AA, market and LLM availability. An
// unavailable optional external provider does NOT make the app un-ready.

import { getDb } from '../db.js';
import { aaIntegrationStatus } from './aa-integration.js';
import { marketProviderConfig } from './market-data.js';
import { config } from '../config.js';

export function health() {
  return { status: 'ok', service: 'wealthcore', version: 1, uptime: Math.round(process.uptime()) };
}

export function readiness() {
  const result = {
    status: 'ok',
    components: {},
  };

  // Database
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    result.components.database = { status: 'ok' };
  } catch (e) {
    result.components.database = { status: 'unavailable', error: String(e.message || e) };
    result.status = 'unavailable';
  }

  // AA / FIU
  const aa = aaIntegrationStatus();
  result.components.aa = {
    status: aa.configured ? 'ok' : 'not_configured',
    integration: aa.integration,
    detail: aa.status,
  };

  // Market data
  const mkt = marketProviderConfig();
  result.components.market = {
    status: mkt.configured ? 'ok' : 'not_configured',
    detail: mkt.configured ? 'configured' : 'provider credentials required',
  };

  // LLM
  const llmCfg = config().llm;
  result.components.llm = {
    status: llmCfg.configured ? 'ok' : 'not_configured',
    detail: llmCfg.configured ? 'configured' : 'provider credentials required',
  };

  return result;
}

export default { health, readiness };
