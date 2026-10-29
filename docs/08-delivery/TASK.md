# Execution Task Ledger — Ready for Pi / OMP / Coding Agents

**Initial status of EVERY task:** `PENDING` (documentation scope only). Owner may change status after inspecting repository and committing evidence. Complete one task at a time or parallelize only non-overlapping files with a defined integration gate.

For proposed research experiments and their dependencies, see [Spike Test Catalog](../09-research/SPIKE_TEST_PLAN.md). Spike results do not automatically complete delivery tasks.

| ID | Epic | Objective | Depends on | Evidence / acceptance |
|---|---|---|---|---|
| T-001 | EP-07 | Preflight repo, branch rules, skills, decision approvals and architecture gate | none | VERIFIED for the documentation and non-secret implementation preflight; see T-001 record below. Real-key gateway and deployment gates remain open. |
| T-002 | EP-07 | Correct documentation validator checkout scope without hiding unexpected package payloads | T-001 | VERIFIED — checkout and isolated package validated; regression tests reject unexpected, missing, modified and symlinked payloads. See T-002 record below. |
| T-010 | EP-06 | React TS Vite PWA shell, routing, theme/status bar | T-001 | iOS-safe responsive shell tests |
| T-011 | EP-06 | SW cache/version and user-controlled update loader | T-010 | N→N+1 E2E, no unsaved draft loss |
| T-020 | EP-01 | SKU/fact/source data schema and IndexedDB stores | T-010 | E2E-001..003,016, corrupt/duplicate test |
| T-021 | EP-01 | Upload MIME/EXIF/resize/provenance; original immutable Blob | T-020 | E2E-002; large image safe |
| T-022 | EP-01 | Portable backup ZIP/import and version migration | T-020 | E2E-017; hash/path/bomb cases |
| T-030 | EP-02 | Self-hosted gateway authentication, CSRF, allowlist, server-configured secret and provider authorization session | T-001 | SEC-001..008; Key scan = 0 |
| T-031 | EP-02 | Provider connect/status/disconnect settings UX without browser key entry | T-030,T-010 | E2E-009; no browser credential exposure |
| T-032 | EP-02 / EP-03 | Pi Agent integration preflight and restricted browser-facing image workflow design | T-001,T-030 | reviewed SDK/runtime boundary, tool allowlist, principal isolation, no-shell tests, cost approval and image-provider contract |
| T-033 | EP-02 / EP-03 | Implement isolated Pi host and browser integration after T-032 acceptance | T-032,T-040 | mocked cross-user and injection tests, redacted traces, browser E2E; controlled live call only after owner key and budget are available |
| T-040 | EP-03 | Provider adapter + one Studio scene generation | T-030,T-021 | E2E-007/008, controlled live API probe |
| T-041 | EP-03 | Job/attempt state machine, timeout UNKNOWN, rate handling | T-040 | E2E-010/015/023, no auto duplicate |
| T-042 | EP-03 | Cost estimate, usage receipt, budget guard | T-041 | E2E-014; values/unknown labeled correctly |
| T-050 | EP-04 | Mask editor, transparent PNG handling and source hash | T-021 | E2E-005, PERF-002, source immutability |
| T-051 | EP-04 | STRICT browser compositing and camera feasibility | T-050,T-040 | source ROI/geometry comparisons, QA-001..003 |
| T-060 | EP-05 | Weighted QA, hard veto and human approval event | T-051 | E2E-011..013, QA-004/005 |
| T-061 | EP-05 | Approved-only format/ratio export and provenance | T-060,T-022 | E2E-013/021/022 |
| T-070 | EP-03 | All seven presets + independent selection/queue | T-041,T-051 | E2E-006/007/010; billable call count visible |
| T-071 | EP-03 | Per-style Retry/compare/history/error UX | T-070,T-042 | E2E-011/015/023 |
| T-080 | EP-06 | Offline, iOS installed, responsiveness/accessibility test | T-011,T-061 | E2E-018..020 + evidence |
| T-081 | EP-07 | Security/privacy/backup/perf regression and remediation | T-071,T-080 | SEC, PERF and threat gates pass |
| T-082 | EP-07 | Five-category SKU pilot, real brand QA and measured cost | T-081 | documented approval/veto & economics |
| T-090 | EP-07 | Production deployment + rollback runbook with explicit owner approval | T-082 | release gates A–F, URL and post-deploy smoke |

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
