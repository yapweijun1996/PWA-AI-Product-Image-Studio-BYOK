# Image Pipeline / STRICT Brand Preservation

## Two independent paths

**STRICT (default real SKU):** original photo → validated transparent cutout / user-corrected mask → independent background generation → alpha compositing using preserved product RGB pixels → shadows/reflections outside core product area → source/output QA → manual approval. No prompt-only pixel fidelity assertion.

**BALANCED / CREATIVE:** reference image (optional) → provider image-edit or generation → output tagged as best-effort or concept → QA with appropriate truth disclosure; cannot be mislabeled STRICT.

```mermaid
flowchart TD
A[Upload reference(s)] --> B[Identify verified invariants and camera view]
B --> C{Lock mode}
C -->|STRICT| D[Mask + preserve original foreground pixels]
D --> E[Generate clean empty scene around intended placement]
E --> F[Composite source foreground; add contact shadow outside]
F --> G[Check source RGB/alpha, geometry, crop, pixels]
C -->|BALANCED| H[Image edit with reference and preservation prompt]
C -->|CREATIVE| I[Generate labelled concept]
H --> G
I --> G
G --> J[5-factor QA + hard veto]
J -->|Review| K[User approves or rejects]
K -->|Approved| L[Portable channel export]
```

## STRICT algorithm (implementation reference)

1. Verify source rights, MIME by magic bytes, EXIF orientation, pixel count, contrast and source hash. Retain original Blob unmodified.
2. Obtain alpha mask (manual accepted; transparent PNG preferred). Keep mask as separate asset; validate same dimensions after EXIF normalization. Automatically guessed segmentation without manual verification is not authoritative.
3. Generate an independent scene with correct empty area, surface, realistic support and camera perspective. If provider is asked to create complete "product" again, it is **not** STRICT.
4. Use source foreground: composite alpha `C = A * RGB_source + (1-A) * RGB_scene`, with correct premultiplication and color space handling. Preserve source RGB in opaque product core; feather only mask edge if necessary. Shadows can be created on an independent layer *behind* the original product, not by changing label pixels.
5. If occlusion is required, restrict props to non-critical areas; complex contact geometry may be impossible without product re-render; reject or switch to BALANCED with approval.
6. Compare original interior sample pixels, crop proportions, label/logo area, variant, scale, scene consistency. Record source hash and mask hash in metadata.
7. For scaling/rotation, interpolation changes pixel values; do not claim byte-identical output; describe "source-layer-preserving" instead of universal pixel equality. Avoid warping label or creating missing side/back.

## View feasibility rules

| Request | Available source | STRICT result |
|---|---|---|
| Studio front / hero near-front | Clear front photo/cutout | Allowed after mask/perspective review |
| True 90° Flat Lay | Front-only bottle photo | BLOCK / use source-angle flat-lay-inspired scene explicitly |
| Macro label details | Low-res original | BLOCK fidelity certification; ask high-res detail |
| Backside packaging | Front photo only | BLOCK or concept; never synthesize ingredient print |
| Hand-held UGC | Front photo no hand | Can composite hand/background with caution about realistic occlusion; may downgrade to BALANCED |
| Whole billboard mockup | Original front product + no copy | Use original embedded product in ad, then fit entire ad into billboard environment; text only if user provided |

## Performance / correctness

- Use `createImageBitmap`, transferable `ImageBitmap`/`OffscreenCanvas` where supported; feature-detect and fallback without blocking UI.
- Never decode 20 full-resolution photos concurrently on mobile; per-job bounded worker concurrency and release Blob URLs/bitmaps.
- Keep an original and derived preview separately. Re-render final export at controlled source resolution; no irreversible preview-only loss.
- Test alpha halos, feather edges, JPEG color shift, EXIF, portrait orientation, highlights and transparent PNG behavior across real browsers.
- For lost SourceAsset, mark projects UNVERIFIABLE; never silently use last generated image as original.

**Current source-input implementation:** PNG, JPEG and static WebP are checked by magic bytes and bounded headers before decoding; files are limited to 20 MiB, 24 megapixels and 20,000 pixels per edge. A separate EXIF-aware preview is reduced to at most 1,600 px per edge. The user reviews it before the original Blob and its SHA-256 metadata commit atomically; the original may retain sensitive EXIF and is never replaced by the preview. Chromium tests used synthetic files, including an oriented JPEG and a 12 MP image. Physical-device decoding, actual quota exhaustion and source-preserving compositing remain unverified.

**Current mask implementation:** A user can review and draw/erase a separate full-oriented-resolution PNG mask, including source-alpha initialization for transparent images. Each saved version is hashed, bound to its source hash and dimensions, stored atomically, and can be backed up with its original. The latest mask per source can be reopened; the last saved version is the product's active mask. Decoded mask alpha is capped to source alpha; a future compositor must retain this cap and treat mask alpha as final coverage, not multiply it by source alpha a second time. Preview is bounded to 1,600 px; full-resolution rendering uses a Worker/OffscreenCanvas when available and falls back to the main thread otherwise. No automatic segmentation or compositor is implemented.

## Proof standard

The algorithm is a proposed approach. It becomes a "source-preserving" claim only after mask and pixel/geometry tests plus human visual QA on the actual target SKU.
