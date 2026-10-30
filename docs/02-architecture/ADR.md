# Architecture Decision Records (Proposed)

## ADR-001 — Strict fidelity via non-destructive compositing

- **State:** CONFIRMED product rule, implementation approach PROPOSED.
- **Context:** Text-only instructions cannot prevent brand label / Chinese text drift.
- **Decision:** maintain original-source foreground with independent mask; generate environment separately; browser composite. Unseen angles explicitly unsupported in STRICT.
- **Tradeoff:** better truthful branding, less flexible viewpoint and more mask/edit work.
- **Rejected:** prompt-only "preserve exact text" as a guarantee; visually indistinguishable output counted as proof without source comparison.
- **Verify:** label ROI pixel/source audit, mask edge QA, human compare, category fixtures.

## ADR-002 — BYOK with trusted gateway

- **State:** Initial self-hosted/server-configured key direction CONFIRMED; a local-only development session subset exists. Production authentication, secret provisioning and complete gateway implementation remain PROPOSED and need security review.
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
- **Proposed request boundary:** The Pi host receives only scoped task data and may propose an image attempt through a single schema-validated image-workflow tool; it cannot choose an arbitrary endpoint or issue an approval. The authenticated browser reviews the exact provider call count and estimated charge and requests the separate gateway approval. The local default-disabled Studio subset consumes a session- and payload-bound one-use approval, then durably reserves the unified attempt ID before provider submission; it does not yet integrate Pi. Approval consumption and disk reservation are not a single transaction: interruption can consume approval without sending. Broader contract and independent security review remain open.
- **Text path candidate:** [PI_TEXT_BOUNDARY](PI_TEXT_BOUNDARY.md) describes a proposed authenticated IPC, bounded budget reservation and UNKNOWN recovery design; no implementation or security acceptance is implied.
- **Provider boundary:** The gateway alone selects an allowlisted OpenAI image model and fixed API operation, validates the request and mediates the response. STRICT requests generate a scene and retain original artwork for local composition. An ambiguous submitted request remains UNKNOWN; a new chargeable attempt needs a fresh user authorization. Estimates are not proof of actual provider cost. The separately required Pi text-model path is still unresolved by T-034.
- **Preflight limitation:** A synthetic Pi SDK 1.4.0 run in a network-disabled, read-only container rejected an unknown `bash` tool and invalid fake image-tool parameters, but `/bin/sh` remained executable inside that container. These flags and the SDK allowlist are not proof of a no-shell or hardened OS boundary. The current application declares Node `>=22.12.0`, whereas this installed Pi SDK requires Node `>=22.19.0`; integration must resolve and verify that compatibility before enabling Pi.
- **Open:** actual process and OS isolation design, principal/session binding, server key configuration, authorization, prompt-injection defense, transcript redaction, tool schema, retry/usage handling and lifecycle. Do not substitute hosted key custody or expose a local-only prototype to a LAN/public network without explicit approval.
- **Tradeoff:** SDK preserves Pi session/tool semantics but is not proof of browser support, multi-user isolation or safe image generation. The installed Pi image-model documentation shows OpenRouter examples; direct OpenAI image model availability through Pi has not been established. A bounded custom provider adapter remains a design option, not verified capability.
- **Verify before release:** mocked tool allowlist and injection tests; OS-level key isolation; authorization and cross-user isolation; no key in browser persistence or agent output; one-use server-bound approval per paid attempt; session and resource cleanup; UNKNOWN/no-auto-retry; controlled owner-approved live provider test.
- **Spike evidence:** [PI_OPENAI_SPIKE](../09-research/PI_OPENAI_SPIKE.md) records successful Pi text and separate direct OpenAI image calls, not a Pi-to-image tool or browser integration test.
- **Rollback:** Disable the Pi integration and preserve local originals, jobs and approvals. The direct local Studio-scene workflow is separately implemented and synthetic-tested, but is disabled by default and not approved for real-key use or production.
- **References:** [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Pi security](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md), [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation).

