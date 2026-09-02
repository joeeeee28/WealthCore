// WealthCore — Market Data Layer.
//
// Price freshness is always represented with an explicit status:
//   LIVE            real-time price from a real provider (never claimed without one)
//   DELAYED         delayed quote from a real provider
//   LAST_AVAILABLE  cached quote from a real provider (possibly stale)
//   MANUAL          price entered / computed by the user (no provider)
//   COST_BASIS      holding valued at its cost basis because no market price
//   UNPRICED        no price and no cost basis (value unknown / zero)
//
// ABSOLUTE RULE 18: WealthCore never reports LIVE without a real provider. With
// no provider configured, refresh is honest and records a pending-provider status.

import { config } from '../config.js';

export const PRICE_STATUS = ['LIVE', 'DELAYED', 'LAST_AVAILABLE', 'MANUAL', 'COST_BASIS', 'UNPRICED'];

export function marketProviderConfig() {
  const c = config();
  return {
    provider: c.market.provider || null,
    apiKey: c.market.apiKey || null,
    baseUrl: c.market.baseUrl || null,
    configured: c.market.configured,
    mode: c.market.configured ? 'PRODUCTION' : 'DEVELOPMENT',
  };
}

/**
 * Provider adapter interface. A real provider implements fetchQuotes(securities).
 * When none is configured, `getProvider()` returns null and callers must treat
 * the result honestly (never a LIVE price).
 */
export function resolveProvider() {
  const cfg = marketProviderConfig();
  if (!cfg.configured) return null;
  // In a production build this would return the provider-driver for cfg.provider.
  return {
    name: cfg.provider,
    async fetchQuotes(securities) {
      throw new Error(`Market provider '${cfg.provider}' retrieval is not wired in this environment.`);
    },
  };
}

function nowIso() { return new Date().toISOString(); }

/** Record a price observation in market_price_history. */
export function recordPriceHistory(db, securityId, { priceMinor, currency, priceStatus, provider }) {
  db.prepare(`INSERT INTO market_price_history (security_id, price_minor, currency, price_status, provider) VALUES (?, ?, ?, ?, ?)`)
    .run(securityId, priceMinor, currency || 'INR', priceStatus, provider || null);
}

/**
 * Refresh prices. With no provider configured this does not fabricate values;
 * it records an honest pending-provider outcome.
 */
export async function refreshPrices(db, userId) {
  const cfg = marketProviderConfig();
  const securities = db.prepare('SELECT id FROM securities WHERE user_id = ?').all(userId);
  if (!cfg.configured) {
    return {
      status: 'READY_FOR_CONFIGURATION',
      message: 'Market data provider credentials are required to fetch live prices.',
      provider: null,
      syncFailed: true,
      securitiesAttempted: securities.length,
      securitiesUpdated: 0,
    };
  }
  const provider = resolveProvider();
  if (!provider) {
    return { status: 'IN_PROGRESS', provider: cfg.provider, securitiesAttempted: securities.length, securitiesUpdated: 0, note: 'provider driver not wired' };
  }
  let updated = 0;
  let attempted = 0;
  for (const sec of securities) {
    attempted++;
    try {
      const quote = await provider.fetchQuotes([sec]);
      if (quote && quote.priceMinor != null) {
        db.prepare(`UPDATE securities SET price_minor=?, price_timestamp=?, price_status=?, previous_close_minor=?, provider=? WHERE id=?`)
          .run(quote.priceMinor, quote.priceTimestamp || nowIso(), quote.status || 'LIVE',
            quote.previousCloseMinor ?? null, cfg.provider, sec.id);
        recordPriceHistory(db, sec.id, { priceMinor: quote.priceMinor, priceStatus: quote.status || 'LIVE', provider: cfg.provider });
        updated++;
      }
    } catch {
      // A failed quote is surfaced by leaving price_status unaffected; the
      // security stays LAST_AVAILABLE / MANUAL. No silent manipulation.
    }
  }
  return { status: 'IN_PROGRESS', provider: cfg.provider, securitiesAttempted: attempted, securitiesUpdated: updated };
}

/** Freshness classification for a stored price timestamp/status. */
export function priceFreshness(priceTimestamp, priceStatus) {
  if (priceStatus === 'LIVE') return 'LIVE';
  if (priceStatus === 'DELAYED') return 'DELAYED';
  if (priceStatus === 'MANUAL') return 'MANUAL';
  if (priceStatus === 'COST_BASIS') return 'COST_BASIS';
  if (priceStatus === 'UNPRICED') return 'UNPRICED';
  if (priceStatus === 'LAST_AVAILABLE') {
    if (!priceTimestamp) return 'LAST_AVAILABLE';
    const ageHours = (Date.now() - new Date(priceTimestamp).getTime()) / 3600000;
    return ageHours <= 24 ? 'LAST_AVAILABLE' : 'STALE';
  }
  if (!priceTimestamp) return 'UNKNOWN';
  const ts = new Date(priceTimestamp).getTime();
  const ageHours = (Date.now() - ts) / 3600000;
  if (ageHours <= 24) return 'LAST_AVAILABLE';
  return 'STALE';
}

/** Validate a price payload from a provider with bounds and type checks. */
export function validateQuote({ priceMinor, timestamp, status }) {
  if (priceMinor == null || Number.isNaN(Number(priceMinor)) || Number(priceMinor) < 0) return { valid: false, error: 'priceMinor must be a positive integer minor unit' };
  if (status && !PRICE_STATUS.includes(status)) return { valid: false, error: `unknown price status ${status}` };
  if (timestamp && Number.isNaN(new Date(timestamp).getTime())) return { valid: false, error: 'invalid timestamp' };
  return { valid: true };
}

export default { PRICE_STATUS, marketProviderConfig, resolveProvider, refreshPrices, priceFreshness, recordPriceHistory, validateQuote };
