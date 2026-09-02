// Security hardening tests: login rate limiting, password reset, CSRF and
// cookie/auth channels. Users are inserted directly so each test is isolated
// (WealthCore setup only allows a single user).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
process.env.WEALTHCORE_LOGIN_RATE_MAX = '3';
process.env.WEALTHCORE_LOGIN_RATE_WINDOW_MINUTES = '15';
const { app } = await import('../server/index.js');
const { getDb } = await import('../server/db.js');
const { hashPassword, generateSalt } = await import('../server/lib/auth.js');

let server;
let base;

function insertUser(email, password) {
  const db = getDb();
  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  const info = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)`)
    .run(email, email.split('@')[0], hash, salt);
  return info.lastInsertRowid;
}

before(async () => {
  insertUser('rate@x.local', 'password123');
  insertUser('reset@x.local', 'password123');
  insertUser('csrf@x.local', 'password123');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(() => { server.close(); });

async function rawReq(method, path, body, headers = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: res.status === 204 ? null : await res.json(), headers: res.headers };
}

test('login rate limits after repeated failures', async () => {
  const email = 'rate@x.local';
  for (let i = 0; i < 3; i++) {
    const r = await rawReq('POST', '/auth/login', { email, password: 'wrong' });
    assert.equal(r.status, 401);
  }
  const blocked = await rawReq('POST', '/auth/login', { email, password: 'wrong' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'RATE_LIMITED');
});

test('password reset issues a token and confirms a new password', async () => {
  const email = 'reset@x.local';
  const request = await rawReq('POST', '/auth/password-reset/request', { email });
  assert.equal(request.status, 200);
  assert.ok(request.json.resetToken);
  const confirm = await rawReq('POST', '/auth/password-reset/confirm', { token: request.json.resetToken, password: 'newpassword456' });
  assert.equal(confirm.status, 200);
  const oldLogin = await rawReq('POST', '/auth/login', { email, password: 'password123' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await rawReq('POST', '/auth/login', { email, password: 'newpassword456' });
  assert.equal(newLogin.status, 200);
});

test('csrf guards cookie-authenticated mutations but not bearer auth', async () => {
  const loginRes = await rawReq('POST', '/auth/login', { email: 'csrf@x.local', password: 'password123' });
  const login = loginRes.json;
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  assert.equal(loginRes.status, 200);
  assert.ok(login.csrf, 'login should return a csrf token');
  assert.ok(cookie.startsWith('wc_session='), 'login should set an httpOnly session cookie');

  // Cookie-auth mutation without CSRF -> 403.
  const noCsrf = await rawReq('POST', '/accounts', { name: 'X', type: 'savings' }, { Cookie: cookie });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.json.error.code, 'CSRF_INVALID');

  // Cookie-auth mutation with the correct CSRF token -> 200.
  const withCsrf = await rawReq('POST', '/accounts', { name: 'Y', type: 'savings' }, { Cookie: cookie, 'X-CSRF-Token': login.csrf });
  assert.equal(withCsrf.status, 200);

  // Bearer-auth mutation skips CSRF -> 200.
  const viaBearer = await rawReq('POST', '/accounts', { name: 'Z', type: 'savings' }, { Authorization: `Bearer ${login.token}` });
  assert.equal(viaBearer.status, 200);
});
