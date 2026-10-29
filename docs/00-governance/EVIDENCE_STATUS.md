# Evidence Status and Limitations

| Subject | Current evidence | Not verified / not claimed |
|---|---|---|
| Repository | The React/Vite app supports local SKU creation, confirmed facts, source upload and manual mask editing; task commits and remaining acceptance are in the [task ledger](../08-delivery/TASK.md). | No complete generation workflow or deployment. Working-tree and remote state can change; recheck before work. |
| Project decision | Owner selected self-hosted gateway, server-configured provider key, seven styles and Pi direction. | Public custody, production deployment and real-key gateway security are not approved. |
| OpenAI images | A prior owner-requested Pi text call and separate direct image call succeeded; see [spike evidence](../09-research/PI_OPENAI_SPIKE.md). | No Pi-to-image gateway workflow or complete cost benchmark. |
| Security | A loopback-only development gateway and settings UI implement owner-token app sessions, CSRF/origin checks and provider authorization with synthetic-test evidence; they make no provider calls. | No independent gateway security review, production identity/HTTPS deployment, OS-level Pi isolation or penetration test. Browser/devtools evidence does not prove absence of every possible secret leak. |
| PWA | Chromium exercised offline shell/product and mask reload, mask editing offline, update activation and unsaved-mask protection; a synthetic waiting update retained the active build's cached HTML. | No actual iOS installed-mode, real-device memory or full PWA release test. |
| Source image | Synthetic PNG, WebP and oriented JPEG were previewed and stored; hashes, corruption and rollback were exercised in Chromium. A forced origin quota caused a large-source save to fail without partial product/source writes; retry succeeded after reset. | No physical iOS, natural device storage exhaustion or real-brand fidelity proof. |
| Portable backup | Chromium exported synthetic originals and masks, checked ZIP hashes, restored them on a separate origin, rejected tampered masks and stale cross-tab saves, and inspected a compatible no-mask archive. | Jobs, outputs, QA, receipts, historical schema migration, backup/import quota exhaustion and installed iOS are not implemented or verified. Backups are unencrypted. |
| Brand fidelity | Reusable Brand Lock methodology and source-preservation requirement documented. | No real-brand output or pixel-fidelity validation. |
| Documentation | T-002 checkout and isolated-package validator runs passed with optional dependencies; five synthetic regression tests passed. | Documentation validation does not test the separate application tree, provider, runtime security or visual fidelity. |

## Required evidence capture during implementation

- Repository URL, branch, HEAD SHA, current AGENTS.md constraints, file paths and relevant test execution logs.
- API account entitlement, model availability, request/response contract redacted fixtures, precise image usage records.
- One source and seven assets for each category, prompt/model/quality/ratio settings, QA scores and hard-veto findings.
- Desktop/iOS/Android screenshots, Lighthouse/accessibility reports, Service Worker N→N+1 update capture.
- Security evidence for BYOK storage, TTL, deletion, tenant identity, logging, rate-limit enforcement, cost reconciliation.

Evidence is private where it contains seller images, credentials or confidential packaging artwork. Use synthetic fixtures in public repos.
