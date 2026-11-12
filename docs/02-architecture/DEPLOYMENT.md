# Deployment and Trust Boundary Options

## Selected direction and hosted alternative

The owner selected a self-hosted gateway with the provider key configured on their own server. Runtime, identity, secure secret operations and deployment remain subject to review and are not approved for production. No browser key submission is part of the selected path.

**Option A, not selected:** Cloudflare Pages (React static) with same-origin Cloudflare Worker `/api/*` gateway and an authenticated short-lived encrypted user-key session store (e.g. Durable Objects). This alternative requires separate owner approval for hosted key custody.

## Other options

| Option | Benefits | Risks / restriction |
|---|---|---|
| A: Pages + Worker | CDN, same origin, no dedicated VM, straightforward static deploy | Security of custody, Worker memory/CPU/cost, persistence and operator trust |
| B: user self-hosted gateway | User controls secret + infrastructure | Harder onboarding, config/CORS and support responsibility |
| C: public Github Pages + separate Gateway | Simple public static preview | Cross-site cookie/CORS/privacy complexity; **demo without real key only** until security review |
| D: direct browser OpenAI API Key | Minimal infrastructure | Not acceptable public production default; officially discouraged by OpenAI |

## Cloudflare resource constraints (verify again on deployment)

Official docs as of 2026-10 list Workers memory 128 MB and Free-plan CPU budget 10 ms/request; account-plan upload body limits and 413 rejection apply. Browser does cutouts and compositing; Worker should authenticate, validate, proxy/transiently stream images and avoid large JSON copies. Network wait differs from CPU usage. See [sources](../09-research/SOURCES.md).

## Environments

- `local`: stubbed provider, synthetic sources; isolated fake Key with zero live network to external API.
- `preview`: restricted identity; staging secrets and dedicated test key; sanitized fixtures; domain isolated from prod.
- `production`: authenticated users, approved custody/retention, redacted traces, rate limiting and owner-operated deployment review.

The default static build expects same-origin root deployment, SPA navigation fallback to `index.html`, HTTPS (localhost for development), and revalidation of `/sw.js` and HTML on every visit. Hashed JS/CSS may be served as immutable. CSP must allow local `blob:` images for previews while disallowing `unsafe-eval`; a scoped Chromium check exercised this policy. Only build-generated shell assets are precached; API responses and seller images are not. This is not approval to deploy.

## Production release gates

- Preview deployment branch built and signed/tagged; verify URLs, CSP, session cookies, `/api` authz, secret access, error handling, request body limits, telemetry redaction.
- Check cost ceilings and user messaging, provider model availability, account verification requirements and API version.
- Validate SW N→N+1, offline, mobile/iOS, image pipeline multi-category pilot and rollback.
- Production publish requires explicit approval; SSOT ZIP creation does not grant permission to deploy.

## Rollback

Static PWA rollback must account for Service Worker controller/cache state and IndexedDB schema compatibility. Keep down-level data readable or snapshot before migration. Revoke leaked secrets separately from code rollback.

## Authorized GitHub Pages preview — 2026-11-11

The owner selected GitHub Pages for a static preview and authorized GitHub Actions deployment, commit and push to main. The workflow publishes only `app/dist`, after unit and Pages browser checks, using Node 24 on Ubuntu 24.04 and pinned official Actions. The `pages` build uses a repository base path, hash routing, relative manifest URLs, scoped worker registration and scoped caches. After DEC-019, Pages uses direct browser BYOK through AI SDK and never contacts the development gateway, even on loopback. Default root builds retain existing routing and cache names. No provider secret is provisioned by this workflow.

Local Chromium verifies direct settings navigation, reload, worker scope, manifest start URL, offline reload and absence of gateway requests. Hosted Actions and live URL acceptance must be observed separately. This is preview acceptance only; T-090 production gates remain open. Rollback requires a reviewed database-compatible artifact and explicit user-driven worker activation; do not silently reload an editor.

### Pages BYOK update — 2026-11-11

The owner subsequently authorized in-browser key entry and direct OpenAI generation (DEC-019 / ADR-019). Settings holds the key in tab memory only; `pages` generation reuses local attempt, composition, review and export paths through a browser transport. The workflow supplies no key and no server key vault is involved. Existing preview URLs now offer BYOK generation rather than only a disconnected static shell. Actual paid generation remains unverified until separately authorized and observed.

### Automatic Pages studio — 2026-11-11

DEC-020 / ADR-020 replace the Pages landing flow with upload-to-output automation. Settings now establishes current-tab key, rights acknowledgement, seven-call consent and a session estimate limit. The workflow verifies transparent-source and actual bundled U2NETP model paths using synthetic photos and mocked image responses. U2NETP weights, license and SHA-256 ship as static assets; ONNX WASM/module assets and the model are included in the Pages shell cache. Root gateway builds keep their original static-cache whitelist and do not require the new model assets for installation.

The new `image-studio-automatic` database is separate from legacy projects and is not rolled back by changing static artifacts. Preserve both databases and request uncertainty markers. Automatic ZIPs are output bundles with technical evidence, not legacy human-approved exports or editable-project backups. A rollback to the prior compatible Pages build restores the old landing screen; user-driven worker activation remains required.

## 2026-11-12 storage amendment — DEC-021

For the Pages build, the owner explicitly requested IndexedDB persistence. This supersedes earlier memory-only statements in this document. The credential lives only in `image-studio-credentials`, separate from image/project databases and excluded from all backups/exports/caches. Same-origin scripts and browser extensions can read it; no password-based encryption is claimed. Reload restores the key, never spending authorization. Explicit removal deletes the record and invalidates open tabs. Gateway custody remains unchanged. No live paid verification was authorized by this storage change.
