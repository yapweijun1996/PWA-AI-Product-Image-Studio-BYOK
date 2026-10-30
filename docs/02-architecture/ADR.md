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

## ADR-015 — Extended provider retry delays

- **State:** Local implementation, synthetic-tested; real-provider and independent security acceptance remain open.
- **Decision:** Preserve valid provider `Retry-After` values through 2147483647 seconds in the client job and gateway journal; both enforce the full delay before new dispatch. Present invalid or out-of-range values retain the existing durable external-review gate. An absent header is not treated as a known delay. No automatic retry is added.
- **Compatibility:** The generation-job schema's supported maximum expands; old clients reject longer values. SSOT baseline advances to 7.0.0 while the local gateway stays `/api/v2`. Older gateways reject journal format 3. Back up user data, preserve journal evidence and avoid running older clients against extended records. No automatic migration or deletion is authorized.
- **Limits:** Server enforcement applies to clients sharing that journal and depends on its clock; browser enforcement is profile-local. Owner acknowledgement of an unrepresentable value is an explicit external-review override, not automatic enforcement of its exact delay. A synthetic desktop Chromium backup round-trip preserved an extended delay and import trust markers; physical-device backup, real-provider and independent security evidence remain open.
- **Rollback:** Disable generation and review journal and backup compatibility before reverting; never discard delay, attempt or user data.

## ADR-016 — Candidate elapsed-time proof for provider retry waits

- **State:** PROPOSED for BUG-001; the version barrier, tracker, journal proof and new gateway wait records have scoped implementations, and legacy review path have scoped implementations, but production security approval remains open. The existing format 3 wall-clock deadline remains vulnerable to a forward clock jump. This candidate does not authorize a provider call or remove any existing hold.
- **New waits:** Record the exact bounded duration and the immutable attempt identity in a versioned journal result before clearing the in-flight marker. In each gateway process, start a monotonic timer no earlier than its first observation of the durable result. Under the existing cross-process journal lock, publish an immutable completion proof bound to that result only after the full duration measured by that process has elapsed. A successful durable proof can be shared by other processes; checking and publishing must be serialized with dispatch and review. Merely reaching the wall-clock deadline or acknowledging a charge is not proof of elapsed time.
- **Restart and concurrent processes:** On startup, inspect outstanding waits and start conservative timers from observation; a process starting later can delay recovery but cannot release a wait early. When the original process records the result, it starts its timer immediately after durable publication. A process seeing a new result later starts its own full timer. A crash before proof publication restarts the full wait; crash after durable publication permits recovery from the proof. Suspend behavior must be tested on supported platforms; a timer that does not advance while suspended delays rather than shortens recovery.
- **Old records and manual recovery:** Format 3 contains a deadline but not trustworthy elapsed-time evidence. Do not infer that the provider interval expired from its wall clock or from reservation time; retain a durable reviewable hold for legacy delay records. Any explicit owner recovery must identify the particular record, require a separate external review of provider guidance and billing, be authenticated and revision-bound, record a durable non-secret receipt, and never automatically dispatch. Existing acknowledgement alone must not silently lift the new time hold. Define and review how to recover when records or prior receipts are missing or contradictory.
- **Compatibility and isolation:** Introduce a journal format/barrier that causes older gateways to fail closed before dispatch; stop and verify all older gateway processes before activating the upgraded journal. A new process cannot retroactively prevent an already-running older process from dispatching. Reject inconsistent, corrupt or orphaned proofs and preserve original records. Treat administrator changes, filesystem rollback, hostile journal writers, VM snapshot cloning and an untrusted monotonic clock as outside the local trust boundary until independently addressed. Browser-local timers remain advisory; the shared journal is authoritative for clients using this gateway.
- **Acceptance before implementation is claimed complete:** Reproduce numeric and HTTP-date waits with forward/backward wall-clock jumps, concurrent gateway processes, restart before/after proof publication, delayed observation, suspend behavior and exact boundary. Exercise malformed/legacy journal, stale approval, explicit recovery, replay and interrupted fsync; verify no provider dispatch before elapsed proof or explicit reviewed recovery and no automatic retry. Tests use fake credentials and fake transport; independent security review and supported-platform verification remain required.
- **Rollback:** Disable generation, stop all gateway processes and preserve every original journal record, hold and proof. Restore an older gateway only after a reviewed migration/recovery procedure; never delete evidence to make the older version start.


## ADR-017 — Versioned source-bound mask region evidence

- **State at that stage:** Local storage foundation; the mask editor later saved this evidence and preview/save later checked it. ADR-020 records the subsequent approval/export gate. T-052 and BUG-007 remain open.
- **Decision:** A new mask version may contain one to 32 oriented source-pixel rectangles, source and mask SHA-256 values, dimensions, version and an evidence digest. Saving and backup validation reject malformed, stale, uncovered or transparent protected pixels. Rectangles are human-specified and cannot prove that every important detail was selected. The unkeyed digest detects inconsistent data; it does not authenticate a user or resist an actor who can rewrite both data and digest.
- **Compatibility:** Version 3.0.0 project archives are emitted only when at least one mask carries this evidence; older readers reject the new archive version rather than discard fields. Version 1 and 2 archives without evidence remain readable. The IndexedDB store version is unchanged; older app code rejects unfamiliar mask metadata. Do not use older active tabs or downgrade a workspace containing evidence; preserve a complete v3 backup and upgrade before editing or restore. Region-bearing v3 imports retain existing imported-review trust barriers.
- **Remaining work:** Bind evidence into composite and review provenance, enforce it in locked save/approval/export transactions, define output and conversion quality thresholds, improve region selection with direct manipulation and verify full keyboard, screen-reader, actual multi-tab, installed-device and SKU workflows before treating STRICT as protected. No such protection is claimed by this foundation.
- **Rollback:** Preserve the workspace and all backups. Revert only after a reviewed migration/export plan preserves the new metadata and all dependent records; older clients cannot consume version 3 backups or new mask fields. Do not delete evidence to force downgrade.


