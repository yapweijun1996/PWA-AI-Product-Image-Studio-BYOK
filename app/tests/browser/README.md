# Browser regression tests

From `app/`, install the existing dependencies and run `npm run test:browser` using Node 22.12 or newer. The test requires a local Chrome or Chromium executable; set `CHROME_BIN` to its absolute path if it is not found automatically.

The test starts a local Vite server and a headless browser with a temporary, isolated profile. It uses synthetic images and does not call a provider. It creates a product and uploads a generated file through the UI, creates a synthetic scene through application modules, then exercises composition, review, explicit approval and export in the UI and inspects the downloaded ZIP. The file chooser receives a synthetic File programmatically. It fails if the browser is unavailable. Run `npm test` separately for the application test suite. Emulated touch does not replace physical-device or assistive-technology testing.
