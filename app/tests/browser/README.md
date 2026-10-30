# Browser regression tests

From `app/`, install the existing dependencies and run `npm run test:browser` using Node 22.12 or newer. The test requires a local Chrome or Chromium executable; set `CHROME_BIN` to its absolute path if it is not found automatically.

The test starts a local Vite server and a headless browser with a temporary, isolated profile. It uses synthetic images and does not call a provider. It creates a product and uploads a generated file through the UI, creates a synthetic scene through application modules, then exercises composition, review, explicit approval and export in the UI and inspects the downloaded ZIP. The file chooser receives a synthetic File programmatically. It fails if the browser is unavailable. Run `npm test` separately for the application test suite. Emulated touch does not replace physical-device or assistive-technology testing.

The same test generates a synthetic scene through the UI, composes and approves that same scene, and verifies its downloaded ZIP. It starts a temporary local gateway with a synthetic access token, fake provider credential, isolated journal and in-process provider response. A Vite test proxy rewrites the upstream origin to the gateway origin; this exercises the UI and gateway together, but does not validate production origin handling or contact an external provider. No real credentials are used.

A second test builds the app into a temporary directory and serves it directly from the local gateway, with no proxy or Origin rewriting. It exercises the synthetic creation-to-export journey and a cross-origin login rejection. Both tests use independent temporary browser profiles and journals.

The direct-gateway test also checks synthetic credential markers against the final DOM, local/session storage, populated IndexedDB and caches, downloaded ZIP entries, and captured console/exception events. This is a scoped plaintext-marker check, not a complete secret or security audit.

The direct-gateway journey also injects a synthetic transport failure, checks that UNKNOWN persists without a resend, and verifies separately acknowledged and authorized retry lineage after reload. Billing review is simulated.

The direct-gateway test also checks first use of the cached product route while offline and simulates a blocked backup route to verify the explicit error and reload flow. A separate synthetic two-build test checks that an old tab retains a draft and can load its cached lazy page after another tab activates an update. These checks do not replace installed-device or suspended-tab testing.
