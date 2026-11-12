# Automatic Output Quality and UX Review — 2026-11-12

Status: source-backed review completed; remediation PENDING. Baseline: `main`, `b8091da`, app v0.3.0. This record documents 13 independent advisor reviews and owner-provided screenshots; it does not claim new implementation, paid generation, or visual acceptance.

## Evidence and scope

The owner supplied a complete seven-image sneaker result and rated Studio 7/10, Hero 7/10, Lifestyle 5/10, Flat Lay 2/10, Detail 3/10, Everyday 4/10 and Billboard 6/10. These are the owner's judgments on one example, not benchmark scores or population evidence. Screenshots suggest floating/oversized placement and weak scene differentiation; actual physical dimensions cannot be established from them. Private screenshots and credentials are not copied into the repository.

Inspected source at the baseline:
- `app/src/automaticPipeline.ts`, `automaticPlan`: generic product/category, no confirmed facts and fixed OTHER source view; all seven styles scheduled without source capability analysis.
- `app/studio-policy.mjs`, `studioBuildPrompt`: empty-background-only generation, with no reference image pixels sent to the provider. A source hash is not visual conditioning.
- `app/src/autoImaging.ts`, `composeAutomatic`: fixed per-style scale/center, full-product drawing even for macro, uniform silhouette shadow, and fixed billboard rectangles/support.
- `app/src/autoImaging.ts`, `prepareForeground`: 320px segmentation followed by alpha resizing; transparency heuristic and area checks do not establish edge fidelity.
- `app/src/automaticPipeline.ts`: PNG/dimension/hash checks become AUTOMATIC_CHECKS_PASSED, not a semantic photography assessment.
- `app/src/UploadStudio.tsx`: results offer downloads but no large preview, original comparison or independent single-result regeneration.
- `app/tests/browser/pages-preview.test.mjs`: synthetic images exercise flow, persistence, source pixels and downloads, not commercial photography quality.

## Thirteen advisor findings

| Advisor | Finding | Proposed response |
|---|---|---|
| 01 Photography/art direction | Same product view across loosely related backgrounds | Define a distinct composition objective for each feasible style |
| 02 Geometry/contact | Fixed centers and billboard geometry do not match generated surfaces | Shared layout specification with support plane, bottom anchor and explicit billboard ownership |
| 03 Style truthfulness | Side view is not Flat Lay; complete product is not Detail | Compatible source view for overhead; evidence-backed local detail crop |
| 04 Professional controls | More mandatory forms would undo upload-only UX | Optional generation settings; keep default upload-to-results |
| 05 Lighting | Background direction and common shadow ignore source light | Adapt environment to source; separate contact and directional shadows |
| 06 Mask/fidelity | Low-resolution masks and alpha heuristics can lose fine edges | Edge fixtures, source-resolution floor and trustworthy transparency handling |
| 07 Architecture | Background generator is blind to actual product geometry/category | SourceAnalysis → CapabilityPlan → independent StyleJob proposal |
| 08 Waiting UX | Large introduction and duplicate progress push results below fold | Compact active-job summary, one completion count, early visible results |
| 09 Result UX | No inspect/compare/single-result repair | Accessible preview, original comparison, versioned single-result attempt |
| 10 Quality assurance | Technical success is mistaken for photographic readiness | Separate technical validation and visual assessment; real-image release fixtures |
| 11 Cost/latency | All seven requests run even where effects duplicate or can be local | Capability-aware plan proposal; local crops/recomposition; preserve no-auto-retry |
| 12 Accessibility | Repeated Download names; future preview needs keyboard/mobile behavior | Style-specific accessible names, focus return/Escape, touch-accessible comparison |
| 13 Product roadmap | Billboard contains a product placement, not a complete ad design | Compose a standalone advertisement first, then map it into the environment |

## Proposed capability and style contracts

Default remains simple upload → automatic results → download, with no mandatory mask editing or human approval in the automatic path. Existing Advanced review/export rules remain intact.

- STRICT keeps authentic visible source content and viewpoint. Background generation and local composition must share layout constraints. Pixel reuse alone does not guarantee successful masking or realistic integration.
- Reference-guided editing is a separate proposed path with explicit source-image transmission disclosure and best-effort fidelity. It is not a pixel-lock switch. Provider/model, cost, storage/provenance and trust-boundary changes require an ADR before implementation.
- Multiple views are optional source assets, not a guarantee of unseen-surface reconstruction. They can support either path.
- Studio: clean catalog composition with credible grounding. Hero: deliberate campaign composition and compatible lighting, not merely a darker room.
- Lifestyle and Everyday: distinct editorial versus informal photographic intent, category-appropriate context, support and scale; no fictional endorsement or unsupported use claim.
- Flat Lay: true overhead only with a compatible source. Otherwise use a clearly named source-angle alternative. Never relabel a side view as overhead.
- Detail: crop an actual visible region with recorded source coordinates and sufficient pixels. Do not synthesize absent texture or hidden surfaces.
- Billboard: create the complete ad artwork first; use supplied copy only, or a deliberate text-free design. Do not fabricate slogans, prices, offers or performance claims. Avoid two independently positioned billboard structures.

Changing the default seven-output promise to capability-dependent counts remains PROPOSED (DEC-022); the review does not silently supersede DEC-020. Canonical style IDs and stored histories remain unchanged until an approved compatibility plan exists.

## UX targets

Image cards retain direct download. Clicking an image opens large preview with zoom and original/result comparison; mobile uses a full-screen view, keyboard supports Escape and focus return. Comparison is optional, not an approval gate. Single-result regeneration creates a new billable attempt, preserves the prior version and displays its estimate; UNKNOWN is not automatically resent. Local crop/layout repairs should avoid provider calls where possible.

Preset, aspect ratio, resolution and fidelity options belong in optional settings with a visible summary. Only expose actually supported capabilities. Do not imply that format resizing generates new detail. Generation uses one real completion count, a compact active-job summary and stable card geometry. Only active requests animate, with reduced-motion support; queued/interrupted states remain distinct. Final partial results state completed and failed counts rather than waiting forever.

## Verification and release boundaries

The historical 300 application tests and 10 browser tests remain scoped functional evidence, not photography certification. This review ran no new application/browser tests and made no paid call. Add semantic assertions for authentic crop coordinates, compatible overhead source, shared composition geometry and full ad layer. Use rights-cleared real-product fixtures for contact, light, edge fidelity, scale and style differentiation. Developer visual review before release does not impose review steps on end users. Automated scores never override a STRICT identity mismatch.

The existing [visual QA contract](../06-ai/VISUAL_QA.md) owns weights and vetoes; no new scoring formula or schema is introduced here. Task status/dependencies are owned by [TASK](../08-delivery/TASK.md), sequencing by [ROADMAP](../08-delivery/ROADMAP.md).

## KB application and compatibility

Retrieved `image:product-photography-brand-lock` v1.0.1 (skill ref `270d896a-12b0-40b4-856f-f6274d872c95:e9cd5046-0b4a-4356-a88e-a1498b133bc3`). Its genuine crop, camera compatibility, contact-shadow and complete-ad requirements explain the observed implementation gaps; its stale/unverified registry marker means it is guidance, not runtime proof. Reused the existing project version rather than upgrading it. Documentation sync follows `project:code-docs-source-of-truth-sync` v1.0.1: evidence precedence matches the local SSOT policy; no runtime contract change is introduced.

## Rollback

Documentation-only change: revert the documentation commit and matching manifest/checksums. No app version, database, provider endpoint, image asset or credential migration. Future implementation tasks must preserve original images, historical versions, spending consent and unresolved-charge records.
