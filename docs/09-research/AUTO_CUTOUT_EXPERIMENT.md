# Automatic cutout browser experiment — 2026-11-11

## Goal and fixed acceptance

Complete automatic selection before sending paid image requests; preserve original product RGB for local composition. A synthetic opaque red product on white must reach seven complete, downloadable outputs with no manual mask or approval. Provider calls are mocked. Transparent-alpha and opaque-model paths must both run in the production Pages build, and an interrupted second request must retain one finished result without sending later styles.

## Observations

- The initial BiRefNet-lite model was pinned to Hugging Face revision `de15b22ba131738a16dff04aab8bdf8dc32e3ac1` and hash verified. A first harness attempt hit its 15-second wait, and a corrected harness revealed `failed to call OrtRun(): std::bad_alloc`. An omitted `.mjs` MIME mapping in the static test server was also corrected uniformly. No failed attempt was treated as passed. This model is not included in the shipped implementation.
- The selected U2NETP file comes from the documented rembg release. Its upstream MD5 `8e83ca70e441ab06c318d82300c84806` and SHA-256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` were independently recomputed. The file is 4,574,861 bytes. The original project licenses code and weights under Apache-2.0; license text/attribution are shipped in `app/public/licenses/u2netp.txt`.
- The opaque-model Chromium journey passed in about 8 seconds locally. It uses the actual bundled ONNX model and WASM runtime; only the OpenAI response is mocked. It verifies product pixels in a completed image, seven results, a seven-PNG ZIP with machine-check provenance, partial UNKNOWN retention and no resend, credential absence in both databases/caches, reload clearing and offline shell loading.
- The final browser regression also covers explicit UNKNOWN recovery, a provider 429 without a readable delay, separately authorized recovery, local journal quota failure before sending (zero provider calls), and IndexedDB quota after a finished image with unload/navigation/history-switch guards.
- A separate transparent-alpha journey passes without invoking the model. Both modes are in the Pages workflow. Mobile-width checks found no horizontal overflow at 390 px; this is emulation, not physical-device acceptance.

## Primary references

- [U-2-Net authors and license](https://github.com/xuebinqin/U-2-Net)
- [rembg U2NETP preprocessing and download checksum](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py)
- [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)

## Limits

The synthetic product is not a representative SKU benchmark. Segmentation may omit a label, transparent detail or part of a real product; resize can reduce readability. Technical checks and hash binding cannot establish complete brand fidelity. Installed iOS, screen-reader, real SKU and real-provider acceptance remain unverified. No live key, billed call or seller image was used. Preserve these limits instead of labelling automatic results human-approved.
