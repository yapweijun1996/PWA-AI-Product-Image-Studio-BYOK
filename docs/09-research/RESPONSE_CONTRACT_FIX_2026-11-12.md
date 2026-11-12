# Vision response contract and error classification fix

Status: patch implemented and scoped local verification passed; delivery is verified against the matching main-revision workflow. Baseline main `cb83094`, app v0.5.0.

## Observed failure

The owner supplied a Responses envelope with `status: completed`, `error: null` and a completed assistant text message. Its source-analysis JSON contained subject ID `shoe_0`, group `g0`, and box `{x:27,y:44,width:968,height:597}`. No response/account identifier, credential or original image is included in this report. This evidence establishes that the provider completed this response; it does not establish invoice amount.

The transmitted schema allowed arbitrary strings and numbers. Local validation instead requires IDs `s1`–`s6`, groups `g1`–`g6`, and normalized coordinates within 0–1. The local rejection was correct, but the producer contract was incomplete and the generic catch incorrectly displayed a transport-uncertainty billing hold. Earlier idealized normalized mock responses did not expose this production mismatch.

## Repair boundaries

Declare supported ranges/enums/array bounds in the actual outbound schema and explain normalized fractional coordinates explicitly in the prompt. Keep local containment, annotation and subject-group validation. Do not normalize arbitrary pixel numbers by guessing source dimensions.

Use narrow completion evidence to distinguish completed-but-unusable analysis from genuinely uncertain request outcomes. Preserve possibly billable request history and conservative local amounts. No automatic paid retry, no blanket HTTP-200 success rule, no clearing historical UNKNOWN entries, no new endpoint/model, and no real credentials or paid tests.

The installed SDK defaults to omitting response bodies from structured-output errors; the writer's actual SDK probe found that `include: {responseBody:true}` retains the parsed raw envelope for internal verification. The body must remain transient, without being logged, exported or saved as user data. The patched guard checks a recognized `NoObjectGeneratedError` caused by `TypeValidationError`, SDK finishReason `stop`, and a raw envelope with matching SDK/provider response ID, exact pinned model, object `response`, status `completed`, error `null`, no incomplete details, and completed assistant text matching the rejected text. Valid-result success is guarded by the same completion evidence. HTTP 200, a finish reason, or a body that merely resembles JSON is insufficient.

For this narrow case, the provider journal/monthly ledger records `DEFINITIVE_SUCCESS` (the request completed), while the application analysis item is `FAILED` with `SOURCE_ANALYSIS_INVALID` or `OUTPUT_REVIEW_INVALID`. This does not mean an image/analysis succeeded or was free. A completed invalid review preserves images and reports unassessed quality. Structured parse failures outside the recognized validation case, incomplete/malformed envelopes, interruption and failed journal/ledger persistence remain UNKNOWN. Raw response bodies are never persisted/exported/logged.

## Vendor reference

[OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs), checked 2026-11-12, supports numeric minimum/maximum and array minItems/maxItems for the selected non-fine-tuned model path. Unsupported cross-field relations still require application validation. This documentation is not proof of a successful paid request with the patched schema.

## Verification and delivery

Affected Node checks passed 45/45, including schema/runtime alignment and 16 isolated actual-SDK response scenarios. The dedicated completion browser test, existing full reference-board journey and Pages/offline/recovery journey each passed 1/1 with process exit 0; build passed. Independent security review repeated 45/45 checks and the dedicated browser file (1/1, exit 0), then independently probed the exact owner-shaped rejection, valid JSON with an incomplete envelope and preserved historical UNKNOWN. No reported P0/P1 remained in this scope. No extra image request, resend, refund, raw-response logging or persistence was observed. Integrated build and delivery evidence are tracked separately below.

The new schema/prompt length changes the existing conservative vision estimate formula: source analysis USD0.033402, batch review USD0.067339, six reference-image attempts unchanged at USD1.264713, total reference reservation USD1.365454. These are planning allowances, not invoice amounts or a hard provider cap; prior reservations remain immutable.

For old v0.5.0 UNKNOWN entries, the stored data lacks the raw completion evidence needed for reclassification. They are not automatically cleared. The existing Settings review acknowledgment can authorize new uploads after the user checks the uncertain request; it does not retry it and requires no replacement key or new budget. Deployment is tracked by the exact main-revision [Pages workflow](https://github.com/yapweijun1996/PWA-AI-Product-Image-Studio-BYOK/actions/workflows/pages.yml) and live version smoke, not inferred from this report. Real provider recognition/photographic accuracy remains outside this bug fix.

Implementation commit: [`7721206`](https://github.com/yapweijun1996/PWA-AI-Product-Image-Studio-BYOK/commit/7721206), fast-forward integrated into main. The manager independently built the integrated repository-scoped Pages bundle; UI SSOT/token checks, TypeScript and Vite completed with exit 0. Documentation synchronization is a separate commit. The Pages workflow now includes the completion-response browser regression as its own Node invocation, alongside the existing checks. The final matching workflow run and fresh-profile live version smoke are reported in the delivery response; no deployment or paid-model success is inferred solely from this source commit.
