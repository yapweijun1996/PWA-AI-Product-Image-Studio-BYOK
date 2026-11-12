# Automatic A+C implementation evidence — 2026-11-12

## Authority and scope

The owner selected A+C: quality remediation plus optional reference-image/multi-view editing. DEC-022 and ADR-022 record that direction. The manager retains prior main-push/Pages authorization, subject to verification. No new paid API call, real key, new provider/model, hosted key custody or full option B preview/comparison/regeneration scope is authorized by this implementation.

Baseline: `main` at `16024109a09f0642362c1e91297ac8a2c3c84c36`. Work took place on isolated `work/ac-quality-reference`. The worker made no push, deployment or cloud resource and used no real credentials. App version is 0.4.0; model remains `gpt-image-2.5-flare`, low quality, 1024-square PNG, with pinned `ai` 7.0.170 and `@ai-sdk/openai` 4.0.115.

## Implemented behavior and source owners

| Requirement | Implementation | Scoped evidence |
|---|---|---|
| Image-private default | `app/automatic-policy.mjs`, `UploadStudio.tsx`, `browserByok.ts` | STRICT default; text-only generations; no reference payload accepted in strict/legacy requests |
| Honest capabilities | `autoImaging.ts` | Measured dimensions/alpha, content bounds; category/view/source lighting UNKNOWN |
| Coordinated layout | `automatic-policy.mjs`, `autoImaging.ts` | Same footprints/visible bottom anchors in prompt and compositor; deterministic contact shadow; heuristic scene/light intent only |
| Genuine Detail | `chooseDetailRegion`, `automaticCompositionEvidence`, pipeline | Square subcrop centered on measured opaque source pixels; original coordinates and enlargement caveat; local before network, no paid call |
| Truthful Tabletop | Automatic policy and result labels | Stable canonical `flat_lay` ID, source-angle Tabletop/concept labels; no unsupported overhead promise |
| Complete billboard layer | `composeAutomatic`, `mountAutomaticBillboard` | Whole text-free ad first, then one local display placement; labeled mockup, no invented copy/claims |
| Reference single/multi-view | `automaticReference.ts`, `browserByok.ts`, pipeline | Primary plus up to two optional views; actual SDK sends ordered PNG bytes as Images edits multipart |
| Consent and budget | Browser adapter, `automaticSession.ts`, Create UI | Separate tab-memory transmission consent; exact hashes/order/count/mode/prompt/estimate approval; reference-inclusive reservation |
| Output trust | Pipeline and decoded-image validator | Full reference result decode before READY; bad IDAT cannot gain image/download action; technical checks separate from visual NOT_ASSESSED |
| Legacy/history | `automaticStore.ts`, UI/export provenance | Automatic db v2 preserves old rows; missing mode remains legacy STRICT; old v1 binaries fail closed; blocked late opens close their connections |
| PWA/advanced compatibility | Existing gateway/review/export/SW source | Existing source/review/export rules and user-driven SW activation retained; browser regression covers affected paths |

All output IDs stay canonical. A normal upload produces six paid styles and a zero-provider-cost Detail crop. Reference editing can continue when local foreground selection fails; the unavailable authentic Detail is explicitly failed rather than fabricated. Additional original views stay in tab memory; only normalized hashes/dimensions persist. Original primary bytes remain unchanged in local history. Reference outputs do not claim original foreground pixels; optional foreground/scene QA hashes are omitted when those layers were not used.

## Input, transport and cost boundary

Each reference is checked against the original 20 MiB/24 MP bounds, decoded with orientation, resized to a maximum 1024-pixel edge and re-encoded PNG. Only IHDR/IDAT/IEND chunks remain, with chunk CRC/order, dimensions, byte bound and SHA-256 verified. At most three references of 5 MiB each are accepted (15 MiB total); URL inputs, original filenames, extra request fields and arbitrary endpoints are rejected.

Reference consent is independent of persistent credentials and spending consent. Reload/pagehide, key change/expiry/removal clear it; revocation invalidates approvals and aborts active reference requests. Epoch/consent checks after hashing, inside the dispatch lock and immediately before fetch cover asynchronous revocation races. The SDK can call only fixed `/v1/images/edits` for Reference or `/v1/images/generations` for STRICT. Credentials/referrers are omitted, redirects refused, responses bounded, retries zero. UNKNOWN keeps the existing no-resend and billing-review holds.

