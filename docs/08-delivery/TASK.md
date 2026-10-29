# Execution Task Ledger — Ready for Pi / OMP / Coding Agents

**Status:** the table and dated records below describe the current evidence and its limits; earlier records preserve historical states. Complete one task at a time or parallelize only non-overlapping files with a defined integration gate.

For proposed research experiments and their dependencies, see [Spike Test Catalog](../09-research/SPIKE_TEST_PLAN.md). Spike results do not automatically complete delivery tasks.

| ID | Epic | Objective | Depends on | Evidence / acceptance |
|---|---|---|---|---|
| T-001 | EP-07 | Preflight repo, branch rules, skills, decision approvals and architecture gate | none | VERIFIED for the documentation and non-secret implementation preflight; see T-001 record below. Real-key gateway and deployment gates remain open. |
| T-002 | EP-07 | Correct documentation validator checkout scope without hiding unexpected package payloads | T-001 | VERIFIED — checkout and isolated package validated; regression tests reject unexpected, missing, modified and symlinked payloads. See T-002 record below. |
| T-003 | EP-07 | Reconcile current architecture and task status across project docs | T-001 | VERIFIED for the scoped source-backed documentation audit and static validation; runtime security, device and release gates remain open. See T-003 record below. |
| T-010 | EP-06 | React TS Vite PWA shell, routing, theme/status bar | T-001 | VERIFIED for the shell in Chromium; installed iOS and offline/update lifecycle remain separate release gates. See T-010 record below. |
| T-011 | EP-06 | SW cache/version and user-controlled update loader | T-010 | IMPLEMENTED_UNVERIFIED — synthetic Chromium update and unsaved-mask guards exercised; real installed-device and full no-loss acceptance remain open. See T-050 record below. |
| T-020 | EP-01 | SKU/fact/source data schema and IndexedDB stores | T-010 | IMPLEMENTED_UNVERIFIED — SKU, facts and source persistence exercised; actual quota exhaustion and generation-dependent fact filtering remain open. |
| T-021 | EP-01 | Upload MIME/EXIF/resize/provenance; original immutable Blob | T-020 | VERIFIED for synthetic Chromium input and local persistence; physical-device and real quota gates remain open. See T-021 record below. |
| T-022 | EP-01 | Portable backup ZIP/import and version migration | T-020 | IMPLEMENTED_UNVERIFIED — product/fact/original/mask subset exercised; jobs, outputs, QA, receipts and historical migrations remain open. See T-022 and T-050 records below. |
| T-030 | EP-02 | Self-hosted gateway authentication, CSRF, allowlist, server-configured secret and provider authorization session | T-001 | IMPLEMENTED_UNVERIFIED — loopback-only development session subset exercised with synthetic credentials; full security review, production identity and provider integration remain open. See T-030 record below. |
| T-031 | EP-02 | Provider connect/status/disconnect settings UX without browser key entry | T-030,T-010 | IMPLEMENTED_UNVERIFIED — loopback synthetic session UI exercised in Chromium; installed-device and full gateway/security acceptance remain open. See T-031 record below. |
| T-032 | EP-02 / EP-03 | Pi Agent integration preflight and restricted browser-facing image workflow design | T-001,T-030 | IMPLEMENTED_UNVERIFIED — synthetic SDK allowlist and request-boundary design recorded; hardened OS/no-shell, principal binding, approval and provider contract remain unverified. See T-032 record below. |
| T-033 | EP-02 / EP-03 | Implement isolated Pi host and browser integration after T-032 acceptance | T-032,T-040 | mocked cross-user and injection tests, redacted traces, browser E2E; controlled live call only after owner key and budget are available |
| T-034 | EP-02 / EP-03 | Design and verify a restricted text-model path for the isolated Pi host | T-030,T-032 | PENDING — document the candidate trust boundary; fake-key tests enforce principal/session/model/budget limits and no key exposure or arbitrary outbound URLs; security review before real credentials |
| T-040 | EP-03 | Provider adapter + one Studio scene generation | T-030,T-021 | E2E-007/008, controlled live API probe |
| T-041 | EP-03 | Job/attempt state machine, timeout UNKNOWN, rate handling | T-040 | E2E-010/015/023, no auto duplicate |
| T-042 | EP-03 | Cost estimate, usage receipt, budget guard | T-041 | E2E-014; values/unknown labeled correctly |
| T-050 | EP-04 | Mask editor, transparent PNG handling and source hash | T-021 | IMPLEMENTED_UNVERIFIED — synthetic Chromium mask editing, alpha, source hash and backup checked; compositor fidelity, real-device performance and quota gates remain open. See T-050 record below. |
| T-051 | EP-04 | STRICT browser compositing and camera feasibility | T-050,T-040 | source ROI/geometry comparisons, QA-001..003 |
| T-060 | EP-05 | Weighted QA, hard veto and human approval event | T-051 | E2E-011..013, QA-004/005 |
| T-061 | EP-05 | Approved-only format/ratio export and provenance | T-060,T-022 | E2E-013/021/022 |
| T-070 | EP-03 | All seven presets + independent selection/queue | T-041,T-051 | E2E-006/007/010; billable call count visible |
| T-071 | EP-03 | Per-style Retry/compare/history/error UX | T-070,T-042 | E2E-011/015/023 |
| T-080 | EP-06 | Offline, iOS installed, responsiveness/accessibility test | T-011,T-061 | E2E-018..020 + evidence |
| T-081 | EP-07 | Security/privacy/backup/perf regression and remediation | T-071,T-080 | SEC, PERF and threat gates pass |
| T-082 | EP-07 | Five-category SKU pilot, real brand QA and measured cost | T-081 | documented approval/veto & economics |
| T-083 | EP-07 | Validate seller setup, BYOK comprehension and single-SKU task with consenting target users | T-010,T-084 | PENDING — synthetic or rights-cleared task script; record completion, time and friction; separate proposed findings from population claims. No outreach without authorization |
| T-084 | EP-06 | Review the proposed visual anchors and accessibility paths for the MVP | T-010 | PENDING — owner records Accept/Change/Reject for representative desktop/tablet/mobile and critical state anchors; verify keyboard, non-drag actions and real zoom when an interactive flow exists |
| T-090 | EP-07 | Production deployment + rollback runbook with explicit owner approval | T-082 | release gates A–F, URL and post-deploy smoke |

