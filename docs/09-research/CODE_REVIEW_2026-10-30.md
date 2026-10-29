# Code Review and Progress Snapshot — 2026-10-30

## Scope and evidence

Review of the intended browser-facing BYOK product image studio, its local React/TypeScript application, gateway, tests and delivery ledger. The reviewed source baseline was `main` at `8e4295d`. No code was changed by the review. Subsequent commit `9429f50` recorded a forced Chromium storage-quota rollback observation without changing app source; consult the [T-020 follow-up](../08-delivery/TASK.md) for its limits. This does not independently re-run that observation or materially change the estimate below.

Actual implementation is determined from source and scoped tests; target behavior comes from the approved product direction and [task ledger](../08-delivery/TASK.md). Invariants include owner-configured server credentials, restricted Pi access, explicit billable attempts, immutable originals and a hard brand-fidelity veto. Historical Pi text and direct image spikes were separate calls and do not prove the integrated browser → Pi → gateway → image path.

## Overall progress: approximately 31%

This is a subjective engineering estimate for the full intended product, not elapsed work, a task-count calculation, a validated KPI, a forecast or a release decision. A rough 25–35% range reflects scope and evidence uncertainty. Weights and completion fractions are reviewer judgments, not user-approved acceptance metrics. Progress must be recalculated when scope or substantial evidence changes.

| Capability | Weight | Estimated completion | Weighted contribution | Basis and remaining boundary |
|---|---:|---:|---:|---|
| PWA shell, navigation, theme and updates | 15% | 75% | 11.25% | Shell and controlled updates exist; installed devices and full no-loss acceptance remain open. |
| Local SKU, source, masks and backup | 20% | 70% | 14% | Supported local subset exists; full project portability and device acceptance remain open. |
| BYOK gateway and session | 15% | 30% | 4.5% | Loopback development session exists; provider integration and production security are not established. |
| Pi, OpenAI generation, jobs and cost control | 25% | 0% | 0% | No complete product integration; isolated preflight and historical spikes are preparation, not an implemented end-to-end capability. |
| STRICT composition, QA, approval and output export | 15% | 0% | 0% | Mask editing exists, but composition and the approved-output journey are absent. |
| Device, security, performance and release gates | 10% | 10% | 1% | Scoped synthetic checks exist; full security review, physical device and pilot gates remain open. |
| **Total** | **100%** | | **30.75%, rounded to 31%** | |

## Findings and next actions

1. **P1 — Missing core generation journey.** `app/gateway.mjs` manages local authentication and provider authorization but makes no provider calls; the help view in `app/src/App.tsx` says generation and approved-output export are unavailable. Build T-040 around one SKU and one style after the required trust and approval boundaries, with explicit cost consent and mock contract tests. Verify provider outcomes, retained attempt lineage and a controlled real call only when authorized. T-041/042 must handle UNKNOWN and prevent silent billable retries.
2. **P1 — Development gateway is not a production BYOK boundary.** `app/gateway.mjs` is loopback-only and includes CSRF, origin, request-size and throttle controls; it does not establish secure production identity, OS-level Pi isolation or a provider adapter. Complete T-030/032/034 security acceptance, test principal binding, restricted IPC, model allowlists and budget controls, and keep provider keys out of the browser and Pi process.
3. **P2 — Recovery covers a subset.** `app/src/backup.ts` checks archive paths, bounds and integrity for currently supported data. Jobs, outputs, QA, receipts and historical schema migrations are not supported. Extend T-022 alongside those capabilities and test round-trip, corruption, conflict and quota rollback without dropping records; preserve original assets and existing backups.
4. **P2 — Release evidence remains incomplete.** The update logic in `app/src/useServiceWorker.ts` guards local drafts, but installed-device, transaction-in-flight, accessibility and complete security gates remain open. T-011/080/081 need representative real-device, recovery and independent security evidence; synthetic Chromium observations are not iOS certification.
5. **P3 — Outdated development guidance.** [`.env.example`](../../.env.example) says the gateway is not implemented, although a limited loopback development gateway exists. T-004 tracks correcting the explanation, including that the gateway does not automatically load `.env` or call OpenAI. Never add actual credentials to examples.
6. **P3 — Bundle warning.** The build reported a roughly 570 kB minified main JavaScript chunk. Measure load and interaction on target devices before choosing focused code splitting; do not treat the warning alone as evidence of a user-visible performance defect.

The next recommended sequence is the smallest safe one-SKU/one-style journey, followed by source-preserving composition, human approval and output export; then isolated Pi integration and seven-style expansion. T-033 remains dependent on accepted T-032 and T-040. Security, device and pilot gates remain mandatory before release.

## SCMC assessment

**PASS WITH WARNINGS:** Simple **PASS**; Clear **WARN** because the environment example gives a stale gateway status; Modular **WARN** because `app/src/products.ts` combines storage and mask-validation responsibilities that may become harder to change as features grow; Consistent **WARN** because setup guidance and implemented gateway state diverge. Prefer bounded documentation corrections and incremental separation when a real change requires it; preserve validation, transaction atomicity and existing tests.

## Checks and limitations

- At `8e4295d`, `npm test` passed **23/23** application tests; covered gateway, archive safety, image headers and mask validation. `npm run build` passed with the chunk warning described above.
- The documentation validator's basic checks passed but its overall result was **WARN** because optional `jsonschema` and `PyYAML` were unavailable; full schema/YAML parsing was not established by that run.
- No new browser or physical-device test, real-key provider call, deployment, real-brand fidelity evaluation or independent security audit was performed during this review. The forced-quota record mentioned above is a later separate evidence entry, not a test performed in this review.
- Review used KB-MCP `engineering:scmc-review` and local project-improvement guidance. A routed `instruction-modules/verification.md` was unavailable in this checkout; core project rules and available evidence were used. No production readiness or seller validation is claimed.
