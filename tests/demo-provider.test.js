// Demo AA provider contract tests.
//
// The Demo provider implements the SAME AAProvider contract as mock/finvu/setu:
// it needs no bank credentials, reports mode DEMO / synthetic / READY, and the
// full lifecycle (createConsent → approve → requestFIData → markDataReady →
// getFIData → normalize) returns clearly-labelled deterministic synthetic data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import DemoProvider from '../server/aa/providers/demo.js';
import { AA_ERROR_CODES } from '../server/aa/errors.js';
import { buildDemoFinancialData, DEMO_TRANSACTION_COUNT } from '../server/aa/fixtures/demo-data.js';

test('demo provider identity and status contract', () => {
  assert.equal(DemoProvider.name, 'demo');
  assert.equal(DemoProvider.mode, 'DEMO');
  assert.equal(DemoProvider.configured, true);
  assert.equal(DemoProvider.synthetic, true);
  assert.equal(DemoProvider.requiresCredentials, false);

  const st = DemoProvider.status();
  assert.equal(st.configured, true);
  assert.equal(st.mode, 'DEMO');
  assert.equal(st.requiresCredentials, false);
  assert.equal(st.synthetic, true);
  assert.equal(st.status, 'READY');
  assert.match(st.detail, /synthetic/i);
});

test('demo provider exposes FIs and FI types (same capability surface)', () => {
  assert.ok(DemoProvider.getSupportedFIs().length >= 1);
  assert.ok(DemoProvider.getSupportedFIs().every((f) => f.startsWith('DEMO-')));
  for (const t of ['DEPOSIT', 'EQUITIES', 'MUTUAL_FUNDS', 'INSURANCE_POLICIES', 'LOAN']) {
    assert.ok(DemoProvider.supportsFIType(t), `must support ${t}`);
  }
  assert.equal(DemoProvider.supportsFIType('UNSUPPORTED_XYZ'), false);
});

test('demo provider requires no bank credentials for any operation', async () => {
  // If bank credentials were required these calls would reject with an
  // authentication/forbidden error; they must all succeed locally.
  const created = await DemoProvider.createConsent({ purpose: 'contract test' });
  assert.ok(created.consent.consentId);
  await DemoProvider.approveConsent(created.consent.consentId);
  const fi = await DemoProvider.requestFIData({ consentId: created.consent.consentId });
  assert.ok(fi.sessionId);
  const data = await DemoProvider.getFIData(fi.sessionId);
  assert.ok(data.accounts.length > 0);
});

test('demo consent lifecycle: create → approve → request → ready → fetch', async () => {
  const created = await DemoProvider.createConsent({ provider: 'demo', fiType: 'DEPOSIT', fiTypes: ['DEPOSIT', 'EQUITIES'], purpose: 'Personal financial management (demo)' });
  const consent = created.consent;
  assert.match(consent.consentId, /^DEMO-CONSENT-/);
  assert.equal(consent.status, 'pending');
  assert.equal(consent.provider, 'demo');
  assert.equal(consent.source, 'DEMO');
  assert.equal(consent.synthetic, true);
  assert.deepEqual(consent.fiTypes, ['DEPOSIT', 'EQUITIES']);

  const approved = await DemoProvider.approveConsent(consent.consentId);
  assert.equal(approved.status, 'approved');

  const status = await DemoProvider.getConsentStatus(consent.consentId);
  assert.equal(status.status, 'approved');

  const fi = await DemoProvider.requestFIData({ consentId: consent.consentId });
  assert.match(fi.sessionId, /^DEMO-SESSION-/);
  assert.equal(fi.status, 'data_requested');

  const ready = await DemoProvider.markDataReady({ consentId: consent.consentId });
  assert.equal(ready.dataStatus, 'data_ready');

  const data = await DemoProvider.getFIData(fi.sessionId);
  assert.equal(data.provider, 'demo');
  assert.equal(data.source, 'DEMO');
  assert.equal(data.synthetic, true);
  assert.equal(data.accounts.length, 7, 'demo exposes 7 AA accounts');
  assert.equal(data.holdings.length, 12, 'demo exposes 12 holdings');
  assert.equal(data.transactions.length, DEMO_TRANSACTION_COUNT, 'demo exposes 180 transactions');
  assert.equal(data.retirement.length, 3, 'demo exposes retirement assets');
  assert.equal(data.insurance.length, 3, 'demo exposes insurance records');
  assert.equal(data.goals.length, 6, 'demo exposes 6 goals');
});