The [official model page](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) and [image guide](https://developers.openai.com/api/docs/guides/image-generation) support image inputs/edits for the selected model. The installed SDK source and a fake-fetch experiment verify `generateImage({prompt:{text,images:[Uint8Array,...]}})` as actual multipart edits. No `input_fidelity` parameter or undocumented model migration is used. The manager's unauthenticated edits OPTIONS probe returned CORS permission for the Pages origin, POST and authorization/content-type headers; this is preflight evidence only, not successful generation, account access or billing evidence.

Each reference reserves an explicit conservative 8,192 image-input-token planning allowance per paid request at USD8/million. Existing 196 image-output-token and UTF-8-byte text allowances remain assumptions. The official GPT Image 2 calculator does not estimate GPT Image 2.5 consumption. Estimates can differ from actual charges; they are not invoices or provider hard caps. Reference-inclusive totals are shown before upload and reserved before the first send. Observed usage/cost is not invented. See the [cost model](COST_MODEL.md).

## Verification

All provider traffic below is synthetic; actual local inference is distinguished from provider generation.

| Check | Result and scope |
|---|---|
| Baseline `npm test` | Manager baseline 300/300 PASS |
| Implementation `npm test` checkpoint | Worker 310/310 PASS; manager independent later checkpoint 313/313 PASS before final CRC/decoder test additions |
| Final targeted unit/semantic tests | `node --experimental-strip-types --test tests/automatic-reference.test.mjs tests/automatic-quality.test.mjs`: 15/15 PASS after final changes; counts overlap the full checkpoint and are not additive |
| Production Pages build | `npm run build -- --mode pages`: PASS after final provider-output decode change; typecheck and UI token/control boundaries passed |
| Complete browser suite | `node --test --test-concurrency=1 tests/browser/*.test.mjs`: 11/11 PASS, zero skipped; serial complete run covers all browser files |
| Changed Pages/reference browser files | 2/2 PASS with bounded DevTools commands; final reference scenario covers corrupt IDAT, single/three-view, consent denial/reset and UNKNOWN partial retention |
| Actual bundled local model | `STUDIO_MATTE_SMOKE=1 node --test tests/browser/pages-preview.test.mjs`: 1/1 PASS with real U2NETP inference and fake provider responses |
| Independent security review | Actual SDK 3-reference multipart/order/hash probes, hash/lock consent and key races, no resend, and final decode-before-READY review passed; no P0/P1 identified within the reviewed boundary |
| Independent browser/visual mechanics | 29 recorded checks including 14 geometry records; 24 responsive/theme screenshots across 320/768/1280; three additional scenario captures; no measured horizontal overflow |
| Diff and documentation | `git diff --check` passed. Manager refreshes root manifests/checksums and performs final documentation packaging validation; worker does not claim that stale-manifest validation passed |

The complete browser run initially exposed a new test setup race: a visible password input was not sufficient proof that credential storage was ready, and clicking submit in the same evaluation as React input changes could run before enabled state. The test now waits for enabled inputs and submit state. A separate full run then stalled with an unbounded existing Pages DevTools/cleanup await. Pages and reference helpers now reuse the existing bounded command/connection pattern and register browser-exit handling before termination, with a finite cleanup fallback. Serial full-suite and changed-file reruns passed. These are test-harness findings; no unsupported attribution to a browser upgrade is made.

Independent actual-browser geometry found the initial rectangular Detail ROI left excessive blank canvas. The final square ROI fix was rebuilt, regenerated and inspected: for the 400×240 fixture, source ROI 109×109 at (146,66) maps visibly to output bounds (31,31)–(992,992). Original foreground bottoms match declared baselines within 2 px across five strict scene styles; the complete ad layer maps to the billboard within 2 px. These measurements demonstrate declared geometry, not realistic light/contact.

Production CI now includes both Pages upload/offline and reference browser tests; bundled-model smoke remains a separate test. Disposable logs/screenshots were retained under `/private/tmp/studio-ac-*` for manager review. No credential value appears in the documentation, hashes or screenshots.

## Limits and rollback

Visual acceptance remains NOT_ASSESSED. Synthetic scenes and opaque-color fixtures do not establish real product extraction, logo/text fidelity, natural light/contact, stylistic aesthetics, commercial photographic readiness, live model/account availability or actual billing. Reference editing may change identity; multiple views cannot prove faithful unseen geometry. Local Detail enlargement adds no authentic resolution. Billboard is a controlled local display mockup. Physical iOS/Safari, installed-device, assistive-technology and rights-cleared SKU acceptance remain open. Option B's full preview/comparison/regeneration remains unimplemented.

Preserve both image databases, originals, outputs and all unknown-charge/no-resend records. Automatic db v2 is an intentional compatibility barrier; an older v1 binary cannot read it. Disable generation or deploy a reviewed v2-compatible artifact for rollback; never delete/downgrade the database or strip reference provenance to make an old binary work. Advanced projects and backup/export contracts are unchanged. PWA updates still require explicit activation.
