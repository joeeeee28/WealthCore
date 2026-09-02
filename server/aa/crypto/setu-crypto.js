// WealthCore — Setu crypto abstraction.
//
// Setu's AA flow (format=json in sandbox) returns DECRYPTED ReBIT JSON to the
// FIU — Setu handles the E2E encryption/decryption via its Rahasya key exchange.
// Therefore no FIU-side decryption is required for the standard JSON path.
//
// CURRENT OFFICIAL AUTH MODEL (verified from Setu docs):
//   Bridge provides client_id + client_secret + x-product-instance-id.
//   The access token is obtained from Setu's Generate Token API
//   (POST https://uat.setu.co/api/v2/auth/token in sandbox) via setu-auth.js.
//   The response token comes in data.token.
//   Setu AA APIs then require `Authorization: Bearer <access_token>` and
//   `x-product-instance-id`. The client secret is NEVER sent as a request
//   header on AA APIs; it is used only to acquire the access token.
//
// This module builds the outbound request headers and verifies webhook
// signatures. Credentials/tokens are never logged.

import crypto from 'node:crypto';
import { config } from '../../config.js';
import { getAccessToken } from '../providers/setu-auth.js';

export function setuCryptoConfig() {
  const s = config().setu || {};
  return {
    baseUrl: s.baseUrl || 'https://fiu-sandbox.setu.co',
    clientId: s.clientId || null,
    clientSecret: s.clientSecret || null,
    productInstanceId: s.productInstanceId || null,
    // Legacy short-lived access token (if supplied directly).
    token: s.token || null,
    webhookSecret: s.webhookSecret || null,
    signingPublicKey: s.signingPublicKey || null,
    configured: Boolean(
      (s.clientId && s.clientSecret && s.productInstanceId) ||
      (s.token && s.productInstanceId),
    ),
  };
}

export async function setuAuthHeaders() {
  const cfg = setuCryptoConfig();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cfg.productInstanceId) headers['x-product-instance-id'] = cfg.productInstanceId;
  return headers;
}

/** Verify a Setu webhook signature (HMAC-style) if a secret is configured. */
export function verifySetuWebhookSignature(rawBody, signatureHeader) {
  const cfg = setuCryptoConfig();
  if (!cfg.webhookSecret) return { valid: false, reason: 'NO_SECRET_CONFIGURED' };
  if (!signatureHeader) return { valid: false, reason: 'MISSING_SIGNATURE' };
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  const got = String(signatureHeader).replace(/^sha256=/, '');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(got, 'hex');
  if (a.length !== b.length) return { valid: false, reason: 'BAD_SIGNATURE' };
  return { valid: crypto.timingSafeEqual(a, b), reason: 'OK' };
}

export default { setuCryptoConfig, setuAuthHeaders, verifySetuWebhookSignature };
