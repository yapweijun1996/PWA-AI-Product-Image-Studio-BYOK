# Execution Task Ledger — Ready for Pi / OMP / Coding Agents

**Initial status of EVERY task:** `PENDING` (documentation scope only). Owner may change status after inspecting repository and committing evidence. Complete one task at a time or parallelize only non-overlapping files with a defined integration gate.

| ID | Epic | Objective | Depends on | Evidence / acceptance |
|---|---|---|---|---|
| T-001 | EP-07 | Preflight repo, branch rules, skills, decision approvals and architecture gate | none | checked HEAD, ADR approvals, secrets policy |
| T-002 | EP-07 | Correct documentation validator checkout scope without hiding unexpected package payloads | T-001 | reproduce checkout failure; test `.git`, `.DS_Store`, tracked payload changes and unexpected payloads; validate isolated package and real checkout |
| T-010 | EP-06 | React TS Vite PWA shell, routing, theme/status bar | T-001 | iOS-safe responsive shell tests |
| T-011 | EP-06 | SW cache/version and user-controlled update loader | T-010 | N→N+1 E2E, no unsaved draft loss |
| T-020 | EP-01 | SKU/fact/source data schema and IndexedDB stores | T-010 | E2E-001..003,016, corrupt/duplicate test |
| T-021 | EP-01 | Upload MIME/EXIF/resize/provenance; original immutable Blob | T-020 | E2E-002; large image safe |
| T-022 | EP-01 | Portable backup ZIP/import and version migration | T-020 | E2E-017; hash/path/bomb cases |
| T-030 | EP-02 | Gateway auth, CSRF, allowlist, secrets and encrypted session | T-001 | SEC-001..008; Key scan = 0 |
| T-031 | EP-02 | BYOK connect/status/disconnect settings UX | T-030,T-010 | E2E-009; no client credential persistence |
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