## Improvement priorities from simulated reviewers — 2026-10-30

- The previous ten-persona review was a simulation based on project evidence, not seller interviews. See [review and task mapping](../09-research/PERSONA_REVIEW_2026-10-30.md).
- Near term: reconcile stale docs (T-003), then use the existing task dependencies to build the smallest one-SKU / one-style / human-QA / approved-export journey. Extend T-022 as masks, jobs, outputs, QA and receipts are implemented; define a migration only when a supported historical schema exists.
- Security and cost: T-030/032/034 must resolve gateway authentication, server-configured key and isolated Pi model access; T-041/042 must protect per-attempt approvals, UNKNOWN and spend. Do not assume the earlier isolated Pi text probe proves the production isolation path.
- Product and design: T-084 and T-083 test the design direction and self-hosted onboarding; T-050/051/060 preserve and review original product identity; T-080/081/082 retain device, security and pilot gates. Proposed work is PENDING until supported by the evidence required by each task.

## T-001 preflight observation — 2026-10-29

- Repository inspection found branch `main` at `4aefa36` (initial commit), with the documentation pack, contracts, fixtures and validator present as untracked working-tree files. The committed tree contains only `.gitattributes`.
- Inspected the project agent contract, SSOT policy, decision register, PRD, proposed architecture and task ledger. The working tree contains documentation and a Python documentation validator, but no implemented PWA, gateway or application tests.
- Read-only syntax checks parsed the validator with Python's AST and parsed the contract and fixture JSON. These checks do not establish full schema validity, runtime behavior, provider access or deployment readiness.
- Deployment, identity, key custody, local retention and other decisions remain open in the [decision register](../00-governance/DECISION_REGISTER.md). No architecture or release approval is inferred from this observation.
- This is a partial preflight record only: T-001 and all other tasks remain `PENDING`. Complete the remaining skill, environment, decision and architecture checks and record their evidence before claiming T-001 is complete.