## ADR-018 — Bind composite records to mask region evidence

- **State:** Partial local implementation; BUG-007 and T-052 remain open. New composites made from a protected mask store that mask's evidence digest. Backup validation and the locked review/export transactions check the digest against the verified mask and re-render with its protected evidence. Legacy composites without a digest remain readable and are not treated as protected.
- **Compatibility:** Version 4.0.0 project archives are emitted when any composite has a protected-evidence digest; older readers reject v4 instead of discarding fields. Version 3 remains for evidence-bearing masks without bound composites; v1/v2 and historical records remain readable. SSOT advances to 9.0.0 for this incompatible local record change; gateway operations and `/api/v2` remain unchanged. Preserve backups and do not downgrade active clients with bound records.
- **Limits at that stage:** Review and decision provenance did not yet include the digest; see ADR-019 for the later binding. Missing evidence and legacy composites remain eligible under old rules; removing a digest is indistinguishable from an old unbound record. Hashes are unkeyed and do not authenticate records. This is not a complete brand-protection gate. Bind review/export lineage, fail closed on absent/stale evidence with an explicit migration, verify crop/overlays/conversion and retain human visual review before release.
- **Rollback:** Preserve all sources, masks, composites, evidence, reviews and backups. Stop editing and use a reviewed migration before downgrade; never strip the digest to force old clients to read records.


## ADR-019 — Bind visual decisions to protected evidence

- **State:** Partial local implementation; BUG-007 and T-052 remain open. New reviews and decisions for bound composites include the protected-evidence digest. The reviewer must submit the digest they observed; a change before review or decision invalidates the old review. Export requires a current matching decision and includes the digest in output provenance. Old unbound reviews remain historical and require a new review before approving a bound composite.
- **Compatibility:** Version 5.0.0 project archives carry review or decision records with the digest; older clients reject v5 instead of dropping fields. Version 4 remains for bound composites without bound review records; v1–v3 remain supported. SSOT advances to 10.0.0 for the incompatible local review record; gateway operations and `/api/v2` are unchanged. Do not downgrade active clients or discard records to make older clients work.
- **Limits at that stage:** Evidence-free and unbound composites remained eligible under legacy rules; see ADR-020 for the subsequent approval/export gate. Unkeyed hashes do not authenticate the data. Region completeness, output quality after resampling and conversion, real SKU and device acceptance remain open. This decision does not close BUG-007.
- **Rollback:** Preserve all original images, masks, evidence, outputs, reviews, decisions and v5 backups. Stop editing and use a reviewed migration before downgrade; never strip evidence or history to force compatibility.


## ADR-020 — Require protected evidence for approval and export

- **State:** Local development implementation; BUG-007 remains open for selection completeness, output fidelity and release acceptance. A passing visual review may be approved only when the saved composite is bound to verified protected mask areas. Approved export rechecks that binding under its existing locked snapshot; missing or changed evidence blocks direct approval and export. Old approvals remain preserved as history but are not current export candidates. Rejection and full backup remain available subject to existing validation; legacy review accessibility after an active-mask change is tracked in BUG-012.
- **Recovery and cost:** Create a new mask with protected areas, then a new scene job and composite; a new provider request requires separate explicit consent and may incur a charge. There is no automatic request, silent retry or deletion. Existing generated scenes cannot yet be rebound to a new mask without a new job.
- **Compatibility:** IndexedDB advances from v1 to v2 with no deletion or rewrite of user records. A v1 client cannot reopen a v2 workspace. A non-cooperating old connection blocks upgrade; an in-flight old transaction can complete before the upgrade. Stop or reload older tabs and preserve backups. Separate profiles, origins, manual ZIP construction and a hostile local script are outside this local barrier. SSOT advances to 11.0.0 for the incompatible approval rule; gateway operations and v1–v5 project archive versions are unchanged.
- **Residual risk:** Selected rectangles do not prove all labels were identified or legible. Resampling, output conversion, region completeness, real SKU, installed-device and independent security acceptance remain open. A standalone ZIP utility and unkeyed hashes are not an authentication boundary against arbitrary code in the browser profile.
- **Rollback:** Preserve all records and backups. A v1 client cannot open the upgraded database; do not downgrade the database or strip evidence to bypass the approval gate. Use a reviewed migration and security plan before rollback.

### ADR-020 follow-up — historical legacy review access

A legacy attempt whose active mask changed may display its validated source, composite and review history read-only. The original inputs and review history remain subject to integrity checks within the same transaction; prior decisions are marked historical and cannot authorize review writes or export. Current product information is identified as current. This adds no persisted schema or archive version. BUG-012 tracks remaining acceptance and rollback.
