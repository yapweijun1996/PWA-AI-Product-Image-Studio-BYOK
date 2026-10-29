# Source Register — Primary References and KB-MCP Provenance

**Verification date:** 2026-10-29. These are publicly documented capabilities as of this date and may change. Recheck before coding or pricing claims. Sources are **not** evidence that this project's app is deployed or that a vendor Key has been tested.

## OpenAI primary references

| ID | Source | Relevant claim |
|---|---|---|
| OPENAI-01 | https://developers.openai.com/api/docs/guides/image-generation | Image API generations/edits, Responses tool, quality/size, cost/usage/cache nuance |
| OPENAI-02 | https://developers.openai.com/api/reference/resources/images/methods/generate | Generate API, model IDs, dimensions, output format and parameters |
| OPENAI-03 | https://developers.openai.com/api/reference/resources/images/methods/edit | Edits API, source reference, mask, models and limitations |
| OPENAI-04 | https://developers.openai.com/api/docs/guides/image-prompting | Prompting and source image preservation guidance |
| OPENAI-05 | https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst | Sunburst model and token rates |
| OPENAI-06 | https://developers.openai.com/api/docs/pricing | Image input/output and text rates; pricing may change |
| OPENAI-07 | https://developers.openai.com/api/docs/guides/rate-limits | 429, Retry-After and rate-limit headers |
| OPENAI-08 | https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety | No API key in browser/mobile/repo |
| OPENAI-09 | https://developers.openai.com/api/docs/changelog | Sep 8 2026 image model release and Oct 23 GPT Image 1 shutdown context |
| OPENAI-10 | https://developers.openai.com/api/docs/guides/your-data | API data controls, retention and eligibility conditions |

**Critical note:** OpenAI docs state GPT Image 2.5 cached input rates apply to the image generation tool in Responses API, not direct Image API calls. Do not apply cache discount blindly to `/images/edits`.

## Cloudflare / browser security primary references

| ID | Source | Relevant claim |
|---|---|---|
| CF-01 | https://developers.cloudflare.com/workers/platform/limits/ | Worker CPU/memory, request size and response limits |
| CF-02 | https://developers.cloudflare.com/workers/configuration/secrets/ | Secrets bindings and no commit secrets |
| CF-03 | https://developers.cloudflare.com/durable-objects/api/alarms/ | DO alarm for cleanup, at-least-once semantics |
| WEB-01 | https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CSP | CSP/XSS guidance |
| WEB-02 | https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist | Persistent storage request is advisory |
| WEB-03 | https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access | Browser permission and secure-context considerations for local-network and loopback access |
| WEB-04 | https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria | Browser storage quotas and eviction |
| WEB-05 | https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL | In-memory data URL costs and the toBlob alternative |
| LIB-01 | https://github.com/imgly/background-removal-js | Browser background-removal library and stated AGPL license; review all applicable assets separately |
| LIB-02 | https://onnxruntime.ai/docs/get-started/with-javascript/web.html | ONNX Runtime Web execution options; device performance remains unverified |
| WEB-06 | https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport | On-screen keyboard and zoom can change the visible viewport |

## UI layout and accessibility references

| ID | Source | Relevant claim |
|---|---|---|
| UX-01 | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | WCAG 2.2 minimum pointer target size and exceptions |
| UX-02 | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html | Single-pointer alternatives to dragging and exceptions |
| UX-03 | https://www.w3.org/WAI/WCAG22/Understanding/reflow.html | Reflow conditions and exceptions |
| UX-04 | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ | Modal focus, keyboard and inert-background pattern |
| UX-05 | https://developer.apple.com/design/human-interface-guidelines/layout | Safe-area guidance for layout |

## Competition primary references

| ID | Source | Relevant claim |
|---|---|---|
| COMP-01 | https://www.photoroom.com/ai-product-photography/e-commerce | Image backgrounds, product fidelity QA and batch workflows |
| COMP-02 | https://www.pebblely.com/how-to/ | Multiple photos, editable text, presets, bulk workflow |
| COMP-03 | https://flair.ai/ | Drag/drop canvas, reusable templates and marketing visuals |
| COMP-04 | https://help.shopify.com/en/manual/ai-powered-tools/media-generation | Shopify image background and generative editor |
| COMP-05 | https://help.photoroom.com/en/articles/16187005-how-to-use-product-fixer | Product Fixer and user-selected repair regions |

## KB-MCP prior decisions, not external URLs

- `image:product-photography-brand-lock` skill version 1.0.1, owner Yap Wei Jun / AI Product Visuals, reviewed in this preparation; product truth, seven style add-ons, STRICT compositing, 35/25/15/15/10 weighted QA.
- `pwa:product-standard` v1.0.0, owner Yap Wei Jun, reviewed; iOS-first opaque status chrome, safe areas, safe SW update, offline contract and accessibility.
- `project:code-docs-source-of-truth-sync` read; code/test first for implementation, explicit user decisions for intended behavior, no "docs-only DONE".
- `engineering:scmc-review` read; maintain simple, clear, modular and consistent contracts under security/correctness priority.
- KB-MCP recall (2026-10-29): user intended exact repo name, own OpenAI BYOK, integrate 7-Style Brand Lock. Memory is context, not implementation proof.
- GitHub connector 2026-10-29: `get_repo(yapweijun1996/PWA-AI-Product-Image-Studio-BYOK)` returned public repository, default branch main, size 0. This is metadata only, not direct HEAD inspection.

## Verification policy

Vendor model support, pricing, terms, API limits, rate limits and ecommerce platform image requirements are time-sensitive. Every actual release must record newly checked date and evidence. No source here promises commercial use authorization or regulatory compliance.
