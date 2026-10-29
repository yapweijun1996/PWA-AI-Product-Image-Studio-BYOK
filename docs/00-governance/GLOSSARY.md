# Glossary / Terminology

| Term | Practical meaning |
|---|---|
| SSOT | Single Source of Truth — one canonical owner for each contract |
| BYOK | Bring Your Own Key — seller supplies an API key; hosted operator may still be trusted with it |
| SKU | Stock Keeping Unit — one concrete real product/variant |
| SourceAsset | Original authorized photo or artwork; never silently overwritten |
| VerifiedFact | Explicit user fact or visible source evidence with provenance; not AI inference |
| Brand Lock | Product-preservation rules controlling labels, geometry, material, color and claims |
| STRICT | Original foreground pixels/artwork preserved through compositing; no unseen-angle fabrication |
| BALANCED | AI edits with best-effort reference fidelity; accuracy not assured |
| CREATIVE | Concept artwork permitted; clearly not an exact real SKU photo |
| Mask | Alpha region separating unchanged product from generated environment |
| Composite | Merge unchanged foreground with AI-created scene, shadows, occlusion and lighting |
| Style preset | One of seven stable photography environment instructions |
| GenerationJob | Logical style requested; each actual provider call is an Attempt |
| Attempt | Billable-or-possibly-billable request with immutable lineage and outcome |
| UNKNOWN | Provider request may have succeeded/billed but client did not receive definitive result |
| QA veto | Non-negotiable mismatch that blocks STRICT approval, regardless of numeric score |
| Human-in-the-loop | Manual confirmation required before labeling visual commercially approved |
| Cost estimate | Approximation, not provider hard spend cap or bill |
| PWA | Progressive Web App with install/offline/update UX; manifest alone insufficient |
| DO | Cloudflare Durable Object; proposed store for short-lived encrypted sessions |
| CSP | Content Security Policy; browser defense-in-depth vs XSS |
| ADR | Architecture Decision Record — options, status, consequences and owner |
