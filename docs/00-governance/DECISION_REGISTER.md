# Decision Register / Architecture Decisions (ADR Index)

**Snapshot:** 2026-10-29. User intent is distinguished from architecture recommendations. **No production or deployment approval is inferred.**

| ID | Decision | State | Basis / next action |
|---|---|---|---|
| DEC-001 | Repository name exactly `PWA-AI-Product-Image-Studio-BYOK` | CONFIRMED | Explicit user preference; GitHub repo metadata lookup located repository; code not established |
| DEC-002 | Initial provider = OpenAI using seller's key (BYOK) | CONFIRMED | User direction; do not implement unsafe browser storage |
| DEC-003 | Seven modes: Studio, Hero, Lifestyle, Flat Lay, Macro, UGC, Billboard | CONFIRMED | KB-MCP skill `image:product-photography-brand-lock` v1.0.1 |
| DEC-004 | Product identity is primary; STRICT for real SKU with compositing | CONFIRMED AS PRODUCT RULE | KB skill; source image is source of truth; no promise of generative pixel lock |
| DEC-005 | Follow KB-MCP `pwa:product-standard` | CONFIRMED AS STANDARD | iOS safe area, controlled SW update, offline definition, accessibility |
| DEC-006 | React + Vite + TypeScript + local-first IndexedDB | PROPOSED | Fits PWA and independent jobs; confirm existing repo and migration constraints |
| DEC-007 | Cloudflare Pages + same-origin Workers hosted BYOK gateway | PROPOSED ALTERNATIVE | Not selected for the initial implementation; public custody remains subject to separate approval and security review |
| DEC-008 | Hosted encrypted user-key session vault | PROPOSED ALTERNATIVE | Not the initial self-hosted path; public custody requires separate owner approval and security review |
| DEC-009 | Production public BYOK requires verified-user authentication + per-user quotas | PROPOSED SECURITY GATE | Identity provider, access policy and region TBD |
| DEC-010 | P0 single SKU, 1–7 independent jobs, per-job QA and human approval | PROPOSED MVP | Prioritize one successful real SKU workflow before batch/video |
| DEC-011 | Weighted QA 35/25/15/15/10 with editorial threshold 85 and hard brand veto | CONFIRMED AS SKILL RULE | Requires per-image human review; not an automated certificate |
| DEC-012 | User-hosted gateway with server-configured provider key | CONFIRMED DIRECTION | Owner selected server configuration; browser never inputs or receives the provider key. Runtime, authentication, secret operations and deployment remain open |
| DEC-013 | Default image models Flare (speed) and Sunburst (precision) | PROPOSED WITH CURRENT EVIDENCE | Official 2026-10 docs; model IDs and rates must be checked before coding |
| DEC-014 | No team sync, video, or ecommerce live publish in MVP | PROPOSED | Keep launch scope bounded; expansion follows validated pilot |
| DEC-015 | No automatic retry for UNKNOWN outcome after provider request | PROPOSED RELIABILITY GATE | Billing/duplication risk; escalate explicit consent to retry |
| DEC-016 | Browser-facing product uses a Pi-based agent and the user's OpenAI key for image generation | CONFIRMED PRODUCT DIRECTION; IMPLEMENTATION OPEN | Explicit owner direction 2026-10-29. Pi execution environment, restricted tool interface and provider/session isolation remain to be designed and verified. |
| DEC-017 | Use one UUID for each image request and its `clientAttemptId`; persist non-secret attempt state to prevent duplicate submission | CONFIRMED DIRECTION | Owner selected the unified-ID option. Repeated attempts must not resend; an ambiguous retry needs a new UUID and approval. This does not authorize a paid call or deployment. |
| DEC-020 | Pages primary UX = upload once, automatically produce seven complete downloadable images | CONFIRMED DIRECTION | Explicit owner request and implementation/main push authorization. Automatic local selection, composition and technical checks replace manual masks/forms/style consent/review in this path. Existing human-reviewed projects remain in Advanced workspace. Machine checks are not human approval or a brand certificate. See ADR-020. |
| DEC-019 | GitHub Pages supports direct browser BYOK via AI SDK; key storage superseded by DEC-021 | CONFIRMED DIRECTION | Explicit owner request 2026-11-11, followed by implementation and main push authorization. Supersedes DEC-012 for the Pages build only; self-hosted gateway remains an alternative. No hosted key custody or paid test is authorized. See ADR-019. |
| DEC-018 | Accept the current mobile retry flow after an UNKNOWN outcome; refine wording later | CONFIRMED INTERACTION DIRECTION | Owner accepted the sequence reviewed with a synthetic screenshot on 2026-10-31: check provider billing and rate limits, confirm and record the review, prepare the retry, then separately authorize the new request. Wording was revised on 2026-11-01; user review of the revised copy remains pending. This decision does not establish real billing, device or accessibility acceptance, or approve other interactions or visual anchors. |

| DEC-021 | Persist Pages BYOK key in a dedicated device-local IndexedDB store | CONFIRMED DIRECTION | Explicit owner request 2026-11-12 supersedes memory-only custody in DEC-019. No hosted custody, plaintext export or paid verification is authorized. Reload originally restored credentials without spending consent; DEC-023 supersedes that repeated-setup behavior. Removal propagates to open tabs. See ADR-021. |

## Approval-needed decisions before implementation / public release

