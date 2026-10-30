# Error Handling, Retry Policy and Billing Reconciliation

## Error mapping

| Event | App state | Automatic retry? | User action |
|---|---|---|---|
| Invalid settings / image 400/413 | FAILED (definitive) | NO | Correct source or size |
| BYOK missing/expired 401 | PAUSED, not submitted | NO | Reconnect |
| Provider authorization 401/403 | FAILED | NO | Check key/project/model entitlement |
| Provider HTTP 429 | FAILED (definitive rejection) | NO | Check rate limits, quota and billing; a valid `Retry-After` is a minimum wait, not proof that waiting resolves the problem |
| HTTP 502/504 from proxy after possible submission | UNKNOWN | **NO** | Show possible charge warning |
| Browser closes mid-run | UNKNOWN until evidence | **NO** | Reopen local attempts; inspect provider usage if possible |
| Returned image fails decode / save | UNKNOWN locally, with remote cost possible | NO | Preserve the attempt, inspect provider billing and explicitly review before a separately approved new attempt |
| QA rejects output | REJECTED | NO | Edit scene, source mask or explicit paid Retry |

## Billing concepts

`estimatedUSD`: before-call model, dimensions, quality and assumed token count; never labeled exact. `observedUsage`: token details when provider returns them. `observedUSD`: calculated only if rates and usage are sufficient, with pricing snapshot; otherwise `null` and "unknown". Provider bill remains the authoritative actual charge.

The local Studio subset keeps only validated, allowlisted token counters. The current Images API reference describes usage as optional and does not guarantee it for the selected Flare model. When complete text/image input and image-only output details are available, `observedUSD` is a calculation using the stored 2026-10-29 rate snapshot, not the provider invoice; incomplete or inconsistent usage leaves it `null`. Synthetic fixtures do not establish actual provider response or charges.

## Budget guardrails

1. User soft session limit and per-attempt budget stored as non-secret settings; before each chargeable attempt require explicit consent.
2. Gateway enforces count, concurrency, body/prompt restrictions and account rate limits, preventing unlimited calls; may enforce conservative estimated cost threshold but cannot guarantee exact token spend.
3. Recommend provider-side project alerts/limits. Do not claim a provider hard cap without validating account-level semantics. Batch mode must display estimated *total* across styles and pipeline stages.
4. Never silently regenerate or call another model because previous attempt failed.

The current local implementation stores the two non-secret soft limits in browser `sessionStorage`; the session is a browser-tab session, not the provider account or a global spend ceiling. Its conservative estimated total counts every saved attempt in that session, including pre-send failures and UNKNOWN outcomes. The prior total is checked atomically against IndexedDB when preparing an attempt; stale consent fails before network submission. A limit below the projected estimate requires a separate one-attempt override and fresh consent, bound into the gateway approval. The gateway validates the supplied arithmetic but cannot independently verify browser-reported session history. Its owner-configured per-attempt estimate guard and hourly count remain separate. Clearing storage, using a separate browser session or other provider clients is outside this soft limit.

## Estimation formula

For **Standard** rates as of snapshot (USD):

`estimate = text_input_tokens * 5 / 1,000,000 + image_input_tokens * 8 / 1,000,000 + image_output_tokens * 30 / 1,000,000`.

This is a scenario, not deterministic token prediction. Caching and batch discounts do not apply to every route; account charges can include mainline Responses model tokens, retries and other features.

## Observability / vendor correlation

Keep `clientAttemptId`, `providerRequestId` if received, `outcome`, `submittedAt`, rate-limit metadata without secrets, pricing snapshot, `usage` optional, `errorCode`. Do not log full prompt if it can contain source labels or confidential SKU descriptions. Escalation policy for UNKNOWN: ask user to inspect provider dashboard/charges before consent to retry.

The local gateway exposes an explicit review acknowledgement when it has a durable terminal result. It preserves the original attempt and does not claim an actual charge, retrieve a lost asset or authorize another call. The retry UI loads the same versioned job inputs without sending; a subsequent attempt requires a new UUID, fresh consent and a separate approval. Changed inputs or older unsupported prompt versions require a new job. Legacy unowned markers and interruptions without a durable result remain blocked; preserve those records. A provider HTTP 429 can indicate rate limiting, quota or billing. Current-build tabs serialize dispatch within one browser profile and enforce a successfully persisted bounded `Retry-After` before a later attempt. When a provider supplies an invalid or unsupported delay, the gateway retains its durable active marker and requires explicit external review before acknowledgement; it does not preserve or enforce the exact long delay after acknowledgement. Another profile, older build, direct client or lost local delay record is outside the browser delay guard. If saving fails, review provider billing and rate limits externally before acknowledging the unresolved attempt; waiting does not guarantee provider availability.
