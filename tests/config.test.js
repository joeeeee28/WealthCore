// Configuration validation tests (fail-fast in production).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, validateConfig } from '../server/config.js';

// Config module caches; reset by deleting the cache via function (no setter),
// so test against freshly-computed config through validateConfig building a
// synthetic config object.

function makeConfig(over = {}) {
  const base = {
    env: 'production', isProd: true, isTest: false,
    sessionSecret: 'a'.repeat(40), encryptionKey: 'b'.repeat(40), cookieSecure: true,
    aaEnvironment: 'production',
    aa: { provider: null, clientId: null, secret: null, baseUrl: null, configured: false },
    setu: { token: null, productInstanceId: null, baseUrl: 'https://fiu-sandbox.setu.co', environment: 'sandbox', configured: false },
    market: { provider: null, apiKey: null, baseUrl: null, configured: false },
    llm: { provider: null, apiKey: null, baseUrl: null, model: null, configured: false },
  };
  return { ...base, ...over, aa: { ...base.aa, ...(over.aa || {}) }, setu: { ...base.setu, ...(over.setu || {}) }, market: { ...base.market, ...(over.market || {}) }, llm: { ...base.llm, ...(over.llm || {}) } };
}

test('valid production config passes', () => {
  const v = validateConfig(makeConfig({}));
  assert.equal(v.valid, true);
  assert.deepEqual(v.errors, []);
});

test('missing session secret in production is a hard error', () => {
  const v = validateConfig(makeConfig({ sessionSecret: null }));
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes('SESSION_SECRET')));
});

test('missing encryption key in production is a hard error', () => {
  const v = validateConfig(makeConfig({ encryptionKey: null }));
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes('ENCRYPTION_KEY')));
});

test('non-secure cookies in production are a hard error', () => {
  const v = validateConfig(makeConfig({ cookieSecure: false }));
  assert.equal(v.valid, false);
});

test('partial AA configuration is flagged as misconfiguration', () => {
  const v = validateConfig(makeConfig({ aa: { provider: 'x', clientId: 'y', secret: null, baseUrl: null, configured: false } }));
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.toUpperCase().includes('AA/FIU')));
});

test('full AA config with baseUrl passes', () => {
  const v = validateConfig(makeConfig({ aa: { provider: 'p', clientId: 'c', secret: 's', baseUrl: 'https://aa.example', configured: true } }));
  assert.equal(v.valid, true);
});

test('config() returns env-aware defaults', () => {
  const c = config();
  assert.ok(Object.hasOwn(c, 'isProd'));
  assert.ok(Object.hasOwn(c, 'aa'));
  assert.ok(Object.hasOwn(c, 'market'));
  assert.ok(Object.hasOwn(c, 'llm'));
  assert.ok(Object.hasOwn(c, 'scheduler'));
});
