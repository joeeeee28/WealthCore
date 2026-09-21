// Central data-environment configuration tests.
//
// Verifies: supported WEALTHCORE_DATA_ENVIRONMENT values, DEMO default,
// invalid-value rejection (config validation), and that PRODUCTION never
// silently falls back to DEMO (validation fails without real credentials;
// resolution never returns the demo provider in production).

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config, validateConfig, resetConfig, parseDataEnvironment, DATA_ENVIRONMENTS, DEFAULT_DATA_ENVIRONMENT } from '../server/config.js';
import { getDataEnvironment, environmentProviderName, getActiveProvider } from '../server/aa/data-environment.js';
import '../server/aa/index.js'; // populate the provider registry (mock/finvu/setu/demo)

const ENV_KEYS = ['WEALTHCORE_DATA_ENVIRONMENT', 'AA_PROVIDER', 'WEALTHCORE_AA_PROVIDER'];

function withEnv(vars, fn) {
  const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  resetConfig();
  try { return fn(); } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    resetConfig();
  }
}

afterEach(() => resetConfig());

test('DATA_ENVIRONMENTS contains exactly the four supported values', () => {
  assert.deepEqual([...DATA_ENVIRONMENTS].sort(), ['DEMO', 'FINVU_SANDBOX', 'PRODUCTION', 'SETU_SANDBOX']);
  assert.equal(DEFAULT_DATA_ENVIRONMENT, 'DEMO');
});

test('parseDataEnvironment: unset and empty default to DEMO (valid)', () => {
  assert.deepEqual(parseDataEnvironment(undefined), { value: 'DEMO', valid: true, raw: null });
  assert.deepEqual(parseDataEnvironment(''), { value: 'DEMO', valid: true, raw: null });
  assert.deepEqual(parseDataEnvironment('   '), { value: 'DEMO', valid: true, raw: null });
});

test('parseDataEnvironment: all supported values accepted (case-insensitive)', () => {
  for (const v of DATA_ENVIRONMENTS) {
    assert.deepEqual(parseDataEnvironment(v).value, v);
    assert.deepEqual(parseDataEnvironment(v.toLowerCase()).value, v);
    assert.deepEqual(parseDataEnvironment(`  ${v}  `).value, v);
  }
});

test('parseDataEnvironment: invalid values are rejected (never coerced)', () => {
  for (const bad of ['STAGING', 'TEST', 'demo2', 'PROD', 'LOCAL', '0']) {
    const r = parseDataEnvironment(bad);
    assert.equal(r.valid, false, `expected ${bad} to be invalid`);
    assert.equal(r.value, null);
  }
});

test('config() defaults to DEMO when WEALTHCORE_DATA_ENVIRONMENT is unset', () => {
  withEnv({}, () => {
    const c = config();
    assert.equal(c.dataEnvironment, 'DEMO');
    assert.equal(c.dataEnvironmentValid, true);
    assert.equal(getDataEnvironment(), 'DEMO');
    assert.equal(validateConfig(c).valid, true);
  });
});

test('config() accepts every supported environment value', () => {
  for (const v of DATA_ENVIRONMENTS) {
    withEnv({ WEALTHCORE_DATA_ENVIRONMENT: v }, () => {
      const c = config();
      assert.equal(c.dataEnvironmentValid, true);
      assert.equal(c.dataEnvironment, v);
    });
  }
});

test('invalid WEALTHCORE_DATA_ENVIRONMENT fails configuration validation', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'BOGUS' }, () => {
    const c = config();
    assert.equal(c.dataEnvironmentValid, false);
    assert.equal(c.dataEnvironment, null);
    const v = validateConfig(c);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => e.includes('WEALTHCORE_DATA_ENVIRONMENT')));
  });
});

test('getDataEnvironment throws on invalid configuration (no silent default)', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'BOGUS' }, () => {
    assert.throws(() => getDataEnvironment(), /WEALTHCORE_DATA_ENVIRONMENT/);
  });
});

test('environment → provider mapping (non-production)', () => {
  withEnv({}, () => {
    assert.equal(environmentProviderName('DEMO'), 'demo');
    assert.equal(environmentProviderName('FINVU_SANDBOX'), 'finvu');
    assert.equal(environmentProviderName('SETU_SANDBOX'), 'setu');
  });
});

test('PRODUCTION without credentials fails validation — never falls back to DEMO', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION' }, () => {
    const c = config();
    const v = validateConfig(c);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => e.includes('PRODUCTION') && /never falls back/i.test(e)));
  });
});

test('PRODUCTION with AA_PROVIDER=demo or mock is a hard misconfiguration', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION', AA_PROVIDER: 'demo' }, () => {
    const v = validateConfig(config());
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => /must not be the demo\/mock provider/.test(e)));
  });
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION', AA_PROVIDER: 'mock' }, () => {
    const v = validateConfig(config());
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => /must not be the demo\/mock provider/.test(e)));
  });
});

test('PRODUCTION resolution NEVER returns the demo provider (no silent fallback)', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION' }, () => {
    const p = getActiveProvider();
    assert.notEqual(p.name, 'demo');
    assert.notEqual(p.mode, 'DEMO');
    assert.equal(p.name, 'production');
    assert.equal(p.mode, 'PRODUCTION');
    assert.equal(p.configured, false);
    assert.equal(p.synthetic, false);
    assert.equal(p.requiresCredentials, true);
    assert.match(p.status().detail, /never/i);
    assert.match(p.status().detail, /demo/i);
  });
});

test('PRODUCTION resolution rejects an explicit demo/mock override', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION' }, () => {
    for (const name of ['demo', 'mock']) {
      const p = getActiveProvider({ provider: name });
      assert.equal(p.name, 'production', `${name} override must not resolve in PRODUCTION`);
      assert.equal(p.synthetic, false);
    }
  });
});

test('PRODUCTION stub blocks all data operations with PROVIDER_NOT_CONFIGURED', async () => {
  await withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION' }, async () => {
    const p = getActiveProvider();
    await assert.rejects(() => p.createConsent({}), (e) => e.code === 'PROVIDER_NOT_CONFIGURED');
    await assert.rejects(() => p.requestFIData({}), (e) => e.code === 'PROVIDER_NOT_CONFIGURED');
    await assert.rejects(() => p.getFIData('x'), (e) => e.code === 'PROVIDER_NOT_CONFIGURED');
  });
});

test('DEMO environment resolves the demo provider through getActiveProvider', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'DEMO' }, () => {
    const p = getActiveProvider();
    assert.equal(p.name, 'demo');
    assert.equal(p.mode, 'DEMO');
    assert.equal(p.synthetic, true);
    assert.equal(p.configured, true);
    assert.equal(p.requiresCredentials, false);
  });
});