## Self-hosted direction and preflight — 2026-10-29

- The owner selected a self-hosted gateway for the initial BYOK trust boundary. This does not approve operator-hosted key custody, deployment or paid provider calls; gateway runtime, authentication, retention and operations remain open.
- `AGENTS.md` now routes coding work through the KB-MCP coding hub and applicable change-safety skills. The project-specific PWA, brand-lock, documentation and review skills remain required.
- A KB-MCP engineering reuse request for T-010 returned `implementation_allowed=false`, including missing target/relationship source validation and reviewed retrieval evidence. No application source exists in the inspected repository; do not bypass the mandatory preflight. T-001 remains `PENDING`.
- The documentation validator failed in the working tree because its inventory includes `.git` and `.DS_Store`. A clean payload copy passed its static checks with warnings: optional `jsonschema` and `PyYAML` dependencies were unavailable. Neither run verifies application behavior.
- Documentation deep dive: the current checkout report records a manifest-set failure caused by non-payload files including `.git`, `.DS_Store` and `.gitattributes`; optional schema dependencies were absent in that run. The package-only check described in [scripts/README.md](../../scripts/README.md) is scoped evidence, not a checkout PASS. T-002 tracks the validator repair; no application task is complete.

## Pi browser-facing Agent direction — 2026-10-29

- The owner requested Pi as the product's browser-facing BYOK Agent, using the seller's OpenAI key for images; the owner will later supply a local development key in ignored `.env`. The empty `.env.example` is a placeholder only and is not a working gateway.
- Local `pi --version` reports 1.4.0. The installed SDK and security documentation show a Node/Bun SDK and powerful default tools. Installed image-model docs give OpenRouter examples; direct OpenAI image support through Pi was not verified.
- A fresh KB engineering reuse call returned `implementation_allowed=false` due to missing or invalid preflight evidence. T-001, T-032 and T-033 remain PENDING. No agent or image API implementation, paid test, key provisioning or deployment has been performed.
- See [ADR-006](../02-architecture/ADR.md). Rollback for this documentation/config preparation is to remove the newly added empty template and ignore rules and revert this record; no credentials or runtime state were changed.

## Pi / OpenAI bounded spike — 2026-10-29

- Later in the same day, at the owner's request, a restricted Pi text request and a separate direct OpenAI Images API request succeeded using the owner-supplied local key. The image request produced a synthetic PNG with SDK retries disabled for the experiment. See [PI_OPENAI_SPIKE](../09-research/PI_OPENAI_SPIKE.md) for evidence, commands' scope and limitations.
- The two calls did not test a Pi-to-image tool, gateway, browser UI, security boundary or full product flow. Exact provider usage/cost was not captured. T-001, T-032, T-033 and T-040 remain PENDING; a live image result alone does not complete them.
- Rollback: remove the spike report and its synthetic test image, revert the index and manifest entries, and retain this task history as appropriate. The ignored `.env` is user-owned and must not be deleted.

## Pi mock preflight observation — 2026-10-29

- In a disposable directory, the installed Pi SDK 1.4.0 was initialized with an in-memory session, in-memory settings, an empty resource loader and only a synthetic `generate_image` tool. The active-tool list contained only that tool; extensions, skills and context files were absent and the session had no file.
- A synthetic in-process model stream produced one tool call and the SDK emitted matching tool-start and tool-end events. A dummy credential was supplied only to satisfy SDK authentication checks; no real credential was read. The fake stream did not invoke a provider.
- In five separate in-memory sessions, a sample strict tool schema accepted one valid request and rejected missing prompt, invalid model, unexpected URL and oversized prompt before the fake tool executed. These checks establish only the tested SDK configuration and sample schema, not product-tool validation, prompt-injection resistance, OS isolation or principal isolation. T-001, T-032 and T-033 remain PENDING.
- The proof scripts ran in temporary directories and were removed automatically. Rollback: remove this observation and its corresponding spike-catalog note; no runtime code or persistent session was created.

