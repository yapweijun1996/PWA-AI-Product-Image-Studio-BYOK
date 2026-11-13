# Cost Model, Guardrails and Accounting (US Dollars)

## Official Standard rates (snapshot 2026-10-29)

OpenAI GPT Image 2.5 Flare and Sunburst publicly list the same **per-million-token rates** for Standard processing: image input **US$8**, image output **US$30**, text input **US$5**. The exact image cost is not fixed because input/output tokens depend on model, quality, prompt, size and reference images. Cached token discounts apply only to supported routes; direct Images API does not receive the same caching treatment as Responses image tool. See [SOURCES](SOURCES.md).

## Example only (not a quote)

Assume for **one image request**: 3,000 image output tokens, 1,500 image input tokens, 300 text input tokens. `3000 × 30 /1e6 + 1500 ×8/1e6 + 300 ×5/1e6 = $0.1035` per image. Seven separate single-stage requests would have estimated token charges `7×0.1035 = $0.7245` **in this illustrative scenario**. Real output token count, missing usage, overhead and retries can change this significantly. Billboard may require extra stages. No target margin or promised price is implied.

## Cost receipt fields

`attemptId`, `apiRoute`, `model`, `quality`, `size`, `estimatedUSD`, `estimateAssumptions`, `usage` (nullable), `observedUSD` (nullable), `priceSnapshotAt`, `providerRequestId` (nullable), `status=UNKNOWN` when ambiguous, `billingReconciled` flag. Store as decimal strings. Do not treat null as zero.

## Spend-control workflow

1. Preflight known output settings, image inputs, anticipated number of image calls, computed estimated total and user soft budget.
2. Enforce authenticated user, concurrent request limits, daily/submitted-call quotas and button double-click guard on gateway.
3. Obtain explicit confirmation for each batch or new attempt. Stop at configured soft budget, prompt for override.
4. Persist receipt and real usage where returned; unknown cost remains unknown until provider billing reconciliation.
5. Recommend provider-side project spend notifications and independent budget controls after verifying current account enforcement.

## Metrics

Cost per approved export = all incurred provider/eligible operation costs (including failed/unknown if billed and user-approved retry) divided by count of approved exported files. Track `cost_per_style`, `cost_per_category`, `retry_rate`, `unknown_rate`, `human_approval_rate` and `source-preserving_pass_rate`. Do not optimize for output count alone.

## Automatic Pages A+C estimates — 2026-11-12

The automatic-only policy uses the existing Flare model, low quality and 1024-square PNG. Six requests plus one zero-provider-cost visible Detail crop retain seven canonical output IDs. Every reference edit uses the primary image and up to two optional views, each normalized to a maximum 1024-pixel edge and 5 MiB. Per reference, per paid request, reserve a conservative **8,192 input-image-token planning allowance** at USD8/million (USD0.065536). Three references add USD0.196608 to each request relative to text-only. The reference-inclusive total is shown before upload and reserved as a whole before the first send.

The existing 196 image-output-token allowance (USD0.005880) is an **unverified planning assumption**, not a confirmed Flare output-token count or upper bound. Text estimates count UTF-8 bytes at USD5/million as a conservative tokenizer-independent proxy. The [official Flare model page](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) confirms rates and edits support but explicitly says the GPT Image 2 calculator does not estimate GPT Image 2.5 consumption. These assumptions can under- or overestimate actual billing and are disclosed in Create/Settings; reservations are neither invoices nor account spending caps. No observed usage, actual charge or successful paid request is claimed. No retry is automatic; UNKNOWN can be charged and its reservation remains. DEC-025 permits a new user-initiated automatic attempt without first clearing the old UNKNOWN. The Advanced gateway estimate contract is unchanged.

## DEC-024 bounded vision allowances

The subject-aware reference workflow plans at most six image attempts, one source-analysis request and one output-review request. Detail and optional local Campaign copy/display rendering have no provider call. Single-image regeneration adds exactly one image attempt and does not silently purchase another analysis or review. STRICT has no source-analysis or output-review image transmission.

Official documentation consulted 2026-11-12 lists `gpt-5.4-mini-2026-03-17` image input/structured outputs and Standard input USD0.75/million, output USD4.50/million: [model reference](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Vision planning allows 8,192 image tokens per input, bounded schema/prompt allowance and 2,048 output tokens per call. These are conservative planning assumptions, not measured usage or a guaranteed cap.

Reserve the whole reference batch before source analysis. The image-edit planning amount consistently assumes up to three frozen references even when analysis ultimately selects fewer; do not silently refund or alter an immutable attempt estimate. Review plans for up to three references and six generated outputs. Local monthly totals include prepared and interrupted attempts and are neither provider invoices nor account-wide spend. Auxiliary UNKNOWN attempts retain the same recorded uncertainty as image attempts. Under DEC-025, neither prevents a new automatic attempt by itself.

## Vision contract patch — v0.5.1

T-114 adds schema bounds and explicit coordinate/ID instructions, so the existing schema/prompt-byte planning formula changes new auxiliary estimates. Prior reservation amounts remain immutable. A narrowly evidenced completed-but-unusable analysis remains a recorded potentially billable request; local application failure does not refund the estimate or imply zero provider cost. A provider journal outcome of DEFINITIVE_SUCCESS describes completion only, not image/analysis quality.
