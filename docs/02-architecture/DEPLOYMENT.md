# Deployment and Trust Boundary Options

## Recommended but NOT approved as production architecture

**Option A:** Cloudflare Pages (React static) with same-origin Cloudflare Worker `/api/*` gateway and an authenticated short-lived encrypted user-key session store (e.g. Durable Objects). PWA and gateway share hostname to simplify cookie/CSRF and avoid cross-domain iOS cookie behavior. This still means operator-hosted code receives plaintext Key transiently and sends the request to OpenAI.

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

## Production release gates

- Preview deployment branch built and signed/tagged; verify URLs, CSP, session cookies, `/api` authz, secret access, error handling, request body limits, telemetry redaction.
- Check cost ceilings and user messaging, provider model availability, account verification requirements and API version.
- Validate SW N→N+1, offline, mobile/iOS, image pipeline multi-category pilot and rollback.
- Production publish requires explicit approval; SSOT ZIP creation does not grant permission to deploy.

## Rollback

Static PWA rollback must account for Service Worker controller/cache state and IndexedDB schema compatibility. Keep down-level data readable or snapshot before migration. Revoke leaked secrets separately from code rollback.
