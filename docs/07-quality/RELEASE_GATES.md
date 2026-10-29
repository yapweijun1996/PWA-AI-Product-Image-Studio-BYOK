# Release Checklist / Definition of Done

**Status of all gates in this pack: NOT RUN / NOT VERIFIED.** Documentation validator passing is **only** Doc Gate evidence.

## Gate A — Design approval

- [ ] Product owner confirms the selected gateway's custody and operational model, authentication, deployment, retention policy, commercial rights notice, P0 scope and unresolved decisions; hosted custody requires separate approval.
- [ ] ADRs match chosen architecture; architecture is not merely copied from proposals.

## Gate B — Code and contract

- [ ] Main branch/commit and AGENTS.md captured.
- [ ] Typecheck, lint, unit, integration, browser smoke passed; OpenAPI/JSON schemas validated against real adapter.
- [ ] Every P0 FR has implementation path and passing test evidence; no undocumented failure conditions.

## Gate C — Security/privacy

- [ ] No secrets in frontend/Git/logs/cache/local storage/ZIP.
- [ ] CSRF/authz/tenant/session TTL/revocation, input allowlist, rate limiting, error sanitization pass.
- [ ] Vendor API access current and verified; appropriate privacy/rights terms shown.

## Gate D — Product visual QA

- [ ] At least five representative categories evaluated with source images and per-style report.
- [ ] STRICT mask and label fidelity, unsupported viewpoint and human approval hard veto tested.
- [ ] Cost per human-approved image and retry/UNKNOWN rates recorded; product owner accepts pilot results.

## Gate E — PWA/app reliability

- [ ] Installed iOS standalone safe areas + opaque status chrome and orientation passes.
- [ ] Offline local edit/export, Service Worker version/cache update N→N+1 user prompt and loader passes.
- [ ] Responsive/accessibility/keyboard/reduced motion/no overflow and storage quota handling pass.

## Gate F — Release operations

- [ ] Staging/production configs and secrets isolated, rollback rehearsed, monitoring configured and redacted.
- [ ] Product owner explicitly approves deployment; actual production URL and smoke evidence recorded.
- [ ] Final `docs/08-delivery/TASK.md` status aligns with code/test facts; do not claim launch without proof.

## Sign-off record template

`releaseId | proposedAt | reviewer | branch | HEAD SHA | gates A-F PASS/FAIL/UNVERIFIED | evidence links | known exceptions | rollback ref | approve/hold`.

No universal "all green" status is warranted solely from this ZIP.