test('every demo record is clearly identified as synthetic', async () => {
  const data = buildDemoFinancialData();
  assert.equal(data.provider, 'demo');
  assert.equal(data.source, 'DEMO');
  assert.equal(data.synthetic, true);
  for (const fip of data.fips) {
    assert.equal(fip.source, 'DEMO');
    assert.equal(fip.synthetic, true);
  }
  for (const a of data.accounts) {
    assert.equal(a.source, 'DEMO');
    assert.equal(a.synthetic, true);
    assert.match(a.linkRefNumber, /^DEMO-LINK-/);
    assert.match(a.maskedAccNumber, /^XXXXXX\d+$/, 'account numbers are masked, never real');
  }
  for (const h of data.holdings) {
    assert.equal(h.source, 'DEMO');
    assert.equal(h.synthetic, true);
  }
  for (const t of data.transactions) {
    assert.equal(t.source, 'DEMO');
    assert.equal(t.synthetic, true);
    assert.match(t.txnId, /^DEMO-TXN-\d{4}$/);
    assert.match(t.narration, /synthetic demo/i);
  }
});

test('transaction ids are sequential DEMO-TXN-0001 … DEMO-TXN-0180 and chronological', async () => {
  const data = buildDemoFinancialData();
  data.transactions.forEach((t, i) => {
    assert.equal(t.txnId, `DEMO-TXN-${String(i + 1).padStart(4, '0')}`);
    if (i > 0) assert.ok(t.transactionDateTime >= data.transactions[i - 1].transactionDateTime, 'sorted chronologically');
  });
});

test('demo loader never returns real-looking secrets or credentials', async () => {
  const data = JSON.stringify(buildDemoFinancialData());
  assert.ok(!/private[_-]?key/i.test(data));
  assert.ok(!/client[_-]?secret/i.test(data));
  assert.ok(!/password/i.test(data));
  assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(data));
});

test('demo provider rejects out-of-order lifecycle transitions (real AA semantics)', async () => {
  const created = await DemoProvider.createConsent({});

  // Requesting data before approval must fail — approval is a real gate.
  await assert.rejects(
    () => DemoProvider.requestFIData({ consentId: created.consent.consentId }),
    (e) => e.code === AA_ERROR_CODES.CONSENT_REJECTED,
  );

  // Revoke before approval is invalid.
  await assert.rejects(
    () => DemoProvider.revokeConsent(created.consent.consentId),
    (e) => e.code === AA_ERROR_CODES.INVALID_TRANSITION,
  );

  // Unknown consent id.
  await assert.rejects(
    () => DemoProvider.getConsentStatus('DEMO-CONSENT-9999'),
    (e) => e.code === AA_ERROR_CODES.CONSENT_NOT_FOUND,
  );

  // Unknown session id.
  await assert.rejects(
    () => DemoProvider.getFIData('DEMO-SESSION-9999'),
    (e) => e.code === AA_ERROR_CODES.DATA_NOT_READY,
  );
});

test('revoking a demo consent blocks data requests and fetches', async () => {
  const created = await DemoProvider.createConsent({});
  await DemoProvider.approveConsent(created.consent.consentId);
  const revoked = await DemoProvider.revokeConsent(created.consent.consentId);
  assert.equal(revoked.status, 'revoked');
  await assert.rejects(
    () => DemoProvider.requestFIData({ consentId: created.consent.consentId }),
    (e) => e.code === AA_ERROR_CODES.CONSENT_REVOKED,
  );
});

test('demo notification handling mirrors the mock contract', async () => {
  const created = await DemoProvider.createConsent({});
  await DemoProvider.approveConsent(created.consent.consentId);
  const handled = await DemoProvider.handleNotification({ event: 'DATA_READY', consentId: created.consent.consentId });
  assert.deepEqual(handled, { ok: true, handled: true });
  const ignored = await DemoProvider.handleNotification({ event: 'NOPE' });
  assert.deepEqual(ignored, { ok: true, handled: false });
});

test('normalizeFinancialData passthrough matches the AA provider contract', async () => {
  const created = await DemoProvider.createConsent({});
  await DemoProvider.approveConsent(created.consent.consentId);
  const fi = await DemoProvider.requestFIData({ consentId: created.consent.consentId });
  await DemoProvider.markDataReady({ consentId: created.consent.consentId });
  const raw = await DemoProvider.getFIData(fi.sessionId);
  const viaAdapter = DemoProvider.normalizeFinancialData(raw);
  assert.equal(viaAdapter, raw, 'demo adapter returns the canonical envelope unchanged (normalizer owns mapping)');
});
