# PWA-AI-Product-Image-Studio-BYOK

**Version:** 2.0.0 (documentation baseline) · **Date:** 2026-10-30 (Asia/Singapore)
**Status:** limited application shell; product workflows and release remain incomplete · **Repository:** `yapweijun1996/PWA-AI-Product-Image-Studio-BYOK`
**Product:** Local-first, BYOK AI product photography PWA with seven category-adaptive styles and truthful product identity protection.

> The `app/` directory provides local SKU projects, user-confirmed facts, immutable source-image upload, a portable backup for this currently supported data, a static-only offline/update worker, and a loopback-only development gateway for app/provider sessions. The gateway makes no provider requests and has no connection UI; it is not approved for production. Backup of future masks, jobs, outputs, QA and receipts and migration from older schema versions remain unimplemented; unsupported data is rejected rather than omitted. Generation remains unimplemented. Draft protection has been exercised for product forms and selected source previews, but real mask/transaction preservation remains unverified. No production deployment, real-brand fidelity or complete application E2E is claimed. See the [task ledger](docs/08-delivery/TASK.md) and [evidence status](docs/00-governance/EVIDENCE_STATUS.md).

## Start here

1. [中文使用说明](START_HERE_中文.md)
2. [SSOT index](docs/INDEX.md) and [governance / precedence](docs/00-governance/SSOT_POLICY.md)
3. [Decisions and unresolved choices](docs/00-governance/DECISION_REGISTER.md)
4. [Product requirements](docs/01-product/PRD.md) + [traceable requirement IDs](docs/00-governance/REQUIREMENTS_TRACEABILITY.md)
5. [Architecture](docs/02-architecture/SYSTEM_ARCHITECTURE.md), [BYOK security](docs/03-security/BYOK_SECURITY.md), [OpenAPI contract](contracts/openapi.yaml)
6. [Seven style engine](docs/06-ai/SEVEN_STYLE_ENGINE.md), [Brand Lock](docs/06-ai/BRAND_LOCK_ENGINE.md), [QA](docs/06-ai/VISUAL_QA.md)
7. [E2E test cases](docs/07-quality/E2E_ACCEPTANCE.md), [release gate](docs/07-quality/RELEASE_GATES.md), [task backlog](docs/08-delivery/TASK.md)
8. Validate the documentation pack using [scripts/README.md](scripts/README.md).

## Normative status tags

- **CONFIRMED:** user-specified naming, BYOK direction, seven-style integration, KB-PWA standard adoption; not proof of implementation.
- **PROPOSED:** recommended implementation design, technology choices, interfaces, targets. Change only through ADR / explicit approval.
- **REQUIRES VERIFICATION:** vendor-specific API/limits/rates and behavior may change; verify prior to coding/live use.
- **NOT IMPLEMENTED / NOT TESTED:** product workflows without corresponding code and test evidence.

## SSOT owner map

| Concern | Only canonical owner |
|---|---|
| Vision, use cases, FR/NFR | `docs/01-product/PRD.md` and `docs/00-governance/REQUIREMENTS_TRACEABILITY.md` |
| Decision status | `docs/00-governance/DECISION_REGISTER.md` |
| Architecture and state diagrams | `docs/02-architecture/` |
| BYOK threat controls | `docs/03-security/` |
| API shapes | `contracts/openapi.yaml` (proposed versioned interface) |
| JSON entities | `contracts/schemas/` |
| 7 preset IDs | `contracts/style-presets.json` |
| Prompt methodology | `docs/06-ai/SEVEN_STYLE_ENGINE.md` |
| Visual QA formula | `docs/06-ai/VISUAL_QA.md` |
| Milestones, executable tasks | `docs/08-delivery/ROADMAP.md`, `docs/08-delivery/TASK.md` |
| Vendor facts and effective date | `docs/09-research/SOURCES.md` |

Root `SPEC.md`, `DESIGN.md`, `EPIC.md`, `ROADMAP.md` and `TASK.md` are **pointers**, not copies of normative content. They exist for code agents expecting conventional names.

## Run the application shell

```bash
cd app
npm ci
npm run dev
```

`npm run build` type-checks and builds the shell and worker; `npm test` runs image-header, backup and local gateway security regression tests on Node 22.12 or newer (Node 22/23 may warn that type stripping is experimental). Static hosting needs HTTPS (or localhost), an `index.html` fallback for application routes, and revalidation of `/sw.js` and HTML rather than immutable caching. The shell can load offline only after a successful online installation. Browser data may be evicted: export backups to a trusted location. Backups are unencrypted and can include confidential photos and EXIF; see the [backup contract](docs/04-data/EXPORT_IMPORT.md) for supported data and limits.

For a **local synthetic-data development gateway**, first build the app. Generate a random 32-byte base64url owner access token and its SHA-256 hex digest with a trusted local tool. Treat the token as a credential: keep it out of source, shell history, logs, URLs and provider-key fields. Supply only the digest as `STUDIO_ACCESS_TOKEN_SHA256` and, if testing configured-provider status, set `OPENAI_API_KEY` to a synthetic value before `npm run gateway`. Open `http://127.0.0.1:4173/`; `STUDIO_PORT` may select another loopback port. The gateway does not load `.env` files or call OpenAI. It has no login/connection UI yet; its API is described in the [gateway contract](docs/05-api/API_CONTRACT.md). Never expose this development gateway to a LAN or public network, or treat it as a production authentication or key-management system. Sessions are invalidated on restart.


## Machine-readable content

`contracts/openapi.yaml`, `contracts/schemas/*.json`, `contracts/style-presets.json`, `fixtures/*.json`, `package-manifest.json`, `SHA256SUMS.txt`, `validation-report.json`, `scripts/validate_ssot.py`.

**Documentation package scope:** docs, contracts, fixtures and validators only; executable application source lives separately in `app/`. Neither the documentation checks nor the shell establish production security, real image fidelity or release readiness.
