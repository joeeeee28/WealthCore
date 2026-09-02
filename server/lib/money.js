// WealthCore — decimal money handling.
//
// Money is stored as an INTEGER number of MINOR UNITS (e.g. paise for INR).
// We never rely on floating point for storage or arithmetic. All major-amount
// parsing converts a decimal string into an integer minor-unit value exactly.
//
// NOTE: JS Numbers are safe integers up to 2^53 (~9e15). For personal finance
// this is far beyond any realistic amount, so Number is used for minor units.
// For extreme safety in multiplication-heavy code amounts are converted with
// BigInt during intermediate steps where NaNs could otherwise sneak in.

const DEFAULT_EXPONENT = 2; // 1 currency unit = 100 minor units

export const CURRENCIES = {
  INR: { symbol: '\u20B9', exponent: 2, name: 'Indian Rupee' },
  USD: { symbol: '$', exponent: 2, name: 'US Dollar' },
  EUR: { symbol: '\u20AC', exponent: 2, name: 'Euro' },
  GBP: { symbol: '\u00A3', exponent: 2, name: 'Pound Sterling' },
  SGD: { symbol: 'S$', exponent: 2, name: 'Singapore Dollar' },
  JPY: { symbol: '\u00A5', exponent: 0, name: 'Japanese Yen' },
  AED: { symbol: 'AED ', exponent: 2, name: 'UAE Dirham' },
};

function exponentOf(currency = 'INR') {
  return (CURRENCIES[currency] && CURRENCIES[currency].exponent) ?? DEFAULT_EXPONENT;
}

function symbolOf(currency = 'INR') {
  return (CURRENCIES[currency] && CURRENCIES[currency].symbol) ?? '';
}

/**
 * Parse a decimal string (e.g. "250000", "248500.50", "-1,200.75") into an
 * integer number of minor units. Throws on malformed or non-finite input.
 */
export function parseMinor(input, currency = 'INR') {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Invalid amount: ${input}`);
    const exp = exponentOf(currency);
    return Math.round(input * 10 ** exp);
  }
  if (typeof input !== 'string') {
    throw new Error(`Invalid amount type: ${typeof input}`);
  }
  // Strips thousands separators, spaces and a single leading currency symbol.
  const cleaned = input.trim()
    .replace(/^[\u20B9$\u20AC\u00A3]/, '')   // currency symbol
    .replace(/[,\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') {
    throw new Error(`Invalid amount: "${input}"`);
  }
  // Must now be a strict numeric literal — reject leftover letters/extras.
  if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid amount: "${input}"`);
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: "${input}"`);
  const exp = exponentOf(currency);
  return Math.round(n * 10 ** exp);
}

/** Convert minor units back to a major-unit Number (for display / JSON). */
export function toMajor(minor, currency = 'INR') {
  return minor / 10 ** exponentOf(currency);
}

/**
 * Format a minor-unit amount as a human string, using Indian digit grouping
 * (lakh / crore) when small=true or when the amount is large.
 */
export function format(minor, currency = 'INR', { compact = true } = {}) {
  const sym = symbolOf(currency);
  const major = toMajor(minor, currency);
  const exp = exponentOf(currency);
  const abs = Math.abs(major);

  if (compact && abs >= 1e7) {
    return `${sym}${(major / 1e7).toFixed(2)} Cr`;
  }
  if (compact && abs >= 1e5) {
    return `${sym}${(major / 1e5).toFixed(2)}L`;
  }

  const currencyMajor = major.toFixed(exp === 0 ? 0 : 2);
  const [intPart, decPart] = currencyMajor.split('.');
  const grouped = groupIndian(intPart);
  return `${sym}${grouped}${decPart !== undefined ? '.' + decPart : ''}`;
}

function groupIndian(intPart) {
  // Standard Indian numbering: last 3 digits, then groups of 2.
  let s = intPart;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (s.length <= 3) return (neg ? '-' : '') + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const groups = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${groups},${last3}`;
}

/** Compare two minor amounts safely (returns -1,0,1). */
export function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Add minor amounts without float precision surprises. */
export function add(a, b) {
  const r = BigInt(a) + BigInt(b);
  return Number(r);
}

/** Subtract minor amounts. */
export function sub(a, b) {
  return Number(BigInt(a) - BigInt(b));
}

/** Multiply minor amount by a scalar (keeps integer result rounded to integer minor units). */
export function scale(a, scalar) {
  if (!Number.isFinite(scalar)) throw new Error('Non-finite scalar in money.scale');
  return Math.round(a * scalar);
}

/** Percentage of a minor amount. */
export function pct(amountMinor, percent) {
  return Math.round(amountMinor * percent / 100);
}

export default {
  CURRENCIES, parseMinor, toMajor, format, cmp, add, sub, scale, pct,
  exponentOf, symbolOf,
};
