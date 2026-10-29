# Architecture Decision Records (Proposed)

## ADR-001 — Strict fidelity via non-destructive compositing

- **State:** CONFIRMED product rule, implementation approach PROPOSED.
- **Context:** Text-only instructions cannot prevent brand label / Chinese text drift.
- **Decision:** maintain original-source foreground with independent mask; generate environment separately; browser composite. Unseen angles explicitly unsupported in STRICT.
- **Tradeoff:** better truthful branding, less flexible viewpoint and more mask/edit work.
- **Rejected:** prompt-only "preserve exact text" as a guarantee; visually indistinguishable output counted as proof without source comparison.
- **Verify:** label ROI pixel/source audit, mask edge QA, human compare, category fixtures.

## ADR-002 — BYOK with trusted gateway

- **State:** PROPOSED, security review and owner sign-off required.
- **Context:** Browser-distributed secrets can be stolen; OpenAI Help recommends backend routing.
- **Decision:** same-origin authenticated gateway, short-lived encrypted session vault, revocation and audit without Key logging.
- **Tradeoff:** operator receives Key temporarily; cannot market as pure zero-knowledge.
- **Rejected:** store Key in localStorage/IndexedDB/Service Worker or commit in GitHub.
- **Verify:** threat test, deletion, authz, CSP, cookie flags, log scan, TTL and key rotation.

### Owner-selected trust boundary

The owner selected a **self-hosted gateway** for the initial implementation. The seller controls the gateway and provider key; this does not approve hosted operator custody or production deployment. Gateway runtime, authentication, secret configuration, retention and operational controls remain open and require design and security review. The hosted encrypted-session design above remains a proposed alternative, not the approved initial implementation.

## ADR-003 — Local-first PWA, cloud image generation

- **State:** PROPOSED.
- **Decision:** client IndexedDB owns user image assets and job history; Service Worker caches shell only. Online generation via gateway. ZIP backup/restore.
- **Tradeoff:** local storage quota/eviction, browser-only device data, no automatic cross-device sync.
- **Verify:** offline E2E, quota and import tests, WebKit install/update tests.

## ADR-004 — Independent style jobs + immutable attempts

- **State:** PROPOSED.
- **Decision:** stable 7 preset IDs, one job per selected style, one Attempt per provider call, explicit paid retry, UNKNOWN-safe recovery.
- **Tradeoff:** more bookkeeping but safer billing and partial failures.
- **Verify:** 1-of-7, 3-of-7, 7-of-7 request count, idempotency and timeout tests.

## ADR-005 — OpenAI model choice / upgradeability

- **State:** PROPOSED with dated official provider docs.
- **Decision:** use adapter with `gpt-image-2.5-flare` as speed option and `gpt-image-2.5-sunburst` as precision option. Version model IDs and quality; separate cost estimation from observed charges.
- **Tradeoff:** vendor changes require release review; no untested dynamic model list.
- **Verify:** live redacted test, parser contract/usage fallback, sandbox spending.

## ADR-006 — Browser-facing Pi Agent integration

- **State:** Owner confirmed Pi-based browser-facing Agent and OpenAI BYOK image generation; runtime architecture and integration are PROPOSED, not implemented.
- **Context:** Pi Coding Agent is a terminal/Node or Bun SDK agent, not an isolated browser runtime. Its default coding tools may read, change and execute files with the process account's permissions; project trust and tool prompts are not OS isolation.
- **Decision direction:** Keep the PWA as the browser UI and the confirmed user-hosted gateway as the initial trust boundary. Evaluate a dedicated Node/Bun Pi host that exposes only explicitly defined, scoped image-workflow tools; route paid OpenAI image calls through the trusted provider adapter after user authorization. No generic shell, filesystem, arbitrary URL fetch, arbitrary extension loading or shared host credential access for end-user sessions. Pin a tested Pi version after compatibility review.
- **Open:** whether the Node/Bun SDK host sits within the self-hosted gateway or as a separate isolated service; principal/session binding, per-user credential handoff, authorization, prompt-injection defense, execution isolation, transcript redaction, tool schema, retry/usage handling and lifecycle. Do not substitute a hosted key-custody model without explicit approval.
- **Tradeoff:** SDK preserves Pi session/tool semantics but is not proof of browser support, multi-user isolation or safe image generation. The installed Pi image-model documentation shows OpenRouter examples; direct OpenAI image model availability through Pi has not been established. A bounded custom provider adapter remains a design option, not verified capability.
- **Verify before release:** mocked tool allowlist and injection tests; no host filesystem/shell access; authorization and cross-user isolation; no key in browser persistence or agent output; explicit cost approval; UNKNOWN/no-auto-retry; session and resource cleanup; controlled owner-approved live provider test.
- **Rollback:** disable the Pi integration and revert to the existing direct, user-confirmed generation workflow; preserve local originals, jobs and approvals. No code or runtime change has been made.
- **References:** [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Pi security](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md), [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation).

## ADR amendment template

`ADR-ID | Title | Author | Date | State | Scope | Options | Decision + user approval evidence | Security/Data impact | Migration | Test evidence | Rollback | Supersedes`.
