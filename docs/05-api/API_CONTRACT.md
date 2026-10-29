# Gateway API Contract — Versioned Boundary

**Canonical machine-readable contract:** [`contracts/openapi.yaml`](../../contracts/openapi.yaml). This text explains semantics but does not override the OpenAPI schema. A loopback-only development authentication and provider-session subset is implemented; image and production endpoints remain unimplemented.

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
| `POST /api/v2/images/approvals` | After explicit user confirmation, create a short-lived authorization bound to the current sessions and canonical attempt payload; no provider call | 201, 400/401/403/409/413/429 |
| `POST /api/v2/images/generate` | Atomically consume the matching one-use approval with attempt reservation, then submit one independent attempt | 200 (P0 synchronous), 400/401/403/409/413/429/502/504 |
| `GET /api/v2/health` | Public non-sensitive service status, no account/dependency leak | 200/503 |

MVP is **synchronous generation** with local attempt state and a timeout UNKNOWN rule. The `202` route is reserved for an optional durable job mode once a server job store exists. Do not implement `GET /jobs/:id` as "working" until persistence exists; it is P1 extension.

The owner supplies, rotates and removes the OpenAI key through their self-hosted server's secret configuration, outside the browser API. The local process reads only whether `OPENAI_API_KEY` is configured at startup and makes no provider request; restart after changing configuration. Provider-side revocation is a separate owner action. The old draft `/api/v1` accepted browser key submission and is superseded by `/api/v2`; there is no deployed migration or compatibility endpoint.

The approval identifier is held only in transient browser memory and sent as `X-Attempt-Approval`; it is not given to Pi or persisted in local storage. The server binds it to both sessions, the attempt ID and the digest of the validated full payload, including disclosed estimates, and rejects expired, replayed or changed requests. Approval creation itself performs no provider call. This controls the authorized gateway workflow but cannot prove a human action when the frontend is compromised.

## Image operation selection

`operation="generate_scene"`: Image API generations with prompt to make environment alone. `operation="reference_edit"`: Image API edits with source image. `operation="concept"`: Image API generation explicitly labels non-faithful result. STRICT compositing takes place in browser; provider scene generation alone does not produce a truthful real SKU output.

A request carries `clientAttemptId`, `productId`, `styleId`, `lockMode`, an allowlisted `model`, explicit output settings, `prompt`, `promptVersion`, `sourceAssetHashes` and `estimatedUSD`. `maxEstimatedUSD`, `imageDataBase64`, `imageMimeType` and `outputFormat` are optional in the current schema. Verified facts may inform the prompt, but a separate `verifiedFacts` request field is not defined. The proposed `X-Client-Request-Id` header and body `clientAttemptId` are distinct fields; their relationship remains [OPEN-008](../00-governance/DECISION_REGISTER.md). Validate all inputs and do not treat client product facts as identity authorization; model-safety/content policy still applies.

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

## Billing model

Gateway should relay measured `usage` when provider returns it and label missing usage `null`; never invent 0 tokens. Cost estimate from public rate table and local assumptions is an estimate only; actual provider invoice is authoritative. Because Images and Responses have different cache behavior, include `apiRoute` and `pricingVersion` in cost evidence.

## Contract verification

- Validate OpenAPI as YAML, response examples and base path. Integration test actual requests against stub provider.
- Pre-release run one **approved, controlled** live request with a disposable restricted project Key, redacted log, expected model, sample output and cost record.
- Do not spend a real seller's Key in CI.
