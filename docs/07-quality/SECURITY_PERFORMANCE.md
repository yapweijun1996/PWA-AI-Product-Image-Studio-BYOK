# Security and Performance Verification

## Security test plan

| ID | Input / attack | Pass criteria |
|---|---|---|
| SEC-001 | SKU name with HTML/script, injected product metadata | No HTML execution, Key not discoverable outside trusted submission |
| SEC-002 | Cross-site POST / missing CSRF token | 403/unauthorized and zero provider requests |
| SEC-003 | Session A calls job/session B, cookie fixation | No cross-user access, deny by default |
| SEC-004 | Inspect localStorage, sessionStorage, IndexedDB, CacheStorage, source map, logs, ZIP | No bearer Key, token or sensitive session secret |
| SEC-005 | Set model to unknown, baseURL attacker domain, redirect, unapproved path | 400/403 before any bearer outbound send |
| SEC-006 | ZIP slip/symlink/zip bomb, malformed image, delete project | Rejected safely; unrelated projects unaffected |
| SEC-007 | SW offline request replay, HTTP cache, telemetry export | No `/api/*` or user image cached, no secret/prompt leak |
| SEC-008 | Session expiry/disconnect, rate bursts, repeated cost override | Access cut off/limits applied with visible feedback |

## Performance test plan

| ID | Workload | Measurement / initial target hypothesis |
|---|---|---|
| PERF-001 | Decode / preview a 12MP JPEG on mid-range phone | No crash, image budget measured, no blocked UI for >1s |
| PERF-002 | Manual mask on 12MP source | Smooth strokes on preview; final render in background Worker, no growing leaked canvases |
| PERF-003 | 7 output Blobs with 2 concurrent previews | Memory peaks captured; release object URLs and bitmaps |
| PERF-004 | ZIP approved exports and import | Bounded heap, progress/cancel, hash validated, no corrupted partial import |
| PERF-005 | SW N→N+1 while unsaved mask exists | Prompt, save guard, no lost draft or uncontrolled reload |

These are suggested targets, not measured pass results. Use Performance panel, Chrome memory sampling and actual iOS low-memory testing before acceptance. Worker Free CPU/memory resource limits and provider size costs must be assessed with real data.

## Recovery and incident simulations

- OAuth/authentication outage (if selected); vault down, malformed encryption Key; repeated 429; provider 5xx; offline after submit; asset save failure; storage eviction; revoked Key.
- Every error visible without Key disclosure; document whether request may have billed. Preserve local source/QA history; no unbounded retries.
