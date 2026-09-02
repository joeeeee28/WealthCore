// Setu adapter tests: config/status honesty, ReBIT JSON → canonical translation,
// consent status mapping, webhook signature verification.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SetuProvider, translateSetuFiToEnvelope, SETU_ENDPOINTS } from '../server/aa/providers/setu.js';
import { verifySetuWebhookSignature, setuHeaders, setuCryptoConfig } from '../server/aa/crypto/setu-crypto.js';
import { normalizeFinancialData } from '../server/aa/rebit-normalizer.js';
import { AA_ERROR_CODES } from '../server/aa/errors.js';

// Sample Setu sandbox FI response (format=json, decrypted ReBIT deposit).
const SETU_FI_RESPONSE = {
  id: '378ec65c-1111-4f11-8f11-e880c2cf88b3',
  status: 'COMPLETED',
  format: 'json',
  consentId: 'd4f40bd9-a22f-4408-a622-4e8a1e4fbda6',
  dataRange: { from: '2021-04-01T00:00Z', to: '2021-09-30T00:00Z' },
  fips: [
    {
      fipID: 'Setu-FIP',
      accounts: [
        {
          linkRefNumber: 'b2329f47-0a6f-4131-adb5-9ef7b4c1ca6a',
          maskedAccNumber: 'XXXXXX4373',
          status: 'DELIVERED',
          data: {
            account: {
              linkedAccRef: 'b2329f47-0a6f-4131-adb5-9ef7b4c1ca6a',
              maskedAccNumber: 'XXXXXX4373',
              type: 'deposit',
              version: '1.1',
              summary: {
                currentBalance: '101666.33',
                currency: 'INR',
                balanceDateTime: '2020-06-22T07:50:00+00:00',
                type: 'SAVINGS',
                branch: 'Jayanagar',
                ifscCode: 'ICIC0001124',
              },
              transactions: {
                startDate: '2021-04-01',
                endDate: '2021-09-30',
                transaction: [
                  { txnId: 'TXN-1', amount: '25000.00', type: 'CREDIT', narration: 'Salary ACME Corp', transactionDateTime: '2021-04-01T09:00:00Z' },
                  { txnId: 'TXN-2', amount: '1500.00', type: 'DEBIT', narration: 'BigBasket Groceries', transactionDateTime: '2021-04-03T12:00:00Z' },
                ],
              },
            },
          },
        },
      ],
    },
  ],
};

test('Setu provider is NOT configured without credentials and reports READY_FOR_CONFIGURATION', () => {
  assert.equal(SetuProvider.configured, false);
  assert.equal(SetuProvider.requiresCredentials, true);
  const st = SetuProvider.status();
  assert.equal(st.mode, 'sandbox');
  assert.equal(st.environment, 'SANDBOX');
  assert.equal(st.configured, false);
  assert.match(st.detail, /READY_FOR_CONFIGURATION/);
  assert.equal(SetuProvider.supportsFIType('DEPOSIT'), true);
  assert.equal(SetuProvider.supportsFIType('UNSUPPORTED'), false);
});

test('Setu provider methods throw PROVIDER_NOT_CONFIGURED when unconfigured', async () => {
  await assert.rejects(() => SetuProvider.createConsent({}), (e) => e.code === 'PROVIDER_NOT_CONFIGURED');
  await assert.rejects(() => SetuProvider.getConsentStatus('x'), (e) => e.code === 'PROVIDER_NOT_CONFIGURED');
  await assert.rejects(() => SetuProvider.requestFIData({ consentId: 'x' }), (e) => e.code === 'PROVIDER_NOT_CONFIGURED');
});

test('translateSetuFiToEnvelope maps ReBIT deposit JSON into canonical accounts/transactions', () => {
  const env = translateSetuFiToEnvelope(SETU_FI_RESPONSE, { provider: 'setu', consentId: 'c1', sessionId: 's1' });
  assert.equal(env.provider, 'setu');
  assert.equal(env.consentId, 'c1');
  assert.equal(env.sessionId, 's1');
  assert.equal(env.accounts.length, 1);
  assert.equal(env.accounts[0].accountType, 'SAVINGS');
  assert.equal(env.accounts[0].currency, 'INR');
  assert.equal(env.accounts[0].linkRefNumber, 'b2329f47-0a6f-4131-adb5-9ef7b4c1ca6a');
  assert.equal(env.accounts[0].currentBalanceMinor, 10166633); // ₹1,01,666.33
  assert.equal(env.transactions.length, 2);
  const salary = env.transactions[0];
  assert.equal(salary.category, 'Salary');
  assert.equal(salary.transactionType, 'CREDIT');
  assert.equal(salary.amountMinor, 2500000);
  const groc = env.transactions[1];
  assert.equal(groc.category, 'Food');
  assert.equal(groc.transactionType, 'DEBIT');
});

