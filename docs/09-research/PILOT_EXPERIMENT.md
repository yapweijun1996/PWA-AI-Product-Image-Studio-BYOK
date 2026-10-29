# Pilot Experiment / Benchmark Protocol

## Aim

Validate whether independent sellers can obtain truthful, approved product imagery for acceptable cost and effort, not merely whether OpenAI can produce attractive images.

## Product test set

Five classes × four products each = **20 SKU source cases** target. Suggested classes: packaged food with bilingual label, skincare/cosmetics bottle, sneaker/garment, electronics/tool, furniture/homeware. Record source quality, angle, SKU attributes, label ROI and authorization. Include deliberately difficult examples: reflective/transparent, curved label, small Chinese text, front-only photo, transparent PNG, complicated silhouette.

## Procedure

1. Review data rights. For each SKU, build verified facts and lock regions before generation.
2. Generate a Studio-only baseline in STRICT; hold model/quality/size fixed within the comparison cohort.
3. Attempt every feasible style; record infeasible requests as rejected feasibility, not as silent model failure.
4. Capture each attempt's source hash, prompt version, model, latency, API usage if available, error/UNKNOWN state, output hash and cost estimate.
5. Independent reviewer grades 0–5 rubric, hard veto, scene fit and evidence; merchant owner explicitly approves or rejects.
6. Compare optional BALANCED outcomes to STRICT on same source, but never mix lock modes in one metric.
7. Export approved assets and import backup; run installed PWA experience and privacy trust questionnaire.

## Metrics / thresholds

Record approval rate, identity hard veto %, minutes to first approved, masked-input correction time, cost per approved asset, retry ratio, unknown billing ratio, seller comprehension and trust. Pilot proposal targets (unproven): STRICT hard veto <5% on *good source with compatible view*, zero Key leakage, zero auto UNKNOWN retry, 100% valid export/import fixture integrity. Do not market pilot target as achieved.

## Stopping rules

Stop repeated generation if source cannot prove label, if conversion produces material product drift, user budget exceeded, Key exposure detected or unsupported camera view is repeatedly attempted. Fix source/mask/UX rather than blindly increasing requests.

## Reporting template

Summary by category/style/model/lock mode; sample counts; confidence intervals if appropriate; failure examples; raw/approved assets securely retained; costs with missing-usage caveat; viable next investment versus pivot recommendation. Reviewer and date required.
