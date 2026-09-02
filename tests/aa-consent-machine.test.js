// AA consent & data state machine tests (explicit transitions, invalid guards).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_STATES, DATA_STATES, consentStateFlow, dataStateFlow,
  canTransitionConsent, canTransitionData, transitionConsentStatus, transitionDataStatus,
} from '../server/aa/consent-state-machine.js';

test('consent state machine exposes valid transitions', () => {
  const flow = consentStateFlow();
  assert.deepEqual(flow[CONSENT_STATES.PENDING], [CONSENT_STATES.APPROVED, CONSENT_STATES.REJECTED, CONSENT_STATES.EXPIRED]);
  assert.deepEqual(flow[CONSENT_STATES.ACTIVE], [CONSENT_STATES.REVOKED, CONSENT_STATES.EXPIRED]);
});

test('valid consent transitions are allowed', () => {
  assert.equal(transitionConsentStatus(CONSENT_STATES.PENDING, CONSENT_STATES.APPROVED), CONSENT_STATES.APPROVED);
  assert.equal(transitionConsentStatus(CONSENT_STATES.ACTIVE, CONSENT_STATES.REVOKED), CONSENT_STATES.REVOKED);
  assert.equal(transitionConsentStatus(CONSENT_STATES.DRAFT, CONSENT_STATES.PENDING), CONSENT_STATES.PENDING);
});

test('invalid consent transitions are rejected', () => {
  assert.throws(() => transitionConsentStatus(CONSENT_STATES.PENDING, CONSENT_STATES.REVOKED));
  assert.throws(() => transitionConsentStatus(CONSENT_STATES.APPROVED, CONSENT_STATES.PENDING));
  assert.throws(() => transitionConsentStatus(CONSENT_STATES.REVOKED, CONSENT_STATES.ACTIVE));
});

test('terminal states cannot transition further', () => {
  assert.equal(canTransitionConsent(CONSENT_STATES.REJECTED, CONSENT_STATES.APPROVED), false);
  assert.equal(canTransitionConsent(CONSENT_STATES.EXPIRED, CONSENT_STATES.ACTIVE), false);
});

test('data state machine allows request→ready→fetched and rejects skips', () => {
  assert.equal(canTransitionData(DATA_STATES.IDLE, DATA_STATES.DATA_REQUESTED), true);
  assert.equal(canTransitionData(DATA_STATES.DATA_REQUESTED, DATA_STATES.DATA_READY), true);
  assert.equal(canTransitionData(DATA_STATES.DATA_READY, DATA_STATES.FETCHED), true);
  assert.equal(canTransitionData(DATA_STATES.IDLE, DATA_STATES.FETCHED), false);
});

test('timeout and partial-failure can retry from data_requested', () => {
  assert.equal(canTransitionData(DATA_STATES.DATA_REQUESTED, DATA_STATES.TIMEOUT), true);
  assert.equal(canTransitionData(DATA_STATES.DATA_REQUESTED, DATA_STATES.PARTIAL_FAILURE), true);
  assert.equal(canTransitionData(DATA_STATES.TIMEOUT, DATA_STATES.DATA_REQUESTED), true);
});
