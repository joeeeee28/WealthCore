# WealthCore — Real Setu Sandbox E2E via GitHub Actions

> **Status: `Setu Sandbox = BLOCKED` (waiting for a network-enabled runner + secure credentials).**
> This workflow is **prepared**; it has **NOT** yet executed successfully against the
> real Setu sandbox. It will only produce a real result once the repository owner
> adds the three Setu Secrets and a human approves the Setu consent in the Setu UI.

The WealthCore development sandbox cannot make outbound HTTPS to `*.setu.co`
(the egress allowlist resets the TLS handshake). **GitHub-hosted runners have broad
outbound egress and are the appropriate network-enabled execution environment** for the
genuine Setu sandbox E2E.

---

## Why GitHub Actions

| Constraint | Local dev sandbox | GitHub-hosted runner |
|---|---|---|
| Outbound HTTPS to `fiu-sandbox.setu.co` / `uat.setu.co` | BLOCKED (TLS reset) | Allowed |
| Public inbound HTTPS webhook callback | Not available | Not automatic (see §Webhooks) |
| Secure credential injection | Env-only (no dedicated store) | GitHub Secrets |
| Human Setu consent approval | Manual | Manual (required — cannot be automated) |

GitHub Actions alone solves **egress + secrets**. It does **not** solve the public
webhook callback or the human consent approval — those are separate requirements
(see §Webhooks and §Human approval).

## Required repository Secrets

The repository owner/admin must add these in **Settings → Secrets and variables →
Actions → New repository secret**:

```text
SETU_CLIENT_ID
SETU_CLIENT_SECRET
SETU_PRODUCT_INSTANCE_ID
```

- Keep the Setu product instance ID as configured for WealthCore.
- `SETU_CLIENT_SECRET` must be a **freshly regenerated** Setu TEST secret (rotate it if
  it was ever exposed). Never paste it into source, docs, logs, or commits.
- The workflow injects them as environment variables; GitHub redacts the values in logs.
  The workflow **never** runs `env`, `printenv`, `echo $SETU_CLIENT_SECRET`, or disables TLS.

## How to trigger the workflow

The workflow is **`workflow_dispatch` only** — it is **not** triggered by pushes. To run it:

1. Repository owner adds the three Secrets (required for the real test; see above).
2. Open the repo → **Actions** → **Setu real sandbox E2E** → **Run workflow**.
3. The workflow runs on `ubuntu-latest` and executes in this order:
   - Checkout + Node 22 + dependency install (prebuilt `better-sqlite3`).
   - `npm run config:setu` — presence-only validation (never prints secrets).
   - Outbound connectivity test to `https://fiu-sandbox.setu.co` and the Generate
     Token API host `https://uat.setu.co` (distinguishes DNS / TLS / transport / HTTP /
     provider response; **no `curl -k`**).
   - `npm run test:setu:sandbox` — the genuine Setu external test (token → consent).
   - Full regression (`npm test`), lint, `config:check`, `audit:secrets`, `npm audit`.
   - Uploads a **redacted** evidence summary (never raw logs/secrets/payloads).

## What the workflow tests / does not test

**Tests:**
- Real Setu token acquisition via the current official Bearer model (client credentials
  → Generate Token API `POST /api/v2/auth/token`, JSON `clientID`/`secret`, response
  `data.token` → `Authorization: Bearer` + `x-product-instance-id`).
- Real Setu connectivity + consent creation attempt.
- Full local regression + security scans.

**Does NOT auto-verify (by design):**
- Real Setu **consent approval** (requires the Setu sandbox UI/OTP/mock-FIP — a human
  action, never automated or fabricated).
- Real Setu **webhook delivery** (needs a public inbound HTTPS callback — see §Webhooks).
- Real **session → data-ready → FI fetch → persist → dashboard → idempotency → revocation**
  (these require the human-approved consent *and* a publicly reachable callback).

## Public callback requirement (webhook)

A GitHub Actions runner is a short-lived compute node; it is **not** a persistent public
webhook receiver. Setu must be able to reach WealthCore's endpoints over HTTPS:

```text
POST https://<public-wealthcore-host>/api/v1/aa/webhook/setu   # Setu notifications
GET  https://<public-wealthcore-host>/api/v1/aa/setu/consent/return  # browser return (informational)
```

Therefore, the **real full E2E** (consent → approval → webhook → session → FI fetch) also
requires a **publicly reachable WealthCore deployment** (e.g. a cloud host with an inbound
public endpoint) — the GitHub runner alone is insufficient for the webhook leg. Configure
`SETU_WEBHOOK_URL` / `SETU_REDIRECT_URL` to that public host and set the callback on the
Setu Bridge.

Because this repository currently has **no configured deployment target** (no Vercel/
Render/Railway/Fly/Cloud Run/Docker in the repo), that infrastructure is an open
requirement. The task does **not** introduce an insecure public tunnel merely to claim
completion.

## Human consent approval

The Setu sandbox consent flow requires the **customer to approve** the consent on Setu's
screens (mobile verification / OTP / sandbox mock-FIP). WealthCore must not automate or
fake OTP approval. Where the human must intervene:

1. The workflow (or the app) creates the consent and prints/returns the **Setu consent URL**
   (the exact URL is deliberately not logged — it is returned to the authenticated UI).
2. A **human** opens the URL, authenticates with Setu, selects the financial accounts, and
   **approves** the consent.
3. The authoritative status change arrives via the **Setu webhook** (`CONSENT_STATUS_UPDATE`),
   not from the browser return route.

## What constitutes real Setu success

`Setu Sandbox = IMPLEMENTED` only when all of the following are demonstrated **against the
real Setu sandbox** (never the local simulator or MockAA):

- Real Setu network reachable (TLS + HTTP).
- Real Generate Token API succeeded → Bearer access token obtained (`data.token`).
- Real consent created (consent ID + URL + status).
- Real consent approved (human) → status `ACTIVE`.
- Real Setu webhook delivered to `/api/v1/aa/webhook/setu` (consent + session events).
- Real session created; real data-ready state; real FI data fetched.
- Real ReBIT payload normalized + persisted (accounts/transactions/holdings, provenance).
- Real dashboard reflects the data; Net Worth = Assets − Liabilities.
- Second sync → 0 duplicates.
- Real revocation → subsequent sync rejected.

Until then: **`Setu Sandbox = BLOCKED`**.

## Security restrictions

- Never commit, print, log, or screenshot credentials/tokens.
- The workflow never dumps env or echoes secrets; it never disables TLS validation.
- Evidence upload is redacted (no secret/token/Authorization/PAN/Aadhaar/account numbers/
  raw FI payload).
- No tests are weakened; a network failure stays `BLOCKED — NETWORK`, an application
  failure stays `FAIL — APPLICATION`, a provider-contract mismatch stays
  `FAIL — PROVIDER CONTRACT`.

## Current status

```text
Setu Sandbox = BLOCKED (waiting for network-enabled runner + secure credentials)
Production    = NOT READY
```
