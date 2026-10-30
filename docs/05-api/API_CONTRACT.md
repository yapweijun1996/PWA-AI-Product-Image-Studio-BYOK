# Gateway API Contract — Versioned Boundary

**Canonical machine-readable contract:** [`contracts/openapi.yaml`](../../contracts/openapi.yaml). This text explains semantics but does not override the OpenAPI schema. A loopback-only development authentication, provider-session and default-disabled seven-style scene subset is implemented; production endpoints and the wider image contract remain unimplemented.

## Routing and authentication

Default same-origin base `/api/v2`. Cookie-based authenticated session; `X-CSRF-Token` required for protected POST/DELETE. The local development gateway binds only to `127.0.0.1`, validates the exact host/origin, caps request bodies and rate-limits login and provider-session creation. Login uses an owner-generated random access token distinct from the provider key; only its SHA-256 verifier is configured server-side. It is not a production identity solution. Public production identity, HTTPS termination, durable limits and user-level throttling must be chosen and reviewed first. All `/api` responses set `Cache-Control: no-store`; no provider key is accepted from or returned to the browser.

| Endpoint | Behavior | Primary responses |
|---|---|---|
| `POST /api/v2/auth/login` | Local development only: authenticate a random owner access token, rotate app session and return its CSRF token | 200, 400, 401, 403, 413, 429, 503 |
| `GET /api/v2/auth/session` | Return the authenticated app session and its CSRF token | 200, 401 |
| `POST /api/v2/auth/logout` | Revoke the app session and any provider authorization | 204, 401, 403 |
| `POST /api/v2/session/connect` | Authorizes the current app session to use the server-configured provider; accepts only the provider identifier | 201 connected, 400 invalid, 401 unauthenticated, 429, 503 unconfigured |
| `GET /api/v2/session/status` | Returns whether a key is configured, connection status and authorization expiry; configuration alone does not prove key validity | 200, 401 |
| `DELETE /api/v2/session` | Revokes the current provider authorization and expires its cookie; it does not remove the server key or revoke it at OpenAI | 204, 401 |
| `GET /api/v2/images/revision` | Read the current non-secret review revision before the user chooses whether to authorize an attempt | 200, 401, 403, 503 |
| `POST /api/v2/images/approvals` | After explicit user confirmation, create a short-lived authorization bound to the current sessions, review revision and canonical attempt payload; no provider call | 201, 400/401/403/409/413/429 |
| `POST /api/v2/images/generate` | Consume the matching one-use approval, durably reserve the attempt before sending, then submit one independent attempt | 200 (P0 synchronous), 400/401/403/409/413/429/502/503/504 |
| `POST /api/v2/images/attempts/{clientAttemptId}/acknowledgement` | Explicitly record external billing review of an eligible attempt; preserve the original outcome and make no provider call | 200, 400/401/403/409/413/503 |
| `GET /api/v2/health` | Public non-sensitive service status, no account/dependency leak | 200/503 |

MVP is **synchronous generation** with local attempt state and a timeout UNKNOWN rule. The `202` route is reserved for an optional durable job mode once a server job store exists. Do not implement `GET /jobs/:id` as "working" until persistence exists; it is P1 extension.

The owner supplies, rotates and removes the OpenAI key through their self-hosted server's secret configuration, outside the browser API. The local process reads `OPENAI_API_KEY` at startup; generation is disabled by default. Explicitly setting `STUDIO_ENABLE_BILLABLE_IMAGES=1` also requires an existing absolute, owner-only `STUDIO_ATTEMPT_JOURNAL_DIRECTORY` and enables real billable provider requests when a key is configured. Use only synthetic credentials until the required isolation and security reviews pass; do not expose the development gateway. Restart after changing configuration. Provider-side revocation is a separate owner action. The old draft `/api/v1` accepted browser key submission and is superseded by `/api/v2`; there is no deployed migration or compatibility endpoint.

