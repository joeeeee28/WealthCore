# WealthCore — Data Environments

One central switch controls which *data world* WealthCore runs against:

```
WEALTHCORE_DATA_ENVIRONMENT = DEMO | FINVU_SANDBOX | SETU_SANDBOX | PRODUCTION
```

Default: **`DEMO`**. Any value outside the four supported values fails
configuration validation at startup (`validateConfig`) and makes resolution
throw — an unrecognised environment is never guessed or silently defaulted
after an operator made an explicit choice.

## The four environments

| Value | Provider | Data | Credentials | UI indicator |
| ----- | -------- | ---- | ----------- | ------------ |
| `DEMO` | Demo provider (`demo`) | deterministic **synthetic** data | none required | 🧪 DEMO MODE |
| `FINVU_SANDBOX` | Finvu AA adapter (`finvu`) | Finvu UAT sandbox | Finvu/AA credentials | 🔬 FINVU SANDBOX |
| `SETU_SANDBOX` | Setu AA adapter (`setu`) | Setu AA sandbox | Setu Bridge credentials | 🔬 SETU SANDBOX |
| `PRODUCTION` | explicitly configured provider (`AA_PROVIDER`) | real financial data | real Finvu **or** Setu credentials | 🔐 PRODUCTION |

While `DEMO` is active the UI also shows a persistent banner:
*“DEMO DATA — All financial information shown is synthetic.”*

## Centralised provider resolution

Environment → provider selection lives in exactly one module,
`server/aa/data-environment.js`. Application code never reads the environment
variable itself and never duplicates selection logic:

```js
import { getDataEnvironment, getActiveProvider, describeDataEnvironments } from './data-environment.js';

getDataEnvironment()   // → 'DEMO' (validated; throws on invalid config)
getActiveProvider()    // → provider object resolved via the AA registry
describeDataEnvironments() // → all four environments + the active one
```

Resolution rules:

1. `DEMO` → registry provider **`demo`** (`server/aa/providers/demo.js`).
2. `FINVU_SANDBOX` → registry provider **`finvu`** (unchanged behaviour).
3. `SETU_SANDBOX` → registry provider **`setu`** (unchanged behaviour).
4. `PRODUCTION` → the explicitly configured `AA_PROVIDER` — Finvu/Setu/etc.
   If none is configured (or the configured provider is the demo/mock
   provider), resolution returns a clearly-labelled **NOT-configured
   PRODUCTION stub** that rejects every data operation with
   `PROVIDER_NOT_CONFIGURED`. **It is architecturally impossible for
   production to resolve to the demo provider.**

The mapping registry entries and the existing Finvu/Setu adapters were not
altered in behaviour; the demo provider was *added* to the registry in
`server/aa/index.js` alongside them.

## Environment-introspection APIs

Both are public and return **labels and flags only** — never credentials,
connection strings, or data:

* `GET /api/v1/data-environment` — the active environment descriptor:
  `{ value, label, icon, synthetic, sandbox, provider, providerConfigured, requiresCredentials, notice }`.
* `GET /api/v1/data-environments` — all four environments with the active one
  marked, for settings/switcher UIs.

The public `GET /api/v1/config` payload also embeds the active-environment
descriptor so the SPA can render the persistent indicator before login.

## Switching environments

Set the variable in `.env` (never commit `.env`) and restart:

```bash
# demo (default — deterministic synthetic data)
WEALTHCORE_DATA_ENVIRONMENT=DEMO

# Setu AA sandbox (existing sandbox flow unchanged)
WEALTHCORE_DATA_ENVIRONMENT=SETU_SANDBOX
SETU_CLIENT_ID=… SETU_CLIENT_SECRET=… SETU_PRODUCT_INSTANCE_ID=…
AA_ENVIRONMENT=sandbox

# Finvu UAT sandbox
WEALTHCORE_DATA_ENVIRONMENT=FINVU_SANDBOX
WEALTHCORE_AA_PROVIDER=finvu
WEALTHCORE_AA_CLIENT_ID=… WEALTHCORE_AA_SECRET=… WEALTHCORE_AA_BASE_URL=…

# production — requires real credentials; config validation fails without them
WEALTHCORE_DATA_ENVIRONMENT=PRODUCTION
AA_ENVIRONMENT=production
```

All existing Finvu and Setu environment variables (`WEALTHCORE_AA_*`,
`WEALTHCORE_SETU_*`, `SETU_*`, `AA_ENVIRONMENT`, …) are preserved and continue
to work exactly as before; see `.env.example`.

## Production safety rules (enforced, tested)

1. **No silent fallback.** `PRODUCTION` never resolves, substitutes, or falls
   back to the demo provider or demo data — not automatically, not silently.
2. **Fail-closed validation.** `PRODUCTION` without configured Finvu/Setu
   credentials fails `validateConfig` (and thus `npm run config:check` /
   production boot). `AA_PROVIDER=demo|mock` under `PRODUCTION` is a hard
   misconfiguration.
3. **Demo mutations blocked.** `loadDemoProfile` / `refreshDemoProfile` /
   `resetDemoProfile` call `assertDemoAllowed()` and refuse with
   `DEMO_DISABLED_IN_PRODUCTION` while `PRODUCTION` is selected.
4. **Honest degradation.** Without a real provider, production surfaces a
   NOT-configured stub, never synthetic stand-ins.

## Security considerations

* The Demo provider requires **no** credentials and performs **no** network
  I/O; all fixtures are local deterministic data.
* No real financial data, account numbers, merchant names or instrument
  identifiers appear in fixtures; ids are namespaced `DEMO-*`, balances
  masked `XXXXXX####`.
* `npm run audit:secrets` scans for keys/secrets; fixtures contain none and
  `.env.example` documents placeholders only.
* Demo rows are ordinary user-scoped rows (`user_id`, `is_demo=1`); one user's
  synthetic data is never visible to another user.
* The existing security controls (scrypt auth, sessions, CSRF, rate limiting,
  config validation, redacted logs) are untouched by this feature.

## Related docs

* `docs/DEMO_DATA.md` — the demo data environment in depth.
* `docs/AA_INTEGRATION.md`, `docs/SETU_INTEGRATION.md` — real AA providers.
* `docs/SYNC_ENGINE.md` — the shared idempotent sync pipeline demo reuses.
