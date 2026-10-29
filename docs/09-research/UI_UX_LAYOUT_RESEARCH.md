# UI/UX Layout Research — Product Image Studio

**Status:** research and draft layout proposals, 2026-10-29. This is not an approved visual design or evidence of an implemented interface. The [UX specification](../01-product/UX_SPEC.md) owns the current product UX contract; [user flows](../01-product/USER_FLOWS.md), [PWA offline](../02-architecture/PWA_OFFLINE.md), and the decision register own their respective requirements. This report informs future design and tests without changing those decisions.

## 1. Problem and evidence

The intended seller needs to take one real product image through source confirmation, style selection, generation, source comparison, human review and export. The interface must make image fidelity, billable attempts and recovery visible while leaving useful space for the image, including on a phone. This is a **creative workbench plus job queue**, not a generic KPI dashboard.

**Evidence:** the original research examined a proposed seven-style BYOK PWA. As of 2026-10-30 a limited shell and local product/source workflows exist; the [task ledger](../08-delivery/TASK.md) records scoped Chromium evidence, not a complete product. KB-MCP `ui:visual-design-lifecycle` v2.1.1 and `pwa:product-standard` guide design and PWA constraints. External guidance is not evidence that sellers prefer the suggested design. Seller behavior, device mix, task times, breakpoint thresholds and visual direction remain untested.

**Initial jobs to test:** (1) create a usable image for a known SKU; (2) see which detail changed relative to the source; (3) safely decide whether to spend on a new attempt or export a reviewed result. Proposed evaluation outcomes: task completion with no assistance, time to first reviewed export, and observed review or retry errors. Record definitions and baseline before setting targets; no success threshold is asserted here.

## 2. Evidence-based patterns and applicability

