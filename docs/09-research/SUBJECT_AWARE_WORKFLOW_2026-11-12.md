# Subject-aware workflow redesign — 2026-11-12

> This is the v0.5.0 historical evidence. DEC-025 / v0.5.2 later removed the global automatic-workflow hold for older UNKNOWN attempts, while retaining their records, provider waits and no-auto-retry behavior.

Status: implementation and scoped local verification complete. Deployment status is tracked by the exact main revision in GitHub Actions, not inferred from this static report. This report distinguishes design, synthetic checks and photographic acceptance.

## Authority and baseline

The owner approved the full P0–P5 plan and KB auto-manager implementation. DEC-024/ADR-024 record the scope. Baseline is main `7d08da0`, app v0.4.1. Previous CI run 43166585643 passed 324 unit tests and separate Pages/reference/monthly browser files. That baseline does not prove this redesign works.

The source writer works in an isolated worktree. Independent security and browser reviewers inspect actual code and built behavior. The manager owns documentation, integration and authorized main/Pages delivery. No real key, paid API request or external provider test is included.

## Knowledge and experiment

Retrieved KB manager v2.3, coding routing, safe-impact gate, SEVA, product brand-lock v1.0.1, PWA standard v1.0.0, code/docs synchronization, SCMC, UI routing and visual-taste guidance. Aggregate Brain recovery failed with `snapshot_changed_or_foreign_scope`; it is not recorded as a passed engineering gate. The owner's existing local-verification waiver applies.

Official references inspected: [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). A disposable actual pinned-SDK probe exercised `generateText`, `Output.object`, fixed Responses, strict JSON schema, `store:false`, bounded output and no tools against fake fetch only. JSON-schema declaration alone did not reject bad semantic structures: a runtime validator is required. An unauthenticated OPTIONS preflight returned allowed origin/method/headers; this does not establish authenticated POST availability or provider success.

## Intended code boundaries

- Vision policy owns pinned model, purposes, bounded schemas, geometry and estimate assumptions.
- Subject preparation owns immutable-original coordinate mapping, clean references and genuine Detail ROI.
- Automatic pipeline owns reservations, lifecycle, selection, generation, review and immutable regeneration versions.
- Result components own compact cards, preview/comparison, local copy/display derivatives and accessible interactions.
- Existing credential/usage stores retain explicit permission and monthly accounting; safe schema migration respects active upload leases.
- STRICT keeps original image pixels local. Reference analysis and review are explicitly consented additional transmission purposes.

## Findings addressed during implementation

Independent review identified an output-review style-count mismatch, unsafe auxiliary-subject grouping, annotation sliver overlap, absent runtime JSON validation, stale semantic findings on regeneration, unsaved-result handling and cross-version database-upgrade interference. Fixes and their final tests must be tied to the integrated source before release acceptance.

## Verification record

Early independent actual-Chromium synthetic-board flow observed one source analysis, six image edits and one output review. The two prepared reference PNGs in each image edit contained zero pixels of the fixture's known external-annotation color; the original hash stayed unchanged. Detail used original ROI `(320,680,360,360)`, not the center specification panel. This proves fixture handling, not general model recognition accuracy. The manager personally inspected early desktop gallery and mobile preview screenshots. Preview Fit clipping, an unstyled Fit action and an untranslated finding were identified before final acceptance. Exact 390×844 inspection also showed the first result image beginning around y794; the manager required a more compact completed-results header and usage/source summary before mobile acceptance.

Independent malformed-review probe: confidence `2` was rejected by the actual SDK runtime validator; auxiliary ledger and journal remained UNKNOWN, repeating the attempt returned 409 and only one synthetic fetch occurred. Cross-version migration was independently exercised with fake IndexedDB: active old upload denied upgrade without changing either v2 database; its result still saved, then v3 upgrade preserved bytes after lease release; regular v3 reads did not recursively acquire the upload lease.

Independent regeneration probes passed: a successful single edit made one synthetic provider request and zero auxiliary calls, replaced the current result without stale semantic/error/reviewed fields, and retained the old bytes/findings in history. Injecting a final IndexedDB quota failure after provider success retained the new downloadable image in memory with `unsavedOutputs` and `LOCAL_SAVE_FAILED`, while leaving the previous disk result unchanged. Replacing a cached Detail with another valid PNG while retaining its old hash was rejected before decode, fetch, emission or version mutation.

Independent ZIP probe confirmed the default archive contains checked output images plus whitelisted metadata, without original/reference/candidate/Detail-cache/history image bytes or base64 reference fields; hash/ROI lineage remains available. This is a synthetic export test, not a full penetration test.

Independent browser scenario checks exercised ambiguous subject choice (zero edits before selection), selected-subject crop bytes, missing Detail with six downloadable outputs, annotation-sliver rejection, STRICT text-only generation and disconnected-foreground refusal before any paid call. Review-unavailable retained completed outputs and NOT_ASSESSED data, but initially lacked a clear gallery status; UNKNOWN regeneration initially exposed its hold only behind the dialog. Both visible-feedback issues require correction and retest before acceptance.

