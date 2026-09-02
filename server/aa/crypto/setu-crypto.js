// WealthCore — Setu crypto abstraction.
//
// Setu's AA flow (format=json in sandbox) returns DECRYPTED ReBIT JSON to the
// FIU — Setu handles the E2E encryption/decryption via its Rahasya key exchange.
// Therefore no FIU-side decryption is required for the standard JSON path.
//
// CURRENT OFFICIAL AUTH MODEL (verified from Setu AA quickstart docs):
//   Setu provides x-client-id + x-client-secret (client credentials) and
//   x-product-instance-id (the Product ID) via the Bridge. These are passed as
//   request headers on every AA call. There is NO direct `Authorization: Bearer`
//   access token in the current sandbox gate — credentials are the client id/secret.
//
// This module isolates the provider-specific auth/signature concerns so real
// crypto can be supplied via env without touching the core AA layer.
//
// PENDING SETU DOCUMENTATION CONFIRMATION:
//   * exact webhook signature verification algorithm (X-Webhook-Signature)
//   * whether an RSA request-signing public key is required for outbound calls
//
import crypto from 'node:crypto';
import { config } from '../../config.js';

export function setuCryptoConfig() {
  const s = config().setu || {};
  return {
    baseUrl: s.baseUrl || 'https://fiu-sandbox.setu.co',
    clientId: s.clientId || null,
    clientSecret: s.clientSecret || null,
    productInstanceId: s.productInstanceId || null,
    // Backward-compat alias: some environments use an access token instead.
    token: s.token || null,
    webhookSecret: s.webhookSecret || null,
    signingPublicKey: s.signingPublicKey || null,
    // Configured when either the current client-credentials model is present
    // (clientId + clientSecret) or a legacy bearer token is supplied.
    configured: Boolean(
      (s.clientId && s.clientSecret && s.productInstanceId) ||
      (s.token && s.productInstanceId),
    ),
  };
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

/**
 * Build the auth headers for outbound Setu calls per the current official
 * model (x-client-id, x-client-secret, x-product-instance-id). If only a
 * bearer token is configured (legacy), fall back to Authorization: Bearer.
 */
export function setuHeaders() {
  const cfg = setuCryptoConfig();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (cfg.clientId && cfg.clientSecret) {
    headers['x-client-id'] = cfg.clientId;
    headers['x-client-secret'] = cfg.clientSecret;
  }
  if (cfg.productInstanceId) headers['x-product-instance-id'] = cfg.productInstanceId;
  if (cfg.token && !headers['x-client-id']) headers.Authorization = `Bearer ${cfg.token}`;
  return headers;
}

export default { setuCryptoConfig, verifySetuWebhookSignature, setuHeaders };
