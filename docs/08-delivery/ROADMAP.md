# Implementation Roadmap — Dependency-Driven, No Promised Dates

**Current state:** M0 has a scoped preflight record; M1 is in progress with an implemented shell, local SKU/facts, original images, masks and subset backup. M2 has a loopback-only development session gateway and a default-disabled, synthetic-tested single Studio scene path, but no approved production identity or deployment. Full-project backup, UNKNOWN recovery, composition, real-provider acceptance, real-device and other milestone exit checks remain open. Consult [TASK](TASK.md) for exact statuses and evidence. Later milestones remain planned. The gates below are sequence constraints, not fixed delivery estimates or proof of release readiness.

| Milestone | Outcome | Dependencies | Evidence to exit |
|---|---|---|---|
| M0 — Decision preflight | Owner resolves key custody, auth, deployment, data/retention; repo checked | SSOT review | Approved ADR, HEAD and risk register |
| M1 — App & local data | PWA shell, SKU source/facts, IndexedDB and ZIP; offline works | M0 | Unit/integration, offline/mobile E2E |
| M2 — Secure BYOK + 1 style | Authenticated Gateway, connect/disconnect, one paid action with honest costs | M1, secret/security gate | Provider stub + controlled real call, redacted logs, negative auth tests |
| M3 — STRICT fidelity | Mask editor, background generation, source compositing, QA and approval | M2 | Real SKU label/mask/perspective tests, human approvals |
| M4 — Seven styles / export | All presets, per-job queue, retry and ZIP outputs | M3 | 1-of-7/7-of-7 E2E, QA and usage receipts |
| M5 — Production readiness | iOS PWA, safe updates, perf, privacy, threat model and pilot | M4 | Release gates A–F with evidence and owner approval |
| M6 — Product listing extensions | Brand Kit, channel presets, copy, bulk | Proven pilot | New PRD/ADR and tests, not assumed P0 |

## Review-based progress and next steps

The 2026-10-30 code review estimated **about 31%** of the full intended product, with a rough 25–35% range. This judgment is not a milestone exit or release-readiness result. The [review](../09-research/CODE_REVIEW_2026-10-30.md) defines its weights and evidence; the [task ledger](TASK.md) owns current task status.

1. Resolve the secure provider and Pi boundaries, then complete one cost-controlled SKU/Studio generation journey (T-030/032/034/040–042).
2. Preserve and composite the original product, complete human QA and approved-only export, then integrate the isolated Pi host and expand to seven independent styles (T-033/050/051/060/061/070/071).
3. Extend recovery for newly implemented data and close device, accessibility, security and pilot gates before any production release (T-022/080–083/090). Correct stale local gateway setup guidance under T-004.

## Critical path

Security decision precedes public BYOK implementation; one style end-to-end precedes seven-style batch; STRICT brand-label fidelity precedes claiming shop-ready imagery; iOS update reliability and security precede production release.

## Rollback / checkpoints

- Git branches/commits per bounded task. Reversible data migrations and backups.
- Unknown provider charge status cannot be overwritten by a later successful attempt.
- Preserve original assets and approved QA even after UI refactor.

## Change control

Features P1/P2 cannot be quietly pulled into P0. Promote with explicit decision and additional capacity/testing evidence; track in canonical [TASK](TASK.md).
