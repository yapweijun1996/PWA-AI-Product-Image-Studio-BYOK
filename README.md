# PWA-AI-Product-Image-Studio-BYOK

**Version:** 2.0.0 (documentation baseline) · **Date:** 2026-10-30 (Asia/Singapore)
**Status:** limited application shell; product workflows and release remain incomplete · **Repository:** `yapweijun1996/PWA-AI-Product-Image-Studio-BYOK`
**Product:** Local-first, BYOK AI product photography PWA with seven category-adaptive styles and truthful product identity protection.

> The `app/` directory provides local SKU projects, confirmed facts, immutable source-image upload, manual mask editing, subset backup, an offline/update worker and a loopback-only development gateway. A default-disabled Studio path can generate one **unapproved empty background**, not a finished product image; only synthetic-provider browser tests have exercised this path. Do not enable billable generation or use a real key before the required isolation and security reviews. Jobs, outputs, QA and receipts cannot yet be backed up, and the app refuses backup rather than omitting them; back up before generating. UNKNOWN attempts cannot yet be reconciled in the UI. Composition, QA, approved export, real-device acceptance and production release remain open.

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

`npm run build` type-checks and builds the shell and workers; `npm test` runs image-header, mask, backup, gateway and Studio-attempt regression tests on Node 22.12 or newer (Node 22/23 may warn that type stripping is experimental). Static hosting needs HTTPS (or localhost), an `index.html` fallback for application routes, and revalidation of `/sw.js` and HTML rather than immutable caching. The shell can load offline only after a successful online installation. Browser data may be evicted: export supported backups to a trusted location. Backups are unencrypted and can include confidential photos and EXIF; see the [backup contract](docs/04-data/EXPORT_IMPORT.md) for supported data and limits.

For a **local synthetic-data development gateway**, first build the app. The following command generates a random app access token and its SHA-256 digest. Its output is sensitive: do not copy the token into source, logs, URLs, shell history or provider-key fields. This token is not an OpenAI API key. The command avoids the `sk-` prefix so it is not mistaken for one.

```bash
node -e 'const c=require("node:crypto");let t;do{t=c.randomBytes(32).toString("base64url")}while(t.toLowerCase().startsWith("sk-"));console.log("Local app access token:",t);console.log("SHA-256:",c.createHash("sha256").update(t).digest("hex"))'
read -r -p 'SHA-256 digest: ' STUDIO_ACCESS_TOKEN_SHA256
export STUDIO_ACCESS_TOKEN_SHA256
OPENAI_API_KEY=synthetic-local-only npm run gateway
```

Open `http://127.0.0.1:4173/settings`, sign in with the local app access token, and connect the synthetic provider session. Do not enter a provider API key in the browser. `STUDIO_PORT` may select another loopback port. The gateway does not load `.env` files. Billable generation is disabled by default; explicitly enabling it with a configured provider key can send real requests and incur charges. Do not enable it or use real keys until the required isolation and security reviews have passed. See the [gateway contract](docs/05-api/API_CONTRACT.md). Never expose this development gateway to a LAN or public network, or treat it as a production authentication or key-management system. Sessions are invalidated on restart.


## Machine-readable content

`contracts/openapi.yaml`, `contracts/schemas/*.json`, `contracts/style-presets.json`, `fixtures/*.json`, `package-manifest.json`, `SHA256SUMS.txt`, `validation-report.json`, `scripts/validate_ssot.py`.

**Documentation package scope:** docs, contracts, fixtures and validators only; executable application source lives separately in `app/`. Neither the documentation checks nor the shell establish production security, real image fidelity or release readiness.
