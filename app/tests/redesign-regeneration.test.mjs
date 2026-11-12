import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ZipReader,
  BlobReader,
  TextWriter,
  configure,
} from "@zip.js/zip.js/lib/zip-core-native.js";
configure({ useWebWorkers: false });
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, ""),
  require = createRequire(root + "/package.json");
test("single image regeneration clears semantic hints, preserves history and exposes unsaved successful bytes", async () => {
  const { IDBFactory, IDBObjectStore } = await import(
    require.resolve("fake-indexeddb")
  );
  const { createServer } = await import(require.resolve("vite"));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  function chunk(type, data) {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    out.write(type, 4);
    data.copy(out, 8);
    let crc = 0xffffffff;
    for (const byte of out.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
    return out;
  }
  function png(red) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1024);
    header.writeUInt32BE(1024, 4);
    header[8] = 8;
    header[9] = 6;
    const pixels = Buffer.alloc((1024 * 4 + 1) * 1024);
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 1024; x++) {
        const at = y * (1024 * 4 + 1) + 1 + x * 4;
        pixels[at] = red;
        pixels[at + 3] = 255;
      }
    const compressed = deflateSync(pixels);
    assert.deepEqual(inflateSync(compressed), pixels);
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", compressed),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
  const oldPng = png(40),
    newPng = png(200),
    oldHash = hash(oldPng),
    newHash = hash(newPng),
    memory = new Map();
  globalThis.window = new EventTarget();
  globalThis.localStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (name, arg, fn) =>
        (typeof arg === "function" ? arg : fn)({ name }),
    },
  });
  const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "custom",
  });
  const report = { syntheticOnly: true, scenarios: [], testedFiles: {} };
  try {
    const store = await server.ssrLoadModule("/src/automaticStore.ts"),
      keys = await server.ssrLoadModule("/src/browserByok.ts"),
      pipeline = await server.ssrLoadModule("/src/automaticPipeline.ts");
    globalThis.document = {
      createElement: (type) => {
        assert.equal(type, "canvas");
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {},
            getImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4) }),
          }),
        };
      },
    };
    globalThis.createImageBitmap = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer()),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return {
        width: view.getUint32(16),
        height: view.getUint32(20),
        close() {},
      };
    };
    for (const failFinalSave of [false, true]) {
      globalThis.indexedDB = new IDBFactory();
      memory.clear();
      keys.clearBrowserKey();
      await keys.saveBrowserKey("sk-synthetic-regen-review-only", true);
      keys.setReferenceTransmissionConsent(true);
      const runId = crypto.randomUUID(),
        oldId = crypto.randomUUID(),
        source = new Blob([oldPng], { type: "image/png" }),
        oldReview = {
          styleId: "studio",
          identity: "consistent",
          composition: "usable",
          confidence: 0.99,
          reasons: [],
          attemptId: crypto.randomUUID(),
          outputSha256: oldHash,
          reviewedAt: new Date().toISOString(),
        };
      const run = {
        version: 1,
        pipelineVersion: "2.0.0",
        id: runId,
        mode: "REFERENCE",
        filename: "synthetic-source.png",
        source,
        sourceSha256: oldHash,
        createdAt: new Date().toISOString(),
        state: "COMPLETE",
        estimatedUSD: "0.000000",
        sessionId: "",
        qualityStatus: "MACHINE_HINTS_AVAILABLE",
        compositionContext: { category: "unknown", camera: "unknown" },
        auxiliary: [],
        preparedReferences: [
          {
            blob: source,
            sha256: oldHash,
            width: 1024,
            height: 1024,
            sourceSha256: oldHash,
            normalizedSha256: oldHash,
            roi: {
              imageIndex: 0,
              x: 0,
              y: 0,
              width: 1024,
              height: 1024,
              originalWidth: 1024,
              originalHeight: 1024,
            },
          },
        ],
        items: [
          {
            id: oldId,
            style: "studio",
            prompt: "Historical synthetic prompt",
            estimatedUSD: "0.100000",
            status: "READY",
            output: source,
            sha256: oldHash,
            error: "OLD_NOTE",
            reviewedAt: "2026-01-01T00:00:00Z",
            semantic: oldReview,
            qa: {
              status: "AUTOMATIC_CHECKS_PASSED",
              sourceSha256: oldHash,
              outputSha256: oldHash,
              checkedAt: new Date().toISOString(),
              humanReview: false,
            },
            provenance: {
              policyVersion: "2.0.0",
              mode: "REFERENCE",
              operation: "reference-edit",
              visualAssessment: "NOT_ASSESSED",
              layout: {
                maxWidth: 0.6,
                maxHeight: 0.6,
                centerX: 0.5,
                bottom: 0.8,
                surface: "test",
                light: "test",
              },
            },
          },
        ],
      };
      await store.saveAutoRun(run);
      let calls = 0,
        failedWrites = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(String(url), "https://api.openai.com/v1/images/edits");
        assert.ok(options.body instanceof FormData);
        assert.equal(options.body.get("n"), "1");
        return Response.json({
          data: [{ b64_json: newPng.toString("base64") }],
        });
      };
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (
          failFinalSave &&
          this.name === "runs" &&
          value?.id === runId &&
          value.items?.[0]?.status === "READY" &&
          value.items[0].id !== oldId
        ) {
          failedWrites++;
          throw new DOMException(
            "synthetic final save quota",
            "QuotaExceededError",
          );
        }
        return originalPut.call(this, value, ...args);
      };
      const emitted = [];
      try {
        await pipeline.regenerateAutomatic(
          runId,
          "studio",
          new AbortController().signal,
          (value) => emitted.push(value),
        );
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      assert.equal(calls, 1);
      const current = emitted.at(-1),
        item = current.items[0];
      assert.equal(current.qualityStatus, "NOT_ASSESSED");
      assert.notEqual(item.id, oldId);
      assert.equal(item.status, "READY");
      assert.equal(item.sha256, newHash);
      assert.equal(item.semantic, undefined);
      assert.equal(current.qualityStatus, "NOT_ASSESSED");
      assert.equal(item.error, undefined);
      assert.equal(item.reviewedAt, undefined);
      const previous = item.versions.find((v) => v.id === oldId);
      assert.equal(previous.sha256, oldHash);
      assert.equal(previous.semantic.outputSha256, oldHash);
      assert.equal(
        hash(
          new Uint8Array(await (await store.checkedOutput(item)).arrayBuffer()),
        ),
        newHash,
      );
      assert.equal(
        hash(
          new Uint8Array(
            await (await store.checkedOutput(previous)).arrayBuffer(),
          ),
        ),
        oldHash,
      );
      assert.equal(
        hash(new Uint8Array(await current.source.arrayBuffer())),
        oldHash,
      );
      assert.equal(store.runHasUnreviewedCharge({...current,auxiliary:[{id:crypto.randomUUID(),kind:'output-review',status:'UNKNOWN'}]}),true);
      assert.equal(store.runHasUnreviewedCharge({...current,items:[{...item,versions:[{id:crypto.randomUUID(),status:'UNKNOWN'}]}]}),true);
      const {resultLabel}=await server.ssrLoadModule('/src/automaticPresentation.ts');
      assert.match(resultLabel({...item,style:'billboard',provenance:undefined}),/legacy/i);
      assert.equal(resultLabel({...item,style:'billboard'}),'Campaign');
      const disk = (await store.listAutoRuns()).find((r) => r.id === runId);
      if (failFinalSave) {
        assert.equal(failedWrites, 1);
        assert.equal(current.unsavedOutputs, true);
        assert.equal(current.message, "LOCAL_SAVE_FAILED");
        assert.equal(disk.items[0].id, oldId);
        assert.equal(disk.items[0].sha256, oldHash);
        assert.equal(
          hash(new Uint8Array(await disk.items[0].output.arrayBuffer())),
          oldHash,
        );
      } else {
        assert.equal(disk.items[0].id, item.id);
        assert.equal(disk.items[0].semantic, undefined);
        assert.ok(disk.items[0].versions.some((v) => v.id === oldId));
        assert.equal(current.unsavedOutputs, undefined);
      }
      if (!failFinalSave) {
        const { automaticArchive } = await server.ssrLoadModule(
          "/src/automaticExport.ts",
        );
        const withPrivateRefs = {
          ...current,
          preparedReferences: current.preparedReferences.map((r) => ({
            ...r,
            dataBase64: "PRIVATE_REFERENCE_BYTES",
            rawOriginal: "PRIVATE_EXIF_VIEW",
          })),
        };
        const archive = await automaticArchive(withPrivateRefs),
          reader = new ZipReader(new BlobReader(archive));
        try {
          const entries = await reader.getEntries();
          assert.equal(
            entries.filter((e) => e.filename.endsWith(".png")).length,
            1,
          );
          const text = await entries
              .find((e) => e.filename === "image-information.json")
              .getData(new TextWriter()),
            info = JSON.parse(text);
          assert.ok(
            !text.includes("PRIVATE_REFERENCE_BYTES") &&
              !text.includes("PRIVATE_EXIF_VIEW") &&
              !text.includes("dataBase64"),
          );
          assert.equal(info.referenceImages[0].sha256, oldHash);
          assert.equal(info.qualityStatus, "NOT_ASSESSED");
          assert.equal(info.images[0].semantic, undefined);
          assert.equal(info.images[0].versions[0].sha256, oldHash);
        } finally {
          await reader.close();
        }
        keys.setReferenceTransmissionConsent(false);
        const macro = {
          ...disk.items[0],
          id: crypto.randomUUID(),
          style: "macro",
          versions: undefined,
          semantic: undefined,
        };
        disk.items.push(macro);
        disk.detail = {
          blob: new Blob([newPng], { type: "image/png" }),
          sha256: oldHash,
          sourceSha256: oldHash,
          roi: { x: 10, y: 10, width: 100, height: 100 },
        };
        await store.saveAutoRun(disk);
        const events = [];
        await assert.rejects(
          () =>
            pipeline.regenerateAutomatic(
              runId,
              "macro",
              new AbortController().signal,
              (r) => events.push(r),
            ),
          /DETAIL_INTEGRITY_FAILED/,
        );
        assert.equal(events.length, 0);
        assert.equal(calls, 1);
        assert.equal(
          (await store.listAutoRuns())
            .find((r) => r.id === runId)
            .items.find((i) => i.style === "macro").versions,
          undefined,
        );
        disk.detail.blob = source;
        await store.saveAutoRun(disk);
        await pipeline.regenerateAutomatic(
          runId,
          "macro",
          new AbortController().signal,
          (r) => events.push(r),
        );
        assert.equal(
          calls,
          1,
          "Local Detail recreation does not transmit images or require new tab consent",
        );
        const local = events.at(-1).items.find((i) => i.style === "macro");
        assert.equal(local.status, "READY");
        assert.notEqual(local.id, macro.id);
        assert.equal(local.estimatedUSD, "0.000000");
      }
      report.scenarios.push({
        name: failFinalSave
          ? "post-provider final save quota preserves memory download and old disk"
          : "successful regeneration drops old semantic and preserves history",
        status: "PASS",
        providerCalls: calls,
        newOutputHash: newHash,
        oldOutputHash: oldHash,
        failedWrites,
      });
      keys.clearBrowserKey();
    }
  } finally {
    await server.close();
  }
});
