# PRD — AI Product Image Studio (BYOK PWA)

**Version:** v2.0.0 draft · **Scope:** MVP/P0 · **Repo:** `PWA-AI-Product-Image-Studio-BYOK` · **Status:** PROPOSED product plan, implementation PENDING.

## Executive summary

Turn one real SKU's source photo(s) and verified facts into selected professional e-commerce visuals, while keeping the product truth primary. Seven category-adaptive styles; seller supplies OpenAI API Key (BYOK). Each job has controllable cost, visual QA, source comparison and manual approval before export. The unique value is **trustworthy, auditable, brand-faithful commerce visuals**, not unlimited creative prompting.

## Users and jobs to be done

Primary: Singapore/Malaysia small sellers using Shopee, Lazada, Shopify, Instagram/Pinterest; secondary: freelance content creators and developer-led brands. "When I only have a product phone photo, I want a clean shop-ready image without inaccurate labels, unpredictable charges or learning Photoshop." See [personas](PERSONAS.md).

## Scope IN (P0)

- One or more source photos for one SKU; verified facts, variant identity and original files preserved.
- Brand Lock mode selection: STRICT (default for actual SKU), BALANCED, CREATIVE (concept only).
- Exactly seven style presets in [style JSON](../../contracts/style-presets.json): studio, hero, lifestyle, flat_lay, macro, ugc, billboard.
- Choose any subset; one style = one independent job; store job attempts, costs and outputs.
- Mandatory product mask + original pixel compositor for STRICT. Manual mask edit and transparent PNG fallback; do not pretend a failed mask is reliable.
- OpenAI Images generation/edit through an authenticated, self-hosted same-origin gateway; the owner configures the key on their server, and the browser connects/disconnects a provider authorization session; quality and model allowlist.
- Visual source/output compare, weighted QA, hard veto and human approval.
- Local-first saved SKU workspace, predictable offline shell, download assets/ZIP with manifests and export/import validation.
- Product-grade iOS-first installed PWA, explicit update UX, security and accessibility release gates.

## Scope OUT (P0)

- Video generation, real shop listing write/publish, managed multi-user cloud workspace, hosted media CDN, automated customer endorsements, automatic truth/certification detection, team approval workflows, paid subscription, general image design SaaS.
- Do not promise all seven images will pass quality with one source angle. Do not promise lower provider bill than alternatives.

## Critical product rules

**PR-01 Truth:** Only verified or user-entered product facts may be included in prompt; no invented benefits, ingredients, claims, certification, star rating, origin or price.  
**PR-02 Visual source:** Original product image / authorized brand assets are reference authority. UI banners/mock screenshots are not product label artwork.  
**PR-03 STRICT compositing:** no generative redrawing of real SKU text/logo; use unchanged cutout when feasible. Reject impossible perspective requests or switch to marked Concept with explicit user action.  
**PR-04 Billing:** each retry could incur cost; disclose estimate and obtain explicit per-attempt consent before a server-bound one-use authorization; timeout=UNKNOWN until reconciled. An approval token does not prove human intent if the frontend is compromised.  
**PR-05 Privacy:** The browser never submits, receives or stores the provider key. The seller configures the self-hosted server key; app-session disconnect, server configuration removal and provider-side key revocation are distinct actions.
**PR-06 QA:** >=85/100 is editorial candidate only; important material or label mismatch vetoes approval.  
**PR-07 Publish:** No live product publishing in MVP. Assets can be exported only after explicit approval or as clearly labeled unverified drafts.

## Main user journey

1. Seller opens PWA, creates SKU; uploads reference, chooses what facts are confirmed.
2. Selects STRICT, reviews extracted visual invariants, accepts mask and supplied camera-angle bounds.
3. Connects a provider authorization session to the server-configured BYOK, chooses 1–7 styles, ratio, quality, model, spend estimate.
4. Submits each selected job, sees individual QUEUED/RUNNING/UNKNOWN/etc states.
5. Reviews preview and original side-by-side; QA findings marked PASS/REVIEW/REJECT.
6. Explicitly approves suitable outputs and exports PNG/JPEG/WebP + metadata ZIP.
7. Offline, continues browse/edit/export existing local records; cloud generation is disabled and clearly labeled.

## Core acceptance criteria

- A user can generate **exactly one chosen style** without initiating six extra requests (FR-007).
- In STRICT, original logo/label pixels are not replaced by generated text; no unsupported viewpoint is approved (FR-004/005).
- User can see cost estimate before request, actual usage when available, and "unknown" rather than fabricated precise cost otherwise (FR-014/015).
- No provider Key appears in browser persistent storage, Git, logs or downloadable project files (FR-009, NFR-001).
- QA can reject output regardless of attractive scene and block approved export (FR-012/013).
- PWA update notification never silently refreshes an active composition (FR-019).
- JSON schema and E2E test cases trace P0 FR IDs in [RTM](../00-governance/REQUIREMENTS_TRACEABILITY.md).

## Known constraints

Single original camera view cannot yield guaranteed true unseen surfaces. Source low resolution cannot prove fine text. Browser storage can be evicted; ZIP backup is required. Client-side pre-submit spend is a soft guard, not a provider hard cap. Hosted BYOK is not zero-knowledge. Product images may be copyrighted and must be authorized. Source provenance and rights are user-confirmed, not legally verified by AI.

## Exit gate

Pilot must demonstrate repeatably useful approved outputs across at least five distinct product categories, with measured **cost per approved asset**, identity veto rate, time-to-approve and customer willingness to use. Define release decision after pilot rather than assuming success.
