# E2E Acceptance Cases (P0) — Planned, NOT RUN

**Oracle:** pass condition is behavior observed in installed app with controlled input, logs/screenshots, and no hidden provider calls. Assign each case a test ID, target branch SHA, environment and evidence artifact before marking PASS.

| ID | Setup / steps | Required observable result |
|---|---|---|
| E2E-001 | Create SKU, reload | Project ID and fields restored; no duplicate created |
| E2E-002 | Upload PNG/JPEG/WebP, EXIF image, corrupt fake PNG | Original hash/rotation correct; bad inputs rejected |
| E2E-003 | Enter verified facts + hostile unsupported claim | Only confirmed facts used; no claim hallucination |
| E2E-004 | Switch STRICT/BALANCED/CREATIVE | Strong visual labels and consent; old approval invalidated |
| E2E-005 | Load source with Chinese label and mask, composite | Original protected label ROI retained; mask failure blocks STRICT |
| E2E-006 | Create all 7 presets | Stable IDs, appropriate scenes, no cross-category props |
| E2E-007 | Select only Studio and submit | Exactly one logical job, one planned billable attempt; no other styles sent |
| E2E-008 | Select unsupported model/size/quality | Client/server reject, no provider call |
| E2E-009 | Configure a fake server key; connect, reload and disconnect | Provider authorization expires or is revoked, no key enters the browser or logs, and disconnect is not described as deleting or revoking the server key |
| E2E-010 | Submit three selected styles | Three separately trackable job IDs, statuses and receipts |
| E2E-011 | Preview source and generated output, zoom | Both viewable; original asset untouched |
| E2E-012 | Inject wrong Chinese label into result | Hard veto even if weighted QA >=85; human approval prevented |
| E2E-013 | Mix approved and rejected assets and export | Approved bundle excludes rejected; drafts clearly labeled if opted in |
| E2E-014 | Set spend soft limit below estimate; confirm one attempt | Explicit warning, user approval and server-bound one-use attempt authorization; no provider call without consent |
| E2E-015 | Simulate provider accept then lost response / retry | UNKNOWN, no automatic duplicate paid call; retry requires acknowledgement and a new attempt approval |
| E2E-016 | Save and reopen large local product | IndexedDB consistent; quota failure safe and surfaced |
| E2E-017 | Export/import ZIP, corrupt hash, upgrade old schema | Valid restores, corrupt rejects, no silent overwrites |
| E2E-018 | Install/cache app, go offline, edit/export | Offline shell + local work; Generate disabled transparently |
| E2E-019 | Install version N then deploy N+1 | Update CTA → user consent → loader → activation → reload, no silent data loss |
| E2E-020 | iPhone standalone and keyboard mobile/desktop | Safe areas, opaque status bar, 16px inputs, 44px targets, no overflow, focus and reduced motion |
| E2E-021 | Export 1:1, 4:5, 9:16 PNG/JPEG/WebP | Dimensions/alpha/format as chosen; no unsupported platform guarantee |
| E2E-022 | Inspect exported evidence after retry | Source/prompt/version/model/usage/attempt IDs correct, no Key |
| E2E-023 | Simulate 400,401,403,413,429,5xx, timeout | Correct safe message and retry state per [error policy](../05-api/ERROR_RETRY_COST.md) |

## Security cases

SEC-001 XSS/DOM key exposure; SEC-002 CSRF/cross-site; SEC-003 principal isolation; SEC-004 Key leak across all persistence/log/export; SEC-005 model/URL allowlist; SEC-006 bomb/malformed ZIP and data deletion; SEC-007 SW cache/telemetry redaction; SEC-008 authenticated rate/spend/TTL tests. See [threat model](../03-security/THREAT_MODEL.md).

## Quality cases

QA-001 label/logo; QA-002 SKU/color/shape; QA-003 pose/mask; QA-004 weighted score and veto; QA-005 claims/UGC/rights. See [visual QA](../06-ai/VISUAL_QA.md).

## Device matrix

- Desktop Chromium current, Firefox current, WebKit where supported.
- Android Chrome installed PWA.
- **Real iPhone Safari installed PWA**: camera input, keyboard, notch/safe areas, background foreground restore, network loss, update.
- Low RAM device with several 12MP photos; ensure no unbounded decode queue.

## Evidence format

For each case: `testId`, commit SHA, OS/browser/version, fixture hash, actual steps, stdout/screenshots, PASS/FAIL/UNVERIFIED, blocker link. A planned table is not test evidence.