## Self-hosted server-key decision — 2026-10-30

- The owner selected server-side provider-key configuration for their self-hosted gateway. The browser does not submit or receive the key. Disconnect revokes the provider authorization session only; server-secret removal and OpenAI revocation are separate operations.
- The proposed OpenAPI contract is updated from `/api/v1` to `/api/v2` for this incompatible draft change. Authentication, Pi isolation, secure secret provisioning and deployment remain unverified. No deployed API exists and no production or public-custody approval is inferred.
- The initial T-001 contract-change reuse preflight returned `PROCEED` for the then-current OpenAPI and related validator/documents; host validation and the broader preflight were still outstanding at that stage. See the later T-001 record below.
- A clean manifest-listed payload passed all eight documentation checks with temporary `jsonschema` and `PyYAML` dependencies installed; this does not verify the actual checkout or an application. A separate schema probe accepted the provider-only request, rejected synthetic key/URL/invalid-provider fields, and checked the generation authorization and CSRF contract. No provider calls were made.
- Rollback: restore the previous draft contract and related documentation only if the owner reverses the self-hosted key decision; no runtime state was changed.

## T-001 preflight record — 2026-10-30

- **State:** VERIFIED for repository, decision, documentation and non-secret local implementation preflight only. This is not approval of a deployed architecture, a real-key gateway or a production release.
- **Repository:** `main` at `4f0421a` before this task's changes. Existing working-tree documents and the ignored owner-managed `.env` were preserved; no production key was read. Local environment: Node `v23.10.0`, Python `3.15.0`, Pi `1.4.0`.
- **Decisions:** Owner confirmed self-hosted gateway, server-configured provider key, seven styles, STRICT source preservation and Pi direction. ADR-002 and ADR-006 record those decisions and remaining authentication, secret-operation and OS-isolation questions. `/api/v2` is a proposed breaking contract, not an implemented endpoint.
- **Reuse/security:** Relevant KB-MCP skills were loaded. Source-hashed T-002 and greenfield T-010 shell preflight requests returned `PROCEED`; both are scoped to their reviewed targets. Independent security review identified approval binding and Pi credential/isolation risks; the proposed contract and security requirements now record the mitigations. No runtime security claim is made.
- **Checks:** Manifest-listed payload validation passed eight documentation checks with temporary `jsonschema` and `PyYAML`; separate synthetic schema probes checked provider-only connection and the approval/generation contract. Mock Pi SDK checks confirmed one valid fake tool invocation and rejected invalid fields and unknown shell/read/network tools. No provider request was made.
- **Downstream gates:** T-002 and the non-secret T-010 shell may proceed after task-specific source validation. T-030/T-032 must independently finalize and review authentication, server-secret lifecycle, one-use approval, Pi OS/IPC isolation and cost controls before any real key or paid call. Public exposure, custody and production deployment remain unapproved.
- **Rollback:** Restore the prior proposed documentation contract and preflight changes if the owner reverses the server-key direction. Do not delete owner-managed secrets, user data or independently created work.

## T-002 validator record — 2026-10-30

- **Change:** Exclude Git/OS metadata and owner-managed environment files from the package inventory and content scans. The validator rejects unexpected, missing, changed or symlinked payloads and writes a report only when explicitly requested.
- **Evidence:** Five deterministic synthetic-package regression tests cover metadata and secret-file exclusion, unchanged existing reports, unexpected and changed files, missing files, symlink rejection and explicit reports. Full dependency-enabled checkout and isolated-package documentation checks are recorded in the task commit; they do not verify application behavior or provider security.
- **Security:** No owner `.env` contents were read, changed or included in a commit. Environment files are not scanned; `.env.example` remains part of the checksummed package.
- **Rollback:** Revert the validator, regression test, documentation, manifest and checksum entries together; the earlier isolated-package invocation in the preceding task commit remains available.

## T-003 documentation sync record — 2026-10-30

