# Visual QA / Product Truth Acceptance Contract

**Canonical source:** KB-MCP `image:product-photography-brand-lock` v1.0.1.

## Weighted rubric

| Dimension | Weight | Score (0–5) example evidence |
|---|---:|---|
| Packaging/material/design fidelity | 35 | unchanged original visible surfaces, finish and packaging geometry |
| Logo and readable typography fidelity | 25 | spelling, Chinese label, variant text, physical position |
| Shape, proportion and perspective | 15 | model silhouette, non-floating contact, realistic scale |
| Photorealism and environmental integration | 15 | shadow direction, edges, contact, materials, reflections |
| Requested style/composition match | 10 | correct studio/hero/lifestyle/etc mood and constraints |

Score formula: `weighted_score = SUM(score_i / 5 * weight_i)`, on a 0–100 scale. The current canonical QA schema accepts fractional component and weighted scores; whether to round and how to allocate unbranded weights remain [OPEN-009](../00-governance/DECISION_REGISTER.md) before implementation. For genuinely unbranded/no-text products, record `weightingVariant=unbranded` and do not invent missing weights. **85/100 is a candidate threshold only**, never universal acceptance.

## Hard veto conditions (always block STRICT approval)

- Wrong SKU, category, product variant or material/finish; invented extra product or changed recognizable shape.
- Rewritten/incorrect brand logo, translated/fabricated Chinese/English label, wrong cap/connector/functional feature.
- Unverified medical/performance/safety claim, ingredient, origin, certificate, price or endorsement.
- Requested unseen package face generated as if real; true overhead without overhead reference.
- Material source image unavailable, hash mismatch, edited original, unsafe watermark/rights modification.
- Mask/composite damages critical product graphic or adds unrealistic/dangerous product details.

## Evaluation states

| State | Condition | UI/export behavior |
|---|---|---|
| `PASS_CANDIDATE` | score>=85, no hard veto, source evidence sufficient | allow manual review, not auto-approved |
| `REVIEW_REQUIRED` | score<85 without obvious veto, uncertain visual integration | must fix/review |
| `UNVERIFIABLE` | original too small/unclear or perspective unseen | request source; cannot approve as faithful STRICT |
| `REJECTED` | one or more hard veto or explicit reviewer rejection | cannot export as approved |

A human `APPROVED` decision is a separate event referencing exact `assetId`, source hashes and QA report. Changing any input/mask/output/claim invalidates approval; new QA required.

## QA procedure

1. Read original full-size photo and product facts; establish protected ROI for logo/text, critical geometry and color sample.
2. Confirm rendered image matches product type, variant, visible logo/text and view. Unverifiable text remains UNVERIFIABLE.
3. Check natural edges, shadows, scale, reflections, props relevance and no duplicated object.
4. Apply 0–5 scores and record specific findings (severity BLOCKER/WARN/INFO) with source/output crop references.
5. Hard-veto before weighted approval. Compare side-by-side at 1:1 zoom; user explicitly approves or rejects.
6. Export only after approval; store model, prompt version, source hash, QA report and decision.

## Automation limits

Computer vision OCR or semantic model similarity is advisory and can miss subtle Chinese glyph differences; similarity scores are not proof of packaging accuracy. Automated checks can reliably verify file metadata, masks, hash lineage, missing assets and geometric constraints. Human review is mandatory for packaging, legal/regulatory claims and major promotions.

## Test matrix

`QA-001` logo/Chinese characters must not change. `QA-002` SKU/variant/color/geometry check. `QA-003` mask halos/unsupported camera. `QA-004` correct formula/threshold, veto override. `QA-005` no fabricated claims, UGC testimonials, removed watermark or unapproved packaging artwork. Use synthetic label fixtures for public E2E; real product benchmark requires merchant authorization.
