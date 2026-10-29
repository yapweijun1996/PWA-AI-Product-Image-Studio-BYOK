# Evidence Status and Limitations

| Subject | Verified on 2026-10-29 | Not verified / not claimed |
|---|---|---|
| Repository | Local inspection on 2026-10-29: `main` at `4aefa36db63b20bb19b41b45a129f48984302f1e`; the committed tree contains `.gitattributes`, while this documentation pack, contracts, fixtures and validator are untracked | No application implementation, deployed site, live provider request or application tests established. Working-tree and remote state can change; recheck before work |
| Previous project decision | KB-MCP recall confirms user plans seven styles, BYOK, exact name; two skills fully read | No confirmed architecture/deployment approval |
| OpenAI images | Official developer docs describe 2026-09 2.5 Flare / Sunburst and image generation/edit methods | No live API call with seller key; no cost/latency benchmark |
| Security | OpenAI official Help advises against browser-deployed API keys | No deployed secrets vault or penetration test |
| Cloudflare | Official docs list Worker resource constraints and Secrets bindings | No account limits, billing, deployment, service configuration inspected |
| PWA | KB-MCP `pwa:product-standard` read and translated to test cases | No actual iOS device, installed PWA or SW update tests performed |
| Brand fidelity | Reusable KB-MCP Brand Lock prompt and QA methodology recovered | **Zero** real new-product outputs visually tested within this documentation task |
| Documentation | Packaged-copy validation passed with full dependencies in an earlier 2026-10-29 check; the current checkout's recorded `validation-report.json` reports `FAIL` on the manifest set and warnings about missing optional dependencies | The validator traverses `.git` and other checkout files not in the package manifest; a package-only PASS does not prove the checkout command passes. Documentation validation is NOT app, provider, security-runtime or visual testing |

## Required evidence capture during implementation

- Repository URL, branch, HEAD SHA, current AGENTS.md constraints, file paths and relevant test execution logs.
- API account entitlement, model availability, request/response contract redacted fixtures, precise image usage records.
- One source and seven assets for each category, prompt/model/quality/ratio settings, QA scores and hard-veto findings.
- Desktop/iOS/Android screenshots, Lighthouse/accessibility reports, Service Worker N→N+1 update capture.
- Security evidence for BYOK storage, TTL, deletion, tenant identity, logging, rate-limit enforcement, cost reconciliation.

Evidence is private where it contains seller images, credentials or confidential packaging artwork. Use synthetic fixtures in public repos.
