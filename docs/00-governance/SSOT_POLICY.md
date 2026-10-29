# SSOT Policy — Authority, Versions, and Change Control

## Purpose

Make **one maintainable source of truth** without confusing design intent with real runtime status. This document is normative for maintaining all documents and source contracts in this pack.

## Evidence precedence

For **actual implementation state**: (1) inspected live code/config and repository commit; (2) passing tests and reproduced runtime/browser evidence; (3) Git history and traceable artifacts; (4) written decisions/requirements; (5) old prose/memory. For **target behavior**: latest explicit user approval overrides earlier proposals and unapproved implementation assumptions. A KB-MCP memory is context, not proof of code or deployment.

## Status vocabulary

| Token | Allowed meaning |
|---|---|
| CONFIRMED | User confirmed product direction or reusable project standard; not implementation evidence |
| PROPOSED | Recommended design requiring ADR/owner confirmation before security-significant action |
| OPEN | Requires a decision or experiment |
| PENDING | Task not implemented |
| IN_PROGRESS | Evidence of work exists; not complete |
| IMPLEMENTED_UNVERIFIED | Code exists but E2E or other gate missing |
| VERIFIED | Code/path + test/browser evidence linked |
| BLOCKED | Prerequisite absent; specify owner and unblock criterion |
| REJECTED | Explicitly rejected alternative; preserve rationale |
| SUPERSEDED | Historical decision replaced; link successor |

## Normative owners

- `contracts/openapi.yaml`: **target** Gateway interface schema. Supplementary prose in `docs/05-api/` explains intent; only change the API structure in OpenAPI.
- `contracts/schemas/*.json`: target portable data fields and validation constraints. Narrative models reference rather than redefine them.
- `contracts/style-presets.json`: stable seven canonical style IDs. Text in `docs/06-ai/` explains instructions and exceptions.
- `docs/01-product/PRD.md`: outcomes, scope, acceptance rules; stable FR/NFR IDs enumerated in `docs/00-governance/REQUIREMENTS_TRACEABILITY.md`.
- `docs/06-ai/VISUAL_QA.md`: QA weights, formula and veto conditions.
- `docs/00-governance/DECISION_REGISTER.md`: accepted versus proposed architecture, vendor and workflow choices.
- `docs/08-delivery/TASK.md`: execution tasks and current evidence statuses. Do not mark DONE on paper evidence only.

## Change protocol

1. Identify impact on product truth, security, API, data schema, prompts, QA and PWA release gates.
2. Inspect current branch, commit and tests before changing any implementation-sensitive spec.
3. Use an ADR (or append one) for changes to storage/secret custody, model, provider, trust boundary, state machine or primary deployment.
4. Change canonical owner first, update references, trace IDs and migration notes. Keep one version of each business rule.
5. Run the documentation validator using the [checkout-safe procedure](../../scripts/README.md) until T-002 resolves its checkout-scope limitation. Verify docs/links/schemas, report the scoped result and separately run code tests when code exists.
6. Record evidence, reviewer, date and any unresolved risk. No inferred approval.

## Semantic version policy

- This bundle starts at **SSOT 1.0.0 / DRAFT**. It is a documentation baseline, not software v1.
- MAJOR: incompatible API/schema or product invariant change.
- MINOR: compatible new features, approved architectural ADR, additional style or nonbreaking API fields.
- PATCH: clarification, link, typo, metadata update without changing contract semantics.
- JSON documents have explicit `schemaVersion`; future app must support defined migrations.

## Artifacts and hashes

`package-manifest.json` contains a SHA-256 digest per included payload file. `SHA256SUMS.txt` provides an independent standard form; `scripts/validate_ssot.py` recomputes checksums. `validation-report.json` records packaging validation, not application test results. These metadata files are not allowed to carry secrets.