After the first UI fixes, independent Chromium measured the first result image at y452.53 on 390×844 (previously about y794), y316 on desktop and y457 on tablet. The manager personally inspected the refreshed 390 light gallery, 768 dark gallery and 1440 light preview; Fit now shows the entire image and the compact result header retains usage and upload controls. These observations concern the synthetic UI fixture.

Fresh browser functional retests passed the corrected UNKNOWN dialog notice and disabled paid-regeneration action. Original/full-board versus prepared-reference comparison, focus return, zoom/Fit, one-call regeneration with old-version download, frozen user-copy metadata and zero-provider-call display preview were exercised again. An altered valid PNG retaining an old output hash was rejected by both local derivative paths.

Actual-browser locale checks passed English and Chinese gallery/preview at desktop, tablet, phone and 320-pixel widths in both themes, plus the other four locales at narrow widths in both themes and unavailable-Detail reasons for all six. Language/theme changes and preview did not trigger API requests. The manager personally inspected the Chinese mobile light gallery and desktop dark preview. This does not claim native-speaker linguistic certification or physical-device acceptance.

Independent scoped security review concluded PASS after the aggregate review-status recomputation was fixed and retested; no unresolved reported P0/P1 or remaining metadata finding was recorded. This verdict covers synthetic request, storage, privacy and byte-provenance boundaries, not real-provider or whole-product certification.

Documentation validation currently passes all eight checks and six validator regression tests. The complete application Node suite passed **335/335**, with zero failures, cancellations or skipped tests (228,905.7 ms). That run preceded the final two test additions; the final 22-test targeted run covers those additions and affected cases, so the 335 tally is not presented as a complete later 337-test run. Updated reference-board and monthly-upload browser files each passed independently. The initial manager baseline run was stopped during outdated-fixture migration and is not counted as a pass. The Pages browser journey passed 1/1, the bundled U2NETP smoke passed 1/1 with process exit 0 (about 100 seconds), gateway browser checks passed 4/4 and two-build lazy-route checks passed 3/3. Additional final focused regressions passed 22/22. The strengthened Reference file and the separately rerun protected-region race file finished with exit 0. Final normal browser total: 12 passing tests across six files (Pages 1, Reference 1, monthly 1, gateway 4, protected race 2, two-build 3), plus the model smoke above. UI SSOT, TypeScript and diff-whitespace checks passed. Earlier cancelled or failed fixture/debug runs are not counted. The implementation was fast-forward integrated into main as `4e9eea0`. The manager independently built the integrated repository with `npm run build -- --mode pages --base "/PWA-AI-Product-Image-Studio-BYOK/"`; it exited 0, including UI/token and TypeScript checks. Vite reports the non-blocking large SDK chunk warning (about 606 kB minified). No photographic-quality verdict is claimed.

## Independent final UI acceptance

Seven final Chrome/CDP drivers exited 0, covering nine functional groups, six source/failure cases, thirteen locale/interpolation groups, six accounting/privacy/history groups, two tampered-derivative cases, free local Detail regeneration and local duplicate warnings. The final bundle was checked against its recorded hash; 54 final locale/size/theme screenshots were reviewed. No blocking UI issue remained in this bounded review.

The independent subjective UI rubric was 90/100 (hierarchy 18/20, spacing 18/20, typography 13/15, color 14/15, consistency 14/15, responsive 13/15). This is a UI judgment, not an image-quality score or human usability study. Final first-image positions were English phone y515.53, Chinese phone y491.53, desktop y355.03 and tablet y496.02. Very narrow Japanese summaries wrap more densely but remain operable without horizontal overflow.

## Remaining acceptance and rollback

Model recognition can miss annotations or confuse views even when schema and geometry are valid. Machine confidence is not calibrated identity proof. Conservative local estimates can differ from invoices. Synthetic review and downloadable output counts are not commercial-photography acceptance.

Rights-cleared real-product benchmarks, actual provider entitlement/behavior, physical installed iOS/Android and assistive-technology acceptance remain open. Preserve originals, saved outputs, frozen reference lineage, monthly reservations and UNKNOWN attempts. Do not downgrade databases or clear histories; use a compatible forward fix or disable generation while retaining downloads.

## Delivery evidence and source identity

Implementation commit: [`4e9eea0`](https://github.com/yapweijun1996/PWA-AI-Product-Image-Studio-BYOK/commit/4e9eea0). Documentation synchronization is a separate commit. The authorized main push triggers the [Pages workflow](https://github.com/yapweijun1996/PWA-AI-Product-Image-Studio-BYOK/actions/workflows/pages.yml), which runs the complete Node suite, the three affected browser files separately, bundled-model smoke, build and deployment. Assess the run matching the requested main revision; a later successful run does not retroactively prove an earlier one passed.

The manager verifies the deployed version/revision and a fresh-profile smoke at the [live PWA](https://yapweijun1996.github.io/PWA-AI-Product-Image-Studio-BYOK/) and reports the exact run in the delivery message. Build/test/deployment evidence remains separate from unperformed paid-provider and physical-device acceptance.