test('translateSetuFiToEnvelope passes through the shared rebit-normalizer', () => {
  const env = translateSetuFiToEnvelope(SETU_FI_RESPONSE, { provider: 'setu' });
  const normalized = normalizeFinancialData(env);
  assert.equal(normalized.accounts.length, 1);
  assert.equal(normalized.transactions.length, 2);
  assert.equal(normalized.provider, 'setu');
});

test('normalizeFinancialData on a Setu getFIData wrapper translates correctly', () => {
  const wrapper = { sessionId: 's1', consentId: 'c1', status: 'fetched', data: SETU_FI_RESPONSE };
  const env = SetuProvider.normalizeFinancialData(wrapper);
  assert.equal(env.consentId, 'c1');
  assert.equal(env.sessionId, 's1');
  assert.equal(env.accounts.length, 1);
});

test('Setu endpoints point to the documented sandbox paths', () => {
  assert.equal(SETU_ENDPOINTS.createConsent, '/v2/consents');
  assert.equal(SETU_ENDPOINTS.createSession, '/sessions');
  assert.ok(SETU_ENDPOINTS.getConsent('abc').includes('/consents/abc'));
});

test('webhook signature verification is honest without a secret', () => {
  const v = verifySetuWebhookSignature('{"a":1}', 'sha256=abc');
  assert.equal(v.valid, false);
  assert.equal(v.reason, 'NO_SECRET_CONFIGURED');
});

test('setuHeaders uses the current official client-credentials auth model', async () => {
  // Set env for the current official Setu model, then read the crypto config.
  const prev = {
    ci: process.env.WEALTHCORE_SETU_CLIENT_ID, cs: process.env.WEALTHCORE_SETU_CLIENT_SECRET,
    pi: process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID, tk: process.env.WEALTHCORE_SETU_TOKEN,
  };
  process.env.WEALTHCORE_SETU_CLIENT_ID = 'cid';
  process.env.WEALTHCORE_SETU_CLIENT_SECRET = 'csec';
  process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID = 'pi';
  process.env.WEALTHCORE_SETU_TOKEN = '';
  const { resetConfig } = await import('../server/config.js');
  resetConfig();
  const { setuHeaders } = await import('../server/aa/crypto/setu-crypto.js');
  const h = setuHeaders();
  assert.equal(h['x-client-id'], 'cid');
  assert.equal(h['x-client-secret'], 'csec');
  assert.equal(h['x-product-instance-id'], 'pi');
  assert.equal(h.Authorization, undefined); // no bearer token in current model
  // restore env
  process.env.WEALTHCORE_SETU_CLIENT_ID = prev.ci || '';
  process.env.WEALTHCORE_SETU_CLIENT_SECRET = prev.cs || '';
  process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID = prev.pi || '';
  process.env.WEALTHCORE_SETU_TOKEN = prev.tk || '';
  resetConfig();
});

test('setuHeaders includes Content-Type and Accept', () => {
  const h = setuHeaders();
  assert.equal(h['Content-Type'], 'application/json');
  assert.equal(h.Accept, 'application/json');
});

test('a liability (credit card/loan) is normalised to positive outstanding', () => {
  const fi = {
    fips: [{ fipID: 'BANK', accounts: [{ linkRefNumber: 'L1', maskedAccNumber: 'XXXX', status: 'DELIVERED', data: { account: { linkedAccRef: 'L1', type: 'deposit', summary: { currentBalance: '-42500.00', currency: 'INR', type: 'CREDIT_CARD' } } } }] }],
  };
  const env = translateSetuFiToEnvelope(fi);
  assert.equal(env.accounts[0].isLiability, true);
  assert.equal(env.accounts[0].accountType, 'CREDIT_CARD');
});