The approval identifier is held only in transient browser memory and sent as `X-Attempt-Approval`; it is not given to Pi or persisted in local storage. The server binds it to both sessions, the attempt ID, the review revision captured before consent and the digest of the validated full payload, including disclosed estimates. An intervening review invalidates the approval before provider dispatch. Approval creation itself performs no provider call. These controls do not prove a human action when the frontend is compromised.

## Image operation selection

`operation="generate_scene"`: Image API generations with prompt to make environment alone. `operation="reference_edit"`: Image API edits with source image. `operation="concept"`: Image API generation explicitly labels non-faithful result. STRICT compositing takes place in browser; provider scene generation alone does not produce a truthful real SKU output.

A request carries `clientAttemptId`, `productId`, `styleId`, `presetVersion`, `sceneContext`, `lockMode`, an allowlisted `model`, explicit output settings, `prompt`, `promptVersion`, `sourceAssetHashes`, `reviewRevision` and `estimatedUSD`. For the current local subset, the gateway reconstructs the exact versioned prompt from a canonical style and bounded context; only `STRICT`, `generate_scene`, `gpt-image-2.5-flare`, low quality, 1024×1024 PNG and one source hash are accepted. The original image and mask stay local, but the disclosed product name, category and selected confirmed facts are sent in the prompt. The user must review them before authorizing each independent call. Flat-lay with unknown source view is rejected before dispatch; `TOP` requires separate human confirmation in the local UI. The request and `clientAttemptId` use the same UUID per [ADR-008](../02-architecture/ADR.md).

Optional `maxEstimatedUSD` and `sessionLimitUSD` are user soft thresholds. A below-threshold limit requires its corresponding one-attempt `softLimitOverride` or `sessionLimitOverride`; the submitted `sessionPriorUSD` is a client-reported estimate, not server-verified spend. Every field is bound into the approval digest. The server's configured per-attempt estimate guard remains non-overridable by these user fields. Successful responses retain sanitized provider token usage when available; complete compatible usage can produce a snapshot-based `observedUSD` with `pricingSnapshot`, never an invoice.

## Error format

Standard JSON:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Image provider is busy. Retry later.",
    "retryable": false,
    "requestId": "request-redacted-demo",
    "outcome": "DEFINITIVE_FAILURE",
    "retryAfterSeconds": 30
  }
}
```

`outcome` may be `DEFINITIVE_FAILURE` or `UNKNOWN`. Never echo bearer token, raw provider error body or private image to the error payload. `requestId` is non-sensitive correlation, distinct from user key.

The local implementation returns `ATTEMPT_BUSY` with `DEFINITIVE_FAILURE` before sending when another attempt is active or requires review. Other conflicts are conservatively treated as UNKNOWN by the client. An authenticated, CSRF-protected acknowledgement records explicit review without resending: UNKNOWN remains UNKNOWN; a definitive outcome and its saved scene remain intact. If a durable terminal result's marker could not be cleared, or a provider supplies an invalid or unsupported `Retry-After`, `X-Studio-Cleanup-Pending: 1` flags a retained marker requiring external review. Any later request needs a new UUID and separate approval. `RECOVERY_REQUIRED` means no image request was sent but journal evidence may need owner review. Legacy unowned markers and interruptions without a durable result remain blocked: never delete records to bypass that protection. Provider HTTP 429 is reported as `PROVIDER_LIMIT`, which can represent rate limits, quota or billing; bounded `Retry-After` is a minimum wait, not a guarantee that waiting resolves it.

## Billing model

Gateway should relay measured `usage` when provider returns it and label missing usage `null`; never invent 0 tokens. Cost estimate from public rate table and local assumptions is an estimate only; actual provider invoice is authoritative. Because Images and Responses have different cache behavior, include `apiRoute` and `pricingVersion` in cost evidence.

## Contract verification

- Validate OpenAPI as YAML, response examples and base path. Integration test actual requests against stub provider.
- Pre-release run one **approved, controlled** live request with a disposable restricted project Key, redacted log, expected model, sample output and cost record.
- Do not spend a real seller's Key in CI.
