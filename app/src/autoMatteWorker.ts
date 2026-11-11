import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import mjsUrl from "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
const HASH = "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8";
let session: Promise<ort.InferenceSession> | undefined;
async function load() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
  const response = await fetch(
    `${import.meta.env.BASE_URL}models/u2netp.onnx`,
    { credentials: "omit" },
  );
  if (!response.ok) throw new Error("Image tools could not be loaded.");
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (bytes.byteLength !== 4574861 || hash !== HASH)
    throw new Error("Image tools failed integrity verification.");
  return ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}
self.onmessage = async (event: MessageEvent<{ pixels: Float32Array }>) => {
  try {
    self.postMessage({ progress: "Selecting your product…" });
    const model = await (session ??= load());
    const result = await model.run({
      [model.inputNames[0]]: new ort.Tensor(
        "float32",
        event.data.pixels,
        [1, 3, 320, 320],
      ),
    });
    const output = result[model.outputNames[0]];
    if (output.type !== "float32" || output.data.length !== 320 * 320)
      throw new Error("Unexpected selection output.");
    const values = output.data as Float32Array;
    let min = Infinity,
      max = -Infinity;
    for (const n of values) {
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 0.001)
      throw new Error("No clear foreground.");
    const alpha = Float32Array.from(values, (n) => (n - min) / (max - min));
    self.postMessage({ alpha }, { transfer: [alpha.buffer] });
    for (const tensor of Object.values(result)) tensor.dispose();
  } catch (error) {
    self.postMessage({
      error:
        "Automatic product selection failed on this device. No image generation was sent.",
      diagnostic:
        error instanceof Error ? error.message : "Matting engine error",
    });
  }
};
