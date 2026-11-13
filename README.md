# Product Image Studio

Create product images from a photo in a local-first progressive web app. Bring your own OpenAI API key, upload a product, and download the available looks as they finish.

[Open the app](https://yapweijun1996.github.io/PWA-AI-Product-Image-Studio-BYOK/) · [使用说明（中文）](START_HERE_中文.md) · [Documentation](docs/INDEX.md) · [Tasks and evidence](docs/08-delivery/TASK.md)

The automatic workspace is designed for a short flow: set up your key once, upload an image, and inspect or download the results. It offers seven result slots: **Studio, Hero, Lifestyle, Tabletop, Detail, Everyday, and Campaign**. Results are not guaranteed to be available or visually accurate; an unreliable Detail crop is marked unavailable.

## Get started

1. Open the [hosted app](https://yapweijun1996.github.io/PWA-AI-Product-Image-Studio-BYOK/) in a supported browser and go to **Settings**.
2. Save your own OpenAI API key and authorize future uploads. A monthly estimate limit is optional; saving a key does not verify it or initiate a paid request.
3. Under **Create**, choose a mode and upload a PNG, JPEG, or WebP product image up to 20 MiB. Use an image you have rights to use.
4. Preview the results, compare them with the source, and download individual images or the available images as a ZIP. You can explicitly regenerate one look; its previous versions are retained.

The interface supports English, Simplified Chinese, Malay, Japanese, Korean, and Vietnamese, plus light and dark themes. An ambiguous reference image may require you to select the intended product before edits begin.

## Choose how images are made

| | STRICT (default) | Reference-guided |
|---|---|---|
| **How it works** | Selects the product locally and composites its foreground over generated scenes. | Analyzes the source, prepares product reference crops, and generates concepts using those references. |
| **Image sharing** | Source images stay on the device. Scene instructions go to OpenAI. | Normalized source images, selected reference crops, and generated outputs are sent to OpenAI for analysis, edits, and review after separate tab consent. |
| **Product fidelity** | Uses locally selected original pixels, subject to selection and resizing. | Generative edits can change labels, logos, geometry, and other details. |
| **Calls per upload** | Up to six image requests; Detail is a local crop when reliable. | Up to six image requests, one source-analysis request, and one batch-review request; Detail is local when reliable. |

Both modes retain the supplied viewpoint; Tabletop does not promise a true overhead photo. Detail uses visible source pixels and cannot add authentic detail. Campaign is the complete ad artwork; optional user-supplied copy and a billboard display preview are created locally as separate variants.

Machine visual hints and technical checks are **not human approval or a guarantee of brand fidelity**. Compare outputs with your original, especially labels, colors, edges, and product shape. See the [style engine](docs/06-ai/SEVEN_STYLE_ENGINE.md) and [subject-aware workflow evidence](docs/09-research/SUBJECT_AWARE_WORKFLOW_2026-11-12.md).

## Costs, privacy, and recovery

- Image generation and reference analysis/review can incur OpenAI charges. The app shows estimates before upload; monthly totals and optional limits are **local estimates**, not invoices or provider-enforced spending caps. See the [cost model](docs/09-research/COST_MODEL.md).
- Your key and upload authorization are stored in a dedicated IndexedDB database on this device until removed. The active in-memory key expires after one hour; a saved key can be restored. Browser scripts and extensions can access stored credentials, which are not protected by a separate password. Use **Settings → Remove saved key** to delete the stored key and clear it from open tabs.
- Reference transmission consent is separate and lasts for the current tab. Normalized source copies are sent for analysis; selected crops are retained locally for future versions. The primary original remains local and unchanged. Uploaded originals may contain EXIF metadata.
- Requests are not retried automatically. An interrupted request may still have been charged. If its outcome is unknown, check provider billing and waiting periods, then use the recovery control in Settings to authorize new uploads. Existing results remain available.
- Browser storage can be cleared or evicted. Download images and originals you need. An automatic output ZIP is not a project backup; [full Advanced-workspace backups](docs/04-data/EXPORT_IMPORT.md) are unencrypted and can contain sensitive project data.

## Install and update

Use your browser's install option, or **Share → Add to Home Screen** on iPhone. After a successful online visit caches the app, the shell and saved local work can be accessed offline; generating images requires a network connection. Browser and installed copies may have separate storage.

The sidebar shows the app version and provides **Check for updates**. Activate an available update when ready; the app guards active work against an unintended reload. Physical-device and assistive-technology acceptance remain open.

## Run locally

Requirements: **Node.js 22.12 or newer** and npm. From the repository root:

```bash
cd app
npm ci
npm run dev -- --mode pages
```

Open the URL printed by Vite. Pages mode uses browser BYOK and hash routes, like the hosted app. A normal `npm run dev` uses the local gateway-oriented workspace instead.

Build the GitHub Pages version with the repository path as its base:

```bash
npm run build -- --mode pages --base /PWA-AI-Product-Image-Studio-BYOK/
npm run preview
```

The Pages build is static and does not require the development gateway. `.github/workflows/pages.yml` runs tests, builds `app/dist`, and deploys it to GitHub Pages on pushes to `main`; Pages must use **GitHub Actions** as its publishing source. See the [workflow](.github/workflows/pages.yml) for the exact checks.

### Advanced workspace and local gateway

The Advanced workspace supports product projects, confirmed facts, manual masks, separate review/approval, and full-project backup. Its loopback-only development gateway uses a **server-configured** provider key and a separate local app access token. It is not production authentication and must not be exposed publicly. Billable image generation is disabled by default. Setup, security boundaries, and synthetic-provider instructions are in the [gateway contract](docs/05-api/API_CONTRACT.md) and [browser test guide](https://github.com/yapweijun1996/PWA-AI-Product-Image-Studio-BYOK/blob/main/app/tests/browser/README.md).

<details>
<summary>Start the local gateway with a synthetic provider configuration</summary>

From `app/`, build the non-Pages app and generate a local access token with its SHA-256 digest. The token is sensitive; do not share it or save it in the repository. It is separate from an OpenAI API key.

```bash
npm run build
node -e 'const c=require("node:crypto");let t;do{t=c.randomBytes(32).toString("base64url")}while(t.toLowerCase().startsWith("sk-"));console.log("Local app access token:",t);console.log("SHA-256:",c.createHash("sha256").update(t).digest("hex"))'
printf 'SHA-256 digest: '
IFS= read -r STUDIO_ACCESS_TOKEN_SHA256
export STUDIO_ACCESS_TOKEN_SHA256
OPENAI_API_KEY=synthetic-local-only npm run gateway
```

Open `http://127.0.0.1:4173/settings`, sign in using the generated local access token, and connect the synthetic provider session. The gateway does not load `.env` files; `STUDIO_PORT` changes its loopback port. This configuration does not enable billable generation or accept a provider key from the browser. Restarting the gateway invalidates its sessions.

</details>

## Verify changes

From `app/`:

```bash
npm test
npm run check:ui
node --test tests/browser/pages-preview.test.mjs
node --test tests/browser/automatic-reference.test.mjs
node --test tests/browser/monthly-upload.test.mjs
node --test tests/browser/vision-completion.test.mjs
```

Browser tests require Chrome or Chromium; set `CHROME_BIN` if it is not found automatically. Run browser files separately. They use synthetic images and provider responses, not real API calls. Additional gateway, update-lifecycle, and bundled-cutout tests are documented in the [browser test guide](https://github.com/yapweijun1996/PWA-AI-Product-Image-Studio-BYOK/blob/main/app/tests/browser/README.md).

For the documentation package, install the optional validation dependencies and run:

```bash
python3 -m pip install -r scripts/requirements-doc-validation.txt
python3 scripts/validate_ssot.py
python3 scripts/test_validate_ssot.py -v
```

The documentation validator checks links, checksums, schemas, and other static contracts; it does not test the app or establish photographic quality. See [validation instructions](scripts/README.md).

## Repository guide

| Path | Purpose |
|---|---|
| [`app/`](app/) | React/TypeScript PWA, browser BYOK, local storage, and development gateway |
| [`docs/01-product/PRD.md`](docs/01-product/PRD.md) | Product requirements |
| [`docs/00-governance/DECISION_REGISTER.md`](docs/00-governance/DECISION_REGISTER.md) | Accepted and proposed decisions |
| [`docs/08-delivery/TASK.md`](docs/08-delivery/TASK.md) | Task status and verification evidence |
| [`docs/03-security/`](docs/03-security/) | Security and privacy boundaries |
| [`contracts/`](contracts/) and [`fixtures/`](fixtures/) | Machine-readable contracts and synthetic fixtures |
| [`scripts/`](scripts/) | Documentation validation tools |

The source code and current task evidence establish implemented behavior; design proposals and historical documentation are not proof of a production release. Real-provider recognition and photographic fidelity, physical installed-device behavior, and full accessibility acceptance remain separate verification gates. See the [evidence status](docs/00-governance/EVIDENCE_STATUS.md).