- **Change:** Reconciled current local-product/backup status and self-hosted server-key guidance across the task ledger, roadmap, data guide, setup notes and proposed API description. Preserved dated historical findings, the existing research/reviewer changes and their limitations. Updated the documentation-package inventory; its status fields do not describe the separate application tree.
- **Evidence:** Audited current `app/src/products.ts` and `app/src/backup.ts`, their scoped T-020–T-022 tests and Chromium observations, ADR-002, the proposed OpenAPI contract and the task ledger. The documentation validator checks links, schemas and checksum metadata; its result is not proof of gateway security, complete image generation or deployment.
- **Limits:** Full-project backup, migrations, gateway authentication and key isolation, physical devices, real-brand QA, consenting seller research and production release remain open. The reviewer personas are a simulation, not interviews. The historical direct provider spike does not establish Pi-to-image integration.
- **Rollback:** Revert the affected documentation, API-description and matching checksum updates together. Preserve user-managed environment files, local product data and research history.

## T-010 shell record — 2026-10-30

- **Change:** Added a React/TypeScript/Vite shell in `app/` with real Workspace, Settings and Help routes, light/dark/system appearance, theme-aware top chrome, browser network status, safe-area layout, manifest and icons. Unimplemented product workflows are explicitly identified instead of simulated.
- **Evidence:** `npm run build` passed. Chromium exercised navigation, direct route loading, Back, refresh and persisted theme, keyboard skip link, active-page semantics, offline status and client-side navigation after going offline. At 320 and 768 CSS px the measured document width matched the viewport; desktop and mobile screenshots were inspected. Manifest and 180/192/512 px icon URLs returned HTTP 200. No application console errors appeared in the final online pass.
- **Security:** `npm audit --audit-level=high` reported zero vulnerabilities. A source scan found no obvious provider-key/private-key patterns in application source or public assets. This is not a gateway security review; the shell has no provider connection.
- **Limits:** Offline page reload, service-worker updates, real-device iOS installation, screen-reader and comprehensive accessibility testing remain pending. The failed offline reload before T-011 confirms that offline launch is not yet available. Product creation, storage, upload, generation and export are not implemented.
- **Rollback:** Revert the `app/` tree and corresponding documentation/validator boundary changes together; do not delete user-managed environment files or other local data.

## T-011 shell update record — 2026-10-30

- **Change:** Each production build emits a distinct static-only service worker. The user must choose the waiting-worker update; the initiating tab displays a loader and reloads after activation. Other tabs receive an update notice rather than an automatic reload. API and non-shell content are not cached.
- **Evidence:** Two separately generated build IDs were served from a local test server. Chromium loaded the first, reloaded it offline, and navigated offline. A second build waited until the user action; a DOM-observed loader appeared; the selected tab reloaded and the old shell cache was removed. A second tab retained an injected unsaved control without a reload and reloaded only after its own action. A synthetic `/api/probe` response was absent from the cache and failed offline.
- **Open acceptance at T-011:** No actual product draft, pending transaction or mask editor existed at this stage. The initiating tab's injected unsaved control was lost after its explicit update; the warning alone was not automatic draft preservation. See the later T-020 form-protection evidence; mask and pending-transaction protection remain open.
- **Limits:** Chromium localhost is not an installed iPhone test. First-load offline is not supported. Hosting must revalidate the worker and HTML. No provider request or real key was used.
- **Rollback:** Revert the worker, build plugin, update UI and related documentation; preserve local data and review active browser caches before any release rollback.

## T-020 product persistence record — 2026-10-30