| Open ID | Question | Options / implication | Owner / blocker |
|---|---|---|---|
| OPEN-001 | Self-hosted deployment and distribution? | Select runtime, hosting and operational procedure; public operator-hosted custody is not approved | Product owner + implementation/security review |
| OPEN-002 | Identity model for public release? | Cloudflare Access beta / email magic-link / passkey / self-host; no unauthenticated public BYOK proxy | Product owner + security reviewer |
| OPEN-003 | Self-hosted secret provisioning and rotation? | Owner configures the server key outside the browser; select secure storage, rotation and removal mechanics and review process isolation | Security engineer |
| OPEN-004 | Default local retention and backups? | No server image storage proposed; provider authorization session <= 60 minutes recommended; browser local data until user deletion; confirm privacy notice | Product owner |
| OPEN-005 | Masking quality floor? | Manual mask MVP; optional automatic local segmentation subject to benchmark | Visual QA reviewer |
| OPEN-006 | Provider usage response guarantees? | Adapter must handle missing usage; reconcile billing; run sandbox contract test | Integration engineer |
| OPEN-007 | Output channel presets? | Confirm current Shopee/Lazada/Shopify dimensions and policies from official docs before claiming compliance | Product owner |
| OPEN-008 | Gateway request correlation and duplicate handling? | Owner selected matching `X-Client-Request-Id` and `clientAttemptId`, with persistent non-secret no-resend records. Journal implementation, principal scope, safe retention/recovery and independent security review remain open. | API / security engineer |
| OPEN-009 | QA score rounding and unbranded weights? | QA schema permits fractional scores; define rounding, threshold behavior and exact unbranded weighting without weakening the hard veto | Product owner + visual QA reviewer |

No open item may be silently marked CONFIRMED. Update `docs/02-architecture/ADR.md` with chosen implementation and rejected alternatives.

## DEC-022 — quality remediation and optional reference editing (CONFIRMED DIRECTION, 2026-11-12)

The owner explicitly selected A+C after the [13-advisor review](../09-research/AUTOMATIC_OUTPUT_REVIEW_2026-11-12.md): implement quality fixes and an optional reference-image/multi-view path. This supersedes only the earlier documentation-only proposal boundary. STRICT remains the image-private default with seven canonical output IDs; six provider requests plus a local authentic Detail crop replace seven paid backgrounds. `flat_lay` is honestly labeled Tabletop at the supplied source angle. Optional Reference-guided allows the primary photo plus up to two additional views after separate tab-memory transmission consent, using the existing pinned model and SDK at the fixed Images edits endpoint. Reference concepts can alter product identity and receive no pixel-preservation claim. The selection does not authorize paid tests, new models/providers, hosted key custody or option B's full preview/comparison/regeneration workflow. See ADR-022, T-100–T-107 and [implementation evidence](../09-research/QUALITY_REFERENCE_IMPLEMENTATION_2026-11-12.md). The manager retains prior main-push/Pages delivery authorization, subject to independent verification.

## DEC-023 — Remember upload authorization and show monthly local usage (CONFIRMED DIRECTION, 2026-11-12)

The owner explicitly rejected repeated session-budget setup and requested a monthly budget/usage view. Save upload authorization once alongside the device-local credential, restore it on reload, and require no mandatory budget amount. A monthly local estimate limit is optional and persists until changed. Existing saved keys without authorization require one explicit opt-in; replacement/removal revokes the prior authorization. This supersedes DEC-021/ADR-021 and earlier automatic-flow requirements only where they require renewed spending consent after every reload. Reference-image transmission remains a separate tab-only consent under DEC-022. Monthly local reservations and sent-attempt estimates must be labeled as local planning records, never actual provider spend or an account-wide billing cap. No paid verification or new provider access is authorized. Retain uncertainty holds and zero automatic retries. See ADR-023 and T-108.


## DEC-024 — Subject-aware production flow and result inspection (CONFIRMED DIRECTION, 2026-11-12)

The owner approved the complete P0–P5 redesign after a reference-board Detail crop included specification text and the seven styles remained insufficiently distinct. This now selects the formerly deferred preview/comparison/single-item-regeneration scope. Desired behavior: reliable subject extraction where evidence permits, honest unavailable Detail, distinct composition plans, new-policy Campaign artwork as the main `billboard` result, optional separate local display preview, localized concise result cards, technical/semantic/duplicate findings without a certification claim, and immutable retry history.

Reference-guided may add one bounded source-analysis call and one bounded batch-quality call using the fixed OpenAI Responses endpoint and `gpt-5.4-mini-2026-03-17`. Existing image generation remains `gpt-image-2.5-flare`. Reference-mode consent must explicitly include these purposes and estimated costs; analysis must not silently inherit authorization for unrelated data transmission. Reserve inclusive costs before the first paid call. STRICT keeps all input images local and reports unassessed semantics honestly. No real keys, paid implementation tests, model-generated billing claims or automatic paid retries are authorized. Existing persistent upload permission, optional monthly limits, data retention and user-driven PWA updates remain.

This is implementation authorization, not evidence of model recognition accuracy or commercial photography acceptance. Final status requires source, negative-path tests, browser evidence and independent review; real-provider/rights-cleared-SKU evaluation remains separately unverified. See ADR-024 and T-109–T-113.

## DEC-025 — Continue automatic uploads after an uncertain attempt (CONFIRMED DIRECTION, 2026-11-13)

The owner requests that an already configured key remain usable without repeatedly requiring billing review after an interrupted request. In the automatic Pages workflow, an older UNKNOWN or interrupted SUBMITTED attempt remains unchanged and potentially billable but does not, by itself, prohibit a new user-initiated upload or separately confirmed single-image attempt. Each new attempt has a fresh ID and existing authorization and local estimate checks. Never automatically retry or reuse the old attempt. Keep source-transmission consent, storage integrity, cross-tab coordination and provider retry-after/wait handling. This supersedes the global automatic-workflow uncertainty-hold portions of DEC-023/DEC-024; Advanced workflow rules remain separate. No real credentials or paid tests are authorized by this change. See ADR-025 and T-115.
