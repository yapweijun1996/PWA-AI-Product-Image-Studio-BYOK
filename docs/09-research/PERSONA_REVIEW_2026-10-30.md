# Ten-Persona Project Review and Task Mapping

**Review date:** 2026-10-30 (Asia/Singapore). **Method:** ten simulated role perspectives evaluated repository documents and available implementation evidence. These are design and engineering hypotheses, not interviews with real sellers or independent professional certifications. Product directions and task status remain owned by the [decision register](../00-governance/DECISION_REGISTER.md) and [task ledger](../08-delivery/TASK.md).

## Situation and scope

The repository now contains a limited PWA shell, local SKU/fact and source-image workflows. The task ledger records bounded Chromium observations; complete image generation, Pi-to-image integration, physical-device release gates and production security are not established. T-022 backup code was changing in the working tree during this review and was not accepted or marked complete here. The original Pi text and separate OpenAI image probes do not establish browser-to-agent-to-provider integration. Earlier status observations are historical, not current-state evidence.

## Review findings

| Simulated persona | Finding / proposed improvement | Task / minimum acceptance |
|---|---|---|
| Product manager | Deliver a first one-SKU, one-style flow through review and approved export before expanding the seven-style UI; retain all seven as the existing product direction. | T-021/030/040/050/051/060/061: demonstrate one complete synthetic end-to-end path, honest statuses and no unapproved export; then use evidence to prioritize T-070. |
| SG/MY seller | Self-hosting and BYOK may be difficult for a phone-first solo merchant; suitability and willingness are hypotheses, not observed demand. | T-083: with separately authorized, consenting participants, use a consistent task script and capture completion, time, friction and cost comprehension. Do not generalize a small convenience sample. |
| Brand / product authenticity reviewer | Real SKU identity depends on the original, usable masks, source-compatible view and human review; a pleasing scene or aggregate score cannot prove label correctness. | T-050/051/060: inspect source versus output; veto brand/variant/geometry mismatch and mark unreadable source text UNVERIFIABLE. Preserve the original and document resampling/compression effects. |
| Pi agent engineer | The intended isolated Pi host may not receive the provider key, yet it needs a model-call path. The prior key-bearing text probe is not evidence of that isolated path. | T-032/034: specify and test a scoped model broker candidate, principal/session/model/budget constraints and process permissions using fake credentials. Do not imply the candidate is already implemented or approved. |
| BYOK security engineer | Self-hosted server-key custody needs unambiguous ownership, authorization and revocation boundaries. Older references to user-key vaults can mislead implementers. | T-003/030/031/032: reconcile docs with ADR-002, then prove authentication, CSRF, OS/IPC isolation, redaction, server key rotation and distinct disconnect/provider-revocation semantics. |
| Image / cost engineer | A successful direct image call is not a Pi image-tool integration; its actual usage is unknown. Duplicate and UNKNOWN outcomes can cause unexpected charges. | T-040/041/042: fake provider verifies one-use approval and precise call counts; post-send ambiguity is UNKNOWN, no automatic retry, and missing usage is not zero. Live tests need a scoped spend envelope. |
| Mobile / PWA engineer | Shell-only tests cannot prove iOS install, safe areas, offline behavior or draft safety on service-worker update. | T-011/080: use two real builds and target devices; record update behavior, safe areas, keyboard, offline state and preservation of actual masks/pending transactions. |
| UX / accessibility researcher | Generated visual anchors contain known inaccurate copy and are not approved; comparison and mask editing need non-drag alternatives. | T-084/080: owner reviews representative desktop/tablet/mobile and critical states; verify accessible names, focus, keyboard, single-pointer alternatives and real zoom on an interactive flow. |
| QA engineer | Static documentation checks and isolated probes do not establish a product-level journey. | T-040/041/050/060/061/081: link unit, integration and browser evidence to a revision; include failure injection, exact mock call counts, source integrity and brand veto. |
| Release / operations engineer | Checkout-safe documentation validation is already recorded for T-002; release still depends on clean setup, app tests, recovery and independently verified gates. | T-002/081/090: preserve current validator tests; execute full docs checks and app checks separately, document rollback and obtain explicit release approval. |

## Recommended sequence at review time

1. Preserve and verify the ongoing T-022 backup work; do not infer its completion from uncommitted files. Reconcile remaining current-state documentation under T-003.
2. Complete T-084 anchor review and plan T-083 seller research; owner approval and consent govern actual participant contact. Seller research can proceed independently of a production gateway when an appropriate prototype is ready.
3. Resolve T-030/032/034 security and Pi-to-model boundaries using fake credentials; complete SP-01/02 and run SP-03/04 as their prerequisites permit. A mock-only tool list is not an OS sandbox.
4. Build and verify a single-style workflow using T-040/041/042, T-050/051 and T-060/061. Keep paid calls and participant/asset rights within separately authorized limits.
5. Validate actual mobile, privacy, export and release gates before broadening to seven-style production and the five-category pilot.

**SCMC assessment of reviewed planning materials:** Simple = WARN (large backlog needs a small first slice); Clear = WARN (historical/current state and runtime boundaries need careful labels); Modular = WARN (Pi/gateway boundary still requires design); Consistent = FAIL at review time because the adapter used a vault description conflicting with the selected server-key model. The adapter description was reconciled during this documentation update; at that time the T-003 audit and runtime/security verification remained open. See the task ledger for current status. These ratings judge the reviewed documentation/design, not a running application's security or performance.

## Evidence and limits

- [Task ledger](../08-delivery/TASK.md): current delivery evidence, acceptance scope and remaining gates.
- [Spike catalog](SPIKE_TEST_PLAN.md): test hypotheses, planned conditions and partial observations.
- [UX research](UI_UX_LAYOUT_RESEARCH.md) and [visual anchor catalog](../10-design/VISUAL_ANCHORS.md): unapproved design hypotheses and known image defects.
- [OpenAI spike](PI_OPENAI_SPIKE.md): one restricted Pi text request and one separate direct image generation; actual cost not captured.
- [BYOK security](../03-security/BYOK_SECURITY.md) and [architecture decisions](../02-architecture/ADR.md): selected server-configured key direction and unresolved isolation/approval questions.

No new user interview, paid provider request, security assessment, device test or deployment was performed for this review. Existing evidence belongs to the referenced dated task records; it has not been independently reproduced for all features here.