- **Change:** Added browser-local product creation, listing, reopening and user-confirmed fact add/remove. IndexedDB v1 creates the documented stores and an exact, trimmed, case-sensitive unique SKU index. Product reads and writes use the canonical schema; successful UI state follows transaction completion.
- **Evidence:** Chromium created and reloaded a synthetic SKU, rejected the same SKU without a duplicate, rejected an injected malformed record without changing the valid product, required explicit fact confirmation, persisted fact add/remove, reopened the product offline and rejected a future database version without downgrading it. The 320 px product view had no horizontal overflow. `npm run build` passed; `npm audit --audit-level=high` reported zero vulnerabilities and the application-source credential-pattern scan found no match.
- **Update integration:** In two builds served under a CSP without `unsafe-eval`, a real unsaved product form blocked update activation and retained its input. After the product was saved, explicit update reloaded to the persisted product. Navigation cancellation also retained a dirty form. Mask and pending-transaction protection still require their own implementation and test.
- **Open acceptance at T-020:** T-021 subsequently exercised image upload and a synthetic 12 MP source. Actual quota exhaustion remains untested (E2E-016), and T-040 must prove generation only consumes confirmed facts (E2E-003). T-020 remains IMPLEMENTED_UNVERIFIED for those named criteria.
- **Rollback:** Revert product source, forms, validator plugin and docs together. Do not delete the IndexedDB database or user-created products; future rollback must preserve or explicitly export data.

## T-021 source image record — 2026-10-30

- **Change:** Added picker, focused paste and drag/drop input; magic/header, static-format, byte and pixel bounds; EXIF-aware reduced preview; explicit review and camera-view selection; atomic original Blob plus product metadata storage. SHA-256 and orientation/dimension metadata are rechecked when an original is reopened. The original may contain private EXIF and is not resized or overwritten.
- **Evidence:** Four deterministic header-parser tests passed. Chromium previewed and saved synthetic PNG, JPEG and WebP using picker/paste/drop; a JPEG with EXIF orientation 6 rendered 40 × 80 with the expected red/blue pixel positions, and its saved SHA-256 matched the original fixture. A 12 MP JPEG produced a 1,600 × 1,200 preview and reopened after persistence. Corrupt input, MIME mismatch, duplicate source, over-20-MiB and over-24-MP input were rejected. A deliberately injected IndexedDB key collision aborted both source and metadata writes; retry after restoring the native method succeeded. A modified synthetic Blob was rejected on hash mismatch.
- **Offline/update:** The saved original reopened offline, while the service-worker cache contained only shell files. Under a CSP permitting `blob:` images but not `unsafe-eval`, a selected source preview blocked an update until saved; the new version reopened the saved source. A failed replacement retained the previous preview and selected camera view.
- **Limits:** Actual device memory/quota exhaustion, physical iOS EXIF behavior, real-brand fidelity, mask editing and compositing remain unverified. No provider call or production key was used.
- **Rollback:** Revert source-input code and documentation without deleting IndexedDB records or original user files. A later migration or backup is required before removing persisted source data.

## T-022 portable backup subset record — 2026-10-30

- **Change:** Added unencrypted ZIP export and previewed, add-only import for the currently implemented product, facts and original images. Canonical product and manifest schemas, original hashes and cross-references are checked. The preview gives the exact expanded archive byte count and warns that actual storage use may differ. Unsupported records and unknown schema versions are rejected, not omitted or guessed.
- **Evidence:** `npm run build` passed; nine application tests passed, including traversal, duplicate names, symlinks, expansion bomb, forged size, unknown manifest version and modified metadata regressions. Chromium downloaded a synthetic ZIP, independently verified its manifest hashes and original JPEG hash, and restored it under a separate origin; the original reopened offline. A race inserting a conflicting source after preview aborted the whole transaction without overwriting the existing record. Malicious paths, links, duplicate names, oversized expansion, forged sizes, modified metadata, unknown versions and extra files were rejected. A synthetic recognizable key pattern was refused before export, and a synthetic unsupported job prevented export rather than being dropped. An 8 MB synthetic image exercised export progress and cancellation with no download. At 320 CSS px the final import page had no horizontal overflow. Import and download also worked under a CSP without `unsafe-eval`.
- **Security and limits:** `npm audit --audit-level=high` reported zero vulnerabilities. Backups are not encrypted and can contain sensitive photo/EXIF data; credential-pattern detection is not a complete secret scan of metadata or image bytes. No production key or provider request was used. Full mask/job/output/QA/receipt portability, actual quota exhaustion, physical iOS behavior and historical migration remain unverified or unimplemented. No prior supported schema is available, so inventing a migration would risk data loss.
- **Rollback:** Revert backup UI, ZIP implementation, tests and the matching documentation together. Preserve all IndexedDB data and downloaded backups; do not delete user files.

