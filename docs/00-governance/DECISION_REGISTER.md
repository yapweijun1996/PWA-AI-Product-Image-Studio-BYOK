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
| DEC-018 | Accept the current mobile retry flow after an UNKNOWN outcome; refine wording later | CONFIRMED INTERACTION DIRECTION | Owner accepted the sequence reviewed with a synthetic screenshot on 2026-10-31: check provider billing and rate limits, confirm and record the review, prepare the retry, then separately authorize the new request. Wording was revised on 2026-11-01; user review of the revised copy remains pending. This decision does not establish real billing, device or accessibility acceptance, or approve other interactions or visual anchors. |

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
