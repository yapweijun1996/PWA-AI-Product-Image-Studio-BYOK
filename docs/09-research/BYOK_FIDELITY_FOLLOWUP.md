# BYOK, Fidelity and Mobile Feasibility — Follow-up Research

**Research date:** 2026-10-29 (Asia/Singapore). **Scope:** additional desk research; no app implementation, authenticated OpenAI request, product-image generation, paid experiment, seller interview or physical-device test was performed. Product decisions remain in the [decision register](../00-governance/DECISION_REGISTER.md); this document supplies evidence and open questions, not approval.

## Executive findings

1. A local companion changes key custody, but creates browser-to-local-service permission, pairing and deployment questions. On iPhone, the phone's `localhost` is the phone itself; a companion on a separate desktop is a LAN service, not the phone's loopback service. Desktop-only proof is not evidence for iOS.
2. A generative mask is not a product-pixel lock. Separate original-derived foreground and generated background, but describe preservation narrowly: alpha/mask choice, geometry transforms, resampling, color conversion and final compression can still affect output. Exact output labels require human review.
3. The proposed gateway contract includes base64 image payloads. Its 16,777,216-character image-field limit is at most 12,582,912 decoded bytes (12 MiB) before considering padding and other validation; it is not a 16 MiB original-image limit. This is arithmetic from the current contract, not a tested gateway limit.
4. Shopee and Lazada Singapore product image rules could not be verified with sufficient detail from accessible official results in this pass. Do not add fixed platform-specific thresholds or a compliance badge based on speculation.
5. Competitor fidelity tools already exist; our combination of user-controlled workflow and source comparison is a testable positioning hypothesis, not a demonstrated unique capability.

## 1. Current project and evidence boundaries

- The inspected `main` commit is `4aefa36`; the working tree contains untracked documentation, proposed contracts, fixtures and a documentation validator, with no application runtime established.
- The product spec proposes OpenAI BYOK, seven independent style jobs, source comparison and manual review. React, Cloudflare Pages/Workers, server-side custody, identity and local data retention are proposed rather than approved or deployed.
- The Brand Lock and PWA standards were read earlier in this conversation. Provider and browser details below are dated public documentation, not proof of the owner's account, device behavior or project implementation.

## 2. BYOK trust and device feasibility

| Candidate | Secret handling and trust | Device/operational questions | Evidence status |
|---|---|---|---|
| Hosted authenticated gateway | User supplies key to first-party backend; encrypted server session may reduce at-rest exposure but operator and deployed code are trusted. | Authentication, principal binding, encryption key lifecycle, deletion, request caps, incident response and public custody approval are required. | Proposed in current architecture; no implementation or security test. |
| User-hosted gateway | User operates backend and secret store. Hosting operator and server remain in trust boundary. | Deployment, authentication, updates, access control, costs and cross-origin connectivity require owner setup. | Proposed alternative, not tested. |
| Local companion | User-controlled process holds provider key and exposes narrowly scoped local actions. Browser still has authority to invoke actions and sends images/prompts to the companion. | Exact-origin allowlist, one-time pairing/session authentication, DNS rebinding and hostile-site protection, revocation, local network permission and process updates. A phone-to-desktop setup involves LAN reachability and cross-device security. | Research alternative, not an approved design or tested implementation. |
| Browser-direct | Running app JavaScript accesses the key for the request. Memory-only avoids persistent browser storage but does not eliminate access by compromised same-origin code or malicious updates. | Simplest static distribution, but increased key exposure and potential spend. OpenAI recommends keeping API keys in secure server-side storage. | Do not treat as equivalent security or assume acceptable for public launch. [OpenAI key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety). |