## T-030 local session gateway record — 2026-10-30

- **Change:** Added a loopback-only development gateway with a random owner access-token verifier, server-issued app/provider sessions, exact host/origin and CSRF checks, request bounds, throttling, an OpenAI provider allowlist and explicit disconnect/logout. Configuration is read at process start; no `.env` file is loaded. The gateway does not send provider requests and is not a production identity or secret-management system. ADR-007 and the API contract record its boundary; the documentation validator checks the expanded endpoint list and local-only status.
- **Evidence:** `npm run build` passed, all 20 application tests passed and `npm audit --audit-level=high` reported zero vulnerabilities. Synthetic HTTP regression tests exercised unauthenticated, cross-origin and CSRF failures; session rotation and cross-session cookie replay; expiry, disconnect and logout; in-flight logout/disconnect races; concurrent login and connection rate limits; oversized and chunked input; provider allowlist; hostile Host headers and static-file boundaries. Responses were validated against the canonical OpenAPI schemas. A Chromium session loaded the local gateway, authenticated and connected using synthetic values, received HttpOnly cookies not visible to `document.cookie`, and found no synthetic provider key in the status response, Web Storage or Service Worker cache. The 320 px product form had no horizontal overflow.
- **Limits and security:** No production key, paid provider request, deployment, independent security review, OS-level Pi isolation or real-device test was performed. Local cookies are host-scoped rather than port-scoped; loopback does not isolate hostile local processes. The full SEC-001–008 gate, production HTTPS/identity, durable rate limits, provider adapter, spend authorization and UI remain open. Use only synthetic credentials for this development gateway.
- **Rollback:** Stop the local gateway and revert its source, tests and matching API/ADR/documentation changes. Preserve all user product data and owner-managed secret files.

## T-031 local provider settings record — 2026-10-30

- **Change:** Settings supports local app-token sign-in, provider authorization connect/status/disconnect and sign-out against the loopback development gateway. The app-token field is distinct from a provider API key; recognizable `sk-` input/paste is rejected and the app token is not persisted by the UI. Missing configuration disables connect. Session expiry uncertainty, offline/unavailable status and user-controlled refresh are explicit. Disconnect is not represented as server-key removal or OpenAI revocation.
- **Evidence:** Chromium exercised synthetic invalid token, login, connect, reload, disconnect, reload and sign-out; a separate unconfigured gateway disabled connect. A simulated browser clock skew yielded an uncertain-expiry message rather than a false disconnected claim; offline and online transitions recovered the current status. Synthetic provider-key paste was cancelled, and a dirty app-token input blocked navigation. Browser storage and Service Worker caches contained neither the test provider key nor the app token/API responses. The 320 and 768 CSS px views had no horizontal overflow. `npm run build` passed.
- **Diagnostics and limits:** Browser instrumentation reported `net::ERR_ABORTED` for the two no-content mutation requests despite recording HTTP 204 and observing successful state changes; the cause is unverified. No provider API key or paid request was used. This is local synthetic Chromium evidence, not an installed-iOS, production-identity, independent security-review or live-provider pass; the complete E2E-009 gate remains open.
- **Rollback:** Revert the settings component, styling and related documentation. Do not remove local product data, owner-managed environment files or server keys.

## T-032 Pi isolation preflight — 2026-10-30

