# AGENTS.md — Agent Contract

**Project:** PWA-AI-Product-Image-Studio-BYOK. **State:** a limited application shell exists; inspect code and the task ledger before assuming any product workflow is implemented.

1. Before coding: inspect current repository branch, HEAD, files, `AGENTS.md`, tests, environment, current vendor references. Load KB-MCP `kb-mcp:coding-skills` for routing, `coding:safe-impact-regression-gate` for code changes, and `engineering:search-experiment-verify-apply` when investigation or an experiment is needed before implementation. Also load `image:product-photography-brand-lock` v1.0.1; `pwa:product-standard` v1.0.0; for doc sync `project:code-docs-source-of-truth-sync`; and for review `engineering:scmc-review`. More recent approved skills supersede versions in this snapshot only after documented compatibility review.
2. Read [SSOT policy](docs/00-governance/SSOT_POLICY.md), [decisions](docs/00-governance/DECISION_REGISTER.md) and the task ID in [TASK.md](docs/08-delivery/TASK.md).
3. Treat existing source/test evidence as authoritative for **implemented reality**; explicit user decisions authoritative for **desired behavior**. Documentation is not proof of implementation.
4. Never infer invisible product facts; never modify brand, geometry, readable labels or SKU in STRICT. No high score overrides a brand mismatch. Product artwork is a separate immutable foreground layer when strict fidelity matters.
5. No production API key in frontend, repo, localStorage, IndexedDB, URL, cache, telemetry or logs. No hardcoded provider key. Use a secure gateway and clear key lifecycle or self-hosted proxy. Restrict models/endpoints and enforce cost guardrails.
6. Build each style as an independent job with separate status, prompt, cost, source hash and QA. Retry is a billable new attempt; timeout may be UNKNOWN, not safely idempotent.
7. PWA MUST: iOS safe areas and opaque theme-aware chrome, installability, offline contract, Service Worker update prompt + user-driven activation with loader, versioned cache, responsive/accessibility/security checks. Do not silently reload an active editor.
8. Do not publish, deploy, commit, push, merge, or create cloud resources unless authorized in the task; separate docs from executable source. Do not claim tests passed without output evidence.
9. Run validators; use sample/dummy data only, redaction and security scans; update task/ADR with evidence and rollback notes.
10. For ambiguous decisions, choose safest compatible default for a reversible implementation, but require user approval before public API key custody or destructive actions.

**Ready-to-code order:** `[T-001]` decision preflight → `[T-002]` documentation validator → `[T-003]` documentation sync → `[T-010]` shell → `[T-011]` update lifecycle → `[T-020]` SKU → `[T-021]` source image → `[T-022]` portable backup → `[T-030]` secure gateway → `[T-040]` one style → `[T-050]` STRICT compositor → `[T-060]` QA → `[T-070]` seven-style production → `[T-080]` release gates. Partial tasks retain their open acceptance criteria; follow explicit dependencies in the task ledger.

**Definition of Done:** requirements traced to a code path, automated tests, browser evidence, security/privacy validation and owner-approved release evidence. Passing documentation validation alone is not application success.
