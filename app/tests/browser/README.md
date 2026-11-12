# Browser regression tests

From `app/`, install the existing dependencies and run `npm run test:browser` using Node 22.12 or newer. The test requires a local Chrome or Chromium executable; set `CHROME_BIN` to its absolute path if it is not found automatically.

The test starts a local Vite server and a headless browser with a temporary, isolated profile. It uses synthetic images and does not call a provider. It creates a product and uploads a generated file through the UI, creates a synthetic scene through application modules, then exercises composition, review, explicit approval and export in the UI and inspects the downloaded ZIP. The file chooser receives a synthetic File programmatically. It fails if the browser is unavailable. Run `npm test` separately for the application test suite. Emulated touch does not replace physical-device or assistive-technology testing.

The same test generates a synthetic scene through the UI, composes and approves that same scene, and verifies its downloaded ZIP. It starts a temporary local gateway with a synthetic access token, fake provider credential, isolated journal and in-process provider response. A Vite test proxy rewrites the upstream origin to the gateway origin; this exercises the UI and gateway together, but does not validate production origin handling or contact an external provider. No real credentials are used.

A second test builds the app into a temporary directory and serves it directly from the local gateway, with no proxy or Origin rewriting. It exercises the synthetic creation-to-export journey and a cross-origin login rejection. Both tests use independent temporary browser profiles and journals.

The direct-gateway test also checks synthetic credential markers against the final DOM, local/session storage, populated IndexedDB and caches, downloaded ZIP entries, and captured console/exception events. This is a scoped plaintext-marker check, not a complete secret or security audit.

The direct-gateway journey also injects a synthetic transport failure, checks that UNKNOWN persists without a resend, and verifies separately acknowledged and authorized retry lineage after reload. Billing review is simulated.

The direct-gateway test also checks first use of the cached product route while offline and simulates a blocked backup route to verify the explicit error and reload flow. A separate synthetic two-build test checks that an old tab retains a draft and can load its cached lazy page after another tab activates an update. These checks do not replace installed-device or suspended-tab testing.

The offline journey also reloads a synthetic product with its original and edited protected mask while offline, checking source and mask hashes, active mask identity, selected alpha samples and one small region after reopening the editor. It does not establish realistic product fidelity or device storage behavior.

The two-build journey also emulates reduced motion and captures the actual update indicator before reload, checking that the status remains visible while its CSS animation is disabled. This is not a complete reduced-motion or assistive-technology audit.

A single-tab two-build cache-limit test fills the shell-cache slots with synthetic fixtures, checks the draft and confirmation guards, and verifies that confirmed cleanup preserves the active shell and unrelated cached data before a separate user-triggered update. It uses simulated confirmation responses and does not reproduce natural quota exhaustion or replace multi-tab/device acceptance.

A two-tab variant checks that an open tab and its synthetic draft prevent cleanup. After that disposable tab closes, the test permits either completed cleanup or a reported partial stop if an update begins concurrently; activation remains a separate user action. Suspended-tab and physical-device acceptance remain open.

The direct-gateway journey also exercises a seven-style queue, requiring individual synthetic consent and verifying separate attempt, job and scene records. The fake provider returns the same synthetic image for every style.

Before the first synthetic generation, the journey also interrupts the network after consent, verifies consent is cleared and no provider call is made, then explicitly rechecks the gateway and gives fresh consent. This covers one pre-dispatch interruption, not in-flight billing or every cross-tab/session case.

The automatic Pages reference test uses the actual pinned AI SDK with fake fetch. A synthetic annotated board exercises separate tab consent, one structured source analysis, safe subject/view crops, six edits, one batch review, unchanged original bytes and authentic Detail coordinates. A second ambiguous board pauses before any edit until the local subject choice. It also covers preview comparison, Escape/focus restoration, frozen local copy export, explicit one-image regeneration without another analysis, immutable old versions, UNKNOWN holds/no resend, reload consent reset and rejection of valid replacement PNGs with stale hashes by both local derivatives. These assertions verify deterministic wiring, not real model recognition or photographic quality.

Pages, reference and monthly-usage CI files run in separate Node processes with finite DevTools deadlines and cleanup. For the complete local browser gate, invoke each file separately and require every command to exit successfully:

```sh
node --test tests/browser/pages-preview.test.mjs
node --test tests/browser/automatic-reference.test.mjs
node --test tests/browser/monthly-upload.test.mjs
node --test tests/browser/direct-gateway-journey.test.mjs
node --test tests/browser/protected-region-race.test.mjs
node --test tests/browser/two-build-lazy-route.test.mjs
STUDIO_MATTE_SMOKE=1 node --test tests/browser/pages-preview.test.mjs
```

The last command runs the bundled local cutout model with synthetic input. It is separate from all fake-provider checks and does not call an image or vision model. Physical devices, suspended tabs, assistive technology and real paid photographic acceptance remain separate gates.
