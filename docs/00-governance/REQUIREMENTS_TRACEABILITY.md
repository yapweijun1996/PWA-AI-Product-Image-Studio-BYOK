# Requirements Traceability Matrix (RTM)

**Baseline:** every requirement is **PENDING CODE / PENDING EVIDENCE** as of bundle creation. E2E IDs refer to [E2E_ACCEPTANCE](../07-quality/E2E_ACCEPTANCE.md). `P0` = release block, `P1` = subsequent increment. The tests below are *planned* not performed.

| ID | Priority | Requirement (normative behavior) | E2E / validation |
|---|---|---|---|
| FR-001 | P0 | Create or open independent SKU projects | E2E-001 |
| FR-002 | P0 | Validate source images/type/size/orientation; preserve originals | E2E-002 |
| FR-003 | P0 | Maintain verified product facts with provenance; no claims inference | E2E-003 |
| FR-004 | P0 | STRICT/BALANCED/CREATIVE mode with clear truth labels | E2E-004 |
| FR-005 | P0 | Original-pixel compositing/accurate alpha mask or block STRICT release | E2E-005 |
| FR-006 | P0 | Exactly seven category-adaptive preset IDs and prompt versions | E2E-006 |
| FR-007 | P0 | Independently select any subset of styles; no forced 7-call batch | E2E-007 |
| FR-008 | P0 | Explicit allowlisted model/quality/output sizes and preflight constraints | E2E-008 |
| FR-009 | P0 | Secure BYOK connect/status/disconnect without client persistence | E2E-009 |
| FR-010 | P0 | Per-style generation job and immutable attempt/evidence records | E2E-010 |
| FR-011 | P0 | Preview original vs result with reasoned provenance | E2E-011 |
| FR-012 | P0 | Weighted visual QA plus severe-failure veto; human review | E2E-012 |
| FR-013 | P0 | Only approved assets exported as approved; rejected excluded | E2E-013 |
| FR-014 | P0 | Pre-submit cost estimate, warning/cap semantics, usage receipts | E2E-014 |
| FR-015 | P0 | Explicit billable Retry with attempt ancestry; UNKNOWN is not auto-retried | E2E-015 |
| FR-016 | P0 | Local-first IndexedDB persistence; safe quota handling | E2E-016 |
| FR-017 | P0 | Versioned ZIP export/restore with hash & schema checks | E2E-017 |
| FR-018 | P0 | Offline shell + local view/edit/export; no offline AI success claim | E2E-018 |
| FR-019 | P0 | Safe PWA install, versioned Service Worker, user-controlled update | E2E-019 |
| FR-020 | P0 | Mobile, iOS safe area, keyboard, contrast, reduced-motion support | E2E-020 |
| FR-021 | P0 | Ratios 1:1, 4:5, 9:16 and format conversion only where source valid | E2E-021 |
| FR-022 | P0 | Prompt/input hash, created time, model, quality, usage and QA lineage | E2E-022 |
| FR-023 | P0 | 400/401/403/413/429/5xx/timeouts surfaced with safe recovery | E2E-023 |
| FR-024 | P0 | Production gateway authz/CSRF/quotas/allowlist and deletion | SEC-001..008 |
| FR-025 | P1 | Brand kit, export presets, listing copy, batch SKU workspace | Future tests |
| FR-026 | P2 | Video, team sync, platform write API and alternative providers | Future tests |
| NFR-001 | P0 | API keys never persist in browser storage or logs | SEC-001..004 |
| NFR-002 | P0 | HTTPS, CSP, least privilege, anti-abuse control | SEC-002..008 |
| NFR-003 | P0 | Real SKU fidelity prioritized above aesthetics and style fit | QA-001..005 |
| NFR-004 | P0 | App remains responsive under target image load; stress test thresholds proposed | PERF-001..005 |
| NFR-005 | P0 | Redacted telemetry incl. error, job, spend, failure-reason | SEC-007 |
| NFR-006 | P0 | Desktop, Android Chromium, iOS Safari + installed PWA | E2E-019..020 |
| NFR-007 | P0 | Corrupt/old local records fail recoverably; backup offered | E2E-017 |
| NFR-008 | P0 | No unbounded cost / retries; provider billing remains authoritative | E2E-014..015 |
| NFR-009 | P0 | Release gate demands evidence; no docs-only completion claims | RELEASE-GATE |
| NFR-010 | P0 | WCAG-informed semantics and usable 44x44 targets | E2E-020 |
| NFR-011 | P0 | No surprise server-side image storage; deletion and retention documented | SEC-006 |
| NFR-012 | P0 | No auto-publishing, claims fabrication, endorsements, unsafe labeling | QA-005 |

## Coverage rule

A PR is not READY merely because it links a requirement. It must add code path + failing-then-passing test evidence + browser/screenshot when visual + real provider test where appropriate. Individual seller keys are not spent in CI. Where a test is genuinely impossible, record UNVERIFIED with release impact.
