# UX / Information Architecture / Accessibility

For research-backed layout hypotheses, structural wireframes and a proposed validation plan, see [UI/UX Layout Research](../09-research/UI_UX_LAYOUT_RESEARCH.md). Those drafts are not approved designs or evidence of an implemented UI; this document remains the current UX contract.

## App navigation

| Screen | Primary action | Secondary actions / states |
|---|---|---|
| Home | Create SKU | Recent projects, storage usage, offline indicator |
| Product Workspace | Upload / replace source | Facts, variants, rights confirmation, mask edit, lock modes |
| Seven-Style Studio | Select styles + generate | Per-style previews, quality/ratio/model, cost estimate |
| Job Queue | Review each attempt | Pending/running/succeeded/UNKNOWN/retry/refund-is-not-guaranteed warning |
| Compare & QA | Source/output slider & veto checklist | Side-by-side, mask overlay, findings, approve/reject |
| Export | Download selected approved assets | Format presets, output manifest, ZIP |
| Settings | Connect / Disconnect OpenAI BYOK | Privacy controls, storage cleanup, theme, version/update |
| Help / Disclosure | Learn STRICT limits | Vendor billing, AI imagery disclosure, issue resolution |

## Mobile-first interaction

- Primary CTA remains visible without overlapping safe area, home indicator or keyboard.
- Full-width product preview, swipeable style cards, clear separation between "Preview" and "Pay to Generate".
- Desktop supports side-by-side panels for mask and QA; mobile uses full-screen comparison with zoom and `source ⇆ output` toggle.
- One SKU path should not force user to fill in every possible product attribute; required invariants are confirmed explicitly.
- Drag-and-drop, paste, file picker with equally functional touch input. Preview every upload before mutation.
- Keep buttons at ~44×44 CSS px, inputs >=16px on iOS, keyboard focus-visible, accessible labels, tooltips not sole source of information.
- Use live regions for job status without excessively announcing each progress event; reduce animations for `prefers-reduced-motion`.

## States and copy contracts

- `READY` / `OFFLINE` / `UPDATE AVAILABLE` / `UPDATING` / `ERROR` are distinct app-wide states.
- `UNKNOWN`: "Your request may have been processed and charged. We will not retry automatically." (explain with Chinese translation in UI).
- `UNVERIFIABLE`: "Reference cannot prove label fidelity; review a higher-resolution source before approval."
- `STRICT`: "Preserve original product foreground; background may be AI-generated."
- `CREATIVE`: "Concept image — product facts and appearance may be fictional."
- `BUDGET`: provider's official billing is authoritative; estimated token charges may differ.

For the owner-accepted mobile UNKNOWN retry sequence, see [DEC-018](../00-governance/DECISION_REGISTER.md). Improve its wording in a later task while preserving the separate external review, recorded acknowledgment, retry preparation and fresh authorization. Acceptance of this interaction does not complete device, accessibility, real-provider or full error-matrix validation.

## Standard PWA requirements

Apply KB `pwa:product-standard`:

- iPhone standalone with `viewport-fit=cover`, padding from `env(safe-area-inset-*)`.
- Solid theme-aware status bar/top background; no transparent chrome as default.
- Versioned caches and reliable SW update discovery; visible "Update now" action; avoid destroying unsaved masks; show loader and wait for controller activation.
- Offline shell with explicit network-disabled controls. Do not cache API traffic, credentials or seller images in generic Service Worker caches.
- For long scroll pages, intelligent hide/reveal top bar and contextual scroll-to-top (skip if no-scroll view).
- Test light/dark contrast and responsive no-overflow. Real iOS install test before release.

## Design system direction (proposed)

Neutral, readable editor (not decoration-first), high contrast for QA findings, clear costs, no confusing brand colors. Separate dangerous/billable actions visually from harmless local edits. Avoid badges that imply automatic product authenticity certification.
