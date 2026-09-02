// WealthCore — explicit consent state machine.
//
// Defines the full AA consent + FI-data lifecycle and the ONLY valid
// transitions. Arbitrary status manipulation is rejected (INVALID_TRANSITION).
//
// Core consent statuses (persisted in consents.status):
//   DRAFT → PENDING → APPROVED → ACTIVE
//   PENDING → REJECTED ; APPROVED/ACTIVE → EXPIRED ; ACTIVE → REVOKED
//
// Data-flow phases (persisted in consents.data_status / aa_sessions.status):
//   DATA_REQUESTED → DATA_READY → FETCHED
//   DATA_REQUESTED → TIMEOUT ; DATA_REQUESTED → PARTIAL_FAILURE

import { aaError } from './errors.js';

export const CONSENT_STATES = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
};

export const DATA_STATES = {
  IDLE: 'idle',
  DATA_REQUESTED: 'data_requested',
  DATA_READY: 'data_ready',
  FETCHED: 'fetched',
  TIMEOUT: 'timeout',
  PARTIAL_FAILURE: 'partial_failure',
};

const CONSENT_TRANSITIONS = {
  [CONSENT_STATES.DRAFT]: [CONSENT_STATES.PENDING, CONSENT_STATES.REJECTED],
  [CONSENT_STATES.PENDING]: [CONSENT_STATES.APPROVED, CONSENT_STATES.REJECTED, CONSENT_STATES.EXPIRED],
  [CONSENT_STATES.APPROVED]: [CONSENT_STATES.ACTIVE, CONSENT_STATES.REVOKED, CONSENT_STATES.EXPIRED],
  [CONSENT_STATES.ACTIVE]: [CONSENT_STATES.REVOKED, CONSENT_STATES.EXPIRED],
  [CONSENT_STATES.REJECTED]: [],
  [CONSENT_STATES.REVOKED]: [],
  [CONSENT_STATES.EXPIRED]: [],
};

const DATA_TRANSITIONS = {
  [DATA_STATES.IDLE]: [DATA_STATES.DATA_REQUESTED],
  [DATA_STATES.DATA_REQUESTED]: [DATA_STATES.DATA_READY, DATA_STATES.TIMEOUT, DATA_STATES.PARTIAL_FAILURE],
  [DATA_STATES.DATA_READY]: [DATA_STATES.FETCHED, DATA_STATES.PARTIAL_FAILURE],
  [DATA_STATES.FETCHED]: [],
  [DATA_STATES.TIMEOUT]: [DATA_STATES.DATA_REQUESTED],
  [DATA_STATES.PARTIAL_FAILURE]: [DATA_STATES.DATA_REQUESTED],
};

export function canTransitionConsent(from, to) {
  return (CONSENT_TRANSITIONS[from] || []).includes(to);
}

export function canTransitionData(from, to) {
  return (DATA_TRANSITIONS[from] || []).includes(to);
}

/** Validate + perform a consent-state transition. Returns the new status. */
export function transitionConsentStatus(current, to) {
  if (current === to) return current;
  if (!canTransitionConsent(current, to)) {
    throw aaError('INVALID_TRANSITION', `Cannot transition consent from "${current}" to "${to}".`, { from: current, to });
  }
  return to;
}

/** Validate + perform a data-state transition. Returns the new data status. */
export function transitionDataStatus(current, to) {
  if (current === to) return current;
  if (!canTransitionData(current, to)) {
    throw aaError('INVALID_TRANSITION', `Cannot transition data from "${current}" to "${to}".`, { from: current, to });
  }
  return to;
}

export function consentStateFlow() {
  return CONSENT_TRANSITIONS;
}
export function dataStateFlow() {
  return DATA_TRANSITIONS;
}

export default {
  CONSENT_STATES, DATA_STATES, consentStateFlow, dataStateFlow,
  canTransitionConsent, canTransitionData, transitionConsentStatus, transitionDataStatus,
};
