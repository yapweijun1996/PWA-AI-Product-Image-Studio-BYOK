# BYOK Security and Key-Custody Contract

**Risk class:** Security-critical. **Status:** proposed design; NOT reviewed or deployed. Official OpenAI guidance forbids placing long-lived API Keys in public browser bundles.

## Trust models

1. **Hosted trusted-gateway model (proposed P0):** Merchant shares provider API Key with trusted first-party backend *temporarily*. HTTPS protects transit; backend decrypts it transiently for provider calls. Merchant must trust site operator and deployment. **Not zero-knowledge.**
2. **User-hosted gateway alternative:** merchant configures own server secret and connects PWA to authenticated endpoint; no operator custody of user Key. Extra support/CORS/operations.
3. **Direct browser BYOK:** optional controlled developer experiment using disposable restricted Keys, but **not an acceptable default for a publicly operated product**.

## Production hosted sequence

```mermaid
sequenceDiagram
participant B as Browser/PWA
participant W as Worker API
participant S as Encrypted session vault
participant O as OpenAI
B->>W: Authenticate + CSRF + POST /session/connect {Key}
W->>S: Encrypt AES-GCM with server secret, principal binding and TTL
W-->>B: HttpOnly Secure SameSite cookie + status (no Key)
B->>W: POST /images/generate with cookie + CSRF + validated settings
W->>S: Fetch & decrypt scoped ephemeral Key
W->>O: Allowlisted API request with Authorization bearer
O-->>W: Image response + usage when available
W-->>B: Transient output and redacted metadata
B->>W: DELETE /session
W->>S: Delete entry + expire cookie
W-->>B: 204 No Content
```

## MUST controls

- HTTPS and same-origin cookie where deployed. Avoid cross-origin permissive CORS; CSRF token on state-changing requests, strict Origin/Fetch-Metadata handling as defense in depth.
- Require authenticated user for publicly shared gateway; connect, job and disconnect always bound to same principal and server-side session. Session IDs random, not guessable; cookie `HttpOnly; Secure; SameSite=Strict; Path=/api`. Limit reauth/session fixation.
- Encrypt at rest with server-only AEAD key binding, nonce uniqueness, AAD (`principalId`, schema version), Key ID for rotation. Store cipher only in short-lived vault; *Key plaintext only in controlled in-memory processing while needed*; do not promise instant zeroing of JS memory.
- Proposed TTL: 60 minutes idle or shorter; hard absolute TTL optional; revoke on disconnect and auth logout. Durable Objects alarm best-effort cleanup with request-time expiry check; do not rely solely on alarms as instantaneous deletion.
- No provider Key in browser localStorage, sessionStorage, IndexedDB, caches, URL, events, analytics, logs, exception messages, files, ZIP, client JSON, DOM after connect. Clear input and sensitive variables best-effort.
- Gateway validates upload MIME/size/pixels, model allowlist, `size`, `quality`, `background`, max request count and prompt length; no forwarding arbitrary URLs/headers or untrusted redirects.
- Authentication is not identical to knowing a valid OpenAI Key. Require per-user session, rate limits, abuse prevention, quotas/soft spend threshold and proper authorization for every job.
- Restrict metadata and redacted telemetry; no full plaintext prompts or product images by default. Incidents: revoke sessions and rotate encryption secrets, contact affected merchant where needed.
- Strong CSP (no arbitrary inline JS, unsafe eval or third-party injection). Dependency/CI secret scans. Avoid supply-chain exfiltration paths.

## Consent and key handling UX

Explain: Key is sent to operator-run backend and OpenAI; may generate provider charges. Provide "Connect", session TTL, "Disconnect / Forget key", delete local projects, and data flow notice. Do not falsely say "Key never leaves your device" for hosted gateway.

## Failure conditions

Vault unavailable/invalid: refuse cloud job, keep local work. Expired session: 401 and reconnect. Key invalid: provider auth error, never echo part of Key. Rate limit: stop and convey retry-after; do not attempt anonymous fallback using owner's key.

## Pre-release security evidence

Threat model, test principal isolation, cross-origin/CSRF, Key absence in all stores/exports/logs, forced session expiry, deletion, encryption rotation, malicious model/URL inputs, image bombs and provider-error redaction. Any Key leak is STOP-SHIP.
