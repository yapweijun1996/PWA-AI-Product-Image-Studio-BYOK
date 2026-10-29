# Feature Priority and MVP Cuts

## P0 — Shipping blocker

**SKU Source + Facts**: upload PNG/JPEG/WebP, preserve originals, validate dimensions/size, storage quota and rights acknowledgement; create verified facts.  
**Brand Lock**: choose STRICT/BALANCED/CREATIVE, editable mask/transparent source, source-angle restrictions, product truth, approved-output gate.  
**AI**: 7 independent style IDs, 1–7 selectable outputs, OpenAI Flare/Sunburst adapter with allowlist, explicit quality/size, separate job attempt history.  
**BYOK**: protected session connect/refresh/disconnect, deployment decision, authenticated public gateway, CSRF, per-session limits, no browser Key persistence.  
**Cost**: before-submit estimate and soft budget; actual response usage if available; UNKNOWN retry protection.  
**QA/Export**: weighted review + hard veto, manual approve, source comparison, approved-only export, hashes/manifests.  
**PWA**: offline local view/edit/export; SW update UX, iOS safe areas and A11y.  
**Release**: tests and security gates, verified deployment evidence.

## P1 — after proven single SKU workflow

- Seller Brand Kit with exact logos/palettes (non-generative overlay).
- Multiple source angles, per-variant assets, controlled grouped batch operations.
- Export dimension presets for platform channels; validate CURRENT platform rules first.
- Listing copy/Alt text from verified product facts only, with human review and localization.
- Prompt A/B comparisons, performance dashboards, cost and QA funnel analytics.
- Optional automatic segmentation with mask quality confidence; manual fallback remains.

## P2 — deferred

- Shopify/Shopee/Lazada API sync and write permissions; video generation; cloud/team collaboration; multi-provider marketplace; billing platform; SaaS subscription.

## De-scope discipline

Never add video or parallel multi-SKU batching before passing the STRICT real-label pilot. Avoid custom MLOps or a server image store in P0. Manual mask editor is a necessary product truth control, not optional visual polish.
