# Threat Model (STRIDE-inspired) / Abuse Cases

## Assets and trust boundaries

Sensitive: seller OpenAI API Key; original product photography/packaging art; seller verified facts and SKU identity; billing/wallet; session cookies; secret-encryption key; source/QA history.

Trust boundaries: Browser UI / arbitrary extensions → same-origin gateway → encrypted server session → OpenAI API; untrusted source images and uploaded project ZIP → local parser and compositor; untrusted provider output → local QA and export.

## Threat register

| ID | Threat | Impact | Proposed controls | Test |
|---|---|---|---|---|
| TH-01 | XSS steals entered Key before submit or invokes gateway | Critical | CSP, no untrusted HTML, dependency SRI/lockfiles, escape data, short session | SEC-001 |
| TH-02 | Cross-site form / CSRF triggers paid generation | High | SameSite cookie, CSRF token, Origin + Fetch Metadata, authz | SEC-002 |
| TH-03 | One user's job/session accessed by another | Critical | server principal binding, scoped data access, deny by default | SEC-003 |
| TH-04 | Key lands in logs, URL, browser storage or ZIP | Critical | redaction rules, log scan, storage scan, no key persistence | SEC-004 |
| TH-05 | Gateway used as arbitrary OpenAI/HTTP proxy | High | fixed allowlisted endpoints/models; strict body schema and egress | SEC-005 |
| TH-06 | Provider requests repeated during timeout | High billing | pre-submit reservation and UNKNOWN, explicit retry | E2E-015 |
| TH-07 | Image/ZIP bomb corrupts storage or crashes device | High availability | MIME magic, dimensions, limits, decompression guard, zip traversal check | SEC-006 |
| TH-08 | Uploaded image contains malicious instructions text | Medium | treat image/text as untrusted data, facts require source/user; no external tools execution | QA-005 |
| TH-09 | Stale Service Worker caches API or credential | Critical | cache only versioned app shell; inspect CacheStorage, HTTP no-store | SEC-007 |
| TH-10 | Unauthorized packaging trademark/watermark removal | Legal/compliance | rights confirmation; don't remove attribution/marks without authorization | QA-005 |
| TH-11 | Fabricated label or endorsement passes QA | High reputational | original source compositing, hard veto, human review | QA-001..005 |
| TH-12 | Vault ciphertext decrypted by unrelated session | Critical | unique per-principal mapping, AAD, authz, key rotation | SEC-003 |
| TH-13 | Merchant key has excessive provider permissions | Financial | onboarding recommend project-restricted Key, quotas and provider budget | SEC-008 |
| TH-14 | Malicious provider result malformed base64 or huge image | High | decode caps, MIME/width verification, no dynamic execution | PERF-001 |

## Security verification matrix

`SEC-001` XSS/DOM injection tests incl. SKU names; `SEC-002` CSRF and cross-origin POST; `SEC-003` tenant/principal isolation; `SEC-004` no Key in localStorage, IndexedDB, CacheStorage, logs or export; `SEC-005` model and URL allowlist; `SEC-006` image/ZIP abuse & deletion; `SEC-007` no authenticated cache and telemetry redaction; `SEC-008` rate-limit, spend warnings and session TTL.

## Fail-closed invariants

No auth → no session. No encrypted key → no provider call. No valid source/mask → no STRICT approval. No user approval → no `approved` export flag. No definitive provider answer → UNKNOWN, never silent retry. No rights confirmation → no commercial "ready" label.

## Residual risk

A compromised operator backend or injected frontend can access transient keys; malicious browser extensions may read user input; accidental private data may enter third-party image processing; billing can remain ambiguous after network interruption. A security audit can reduce, not eliminate, these risks.
