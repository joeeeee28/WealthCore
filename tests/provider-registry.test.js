// Provider registry & data-environment resolution tests.
//
// Verifies: demo provider registered alongside (never replacing) the existing
// mock/finvu/setu providers; environment→provider mapping; and that PRODUCTION
// resolution cannot return the demo provider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAAPProvider, listAAPProviders, resolveAAPProvider } from '../server/aa/interface.js';
import MockAAProvider from '../server/aa/providers/mock.js';
import FinvuProvider from '../server/aa/providers/finvu.js';
import SetuProvider from '../server/aa/providers/setu.js';
import DemoProvider from '../server/aa/providers/demo.js';
import { ENVIRONMENT_PROVIDER, getDataEnvironment, getActiveProvider, describeDataEnvironments } from '../server/aa/data-environment.js';
import { resetConfig } from '../server/config.js';
import '../server/aa/index.js'; // populate the registry

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

test('demo provider is registered with the demo contract flags', () => {
  const p = getAAPProvider('demo');
  assert.ok(p, 'demo provider must be registered');
  assert.equal(p, DemoProvider);
  assert.equal(p.name, 'demo');
  assert.equal(p.mode, 'DEMO');
  assert.equal(p.configured, true);
  assert.equal(p.synthetic, true);
  assert.equal(p.requiresCredentials, false);
  const st = p.status();
  assert.equal(st.status, 'READY');
  assert.equal(st.mode, 'DEMO');
  assert.equal(st.synthetic, true);
});

test('environment→provider mapping is centralised', () => {
  assert.equal(ENVIRONMENT_PROVIDER.DEMO, 'demo');
  assert.equal(ENVIRONMENT_PROVIDER.FINVU_SANDBOX, 'finvu');
  assert.equal(ENVIRONMENT_PROVIDER.SETU_SANDBOX, 'setu');
  assert.equal(ENVIRONMENT_PROVIDER.PRODUCTION, undefined, 'production has no static mapping (resolved from explicit config only)');
});

test('demo registration does NOT evict existing mock/finvu/setu providers', () => {
  const names = listAAPProviders().map((p) => p.name);
  for (const n of ['mock', 'finvu', 'setu', 'demo']) assert.ok(names.includes(n), `registry must include ${n}`);
  assert.equal(getAAPProvider('mock'), MockAAProvider);
  assert.equal(getAAPProvider('finvu'), FinvuProvider);
  assert.equal(getAAPProvider('setu'), SetuProvider);
  // Finvu/Setu behavior untouched: still require credentials, still unconfigured.
  assert.equal(FinvuProvider.requiresCredentials, true);
  assert.equal(FinvuProvider.configured, false);
  assert.match(FinvuProvider.status().detail, /READY_FOR_CONFIGURATION/);
  assert.equal(SetuProvider.requiresCredentials, true);
  assert.match(SetuProvider.status().detail, /READY_FOR_CONFIGURATION/);
  assert.equal(MockAAProvider.status().mode, 'MOCK');
});

test('resolveAAPProvider({provider:"demo"}) resolves the demo provider directly', () => {
  const p = resolveAAPProvider({ provider: 'demo' });
  assert.equal(p.name, 'demo');
  assert.equal(p.mode, 'DEMO');
});

test('getActiveProvider honours FINVU_SANDBOX and SETU_SANDBOX (preserved)', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'FINVU_SANDBOX' }, () => {
    assert.equal(getDataEnvironment(), 'FINVU_SANDBOX');
    const p = getActiveProvider();
    assert.equal(p.name, 'finvu');
    // Sandbox/UAT mode (not silently promoted to PRODUCTION without credentials).
    const mode = typeof p.mode === 'function' ? p.mode() : p.mode;
    assert.equal(mode, 'SANDBOX');
    assert.equal(p.requiresCredentials, true);
  });
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'SETU_SANDBOX' }, () => {
    assert.equal(getDataEnvironment(), 'SETU_SANDBOX');
    const p = getActiveProvider();
    assert.equal(p.name, 'setu');
    const mode = typeof p.mode === 'function' ? p.mode() : p.mode;
    assert.equal(String(mode).toUpperCase(), 'SANDBOX');
    assert.equal(p.requiresCredentials, true);
  });
});

test('getActiveProvider in DEMO resolves demo; PRODUCTION never does', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'DEMO' }, () => {
    assert.equal(getActiveProvider().name, 'demo');
  });
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION' }, () => {
    const p = getActiveProvider();
    assert.equal(p.name, 'production');
    assert.ok(p.name !== 'demo' && p.name !== 'mock');
    assert.equal(p.mode, 'PRODUCTION');
  });
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'PRODUCTION', AA_PROVIDER: 'setu' }, () => {
    // An explicitly configured real provider is honoured in production.
    assert.equal(getActiveProvider().name, 'setu');
  });
});

test('describeDataEnvironments lists all four environments with the active one marked', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'DEMO' }, () => {
    const envs = describeDataEnvironments();
    assert.equal(envs.length, 4);
    const values = envs.map((e) => e.value);
    for (const v of ['DEMO', 'FINVU_SANDBOX', 'SETU_SANDBOX', 'PRODUCTION']) assert.ok(values.includes(v));
    const active = envs.filter((e) => e.active);
    assert.equal(active.length, 1);
    assert.equal(active[0].value, 'DEMO');
    assert.equal(active[0].synthetic, true);
    const prod = envs.find((e) => e.value === 'PRODUCTION');
    assert.equal(prod.synthetic, false);
    assert.equal(prod.provider, null, 'production has no provider without explicit config');
  });
});

test('environment display labels match the UI contract', () => {
  withEnv({ WEALTHCORE_DATA_ENVIRONMENT: 'DEMO' }, () => {
    const envs = describeDataEnvironments();
    const byName = Object.fromEntries(envs.map((e) => [e.value, e]));
    assert.equal(byName.DEMO.label, 'DEMO MODE');
    assert.equal(byName.FINVU_SANDBOX.label, 'FINVU SANDBOX');
    assert.equal(byName.SETU_SANDBOX.label, 'SETU SANDBOX');
    assert.equal(byName.PRODUCTION.label, 'PRODUCTION');
    assert.ok(byName.DEMO.icon.length > 0);
    assert.ok(byName.PRODUCTION.icon.length > 0);
  });
});
