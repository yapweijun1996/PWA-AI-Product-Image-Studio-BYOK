# Evidence Status and Limitations

| Subject | Current evidence | Not verified / not claimed |
|---|---|---|
| Repository | T-010 adds a React/Vite shell under `app/`; T-001 and T-002 were merged locally before it. See the [task ledger](../08-delivery/TASK.md) and Git history for task-level evidence. | No complete product workflow or deployment. Working-tree and remote state can change; recheck before work. |
| Project decision | Owner selected self-hosted gateway, server-configured provider key, seven styles and Pi direction. | Public custody, production deployment and real-key gateway security are not approved. |
| OpenAI images | A prior owner-requested Pi text call and separate direct image call succeeded; see [spike evidence](../09-research/PI_OPENAI_SPIKE.md). | No Pi-to-image gateway workflow or complete cost benchmark. |
| Security | The shell contains no provider-key input; the provider boundary remains a proposed contract. | No implemented secure gateway, OS-level Pi isolation or penetration test. |
| PWA | T-010 browser checks cover shell navigation, theme, network indication and responsive layout in Chromium. | No actual iOS installed-mode, offline launch or service-worker update tests. |
| Brand fidelity | Reusable Brand Lock methodology and source-preservation requirement documented. | No real-brand output or pixel-fidelity validation. |
| Documentation | T-002 checkout and isolated-package validator runs passed with optional dependencies; five synthetic regression tests passed. | Documentation validation does not test the separate application tree, provider, runtime security or visual fidelity. |

## Required evidence capture during implementation

- Repository URL, branch, HEAD SHA, current AGENTS.md constraints, file paths and relevant test execution logs.
- API account entitlement, model availability, request/response contract redacted fixtures, precise image usage records.
- One source and seven assets for each category, prompt/model/quality/ratio settings, QA scores and hard-veto findings.
- Desktop/iOS/Android screenshots, Lighthouse/accessibility reports, Service Worker N→N+1 update capture.
- Security evidence for BYOK storage, TTL, deletion, tenant identity, logging, rate-limit enforcement, cost reconciliation.

Evidence is private where it contains seller images, credentials or confidential packaging artwork. Use synthetic fixtures in public repos.
