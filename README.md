# PWA-AI-Product-Image-Studio-BYOK

**Version:** 7.0.0 (documentation baseline) · **Date:** 2026-10-30 (Asia/Singapore)
**Status:** limited application shell; product workflows and release remain incomplete · **Repository:** `yapweijun1996/PWA-AI-Product-Image-Studio-BYOK`
**Product:** Local-first, BYOK AI product photography PWA with seven category-adaptive styles and truthful product identity protection.

> The `app/` directory provides local SKU projects, confirmed facts, immutable source-image upload, manual masks, full-project backup, an offline/update worker and a loopback-only development gateway. A default-disabled seven-style queue can produce separately authorized, unapproved scenes and locally composite selected source pixels. **Known fidelity gap:** an incorrect mask can expose background content over product labels; selected protected areas are checked, but the app cannot determine whether every required label has been selected or remains readable. See [BUG-007](BUG.md); do not treat existing approvals as proof of protected-region coverage. The displayed prompt sends the product name, category and selected confirmed facts to the provider; original images and masks remain local. Human style-specific review and a separate decision are required before conversion and output-only ZIP export; the output bundle is separate from the full project backup. Imported review and attempt history is untrusted; restored outputs require fresh local review. Synthetic tests do not establish real-SKU fidelity, production security or installed-device acceptance. The self-hosted gateway retains its isolation/security release gates. Pages browser BYOK is separately owner-authorized; real-provider acceptance is still unverified. Eligible local UNKNOWN attempts can be acknowledged without rewriting their outcome; generation and interrupted-submission review require browser Web Locks.

The style queue displays the number of potentially billable calls and supports estimate-only per-attempt and browser-tab session soft limits with separate one-attempt overrides. Synthetic responses can record sanitized usage and a snapshot-based estimate; these are not the provider invoice or an account-wide spending cap.

Per-style retry preserves the previous attempt and uses a fresh consent, UUID and gateway approval; a reviewed UNKNOWN is not rewritten as success. The history can compare same-style scenes and saved local composites, and approved output provenance includes the immediate retry parent. A recorded rate-limit delay is enforced only within the same browser profile; it is not a provider-wide cap.

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

Open `http://127.0.0.1:4173/settings`, sign in with the local app access token, and connect the synthetic provider session. Do not enter a provider API key in the browser. `STUDIO_PORT` may select another loopback port. The gateway does not load `.env` files. Billable generation is disabled by default; explicitly enabling it with a configured provider key can send real requests and incur charges. Do not enable it or use real keys until the required isolation and security reviews have passed. See the [gateway contract](docs/05-api/API_CONTRACT.md). Never expose this development gateway to a LAN or public network, or treat it as a production authentication or key-management system. Sessions are invalidated on restart. The development gateway is reachable only from the same device at its `127.0.0.1` origin; on a phone that address refers to the phone itself. Remote mobile gateway access is not yet implemented. Projects are stored separately in each browser.


## Machine-readable content

`contracts/openapi.yaml`, `contracts/schemas/*.json`, `contracts/style-presets.json`, `fixtures/*.json`, `package-manifest.json`, `SHA256SUMS.txt`, `validation-report.json`, `scripts/validate_ssot.py`.

**Documentation package scope:** docs, contracts, fixtures and validators only; executable application source lives separately in `app/`. Neither the documentation checks nor the shell establish production security, real image fidelity or release readiness.

## GitHub Pages static preview

`.github/workflows/pages.yml` tests, builds and deploys the static preview on pushes to `main` or manual dispatch on `main`. Pages must use the GitHub Actions publishing source. Only `app/dist` is uploaded; no provider credentials are needed. The preview uses `#/` routes because Pages has no SPA fallback. The `pages` build uses browser BYOK through AI SDK and does not contact the development gateway.

Preview URL: https://yapweijun1996.github.io/PWA-AI-Product-Image-Studio-BYOK/

Local equivalent: from `app/`, run `npm ci`, `npm test`, `node --test tests/browser/pages-preview.test.mjs`, and `npm run build -- --mode pages --base /PWA-AI-Product-Image-Studio-BYOK/`. The browser test requires Chrome/Chromium. Normal `npm run build` retains root hosting and browser-history routing for the local gateway.

