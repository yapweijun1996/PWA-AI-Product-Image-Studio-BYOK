# Architecture Decision Records (Proposed)

## ADR-001 — Strict fidelity via non-destructive compositing

- **State:** CONFIRMED product rule, implementation approach PROPOSED.
- **Context:** Text-only instructions cannot prevent brand label / Chinese text drift.
- **Decision:** maintain original-source foreground with independent mask; generate environment separately; browser composite. Unseen angles explicitly unsupported in STRICT.
- **Tradeoff:** better truthful branding, less flexible viewpoint and more mask/edit work.
- **Rejected:** prompt-only "preserve exact text" as a guarantee; visually indistinguishable output counted as proof without source comparison.
- **Verify:** label ROI pixel/source audit, mask edge QA, human compare, category fixtures.

## ADR-002 — BYOK with trusted gateway

- **State:** Initial self-hosted/server-configured key direction CONFIRMED; authentication, secret provisioning and runtime implementation remain PROPOSED and need security review.
- **Context:** Browser-distributed secrets can be stolen; OpenAI recommends backend routing.
- **Decision:** the owner configures the provider key on their self-hosted server; the browser connects to a short-lived provider authorization session without submitting or receiving the key. Disconnect revokes only that authorization.
- **Tradeoff:** the owner operates and protects the server; removing the configured key and provider-side revocation are separate operations.
- **Alternative:** operator-hosted encrypted key custody remains unapproved and requires separate owner approval.
- **Verify:** authz, CSRF, session expiry, origin checks, key isolation from Pi and browser, log scans, server-key rotation/removal and provider-error redaction.

### Owner-selected trust boundary

The owner selected a **self-hosted gateway with server-configured provider key** for the initial implementation. This does not approve operator-hosted custody or production deployment. Gateway runtime, authentication, exact secret configuration, retention and operational controls remain open and require design and security review. The old `/api/v1` browser-key-submission proposal is superseded by the proposed `/api/v2` contract; no runtime or deployed migration exists.

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
- **Decision direction:** Keep the PWA as the browser UI and the confirmed user-hosted gateway as the initial trust boundary. Run the Pi host separately from the key-holding process under reviewed OS-level permissions/isolation; an SDK tool allowlist alone is not a sandbox. Expose only scoped image-workflow IPC mediated by the trusted gateway and bound to the current principal, provider session and approved attempt. Pi must not receive provider keys, browser session/CSRF/approval credentials or approval-issuance authority, and must not have generic shell, filesystem, arbitrary URL fetch or extension loading.
- **Open:** actual process and OS isolation design, principal/session binding, server key configuration, authorization, prompt-injection defense, transcript redaction, tool schema, retry/usage handling and lifecycle. Do not substitute hosted key custody or expose a local-only prototype to a LAN/public network without explicit approval.
- **Tradeoff:** SDK preserves Pi session/tool semantics but is not proof of browser support, multi-user isolation or safe image generation. The installed Pi image-model documentation shows OpenRouter examples; direct OpenAI image model availability through Pi has not been established. A bounded custom provider adapter remains a design option, not verified capability.
- **Verify before release:** mocked tool allowlist and injection tests; OS-level key isolation; authorization and cross-user isolation; no key in browser persistence or agent output; one-use server-bound approval per paid attempt; session and resource cleanup; UNKNOWN/no-auto-retry; controlled owner-approved live provider test.
- **Spike evidence:** [PI_OPENAI_SPIKE](../09-research/PI_OPENAI_SPIKE.md) records successful Pi text and separate direct OpenAI image calls, not a Pi-to-image tool or browser integration test.
- **Rollback:** disable the Pi integration and preserve local originals, jobs and approvals. A direct generation workflow may be used only if separately implemented and verified; none exists at this decision snapshot.
- **References:** [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Pi security](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md), [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation).

## ADR amendment template

`ADR-ID | Title | Author | Date | State | Scope | Options | Decision + user approval evidence | Security/Data impact | Migration | Test evidence | Rollback | Supersedes`.
