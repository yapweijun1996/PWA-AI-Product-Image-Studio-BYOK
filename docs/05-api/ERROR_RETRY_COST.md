# Error Handling, Retry Policy and Billing Reconciliation

## Error mapping

| Event | App state | Automatic retry? | User action |
|---|---|---|---|
| Invalid settings / image 400/413 | FAILED (definitive) | NO | Correct source or size |
| BYOK missing/expired 401 | PAUSED, not submitted | NO | Reconnect |
| Provider authorization 401/403 | FAILED | NO | Check key/project/model entitlement |
| Rate limit 429 before confirmed acceptance | FAILED/PAUSED | Optional bounded *only if no possible submission* | Show `Retry-After`, consent before paid retry |
| HTTP 502/504 from proxy after possible submission | UNKNOWN | **NO** | Show possible charge warning |
| Browser closes mid-run | UNKNOWN until evidence | **NO** | Reopen local attempts; inspect provider usage if possible |
| Returned image fails decode / save | FAILED with remote cost possible | NO | Preserve provider request ID and recovery plan |
| QA rejects output | REJECTED | NO | Edit scene, source mask or explicit paid Retry |

## Billing concepts

`estimatedUSD`: before-call model, dimensions, quality and assumed token count; never labeled exact. `observedUsage`: token details when provider returns them. `observedUSD`: calculated only if rates and usage are sufficient, with pricing snapshot; otherwise `null` and "unknown". Provider bill remains the authoritative actual charge.

## Budget guardrails

1. User soft session limit and per-attempt budget stored as non-secret settings; before each chargeable attempt require explicit consent.
2. Gateway enforces count, concurrency, body/prompt restrictions and account rate limits, preventing unlimited calls; may enforce conservative estimated cost threshold but cannot guarantee exact token spend.
3. Recommend provider-side project alerts/limits. Do not claim a provider hard cap without validating account-level semantics. Batch mode must display estimated *total* across styles and pipeline stages.
4. Never silently regenerate or call another model because previous attempt failed.

## Estimation formula

For **Standard** rates as of snapshot (USD):

`estimate = text_input_tokens * 5 / 1,000,000 + image_input_tokens * 8 / 1,000,000 + image_output_tokens * 30 / 1,000,000`.

This is a scenario, not deterministic token prediction. Caching and batch discounts do not apply to every route; account charges can include mainline Responses model tokens, retries and other features.

## Observability / vendor correlation

Keep `clientAttemptId`, `providerRequestId` if received, `outcome`, `submittedAt`, rate-limit metadata without secrets, pricing snapshot, `usage` optional, `errorCode`. Do not log full prompt if it can contain source labels or confidential SKU descriptions. Escalation policy for UNKNOWN: ask user to inspect provider dashboard/charges before consent to retry.