On Pages, open Settings and enter your own OpenAI key to generate scenes directly from this tab. The key is saved in a dedicated IndexedDB database until removed (DEC-021). Reload restores the key but requires new session spending consent. Browser extensions/scripts can read stored credentials; use a dedicated project key and provider spending limits. A successful preview deployment does not complete production release task T-090. To roll back, redeploy a reviewed compatible revision; preserve local backups and database compatibility, and let users activate PWA updates explicitly.

### Browser BYOK on GitHub Pages

1. Open Settings, enter your OpenAI API key, choose a session estimate limit, accept the upload consent and select **Set up session**. The key is saved on this device without separate password encryption; saving does not verify credentials or make a paid request.
2. Upload one product photo to produce six generated looks and one local visible detail crop. STRICT is the default; optional Reference-guided supports the main photo plus up to two additional views with separate transmission consent. Download finished images individually or as a ZIP. The Advanced workspace retains the manual mask/review workflow.
3. AI SDK sends STRICT requests only to `https://api.openai.com/v1/images/generations`; optional Reference-guided sends normalized PNG copies only to `https://api.openai.com/v1/images/edits`. No automatic retry, cookies or redirects. STRICT photos stay local; reference edits can change branding and geometry and are labeled concepts. Estimates include reference-input allowances and are not provider spending caps.
4. Reload restores the saved key without restoring spending authorization. Review interrupted requests before authorizing a new session.
5. **Remove saved key** deletes the dedicated credential record and clears active keys in open tabs. It cannot undo provider billing. Keys are excluded from image databases, backups, caches and exports.

CORS preflight was observed to permit the Pages origin and authorization/content-type headers. This is not a successful paid generation or Safari/iOS acceptance result. Account/model permissions, network restrictions and provider changes can still block calls. Browser bookkeeping is local and user-editable; it is not gateway authentication, server-enforced quotas or independent billing proof. Corrupt history/storage failure blocks requests; preserve it for recovery instead of deleting unresolved evidence.

## Upload-only Pages studio

Open the Pages homepage. In Settings, set your key, session estimate limit and automatic-processing consent once for this tab. Then upload one product photo: automatic cutout, six independent background requests and a free local detail crop run without product forms, mask editing or approval steps. Each complete PNG appears immediately; download one or a ZIP of finished images. The lightweight cutout model is bundled and verified locally; STRICT source photos are not sent for cutout or scene generation. Reference-guided instead sends up to three metadata-stripped PNG copies, bounded to 1024 px per edge, after explicit tab-only consent. The original files remain local; reference generation can alter product details. No unseen product facts or faithful overhead views are inferred.

Automatically checked outputs are distinct from human-approved Advanced workspace exports. They carry machine-check evidence and are not a brand-fidelity certificate. Partial failures keep completed images; UNKNOWN pauses later paid requests and is never retried automatically. Exceptional billing/wait recovery is in Settings. The homepage's previous-uploads section retains originals and saved results. Existing projects and full legacy backups remain under Advanced workspace; automatic output ZIPs are not editable-project backups. Local storage may be evicted, so download results and originals you need.

The automatic studio uses its own local IndexedDB database; version 2 preserves old automatic runs and blocks older v1 clients from mislabeling new reference concepts. Advanced projects are unchanged. Downgrade requires a reviewed compatibility plan; never delete history to reopen an old client. The session estimate limit reserves all six paid estimates, including each reference-input allowance, before the first send and retains reservations for requests not sent after a failure. It is not a provider charge or hard billing cap. The square Detail crop uses measured visible source pixels; enlargement adds no detail. Tabletop retains the source angle. Billboard places a full text-free ad into a local display mockup; photographic placement and lighting are not automatically assessed. See [A+C evidence and limits](docs/09-research/QUALITY_REFERENCE_IMPLEMENTATION_2026-11-12.md). A real-model browser check runs with `STUDIO_MATTE_SMOKE=1 node --test tests/browser/pages-preview.test.mjs` from `app/`; provider calls in that check are synthetic. See the [cutout experiment](docs/09-research/AUTO_CUTOUT_EXPERIMENT.md) for the rejected large-model result, selected model identity and verification limits.
