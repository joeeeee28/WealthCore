# WealthCore Documentation

Documentation is part of the product. This is the single source of truth for what WealthCore is, what it does, and how it works.

## Product

- `BRD.md` — Business Requirements Document (vision, goals, non-goals, success criteria)
- `PRD.md` — Product Requirements Document (journeys, screens, scope)
- `FRD.md` — Functional Requirements Document (per-module functional requirements)

## Architecture & Data

- `ARCHITECTURE.md` — system architecture, data flow, layers
- `DATA_MODEL.md` — entities, fields, relationships, indexes
- `API_SPECIFICATION.md` — REST endpoints, request/response, errors
- `SYNC_ENGINE.md` — synchronisation behaviour
- `DATA_ENVIRONMENTS.md` — central `WEALTHCORE_DATA_ENVIRONMENT` (DEMO/FINVU_SANDBOX/SETU_SANDBOX/PRODUCTION), provider resolution, production safety
- `DEMO_DATA.md` — demo data environment: deterministic synthetic fixtures, demo provider, load/refresh/reset, isolation & idempotency
- `AA_INTEGRATION.md` — Account Aggregator / FIU integration & consent lifecycle
- `SETU_INTEGRATION.md` — Setu AA gateway adapter, current official auth contract, webhook contract & external-sandbox result
- `SETU_GITHUB_ACTIONS.md` — running the real Setu sandbox E2E on a GitHub-hosted runner (secrets, trigger, callback + human-approval requirements)
- `MARKET_DATA.md` — price freshness model and provider config
- `AI_ARCHITECTURE.md` — AI tool layer, context, hallucination prevention

## Security & Privacy

- `SECURITY.md` — authentication, authorization, encryption, secrets
- `PRIVACY.md` — data handling, logging, export, control

## Data portability

- `IMPORT_EXPORT.md` — JSON/CSV export, JSON import

## Testing & Quality

- `TEST_STRATEGY.md` — testing layers and principles
- `TEST_CASES.md` — automated + documented test cases
- `UAT.md` — user acceptance workflows

## Operations

- `DEPLOYMENT.md` — run, configure, reset
- `OPERATIONS_RUNBOOK.md` — runbook for running/monitoring
- `npm run config:setu` — Setu config validation (presence-only, never prints secrets)
- `npm run test:setu:sandbox` — credential-gated real Setu sandbox E2E (separate from CI)
- `DISASTER_RECOVERY.md` — backup / restore
- `TROUBLESHOOTING.md` — common issues
- `USER_GUIDE.md` — end-user walkthrough
- `RELEASE_NOTES.md` — release history
- `CHANGELOG.md` — change log

## Governance & Audit

- `REMEDIATION_BASELINE.md` — baseline audit at the start of the production pass
- `APPLICATION_AUDIT.md` — module audit matrix and findings
- `FINBOOM_PARITY.md` — FinBoom functional parity
- `DEFECTS.md` — defect log
- `ROADMAP.md` — phased roadmap
- `APPLICATION_HEALTH.md` — health scorecard
- `FINAL_PRODUCTION_AUDIT.md` — production-readiness audit (supersedes `FINAL_AUDIT_REPORT.md`)

> Copies of `APPLICATION_AUDIT.md`, `FINBOOM_PARITY.md`, `DEFECTS.md`, `ROADMAP.md`,
> `CHANGELOG.md`, `APPLICATION_HEALTH.md` and `FINAL_PRODUCTION_AUDIT.md` also live at
> the repository root for convenience.