| Reference and observed guidance | Applicable pattern | Boundary / decision |
|---|---|---|
| [Shopify media generation](https://help.shopify.com/en/manual/ai-powered-tools/media-generation) offers automatic subject detection, manual correction and prompt-based changes. | Keep source/subject correction close to the preview; progressive disclosure avoids overwhelming first-time users. | Vendor documentation is not a usability study; feature and plan availability vary. Do not copy brand or assume identical behavior. |
| [Photoroom Product Fixer](https://help.photoroom.com/en/articles/16187005-how-to-use-product-fixer) uses original and generated images and a selected repair area. | Put the original beside or immediately accessible from the result; let the user locate a suspect detail. | Repair may be imperfect; the proposed STRICT original-foreground pipeline must not be presented as generative product repair. |
| [W3C drag alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) requires a single-pointer non-drag alternative unless an exception applies. | Comparison, crop/position and mask actions need an appropriate non-drag method; keyboard support is also separately required. | A pair of source/output buttons is useful for comparison, but may not provide an equivalent mask-editing workflow. Test each action. |
| [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) addresses vertical content at 320 CSS px, with exceptions for inherently two-dimensional content. | Reflow controls and text to a single column; preserve deliberate pan/zoom for the image only where necessary. | The 320 px criterion is not a claim every canvas interaction is exempt. Test controls and information around the canvas. |
| [W3C minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) sets a 24×24 CSS px minimum with defined exceptions. | Aim for approximately 44×44 CSS px interactive areas per this project’s iOS-first standard, with spacing. | 44 is the project design target, not the WCAG AA minimum; actual fit and native-device behavior require tests. |
| [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes focus containment and inert background. | When a settings sheet is modal, keep a visible close control, manage focus and restore it on close. | A non-modal inspector or full-page mobile screen has different semantics; do not label it modal while the background remains interactive. |
| [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) explains that an on-screen keyboard or zoom can shrink the visual viewport independently of the layout viewport. | Test whether actions, fields and close controls remain reachable with the keyboard open and when zoomed. | Do not assume `dvh`, a single browser API or one CSS rule solves all iOS/Android keyboard cases. |
| [Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout) describes safe areas that keep important content clear of hardware and system UI. | Use safe-area-aware opaque top and bottom surfaces in installed mode. | Native guidance informs this web PWA; verify actual browser and standalone behavior on physical devices. |

## 3. Information architecture and navigation (draft)

- **Projects:** list or create SKU projects; show retained local assets and recovery/backup access. Empty state: one clear “Create project” action.
- **Product:** inspect original, confirm required identity/facts, rights and applicable lock mode; prepare or correct mask where STRICT requires it. Do not imply the model sees facts that are absent.
- **Studio:** select styles, configure only necessary options, review estimate and submit independent jobs. Style names and selection controls must remain understandable without imagery alone.
- **Results:** per-style attempt status, compare to source, make QA findings and approve/reject. The same attempt retains its identity across queue, compare and export.
- **Export:** select approved results and download with format and provenance; explicitly explain why unapproved/unknown results cannot be exported as approved.
- **Settings and help:** connection/session lifecycle, privacy, storage, theme and app update. Never show or retain the API key after connection contrary to the project security contract.

The main journey can be represented by **Product → Studio → Results → Export**, with Projects and Settings available outside it. This is a proposed navigation model, not a new scope or a requirement to force a linear wizard: users must be able to return to prior steps without losing drafts. Keep one current location indicator and one primary next action; treat deep settings as secondary.

## 4. Layout hypotheses and wireframes

These are structural sketches, not screenshots, visual anchors or proof of fit. All sizes below are test inputs, not fixed breakpoints. Switch layouts when the preview, labels and controls no longer fit, using measured content rather than a device name.

### Desktop: workspace / style setup

```text
+--------------------------------------------------------------------------+
| Projects / SKU name              Saved / Offline / Update    Settings    |
+--------------------------------------------------------------------------+
| Product  Studio  Results  Export                                           |
+----------------------+----------------------------+------------------------+
| Source & essentials  |                            | Style and output       |
| source thumbnail     |     Large product /        | Select style(s)        |
| facts / lock mode    |     scene preview          | ratio / quality        |
| mask controls        |                            | estimate / attempt     |
|                      |                            | [Review & generate]    |
+----------------------+----------------------------+------------------------+
| Attempt summary: 1 ready / 1 running / 1 needs attention                 |
+--------------------------------------------------------------------------+
```

The preview owns the largest region. The side panels can scroll independently only if they have a clear bounded purpose, visible heading and reachable final control. Keep the primary button and cost adjacent; never cover image details with status chrome. At intermediate widths collapse one inspector or stack sections before the canvas or labels become unusably narrow.

### Mobile: source → style → review

```text
+--------------------------------+
| < Projects   SKU name    More  |  opaque safe-area-aware header
| Product · Studio · Results     |  current step identified in text
+--------------------------------+
|                                |
|        Product preview         |  fit-to-screen, zoom controls
|                                |
+--------------------------------+
| Source / mask / facts          |  contextual expandable section
| Style selection                |  tap-select; no swipe-only control
| Status and cost explanation    |
+--------------------------------+
| [Review & generate]            |  only when applicable; safe area
+--------------------------------+
```

Prefer one primary vertical page scroll. Secondary controls may open a bounded sheet with its own content scroll; when it is modal, dim/inert the background, focus inside, and return focus on close. A sticky action bar is optional and must not cover content, conflict with a keyboard, or reduce the image to an unusable viewport; use bottom padding and test actual geometry. Hide/de-emphasize it while typing if needed, but retain an accessible way to finish the task. Test landscape and compact height independently.

### Review: focus on truth

```text
Desktop:   [Original + zoom]  |  [Selected output + zoom]  |  [QA findings]
Mobile:    [Original] [Output] [Split]    [Zoom −] [Zoom +] [Reset]
           [Image area: selected view or comparison]
           [Brand / label / geometry / crop findings]
           [Reject]                         [Approve]
```

Give original/output clear text labels, preserve a consistent crop/scale where comparison mode makes that possible, and offer reset and single-action toggles. If a draggable divider exists, add tap-to-position or equivalent controls and keyboard operation. Zoom and pan need pointer alternatives; mask editing needs equivalent non-drag selection/editing or a documented accessible alternative, not just a keyboard-only workaround. A screen reader needs a textual summary and navigable QA checklist; it cannot independently verify tiny visual label details, so human visual review remains necessary.

## 5. State and interaction contract (proposals consistent with current UX)

| State | Placement and useful action | Truth and recovery |
|---|---|---|
| Empty / first use | Image area explains missing source; file picker is visible. | Do not present a concept without source as an authentic SKU. |
| Upload / mask | Preview original before replacement; show mask edit, undo/reset and save status. | On save or quota failure retain the previous committed original, expose recovery and backup. |
| No connection / session expired | Explain beside Generate and in Settings; offer reconnect. | Preserve local work; never echo credentials or claim connectivity without evidence. |
| Ready to generate | Show selected styles, count, estimate, uncertainty and one action. | A preview or selecting a style must not submit a paid request. Each style is an independent job. |
| Running / partial | Each attempt shows its own status and available result; announce important changes politely. | Indeterminate progress when no reliable percentage exists. Avoid repeating every update in a live region. |
| UNKNOWN / timeout | Show on the affected attempt, with the possible charge and a clear manual retry action. | Do not auto-retry; present retry as a new potentially billable attempt and require acknowledgment. |
| QA failed / UNVERIFIABLE | Point to issue and reference; allow reject, better source or review. | A missing/illegible source cannot prove fidelity; no score overrides brand mismatch. |
| Offline | Persistent compact indicator; explain unavailable action near Generate. | Existing local editing/export is conditional on cached shell, retained data and device capability. |
| Update available | Non-blocking update action; keep active editing intact. | Save/flush drafts, user initiates update, show activation progress and recovery; no silent reload. |
| Export / success | Show selected approved files and explicit download action. | Distinguish prepared from actually saved/downloaded; never claim successful marketplace publishing. |

Billable actions and destructive deletion should use specific verbs, clear consequences and separate placement. Cost estimates are estimates, not final provider invoices; unavailable actual usage is unknown, not zero.

## 6. Visual system direction (unapproved)

Use a restrained neutral workspace so the product image and QA findings dominate. Establish semantic roles for canvas, surface, text, borders, focus, success, warning and error; support light/dark modes with measured contrast. Do not rely on red/green alone or add an “authentic” certification badge. Start with a small consistent spacing scale (4, 8, 12, 16, 24, 32 CSS px), readable text, visibly labelled controls and consistent focus states. These are draft tokens, not an approved brand palette or a replacement for a future component/token SSOT.

Core components: app shell and current-step navigation; source picker and preview; style selector; image comparison; mask tools; per-attempt status; estimate/charge confirmation; QA checklist; responsive sheet/dialog; export selector; offline/update notices. Each needs empty, disabled, focus, loading, error and recovery states when applicable. Use real-length English and Chinese sample strings during layout checks; language requirements and translations remain to be confirmed.

## 7. Validation plan and acceptance

Draft desktop/tablet/mobile [visual anchors](../10-design/VISUAL_ANCHORS.md) and a limited application shell now exist; the anchors remain PROPOSED and the app is not evidence of a completed end-to-end image studio. The task ledger records scoped Chromium checks, while target physical-device and seller tests remain open. Review representative anchors with the owner and test the relevant interactive flows before treating a visual design as approved. Record anchor version/status and evidence; do not self-approve or publish a gallery without authorization. Test only synthetic or rights-cleared product imagery.

**Prototype task sessions:** recruit 5–8 consenting target sellers when authorized; use a consistent script and do not guide the participant. Counterbalance comparison order where useful, ask participants to create one style, identify a label mismatch, interpret an UNKNOWN attempt and find an approved export. Record device, task outcome, observed errors, time and a brief anonymized observation; ask permission before recording. A small convenience sample can expose friction but cannot estimate population prevalence.

**Engineering acceptance, once implemented:**

1. At 320, 375, 390, 768, 1024 and 1280 CSS px plus actual target devices, verify no clipped controls or accidental page-level horizontal overflow; image-specific two-dimensional interaction may need pan. Test landscape, long SKU/style names and translated copy.
2. At real 200% browser zoom and the applicable 320 CSS px reflow condition, verify content and actions remain accessible; the test viewport alone does not prove real zoom behavior.
3. On mobile, inspect collapsed and expanded settings, modal close and focus return, scroll at top/middle/bottom, action-bar clearance, keyboard shown/hidden, source/output switch, mask controls and safe areas. Measure rectangles rather than relying only on screenshots.
4. On desktop/tablet, verify panels do not obscure the canvas, independent scroll areas retain reachable titles/actions, focus order is logical and compare/QA works with keyboard and single-pointer alternatives.
5. Test empty, offline, 429, expired session, per-style partial success, UNKNOWN, retry acknowledgment, rejected/UNVERIFIABLE QA, storage failure, update activation and reduced motion. Verify announced status does not spam.
6. Run relevant automated accessibility checks and manual keyboard/screen-reader checks; inspect real browser console/network without exposing image contents or credentials. Capture sanitized screenshots and record actual device/browser/version and unresolved failures.

**Owner decisions still open:** visual style and branding, supported locales, device priority, accessible mask editing approach, exact onboarding/cost wording, and review/approval of proposed visual anchors. Key custody, model, privacy and production release decisions remain governed by the existing decision register.