- **Design:** ADR-006 now records the proposed separation of Pi, browser approval and credential-holding gateway. The browser must approve the exact chargeable attempt; the gateway enforces session-bound one-use approval and reservation, fixed provider operations and model allowlisting. STRICT preserves the original artwork; ambiguous provider outcomes remain UNKNOWN. The proposed approval and image endpoints are not implemented, and OPEN-008 remains unresolved.
- **Synthetic SDK evidence:** Pi SDK 1.4.0 and Node 22.23.4 ran with only a fake `generate_image` tool, empty resources and separate in-memory sessions inside a disposable `node:22-alpine` container. A fake model stream's `bash` call was rejected as an unknown tool, invalid tool parameters did not execute, a valid synthetic call executed once, and each session's prompt was absent from the other session's in-memory history. The container had networking disabled, a read-only root, dropped capabilities, `no-new-privileges`, bounded resources and an unprivileged UID. No provider request or real credential was used.
- **Security limits:** The same container successfully executed `/bin/sh`; tool-level rejection is not an OS-level no-shell guarantee. In-memory history separation is not proof of cross-process or cross-principal authorization. No reviewed IPC boundary, host sandbox, real image adapter, one-use approval implementation, cost guard, provider entitlement or paid end-to-end flow was tested. Pi 1.4.0 requires Node `>=22.19.0`, while the current app permits Node `>=22.12.0`; integration must resolve the mismatch. T-032 is not accepted for production or as a completed dependency for T-033.
- **Rollback:** Revert this record and the accompanying ADR amendment; no persistent Pi runtime, user data, credential or provider state was changed.

## T-050 manual mask and backup record — 2026-10-30

- **Change:** Added a local source selection editor with draw/erase, a non-drag brush action, zoom, preview and explicit review. Masks are oriented full-resolution PNGs with source-bound hashes, immutable versions and an atomic active pointer; the original Blob is not changed. Stale cross-tab saves fail closed. Latest masks can be reopened per source, and a new save activates the reviewed mask. PNG mask alpha is final coverage capped to decoded source alpha; STRICT compositing remains unimplemented. Full-resolution rendering uses a Worker when supported, otherwise a main-thread fallback.
- **Chromium evidence:** Synthetic transparent PNG, half-alpha PNG and EXIF-oriented JPEG produced matching masks; original and restored hashes matched, transparent background remained unselected, a half-alpha pixel remained 128, and a 24×40 JPEG with orientation 6 yielded a 40×24 mask. Synthetic edits produced immutable versions; a stale second tab was rejected. A five-mask, three-original backup restored on a separate origin; tampered mask PNG was rejected and a prior no-mask archive passed inspection. A saved prior mask could be selected and activated again. A 12 MP synthetic image was edited and saved on this desktop browser; one observed save took about 0.74 s, not a device-performance certification.
- **PWA and navigation:** Unsaved masks blocked update and browser Back in Chromium; navigation after successful product creation and backup restore continued without a discard prompt. Offline reload, edit and mask-worker save succeeded after installation. A synthetic waiting update retained version A HTML until explicit activation of version B. Controlled navigation now uses its active worker's cached HTML to avoid mixing builds while an update waits. This does not establish real-iOS installation, low-memory behavior or all cross-tab update cases.
- **Automated checks:** `npm run build` passed with a Vite bundle-size warning; `npm test` passed 23/23 tests including mask corruption, dimensions, references and alpha checks; `npm audit --audit-level=high` reported zero vulnerabilities. These tests do not replace the browser or physical-device gates.
- **Limits:** No real-brand source, compositor/label ROI comparison, human QA, actual quota exhaustion, memory-leak profile, mid-range phone or installed iOS test was performed. Large masks/backups have documented size and count limits; older browsers may render on the main thread. The full E2E-005, PERF-002, T-011 and T-022 acceptance gates remain open.
- **Rollback:** Revert editor, mask storage/backup, navigation guard, worker cache changes and corresponding documentation together. Preserve IndexedDB originals and mask records and existing backups; an older app cannot safely export projects containing masks.

## Task execution record template

```text
Task ID:
State: PENDING | IN_PROGRESS | IMPLEMENTED_UNVERIFIED | VERIFIED | BLOCKED
Branch / HEAD:
Before: actual code paths and tests inspected:
Files changed:
Contract or ADR impact:
Tests: commands, total/passed/failed, browser artifacts:
Security review / secret scan:
Known issues / cost / model observations:
Rollback:
Next task and owner:
```

Do not mark production deployed from CI green alone. Human permission required for release. A task update must carry verified code/test evidence, not generic assistant claims.