## ADR-007 — Loopback development gateway authentication

- **State:** Local development implementation; production identity, secret storage and exposure remain OPEN and require separate security review and owner approval.
- **Decision:** The non-public gateway binds only to `127.0.0.1`. One owner uses a randomly generated 256-bit access token, with only its SHA-256 verifier supplied to the process. The token is an application login credential, not the provider key. Server-issued app/provider sessions are memory-only, session-bound and expire independently; restarting invalidates them. The provider key remains server-side. Studio provider calls are disabled by default and require explicit opt-in; do not use a real key before the required security and isolation reviews.
- **Controls:** Exact host and origin, session-bound CSRF, strict JSON and size limits, login and connection throttles, Secure/HttpOnly/SameSite cookies, fixed provider allowlist and no request-body logging. These controls are not an independent security audit or an OS sandbox. A development access token is not an appropriate production identity system.
- **Tradeoffs:** Restart disconnects all sessions; access is limited to the machine running the server. HTTPS termination, multi-user identity, durable/restart-safe limits, production secret provisioning and Pi process isolation are deliberately not implied by this local implementation.
- **Local threat boundary:** Browser cookies are host-scoped, not port-scoped; a hostile service or process on the same machine may interfere with local sessions. Loopback is not an OS isolation boundary. Use only synthetic credentials until the separately reviewed production isolation and secret controls exist.
- **Verify:** Synthetic hostile requests, cross-session isolation, expiry/revocation, in-flight disconnect race, rate limits, key redaction and a local browser smoke. Full SEC and live-provider gates remain open.
- **Rollback:** Stop the local gateway and revert its source and API documentation; do not remove configured secrets or local product data.
- **References:** [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## ADR-008 — Unified image attempt identity

- **State:** Owner selected the unified-ID direction; a single-owner local journal and explicit review of eligible ambiguous attempts have synthetic-test evidence. Independent security review, complete crash recovery, provider billing reconciliation and production design remain OPEN. This decision does not authorize a real provider call or deployment.
- **Decision:** For `/images/generate`, `X-Client-Request-Id` and `clientAttemptId` are the same UUID. A trusted gateway must durably reserve each authenticated principal's attempt before sending, retain a non-secret request digest and outcome, and never submit a duplicate attempt again, including after restart. A timeout after possible transmission is UNKNOWN. A user-approved retry is a new attempt with a new UUID and approval.
- **Privacy / scope:** The journal must not retain provider keys, session/CSRF/approval credentials, prompts or image payloads. The local implementation persists only hashed single-owner attempt identity, request digest, reservation time, outcome and explicit review acknowledgement; access-token rotation preserves its duplicate and hourly protections. Review preserves the original UNKNOWN; legacy unowned markers and interruptions without a durable result remain blocked. Multi-user identity, safe retention, complete crash recovery and independent review remain open.
- **Alternative:** Independent correlation and attempt UUIDs require a mapping and additional collision/replay rules; the owner selected the simpler unified identity. A local reservation does not prove provider-side idempotency.
- **Verify / rollback:** Synthetic duplicate, concurrent, restart, changed-payload, session-bound approval and UNKNOWN cases before a separately authorized paid test. Reversing this decision requires a versioned contract and migration that preserves prior reservations; do not delete attempt evidence.

## ADR-009 — Review-revision binding and local recovery

- **State:** Local implementation, synthetic-tested; production security review remains OPEN. This does not authorize real-key use or deployment.
- **Decision:** A user obtains the current journal review revision before consenting. Image approval and dispatch require that exact revision; the gateway serializes its final check and provider-request initiation against review acknowledgements. A review increments the revision once and never resends or overwrites the original attempt. Local Web Locks protect an in-flight result until the browser persists it.
- **Compatibility:** The mandatory `reviewRevision` breaks earlier draft image requests. Contract and documentation baseline advance to 3.0.0. The existing `/api/v2` server-key route namespace is retained for this unexposed local prototype; earlier clients fail closed, with no compatibility shim and no deployed migration.
- **Limits:** Web Locks are origin/profile-scoped, not cross-profile process isolation; the durable gateway revision coordinates instances sharing a journal. Legacy or interrupted markers without a provable terminal result remain blocked. An explicit review records user acknowledgement, not an invoice reconciliation or recovered provider asset. Real-device, production identity and security acceptance remain open.
- **Durable bounded delay:** Local gateway journal format 3 records the provider-derived not-before time for representable 1–86400-second waits and checks it under the dispatch lock, even after acknowledgement or restart. Older gateways do not understand format 3 and must fail closed; rollback requires a reviewed compatibility plan without deleting journal evidence. Exact longer delays remain BUG-001.
- **Rate-delay mitigation:** For a 429 carrying an invalid or unsupported `Retry-After`, the gateway retains the definitive result and active marker and uses the existing cleanup-pending signal to require external review. Acknowledgement is an explicit override, not enforcement of the original delay. Exact long-delay persistence remains BUG-001; this compatible signal broadening does not change response fields or stored schema.
- **Rollback:** Disable image generation and revert this contract with matching gateway and client together. Preserve all source images, jobs, attempts, outputs, acknowledgements and private journal records. Never delete records to release a charge-ambiguous lock.

## ADR-010 — Seven independent scene attempts and protected compositions

- **State:** Local development implementation only; real-provider, installed-device and independent security acceptance remain open. No paid call or deployment is authorized by this decision.
- **Boundary:** Each selected style has a distinct job, attempt UUID, source and mask hashes, prompt, preset version, disclosed context, estimate and explicit authorization. The gateway independently reconstructs the bounded prompt and binds it and the context into a one-use approval. Product name, category and selected confirmed facts reach the provider; original images and masks do not. Image payloads have a separate bounded request limit; other gateway routes retain their smaller limit.
- **Compatibility:** Mandatory `presetVersion` and `sceneContext` change draft image request semantics, so OpenAPI and the documentation baseline advance to 4.0.0. The unexposed local server-key namespace stays `/api/v2`; old clients fail closed. Existing local Studio records remain readable under their original prompt rules.
- **Composition and review:** STRICT locally uses protected source pixels. Macro crops only real source pixels; a true overhead requires confirmed TOP view. Billboard uses a complete locally assembled ad and a user-inspected front-facing rectangle. A frozen, hashed copy layer avoids reliance on device font rasterization during later verification. Approval is separate from the style-specific checks and is invalidated by material product, source, mask, scene, recipe or output changes.
- **Queue and recovery:** Requests are sequential, never automatically retried, and stop on a failed or ambiguous attempt or closed workspace. Unsent prepared records are closed where possible; interrupted records can be closed explicitly without sending. A persisted submission whose outcome is uncertain stays UNKNOWN and may have incurred a charge. Estimates are not provider invoices.
- **Rollback:** Disable image generation and revert the gateway, queue, renderer and contract together. Preserve source images, masks, jobs, attempts, scenes, frozen copy layers, composites, QA and journal records; older versions may not understand the newer records and must not silently discard them.

## ADR-011 — Explicit per-style retry lineage

- **State:** Local development implementation only; real-provider, device and independent security acceptance remain open. No real credential or paid request is authorized by this decision.
- **Decision:** A same-input retry appends a new attempt UUID to the existing job and records the immediately preceding attempt as `retryOf`. Earlier attempt outcomes, sources, scenes, QA and approvals are retained. A changed source, mask, product snapshot, fact selection, preset or prompt requires a new job. Legacy Studio prompts unsupported by the current gateway can start a new job, not an implicit same-job retry.
- **Billing:** Retry preparation makes no provider request. Each later submission requires fresh explicit consent and a new one-use gateway authorization. A prior UNKNOWN remains UNKNOWN after the required explicit external-billing review. A bounded `Retry-After` is retained and checked for subsequent local attempts; it is a minimum delay, not a promise of success or provider-wide enforcement. Browser-local controls do not cover other profiles or clients.
- **Compatibility and recovery:** Jobs may now contain multiple ordered attempts, with optional `retryOf`, categorized failure and retry-delay metadata. Existing single-attempt jobs remain readable by the new build; older builds may not understand new records and must not be used to rewrite them. Output-only provenance includes the immediate retry parent when present. Full backup is specified separately in ADR-012.
- **Rollback:** Disable generation, retain all local records and journals, and restore the matching pre-retry client only after a reviewed migration or recovery plan. Do not delete records to bypass an ambiguous charge or rate delay.

## ADR-012 — Full project archive and imported-history trust

- **State:** Local development implementation; release, physical-device and independent security acceptance remain open. This decision does not authorize a provider call or deployment.
- **Decision:** Add version `2.0.0` full-project ZIPs containing original sources, masks, jobs, attempts, generated scenes, immutable composition layers and QA history; continue reading version `1.0.0` product/original/mask backups. Validate and atomically restore an entire graph without overwriting an existing SKU or ID. Earlier clients reject v2 archives rather than silently discarding history.
- **Trust boundary:** ZIP hashes identify corruption, not an author or a truthful QA decision. Imported approval history is retained but cannot authorize output until a fresh local human review and separate decision. All imported attempt IDs remain untrusted and cannot be gateway-acknowledged or used as same-job retry predecessors. Explicit local-only review of imported uncertainty records that the user checked external billing and rate limits without changing the original outcome or the gateway journal. A separately authorized new attempt remains subject to the gateway's own checks.
- **Privacy and limits:** Archives are unencrypted and can contain prompts, cost estimates, QA notes, original EXIF and images. Credential-pattern checks do not inspect pixels or detect all secrets. Entries, bytes, MIME, paths, references and compression are bounded; see [the backup contract](../04-data/EXPORT_IMPORT.md).
- **Rollback:** Stop import/export and use a compatible prior client only after a reviewed migration; preserve all originals, masks, jobs, attempts, generated assets, QA, local trust markers and gateway journals. Never delete uncertainty or approval evidence to bypass a safety gate.

## ADR-013 — Bounded archive image validation

- **State:** Local development implementation; physical-device performance and independent production security acceptance remain open.
- **Decision:** Apply the documented aggregate decoded-pixel work limit before mask/output decoding or rendering, including original images. Check cancellation between validation steps and mask strips; do not silently omit data or partially import. A single browser image decode may not be interruptible.
- **Compatibility:** Some otherwise valid v1 or v2 backups and large local projects previously accepted by the application now exceed the safety limit and are rejected. This incompatible restriction advances the SSOT baseline to 5.0.0; archive schema versions and gateway request fields are unchanged. No automatic migration, deletion or splitting is performed.
- **Rollback:** Disable backup import/export or replace the limit with an equivalently reviewed bounded implementation; preserve all source records and archives.

## ADR-014 — Versioned structured human findings

- **State:** Local development implementation only; actual-product, installed-device and independent security acceptance remain open.
- **Decision:** New QA reports record bounded human findings with severity and source/output pixel rectangles, or an explicitly unlocalized scope when no truthful region can be given. A human `BLOCKER` is a hard veto even at a perfect score. Findings do not create an approval; the decision remains separate and evidence-bound.
- **Compatibility:** Historical v1 reports remain readable without modification; new structured reports use v2. Older clients cannot safely validate the new report semantics, so the SSOT baseline advances to 6.0.0. The gateway API route and archive format versions do not change. Imported review history remains untrusted and requires a new local review.
- **Rollback:** Preserve all QA records, history heads, originals and outputs. Disable new review creation or implement a reviewed migration before returning to an older client; never discard a blocker to enable approval.

## ADR amendment template

`ADR-ID | Title | Author | Date | State | Scope | Options | Decision + user approval evidence | Security/Data impact | Migration | Test evidence | Rollback | Supersedes`.
