# Visual Design System — Proposed Candidate

**Status:** Overall visual direction CONFIRMED; individual anchors and other interactions remain PROPOSED except where separately accepted. Version `0.1.0`, created 2026-10-29. This folder is the single index for the current *candidate visual anchors*, not evidence of an implemented UI, a functioning component library or verified accessibility. Existing [UX specification](../01-product/UX_SPEC.md), [SSOT policy](../00-governance/SSOT_POLICY.md), [decision register](../00-governance/DECISION_REGISTER.md), and [style presets](../../contracts/style-presets.json) take precedence over anything drawn or written in a generated image. The [image catalog](VISUAL_ANCHORS.md) tracks individual references and status.

## Owner direction — 2026-10-31

The owner accepted the **overall visual direction** represented by desktop workspace [01](visual-anchors/01-desktop-product-workspace.png), tablet comparison [30](visual-anchors/30-tablet-compare.png) and mobile comparison [43](visual-anchors/43-mobile-compare.png), with specific interactions to be reviewed separately. This is an initial direction decision, not individual approval of these images, their generated copy, controls, features, fidelity claims or QA results. Known inaccuracies remain subject to correction; critical states, component specimen, individual anchors and accessibility verification remain open under T-084.

The owner separately accepted the current mobile UNKNOWN retry interaction, with wording to be refined later; [DEC-018](../00-governance/DECISION_REGISTER.md) records the accepted sequence and scope. This decision does not approve individual visual anchors or other interactions.

## Design intent

A calm, image-first workspace for sellers to prepare and review product images: neutral light surfaces, charcoal text, one deep teal action color, restrained borders, compact but readable controls, an expansive preview and clear distinction between local actions and potentially billable generation. Dark mode is a proposed alternative. Product names, thumbnails, accounts, values, and screens in the illustrations are fictional.

## Candidate design foundations

- **Layout:** desktop image canvas between source and contextual inspector; tablet collapses secondary panels; mobile prioritizes a single column, safe areas, accessible controls and a focused action. Actual breakpoints are not decided by these images.
- **Color roles:** page background, raised surface, image canvas, text, muted text, border, accent action, focus, success, warning and error. Colors in images are illustrative; precise values, accessibility contrast and theme mapping have not been approved or measured.
- **Type and spacing:** legible hierarchy with a compact title, section labels, body text and supporting metadata. The research starting scale is 4 / 8 / 12 / 16 / 24 / 32 CSS px; final font family, type scale and spacing tokens require design review and implementation testing.
- **Components to specify:** app shell, navigation, image preview and source picker, style selector, mask controls, cost review, per-attempt status, original/result comparison, QA checklist, buttons, form fields, notices, dialogs/sheets, export selection and update/offline notice. Each interactive component needs documented semantics and supported states in a future implementation-owned component library.
- **Behavior:** wire UX contracts to canonical docs, not image text. No credential in persistent frontend state; user authorization before paid submission; UNKNOWN remains distinct from success/failure; no auto-retry for ambiguous attempts; user initiates updates; source-derived foreground and manual QA do not guarantee pixel-perfect export.

## How to use images

1. Each image is a static generative illustration with an ID, purpose, device category and PROPOSED status in the catalog. They are **not** pixel-perfect blueprints, a working prototype, proof of actual functionality, or an accessibility audit.
2. Review layout and hierarchy, then review all generated copy, icons, controls, costs and product depiction against authoritative contracts. Incorrect, inconsistent or invented details must not be implemented.
3. Known defects include screen 01 implying unqualified exact preservation across all generated images; screen 03 suggesting unsupported project sharing and new viewing angles; screens 19 and 30 showing checked QA results without evidence; screen 40 suggesting a generic credits system instead of a clear BYOK provider-cost estimate; and screen 43 showing an ambiguous use-image action without the required QA decision. The superseded first version of screen 42 incorrectly asserted no charge; v2 corrects the visible warning but still requires an explicit retry acknowledgment in the interaction specification. These are illustrative content, not feature requirements. Other images require individual review and may contain additional defects.
4. The owner accepts, requests changes or rejects each candidate. Record approval with version and date before treating a revised anchor as authoritative. Do not self-approve or change security, feature or data contracts through the visual gallery.
5. On implementation, create a real component and token source of truth appropriate to the chosen stack, document semantics, and verify against approved anchors in real mobile/tablet/desktop browsers, keyboard/screen reader journeys, and physical iOS/Android devices.

