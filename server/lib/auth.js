// WealthCore — authentication, session management, app lock, password reset,
// login rate limiting and CSRF protection.
//
// Passwords are hashed with scrypt and a per-user random salt. Sessions are
// opaque random tokens stored server-side with an expiry — there are no JWTs
// or secrets in the client. App lock is an optional PIN layer over a session.
// Login attempts are rate-limited per identifier to prevent brute force.

import crypto from 'node:crypto';
import { config } from '../config.js';

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 12 * 3600 * 1000; // 12h

export function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

export function verifyPassword(password, salt, hash) {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expires);
  return token;
}

export function getSession(db, token) {
  if (!token) return null;
  const s = db.prepare(`SELECT * FROM sessions WHERE token = ? AND revoked = 0`).get(token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE sessions SET revoked = 1 WHERE token = ?`).run(token);
    return null;
  }
  return s;
}

export function destroySession(db, token) {
  db.prepare(`UPDATE sessions SET revoked = 1 WHERE token = ?`).run(token);
}

// --- App lock -----------------------------------------------------------

export function enableAppLock(db, token, pin) {
  const salt = generateSalt();
  const hash = hashPassword(pin, salt);
  db.prepare(`UPDATE sessions SET app_lock_enabled = 1, app_lock_pin_hash = ?, app_lock_pin_salt = ?, app_locked = 1 WHERE token = ?`)
    .run(hash, salt, token);
  return true;
}

export function lockSession(db, token) {
  db.prepare(`UPDATE sessions SET app_locked = 1 WHERE token = ?`).run(token);
  return true;
}

export function unlockSession(db, token, pin) {
  const s = getSession(db, token);
  if (!s) throw new Error('Session not found');
  if (!s.app_lock_enabled) throw new Error('App lock is not enabled for this session');
  if (!verifyPassword(pin, s.app_lock_pin_salt, s.app_lock_pin_hash)) {
    throw new Error('Incorrect app lock PIN');
  }
  db.prepare(`UPDATE sessions SET app_locked = 0 WHERE token = ?`).run(token);
  return true;
}

export function isAppLocked(session) {
  return Boolean(session && session.app_locked);
}

// --- Login rate limiting (brute-force protection) -------------------------

export function isLoginBlocked(db, identifier) {
  const cfg = config();
  const windowStart = new Date(Date.now() - cfg.rateLoginWindowMs).toISOString();
  const count = db.prepare(`
    SELECT COUNT(*) c FROM login_attempts
    WHERE identifier = ? AND success = 0 AND created_at >= ?
  `).get(identifier, windowStart).c;
  return count >= cfg.rateLoginMax;
}

export function recordLoginAttempt(db, identifier, success, ip = null) {
  // created_at is stored in ISO (matches the comparisons in isLoginBlocked).
  db.prepare(`INSERT INTO login_attempts (identifier, success, ip, created_at) VALUES (?, ?, ?, ?)`)
    .run(identifier, success ? 1 : 0, ip ?? null, new Date().toISOString());
}

export function clearLoginAttempts(db, identifier) {
  db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(identifier);
}

// --- Password reset --------------------------------------------------------

export function createPasswordReset(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
  db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
    .run(userId, tokenHash, expires);
  return token;
}

export function verifyPasswordReset(db, token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT * FROM password_resets WHERE token_hash = ? AND used = 0`).get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export function consumePasswordReset(db, token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(tokenHash);
}

export function setPassword(db, userId, newPassword) {
  const salt = generateSalt();
  const hash = hashPassword(newPassword, salt);
  db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, salt, userId);
}

// --- CSRF protection (for cookie-authenticated requests) ------------------

export function generateCsrf() {
  return crypto.randomBytes(24).toString('hex');
}

export function csrfValid(token, sessionToken) {
  if (!token || !sessionToken) return false;
  const expected = crypto.createHash('sha256').update(`${sessionToken}:${token}`).digest('hex');
  // Store a signed csrf token so it can be validated without server state.
  const payload = token + '.' + expected;
  return verifyCsrfToken(payload, sessionToken);
}

export function signCsrf(sessionToken) {
  const token = generateCsrf();
  const sig = crypto.createHash('sha256').update(`${sessionToken}:${token}`).digest('hex');
  return `${token}.${sig}`;
}

export function verifyCsrfToken(payload, sessionToken) {
  if (!payload || !sessionToken) return false;
  const idx = payload.lastIndexOf('.');
  if (idx <= 0) return false;
  const token = payload.slice(0, idx);
  const sig = payload.slice(idx + 1);
  const expected = crypto.createHash('sha256').update(`${sessionToken}:${token}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default {
  generateSalt, hashPassword, verifyPassword, createSession, getSession,
  destroySession, enableAppLock, lockSession, unlockSession, isAppLocked,
  isLoginBlocked, recordLoginAttempt, clearLoginAttempts,
  createPasswordReset, verifyPasswordReset, consumePasswordReset, setPassword,
  generateCsrf, signCsrf, verifyCsrfToken,
};
