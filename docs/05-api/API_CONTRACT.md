# Gateway API Contract — Versioned Boundary

**Canonical machine-readable proposal:** [`contracts/openapi.yaml`](../../contracts/openapi.yaml). This text explains semantics but does not override the OpenAPI schema. The API is **not implemented**.

## Routing and authentication

Default same-origin base `/api/v1`. Cookie-based authenticated session; `X-CSRF-Token` required for POST/DELETE. Request body and rate limits enforced in backend. For public production, identity verification and user-level throttling must be chosen first. All `/api` responses set `Cache-Control: no-store`; no secrets in JSON output.

| Endpoint | Behavior | Primary responses |
|---|---|---|
| `POST /api/v1/session/connect` | Accepts Key over HTTPS; encrypts ephemeral server vault entry; sets HttpOnly cookie | 201 connected, 400 invalid, 401 unauthenticated, 429 |
| `GET /api/v1/session/status` | Returns connected/expiry and safe provider display name only | 200, 401 |
| `DELETE /api/v1/session` | Revokes Key session and expires cookie | 204, 401 |
| `POST /api/v1/images/generate` | One target style, independent attempt; provider generation or edit route chosen server-side | 200 (P0 synchronous), 400/401/403/409/413/429/502/504 |
| `GET /api/v1/health` | Public non-sensitive service status, no account/dependency leak | 200/503 |

MVP is **synchronous generation** with local attempt state and a timeout UNKNOWN rule. The `202` route is reserved for an optional durable job mode once a server job store exists. Do not implement `GET /jobs/:id` as "working" until persistence exists; it is P1 extension.

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