## Generation provenance

Built-in ImageGen, `ui-mockup` use case, with `01-desktop-product-workspace.png` as common style reference for subsequent screens. Prompts requested a neutral, slate and deep-teal image-first UI, fictional unbranded amber bottle when relevant, and each cataloged task and device. Reusable prompt framing and per-image subjects are in [VISUAL_ANCHORS.md](VISUAL_ANCHORS.md). Generated text is probabilistic; presence of text is not evidence that the named behavior exists.

## Acceptance before promotion

- Owner reviews a coherent desktop/tablet/mobile family, key error states and the component specimen; records Accept / Change / Reject.
- Resolve factual issues, unsupported features, misleading costs and design inconsistencies; establish accessible tokens and interaction specs.
- Independently verify user tasks, focus and screen-reader behavior, color contrast, reflow, pointer alternatives, real devices, and offline/update/UNKNOWN flows when implementation exists.
- Only approved and versioned anchors become a visual implementation reference. Update the catalog and retire superseded versions without rewriting history.

## Implemented UI foundations — option A, 2026-11-12

The owner authorized option A: redo the PWA experience while retaining generation and local data, with push to main. DEC-020 controls the automatic primary journey; the older visual anchors remain historical direction, not specifications for the automatic workflow.

Implementation ownership:

- `app/src/ui/tokens.css`: light/dark semantic colors and shared dimension scale. Dimension tokens retain existing editor geometry during migration; changing them is a cross-page change. `theme-color` reads the active page token.
- `app/src/ui/components.tsx`: Button, Input, Select, Textarea, GuideStep, PageHeader and Progress. Native control semantics, event handlers, refs and explicit form types are preserved. Shared controls render native elements; page code does not recreate their tags.
- `app/src/styles.css`: component presentation and page layout. Numeric media-query breakpoints are the exception to token-only dimensions because CSS custom properties do not resolve in media conditions.
- `/design-system`: live component/state specimen. `npm run check:ui`, included in build, enforces the token/control boundary.

Primary navigation is Create / My images / Settings / Help. The automatic source upload starts the existing seven-attempt pipeline; results appear independently. My images shows local source thumbnails and opens a saved run without sending a request. Legacy projects remain available through Advanced workspace. No database migration or deletion is part of this change.

Interaction contracts:

- Upload: disabled without a usable session or while unsaved outputs need protection. Existing cost, UNKNOWN and request guards remain authoritative.
- Result/export: pending and failed states are visible; single and ZIP downloads prevent duplicate preparation. Export-in-progress protects navigation. Partial output is downloadable and is never described as human approval.
- Settings: Pages prioritizes BYOK setup; privacy detail is progressively disclosed while key lifetime and extension exposure remain visible. Local gateway mode retains its separate credential contract and original control order.
- Navigation: keyboard focus moves into the destination; query changes also respect unsaved navigation protection. Long pages expose a safe-area-aware back-to-top action. Sticky chrome hides/reveals with a movement threshold; focus and reduced-motion preferences take priority.
- Responsive: compact wrapped navigation on mobile, sidebar on desktop; content and result cards reflow. Light and dark use opaque chrome. Input text is at least 16 CSS px.

PWA Standard compatibility: KB `pwa:product-standard` registry v1.0.1 retains the v1.0 rules and adds explicit active-request/draft protection, app-scoped cleanup and separate automated versus physical-device evidence. These additions are compatible with DEC-019/020 and the existing worker protocol. This release adopts that acceptance contract; it does not claim physical iOS or assistive-technology verification.

Future extension boundaries: do not duplicate controls in new pages, change the generation contracts for visual convenience, or confuse the specimen page with complete accessibility certification. Complex protected-region editors retain their specialized layout and domain controls on the shared foundations.
