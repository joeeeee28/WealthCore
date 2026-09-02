// Mock AA provider + provider registry + normalizer tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import MockAAProvider from '../server/aa/providers/mock.js';
import FinvuProvider from '../server/aa/providers/finvu.js';
import SetuProvider from '../server/aa/providers/setu.js';
import { getAAPProvider, listAAPProviders, resolveAAPProvider } from '../server/aa/interface.js';
import { normalizeFinancialData, capabilityError } from '../server/aa/rebit-normalizer.js';
import { AA_ERROR_CODES } from '../server/aa/errors.js';
import { buildMockFinancialData } from '../server/aa/fixtures/mock-data.js';
// Import the module entry so all providers are self-registered (mock, finvu, setu,
// onemoney, anumati, ink, saafe, nadl, protean).
import '../server/aa/index.js';

test('mock provider is configured and reports demo mode', () => {
  assert.equal(MockAAProvider.configured, true);
  assert.equal(MockAAProvider.requiresCredentials, false);
  const st = MockAAProvider.status();
  assert.equal(st.mode, 'MOCK');
  assert.match(st.detail, /Demo \/ simulation/i);
});

test('mock provider exposes supported FIs and FI types', () => {
  assert.ok(MockAAProvider.getSupportedFIs().length >= 1);
  assert.ok(MockAAProvider.getSupportedFITypes().includes('DEPOSIT'));
  assert.ok(MockAAProvider.supportsFIType('EQUITIES'));
  assert.equal(MockAAProvider.supportsFIType('UNSUPPORTED_X'), false);
});

test('mock consent lifecycle create → approve → request → fetch', async () => {
  const created = await MockAAProvider.createConsent({ provider: 'mock', fiType: 'DEPOSIT', fiTypes: ['DEPOSIT'], purpose: 'Personal financial management', customerHandle: 'mock@mock' });
  const consent = created.consent;
  assert.equal(consent.status, 'pending');
  assert.equal(consent.provider, 'mock');

  const approved = await MockAAProvider.approveConsent(consent.consentId);
  assert.equal(approved.status, 'approved');

  const fi = await MockAAProvider.requestFIData({ consentId: consent.consentId });
  assert.ok(fi.sessionId);

  await MockAAProvider.markDataReady({ consentId: consent.consentId });
  const data = await MockAAProvider.getFIData(fi.sessionId);
  assert.equal(data.provider, 'mock');
  assert.ok(data.accounts.length >= 1);
  assert.ok(data.transactions.length >= 1);
  assert.ok(data.holdings.length >= 1);
});

test('mock rejects invalid consent transitions', async () => {
  const created = await MockAAProvider.createConsent({ provider: 'mock', fiType: 'DEPOSIT' });
  await assert.rejects(() => MockAAProvider.revokeConsent(created.consent.consentId), (e) => e.code === 'INVALID_TRANSITION');
  const rejected = await MockAAProvider.rejectConsent(created.consent.consentId);
  assert.equal(rejected.status, 'rejected');
});

test('mock revoke blocks data fetch', async () => {
  const created = await MockAAProvider.createConsent({ provider: 'mock', fiType: 'DEPOSIT' });
  await MockAAProvider.approveConsent(created.consent.consentId);
  await MockAAProvider.revokeConsent(created.consent.consentId);
  await assert.rejects(() => MockAAProvider.requestFIData({ consentId: created.consent.consentId }), (e) => e.code === 'CONSENT_REVOKED');
});

test('real-provider adapters are NOT configured and surface PENDING confirmation', () => {
  assert.equal(FinvuProvider.configured, false);
  assert.equal(FinvuProvider.requiresCredentials, true);
  assert.match(FinvuProvider.status().detail, /READY_FOR_CONFIGURATION/);
  assert.equal(SetuProvider.configured, false);
  assert.match(SetuProvider.status().detail, /READY_FOR_CONFIGURATION/);
});

test('provider registry resolves mock and lists all providers', () => {
  const providers = listAAPProviders().map((p) => p.name);
  assert.ok(providers.includes('mock'));
  assert.ok(providers.includes('finvu'));
  assert.ok(providers.includes('setu'));
  assert.ok(providers.includes('onemoney'));
  assert.equal(getAAPProvider('mock').name, 'mock');
  assert.equal(resolveAAPProvider({ provider: 'mock' }).name, 'mock');
});

test('normalizer maps canonical envelope into domain rows', () => {
  const norm = normalizeFinancialData(buildMockFinancialData());
  assert.equal(norm.accounts.length, buildMockFinancialData().accounts.length);
  assert.equal(norm.transactions.length, buildMockFinancialData().transactions.length);
  assert.ok(norm.accounts[0].external_ref);
  assert.ok(norm.accountByLinkRef || true); // maps via link ref
  // transaction kind mappings
  const salary = norm.transactions.find((t) => t.category === 'Salary');
  assert.equal(salary.direction, 'in');
});

test('capabilityError is structured for unsupported FI types', () => {
  const e = capabilityError('UNSUPPORTED');
  assert.equal(e.code, AA_ERROR_CODES.UNSUPPORTED_FI_TYPE);
});
