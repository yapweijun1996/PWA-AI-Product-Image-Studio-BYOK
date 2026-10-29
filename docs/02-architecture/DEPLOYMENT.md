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

The current static shell expects same-origin root deployment, SPA navigation fallback to `index.html`, HTTPS (localhost for development), and revalidation of `/sw.js` and HTML on every visit. Hashed JS/CSS may be served as immutable. Only build-generated shell assets are precached; API responses and seller images are not. This is not approval to deploy.

## Production release gates

- Preview deployment branch built and signed/tagged; verify URLs, CSP, session cookies, `/api` authz, secret access, error handling, request body limits, telemetry redaction.
- Check cost ceilings and user messaging, provider model availability, account verification requirements and API version.
- Validate SW N→N+1, offline, mobile/iOS, image pipeline multi-category pilot and rollback.
- Production publish requires explicit approval; SSOT ZIP creation does not grant permission to deploy.

## Rollback

Static PWA rollback must account for Service Worker controller/cache state and IndexedDB schema compatibility. Keep down-level data readable or snapshot before migration. Revoke leaked secrets separately from code rollback.
