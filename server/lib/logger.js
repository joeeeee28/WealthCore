// WealthCore — structured logging with sensitive-data redaction.
//
// Rules (ABSOLUTE RULE 7 / 11):
//   * Never log passwords, tokens, API secrets, financial credentials or raw
//     personal financial values unless explicitly intended.
//   * Logs are structured (JSON) in production and pretty in development.
//   * Every request carries a request id and correlation id so a flow can be
//     traced end-to-end without ever logging sensitive payloads.

const REDACT = new Set([
  'password', 'password_hash', 'password_salt', 'token', 'authorization',
  'secret', 'api_key', 'apikey', 'session', 'pin', 'salt', 'hash',
  'client_secret', 'access_token', 'refresh_token', 'private_key',
]);

export function redact(obj, depth = 0) {
  if (depth > 4) return '[omitted]';
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (REDACT.has(k.toLowerCase())) { out[k] = '[REDACTED]'; continue; }
      if (typeof v === 'object' && v !== null) out[k] = redact(v, depth + 1);
      else out[k] = v;
    }
    return out;
  }
  if (typeof obj === 'string' && /(password|secret|token|key|bearer)/i.test(obj) && obj.length > 16) {
    return '[REDACTED]';
  }
  return obj;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel = process.env.WEALTHCORE_LOG_LEVEL || 'info';
let jsonMode = process.env.WEALTHCORE_LOG_JSON === 'true';

export function setLogLevel(level) { if (LEVELS[level]) currentLevel = level; }
export function setJsonMode(mode) { jsonMode = Boolean(mode); }

function write(level, msg, meta) {
  const lvl = LEVELS[level] || 20;
  if (lvl < (LEVELS[currentLevel] || 20)) return;
  const safeMeta = redact(meta || {});
  const record = { ts: new Date().toISOString(), level, msg };
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ...record, ...safeMeta }) + '\n');
  } else {
    const metaStr = Object.keys(safeMeta).length ? ' ' + JSON.stringify(safeMeta) : '';
    process.stdout.write(`[${record.ts}] ${level.toUpperCase()} ${msg}${metaStr}\n`);
  }
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  setLevel: setLogLevel,
  setJsonMode,
};

export default logger;
