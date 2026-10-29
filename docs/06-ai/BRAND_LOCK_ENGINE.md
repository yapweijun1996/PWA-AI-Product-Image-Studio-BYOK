# Brand Lock Engine — Mandatory Visual Truth Rules

**Source:** KB-MCP skill `image:product-photography-brand-lock`, version 1.0.1; source content reviewed 2026-10-29. **Status:** confirmed product invariant, proposed software implementation. This is not proof an actual image was generated or tested.

## Three lock modes

| Lock | Promise | Technique | Required user label |
|---|---|---|---|
| STRICT | Preserve actual visible source-product artwork/geometry as closely as original-layer compositing permits | Mask source product, generate only scene, composite original RGB | "Original product layer; AI-generated environment" |
| BALANCED | Best-effort product similarity, not exact logo/text or shape | Reference edit + QA | "AI-edited product visual; verify details" |
| CREATIVE | Concept can change design/shape if permitted | Generate/edit with explicit concept intent | "Concept — not verified photo of actual SKU" |

**Never promise exact label/pixel identity from prompting alone.** Compositing preserves source imagery more reliably but scaling, resampling and edge blending still alter some pixels. STRICT output must not fabricate unseen package faces, ingredient labels or approvals.

## Input truth contract

`PRODUCT_REFERENCE`: high-resolution authorized source(s), clear viewpoints, optionally original logo/label artwork or transparent PNG.  
`PRODUCT_FACTS`: only facts explicitly stated by seller or actually legible in source; each fact has provenance and confirmation.  
`CATEGORY`: category verified from source/user, no default assumptions from previous SKU.  
`LOCK_MODE`, `SELECTED_STYLES`, `OUTPUT_RATIO`, `BACKGROUND`, `SCENE`, `LIGHTING`, `FORBIDDEN_CHANGES`, `RIGHTS_ACKNOWLEDGEMENT`.

If no real source photo, concept-only flow; no "source-faithful" label. If text is too small, mark UNVERIFIABLE; no invention. An external price tag, screenshot UI, customer review overlay or a social logo must not be treated as physically printed packaging.

## Invariant inventory checklist

1. Product type and visible packaging form; material, shape, size, functional details.
2. Logo, original brand spelling, all readable Chinese/English typography, locations and sizes.
3. Variant/flavor/shade/size visible on packaging; colorway, logo placement and position.
4. Camera pose actually supplied, hidden surfaces not shown.
5. No invented certifications, ingredients, efficacy, regulatory claims, country-of-origin, price, stars, testimonials or brand endorsement.
6. Product must not duplicate, bend, float or merge with props. Respect shadows and realistic contact, no category-mismatched props.
7. Keep rights notices/watermarks unless authorized to remove.

## STRICT compositing protocol

- Preserve original and mask as separate immutable assets, hash them. Manual mask editor required at least; optional automated cutout needs explicit source check.
- AI creates environmental scene and negative space for foreground; do not redraw label. Composite using original image with alpha. Add contact shadows as independent underlay and match perspective without distorting protected region.
- At product core ROI compare RGB/geometry at corresponding original sampling positions; transformed outputs must be accompanied by explicit mapping and cannot claim raw byte identity.
- Refuse true overhead or backside reconstruction if source angle unavailable; offer compatible angle or explicit concept switch.
- Perform mandatory side-by-side human verification for branded packaging; no threshold-only automation.

## BALANCED rules

Use reference image(s) and strongly specify unchangeable identifiers. No assurance of fine-print fidelity; any detected logo, material or SKU change is a finding. Product photos designated for actual commerce require owner approval with an accurate disclosure of deviations.

## CREATIVE rules

Only after the user opts in to design variation; mark outputs as Concept. A new package design must not be mistaken for real merchant inventory. Marketing claims must still be provided by user, not invented.

## Recovery

| Failure | Action |
|---|---|
| Chinese text changes | Reject STRICT; overlay original product/label layer or get higher-res source |
| Wrong variant/color | Reject; verify source asset and locked facts |
| Flat Lay impossible | Request overhead source, source-angle alternative, or concept opt-in |
| Floating object / halo | Refine mask/contact shadow/perspective; if impossible reject |
| Unreadable source logo | UNVERIFIABLE; get clearer original |
| Unsupported category props | Regenerate background only, preserve foreground |

## Examples

**Sneaker:** keep exact shoe shape/colorway; lifestyle street backdrop; never substitute different laces/brand marks.  
**Bottled drink:** keep cap, bottle silhouette, original visible label; no invented nutrition/health statement.  
**Desk lamp:** keep arm joints, shade geometry and finish; no unsupported brightness or safety badge.  
**Chair:** retain fabric weave and leg geometry; avoid unrequested style/design upgrades.

## Quality bar

Use the exact weight and hard veto protocol in [VISUAL_QA](VISUAL_QA.md). A visually beautiful but inaccurate real SKU image must be rejected from STRICT approved export.