Chrome describes separate permissions for access to local and loopback address spaces, plus standard CORS considerations. The exact features, permission names and mixed-content behavior vary by browser and version; make a user-initiated connection, show denied/recovery states, and verify real Chrome, Safari and installed iOS/Android rather than assuming uniform support. [Chrome Local Network Access guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access); [Chrome LNA permission overview](https://developer.chrome.com/blog/local-network-access).

**Decision implication:** preserve existing OPEN-001 to OPEN-004. Evaluate a local companion as an additional option without quietly replacing the existing proposed hosted gateway or claiming that an owner decision has been made. A production key must not be persisted in the frontend under the current project contract.

## 3. Image fidelity and mask limitations

### What is supported by documentation

- GPT Image editing masks guide editing rather than guarantee pixel-exact shape boundaries. For multiple source images, the stated mask applies to the first image. [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation).
- A source-layer composition avoids generative redrawing of pixels in that layer. It does **not** automatically guarantee that the cutout includes every real feature, that edges are free of halos, or that scaled/JPEG-exported output is pixel-identical. This conclusion follows from the proposed workflow; actual quality has not been measured.
- Exact hidden views cannot be established from a single reference. Use the supplied view or mark the result as a concept and do not invent label text or claims.
- Photoroom's Product Fixer uses an original reference and a user-selected area to repair AI image details; its instructions say some outputs may remain incorrect. This is evidence of a competing workflow, not independently measured accuracy. [Photoroom Product Fixer](https://help.photoroom.com/en/articles/16187005-how-to-use-product-fixer).

### Evaluation requirements

| Scenario | Main risk | Proposed check |
|---|---|---|
| Tiny multilingual packaging labels | Letter, digit, brand or variant drift | 1:1 crop comparison against readable original; mark source illegible as UNVERIFIABLE. |
| Transparent glass / reflective surfaces | Mask includes old background or drops translucent regions | Inspect alpha against dark and light test backgrounds; human review. |
| White product on white background | Subject edge and cropping hard to see | Compare against checkerboard or contrast background, then inspect target export. |
| Fine fabric, hair or cables | Broken silhouette / missing thin parts | Zoom mask edge; compare source and output. |
| Scaled or JPEG export | Resampling, color shifts and lossy compression | Preserve original and mask; record output dimensions and format; check essential details visually. |
| Flat lay / macro | An unavailable angle or detail is invented | Request a compatible photo or use a clearly labeled concept; no silent substitution. |

`@imgly/background-removal` describes in-browser processing and an AGPL license; project code, model weights, transitive licenses, bundling and commercial-use implications must be reviewed separately before selection. It is an example, not an approved dependency. [IMG.LY repository](https://github.com/imgly/background-removal-js).

ONNX Runtime Web publishes browser/engine support matrices and WASM/WebGPU execution-provider options. These describe runtime availability, not performance or correctness of a particular segmentation model on the owner's phone. Select an actual model only after license, download size, cold-start, memory, offline and physical-device tests. [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).

## 4. Gateway and device resource constraints

- The proposed OpenAPI JSON `imageDataBase64` property has `maxLength: 16777216`; with standard base64, 4 characters encode at most 3 bytes. Thus the maximum mathematical payload is `16777216 × 3 / 4 = 12582912` bytes before padding. MIME validation, whole-body limits, metadata and runtime checks can lower the practical accepted size. Do not advertise this number as a supported real upload size before implementation and testing. [Proposed gateway contract](../../contracts/openapi.yaml).
- Cloudflare currently describes a 128 MB memory limit **per isolate**, and one isolate can handle multiple concurrent requests. Image decoding, JSON strings, base64 conversion and concurrent requests may consume multiple copies; exact runtime memory must be measured. Account-plan body limits and Worker CPU limits are separate constraints. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Browser `canvas.toDataURL()` creates an in-memory string. MDN recommends `toBlob()` for large-image export; output format support, memory, timeout and download behavior still require target-device tests. [MDN toDataURL](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL).
- Cloudflare Durable Object alarms have at-least-once execution and retries. If the proposed vault uses alarms for cleanup, enforce expiry on every read as a design requirement; do not rely on an alarm firing at the exact expiry instant. [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

## 5. Cost and privacy specifics

- OpenAI's GPT Image 2.5 Flare and Sunburst share published per-token Standard rates, but equal rates do not imply equal token consumption or cost for the same requested image. A comparable benchmark must hold model settings, source inputs and evaluation conditions explicit. [OpenAI image generation cost guidance](https://developers.openai.com/api/docs/guides/image-generation).
- GPT Image 2/2.5 cached input pricing applies to the image-generation tool in Responses API rather than direct `/v1/images/edits`. Responses requests can also incur mainline-model charges. Account invoice and current documentation remain authoritative. [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation).
- The existing [illustrative cost model](COST_MODEL.md) uses hypothetical token counts and is not a measurement. Do not estimate actual pilot spend by equating it with the hypothetical $0.1035 result.
- OpenAI says API data is not used for model training by default unless opted in. Its data controls list default abuse-monitoring retention and endpoint-specific state and zero-data-retention eligibility; different product, region and account controls can apply. Verify actual seller-account settings before making privacy promises. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).
- A timeout or client abort can leave provider-side processing and billing ambiguous. Keep UNKNOWN distinct from failure; never auto-retry an ambiguous paid attempt or present a missing usage field as zero cost.

## 6. Local-first storage and backup

Browser storage is generally best effort until persistence is granted. `navigator.storage.persist()` can return false, and Safari can proactively evict inactive script-created data under conditions described by MDN. Clearing site data, private browsing and device loss remain separate risks. Preserve original assets independently and offer backup/restore; do not describe offline storage as a permanent backup. [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [MDN persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

## 7. SG/MY marketplace and competitive landscape

- The PRD proposes Singapore/Malaysia sellers and Shopee/Lazada/Shopify channels, but we have no direct seller interviews and no representative demand data. Treat this as a research segment, not validated market size.
- Public search in this pass did not produce a sufficiently specific, accessible, authoritative current Shopee Singapore or Lazada Singapore product image specification. The Lazada seller help center was reachable, but the returned page did not expose the needed image dimensions. This does not mean those rules do not exist. [Lazada seller help](https://sellercenter.lazada.sg/helpcenter/s/faq/knowledge?categoryId=1000028218&flag=tempWebview&hybrid=1&m_station=BuyerHelp&questionId=1000145825).
- Shopify documents one-at-a-time media generation, automatic subject detection and manual correction, and describes a default 1 MP generated image size; account, plan and current feature availability must be checked. [Shopify media generation](https://help.shopify.com/en/manual/ai-powered-tools/media-generation).
- Photoroom documents a reference-based detail-fixing workflow and batch tools. Our proposed evidence trail and manual approval may be useful, but it is not proven to outperform established tools in cost, ease, fidelity or repeat use. [Photoroom Product Fixer](https://help.photoroom.com/en/articles/16187005-how-to-use-product-fixer).

**Proposed first commercial discovery:** interview 5–8 consented SG/MY sellers using a common task guide; observe SKU intake, real listing preparation, editing, device selection, image review and their reaction to handling an API key. Do not extrapolate prevalence from a convenience sample or contact sellers without authorization.

## 8. Actionable next research and acceptance

1. **Architecture spike, no real key:** test companion pairing, denial/recovery and unauthorized-origin cases using a synthetic credential; desktop loopback and phone-to-desktop LAN are separate scenarios. Obtain an explicit architecture decision before committing to public key custody.
2. **Fidelity pilot, subject to rights and budget:** use the existing [pilot protocol](PILOT_EXPERIMENT.md); compare pre-verified source/cutouts, STRICT composites and BALANCED edits with randomized, blinded human review. Track unusable/unverifiable cases and correlate multiple outputs by SKU. No live image generation has been run.
3. **Device memory tests:** use synthetic 12 MP and larger fixtures, measure decode/mask/composition/export and peak memory on real target devices; inspect color, alpha, orientation and quota-failure recovery. Do not claim any performance threshold before measurement.
4. **Marketplace facts:** retrieve official country/category documentation via authorized seller access if needed; record retrieval date and apply owner-selected export presets only after verification.
5. **Cost evidence:** mock first; then run only a pre-authorized, capped provider probe using approved sample images and a disposable/restricted key where supported. Record exact request count, actual usage where available, failed and UNKNOWN results; omit raw images, credentials and sensitive prompts from logs.

## 9. Remaining unknowns

Actual seller willingness to use BYOK; platform-specific listing rules for the initial channel; key custody approval; model availability in the seller's account; quality and expense per approved image; mobile permission compatibility; mask/package licensing; iPhone/Android performance; and whether local backups and updates work are all unverified. These cannot be resolved by documentation alone.
