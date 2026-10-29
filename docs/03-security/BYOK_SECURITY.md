# BYOK Security and Key-Custody Contract

**Risk class:** Security-critical. **Status:** proposed design; NOT reviewed or deployed. Official OpenAI guidance forbids placing long-lived API Keys in public browser bundles.

## Trust models

1. **User-hosted gateway (selected direction):** The seller configures the provider key on their own server, outside the browser. The application uses authenticated provider authorization sessions; disconnect does not remove server configuration or revoke the provider key.
2. **Hosted trusted-gateway model (alternative, not approved):** Merchant shares the provider key with a trusted first-party backend temporarily; public custody requires separate owner approval, authentication and security review.
3. **Direct browser BYOK:** optional controlled developer experiment using disposable restricted Keys, but **not an acceptable default for a publicly operated product**.

## Selected self-hosted flow

1. The owner configures the provider key on their server using an approved secret mechanism; provisioning, rotation and removal mechanics are still open.
2. The browser authenticates to the same-origin gateway and requests a short-lived provider authorization using only the provider identifier and CSRF token. The provider key never enters the browser request or response.
3. After explicit cost approval, the gateway validates and sends an allowlisted provider request. The restricted Pi host must not receive the key or gain general shell, filesystem or arbitrary network access.
4. Disconnect revokes the provider authorization session. Removing the server configuration and revoking the key at OpenAI are separate owner actions.

The proposed `/api/v2` contract describes this flow; no implementation or security verification is claimed. The prior hosted encrypted-vault sequence is not the selected initial path.

## MUST controls

- HTTPS and same-origin cookie where deployed. Avoid cross-origin permissive CORS; CSRF token on state-changing requests, strict Origin/Fetch-Metadata handling as defense in depth.
- Require an authenticated user in every environment; local loopback is not authentication. Connect, approval, job and disconnect are bound to the same principal and server-side session. Reject unauthorized LAN/public exposure and enforce exact Origin/Host and CSRF checks. Session IDs are random, not guessable; deployed cookies are `HttpOnly; Secure; SameSite=Strict; Path=/api`. Limit reauth/session fixation.
- Protect owner-configured server secrets from source control, browser code, logs, agent contexts and unauthorized processes; use least privilege and a reviewed provisioning, rotation and deletion procedure. Do not assume a provider session expiry deletes the configured key.
- Proposed provider authorization TTL: 60 minutes idle or shorter; revoke on disconnect and auth logout. Enforce expiry at request time; cleanup timers are not a substitute.
- No provider key in browser input, DOM, localStorage, sessionStorage, IndexedDB, caches, URL, events, analytics, logs, exception messages, ZIP or client JSON. Server secrets may be present only in the owner's protected server configuration and transient authorized provider processing.
- Gateway validates upload MIME/size/pixels, model allowlist, `size`, `quality`, `background`, max request count and prompt length; no forwarding arbitrary URLs/headers or untrusted redirects.
- Authentication is not identical to knowing a valid OpenAI Key. Require per-user session, rate limits, abuse prevention, quotas/soft spend threshold and proper authorization for every job.
- Require an explicit per-attempt user decision and a one-use, short-lived server authorization bound to the app/provider sessions and canonical attempt payload; atomically consume it with the attempt reservation. A compromised frontend can impersonate user intent, so this is not a substitute for authentication or a claim of human-presence proof.
- Run Pi separately from the key-holding process under reviewed OS-level isolation. An in-process tool allowlist alone does not isolate secrets. Pi must not receive browser session, CSRF or approval credentials or issue approvals; the trusted gateway mediates approved session/attempt-bound work. Do not connect a real key before the isolation design and tests pass.
- Restrict metadata and redacted telemetry; no full plaintext prompts or product images by default. Incidents: revoke sessions, rotate the configured provider key, and notify affected users where appropriate.
- Strong CSP (no arbitrary inline JS, unsafe eval or third-party injection). Dependency/CI secret scans. Avoid supply-chain exfiltration paths.

## Consent and key handling UX

Explain that the seller configures the key on their own server and that OpenAI receives submitted prompts and images, potentially incurring charges. Show provider authorization status, session expiry and Disconnect. Explicitly distinguish disconnect from removing server configuration or revoking the provider key.

## Failure conditions

Missing server configuration or invalid provider authorization: refuse cloud jobs and keep local work. Expired session: 401 and reconnect. Key invalid: provider auth error, never echo part of the key. Rate limit: stop and convey retry-after; no fallback to another key.

## Pre-release security evidence

Threat model; principal isolation; cross-origin and CSRF tests; key absence from browser stores, exports, agent context and logs; forced session expiry and deletion; server-key rotation/removal procedure; malicious model/URL inputs, image bombs and provider-error redaction. Any key leak is STOP-SHIP.
