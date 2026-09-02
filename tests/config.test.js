// Configuration validation tests (fail-fast in production).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, validateConfig, validateSetuConfig, resetConfig } from '../server/config.js';

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

test('SETU_* short aliases map into config().setu (never expose values)', () => {
  const prev = {
    ci: process.env.SETU_CLIENT_ID, cs: process.env.SETU_CLIENT_SECRET,
    pi: process.env.SETU_PRODUCT_INSTANCE_ID, base: process.env.SETU_BASE_URL,
  };
  process.env.SETU_CLIENT_ID = 'test-client-id';
  process.env.SETU_CLIENT_SECRET = 'top-secret-value';
  process.env.SETU_PRODUCT_INSTANCE_ID = 'test-product-instance-id';
  process.env.SETU_BASE_URL = 'https://fiu-sandbox.setu.co';
  resetConfig();
  const s = config().setu;
  assert.equal(s.clientId, 'test-client-id');
  assert.equal(s.productInstanceId, 'test-product-instance-id');
  assert.equal(s.configured, true);
  // Restore.
  process.env.SETU_CLIENT_ID = prev.ci || ''; process.env.SETU_CLIENT_SECRET = prev.cs || '';
  process.env.SETU_PRODUCT_INSTANCE_ID = prev.pi || ''; process.env.SETU_BASE_URL = prev.base || '';
  resetConfig();
});

test('validateSetuConfig reports presence only and never leaks the secret', () => {
  const prev = {
    ci: process.env.SETU_CLIENT_ID, cs: process.env.SETU_CLIENT_SECRET,
    pi: process.env.SETU_PRODUCT_INSTANCE_ID,
  };
  process.env.SETU_CLIENT_ID = 'cid'; process.env.SETU_CLIENT_SECRET = 'cs-value';
  process.env.SETU_PRODUCT_INSTANCE_ID = 'pi';
  resetConfig();
  const r = validateSetuConfig(config());
  assert.equal(r.valid, true);
  // Presence flags only; the actual secret value is NEVER present in the report.
  const json = JSON.stringify(r);
  assert.ok(!json.includes('cs-value'), 'secret value must not appear in report');
  assert.ok(!json.includes('cid'), 'client id value must not appear in report');
  const secField = r.configuredFields.find((f) => f.key === 'SETU_CLIENT_SECRET');
  assert.equal(secField.present, true);
  assert.deepEqual(r.missing, []);
  // Restore.
  process.env.SETU_CLIENT_ID = prev.ci || ''; process.env.SETU_CLIENT_SECRET = prev.cs || '';
  process.env.SETU_PRODUCT_INSTANCE_ID = prev.pi || '';
  resetConfig();
});
