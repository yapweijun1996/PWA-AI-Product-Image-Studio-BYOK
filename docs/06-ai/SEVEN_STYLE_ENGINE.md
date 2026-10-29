# 7-Style Product Photography Engine

**Canonical IDs & full English add-on prompts:** [`contracts/style-presets.json`](../../contracts/style-presets.json). For comparison, source product, lock mode, chosen ratio, quality and model are held fixed where feasible; styles change scene and perspective only within evidence bounds. One selected style is one job with independently controlled attempts.

## Style table

| ID | Style | Use | Source/quality limitations |
|---|---|---|---|
| `studio` | Studio Shot | Catalog/ecommerce product detail | preserve source angle and crisp true color |
| `hero` | Hero Shot | Premium promotional visual | drama through environment, not product redesign |
| `lifestyle` | Lifestyle/Pinterest | Editorial use context | no unsupported use claims or fictitious endorsements |
| `flat_lay` | Flat Lay | Overhead accessories flat composition | true top-down requires top-view source in STRICT |
| `macro` | Macro Detail | Real visible workmanship/material | cannot hallucinate microtext or details not in source |
| `ugc` | UGC-style | Casual plausible phone-style imagery | no fake verified customer review or testimonial |
| `billboard` | Billboard Mockup | Realistic placement mockup | entire ad in environmental display; only user-supplied copy |

## Master prompt assembly

`Master Prompt` + `Verified Product Facts` + `Lock-mode clauses` + exactly one `Style Add-on` + `Scene/Ratio/Light` + `Exclusions`. Renderer must escape untrusted text as data and never allow product metadata to instruct external actions. Unfilled placeholders are build-time/runtime errors, not valid prompts.

## Shared English master prompt template

```text
Use the supplied original product image(s) as the visual source of truth for {VERIFIED_PRODUCT_DESCRIPTION}, category {VERIFIED_CATEGORY}. Lock mode: {LOCK_MODE}. Keep all original visible source-product features unchanged as far as the selected workflow technically permits: geometry, material, surface finish, colors, existing logo and brand spelling, readable label text, visible variant and functional details. Do not invent, distort, misspell, duplicate or relocate brand marks. Do not fabricate hidden package faces, printing, claims, ingredients, prices, certifications or endorsements.

Treat the source product as an intact foreground visual asset when STRICT; create the requested {STYLE} environment around it rather than re-imagining the merchandise. Respect camera perspective and authentic product-ground contact. Use category-appropriate props for {SCENE} and {AUDIENCE} without implying unverified features. Shot {COMPOSITION}; lighting {LIGHTING}; background {BACKGROUND}; aspect {ASPECT_RATIO}. Photorealistic, high-quality commercial composition; real product dominant and recognizable. No extra text unless seller supplied verbatim. Prioritize source fidelity over creative composition. Exclude: {EXCLUSIONS}.
```

STRICT uses this prompt for scene generation/advisory only; core product remains unchanged original layer regardless of prompt instructions. Do not rely on a generator's interpretation of "exact" to certify identity.

## Style-specific adjustments

- **Studio:** softbox, seamless contrast backdrop, clean contact shadow, sparse props; easiest first category benchmark.
- **Hero:** directional/refined light, believable reflections and negative space, physical support when appropriate.
- **Lifestyle:** credible home/use context, daylight, contextual props; no unverified usage/performance assertions.
- **Flat Lay:** only when proper view exists; otherwise "flat-lay-inspired source-angle" and disallow "true top-down" label.
- **Macro:** crop into actually visible pixels with enough source detail; no synthetic high-frequency enhancement presented as real material.
- **UGC:** natural imperfect framing, no unverified user-generated endorsement; AI origin disclosed when representation would mislead.
- **Billboard:** compose protected product art into complete advert, then place whole advert in realistic display. Stage calls and user-provided ad copy may increase billing.

## Preset versioning and customization

- Stable ID never reused to change its meaning. Store `promptVersion`, `presetVersion`, model, quality, source hash and customized values on job.
- Seller may edit scene props/background; do not allow modifications of verified product facts or forbidden changes without explicit reconfirmation and new version.
- Channel ratios are UI choice: generic 1:1 (catalog), 4:5 (social), 9:16 (story), wide for billboard. Export size compliance with particular marketplace is P1 after official rules review.

## Seven-style fixture benchmark

Each category: use same source/lock/model/quality; choose seven styles, QA every result, note impossible view/style exceptions, compare costs and veto rates. Product categories: packaged food, skincare, shoes, electronics, furniture. Do not cherry-pick only visually flattering successes.
