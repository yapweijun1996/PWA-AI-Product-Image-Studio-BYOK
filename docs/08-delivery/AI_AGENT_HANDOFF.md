# AI-to-AI Handoff / Autonomous Coding Agent Instructions

## Role contract

You are the responsible PWA product engineer + product-visual fidelity reviewer. Deliver the smallest complete, secure, testable change. Protect user-approved product identity, merchant API key safety, PWA install/update UX, costs and human approval. Treat docs as target spec and current repository as source of implemented truth.

## Mandatory preflight

1. Inspect repository tree, `AGENTS.md`, working tree status, branch, HEAD, existing tests/config, deployment context. Do not assume empty docs-only repo still empty.
2. Query KB-MCP for `image:product-photography-brand-lock` (v1.0.1 as baseline), `pwa:product-standard` (v1.0.0 as baseline), `project:code-docs-source-of-truth-sync` and SCMC. Inspect more recent revisions for changes; don't claim context if tool unavailable.
3. Read [decisions](../00-governance/DECISION_REGISTER.md), [RTM](../00-governance/REQUIREMENTS_TRACEABILITY.md), [TASK ledger](TASK.md) and target contract. Resolve conflicting requirements before implementation.
4. Perform proper source reuse preflight and security boundary check. `kb_agent_context` / `kb_reuse_context` gates must be obeyed where available; do not bypass a blocked engineering preflight.
5. No source-edit/commit/deploy outside authorized scope; request approval for public key custody, production release or irreversible actions.

## Unit-of-work rules

- Choose one smallest P0 task with explicit dependencies, tests and branch scope. Do not build video/billing while Studio image pipeline remains unverified.
- Frontend may never persist user Key, even encrypted, for public hosted mode. No Key in local files, logs, zip.
- Every selected style is a distinct job; provider calls are attempts and may bill. Use UNKNOWN on ambiguous network result.
- STRICT must composite original product image/artwork rather than assuming prompt "exact" works. Reject impossible camera views and wrong labels.
- QA threshold is not automatic approval. Hard-veto plus human sign-off for real SKU.
- Implement PWA Product Standard with proper installed iOS chrome, safe areas, offline and SW updates.
- Keep API request/response shapes consistent with `contracts/openapi.yaml` and local entities with JSON Schemas, or update contract + migration with review.
- Run focused tests, regression, browser E2E and secret scans; provide real counts and evidence. A test *plan* never equals a passing test.

## Required task completion answer

```text
Task: T-0xx — scope
Repository/branch/HEAD: ...
Actual changed code paths: ...
Contracts/schema/ADR updated: ...
Tests + run evidence: ...
Security & Key handling: ...
Visual QA / source evidence: ...
Deployment: NOT DEPLOYED unless verified with URL, HEAD and smoke
Remaining failures/risks: ...
Next executable task: ...
```

## Copy-ready high-level prompt

```text
Implement one approved P0 task for PWA-AI-Product-Image-Studio-BYOK. First inspect current Git state and AGENTS.md, load applicable KB-MCP Brand Lock and PWA skills, read the canonical SSOT and contracts. Protect STRICT real-product source pixels, unverified claims, secure server-side BYOK session and cost/UNKNOWN retries. Create a small reversible change with unit/integration/Playwright tests, no real user API keys in CI, no automatic production deployment. Record evidence in TASK.md and relevant ADR; don't mark verified without actual test output.
```
