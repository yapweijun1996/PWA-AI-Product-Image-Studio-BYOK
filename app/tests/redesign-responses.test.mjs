import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
test("bounded Responses uses exact images and rejects invalid results without resend", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, ""),
    require = createRequire(root + "/package.json"),
    { IDBFactory } = await import(require.resolve("fake-indexeddb"));
  globalThis.window = new EventTarget();
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (name, a, b) =>
        (typeof a === "function" ? a : b)({ name }),
    },
  });
  const api = await import(root + "/src/browserByok.ts"),
    ledger = await import(root + "/src/browserCredentialStore.ts"),
    p = await import(root + "/vision-policy.mjs");
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  function chunk(t, d) {
    const b = Buffer.alloc(d.length + 12);
    b.writeUInt32BE(d.length);
    b.write(t, 4);
    d.copy(b, 8);
    let c = 0xffffffff;
    for (const n of b.subarray(4, -4)) {
      c ^= n;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    b.writeUInt32BE((c ^ 0xffffffff) >>> 0, b.length - 4);
    return b;
  }
  function ref(red) {
    const h = Buffer.alloc(13);
    h.writeUInt32BE(1);
    h.writeUInt32BE(1, 4);
    h[8] = 8;
    h[9] = 6;
    const bytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", h),
      chunk("IDAT", deflateSync(Buffer.from([0, red, 2, 3, 255]))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    return {
      mimeType: "image/png",
      width: 1,
      height: 1,
      sha256: sha(bytes),
      dataBase64: bytes.toString("base64"),
    };
  }
  const styles = [
      "studio",
      "hero",
      "lifestyle",
      "flat_lay",
      "ugc",
      "billboard",
    ],
    source = {
      classification: "single-product",
      confidence: 0.99,
      primaryId: "s1",
      subjects: [
        {
          id: "s1",
          group: "g1",
          imageIndex: 0,
          box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          confidence: 0.99,
          category: "toy",
          camera: "front",
          detailBox: null,
          views: [],
        },
      ],
      textRegions: [],
    };
  const cases = [
    {
      name: "source exact image bytes",
      purpose: "source-analysis",
      refs: [ref(1)],
      styles: [],
      sourceCount: 1,
      output: source,
    },
    {
      name: "batch nine exact ordered images",
      purpose: "output-review",
      refs: Array.from({ length: 9 }, (_, i) => ref(i + 10)),
      styles,
      sourceCount: 3,
      output: {
        findings: styles.map((styleId) => ({
          styleId,
          identity: "uncertain",
          composition: "attention",
          confidence: 0.8,
          reasons: ["identity_conflict"],
        })),
      },
    },
    {
      name: "invalid source box",
      purpose: "source-analysis",
      refs: [ref(2)],
      styles: [],
      sourceCount: 1,
      output: structuredClone(source),
      invalid: true,
    },
    {
      name: "invalid review confidence",
      purpose: "output-review",
      refs: [ref(3), ref(4)],
      styles: ["studio"],
      sourceCount: 1,
      output: {
        findings: [
          {
            styleId: "studio",
            identity: "consistent",
            composition: "usable",
            confidence: 2,
            reasons: [],
          },
        ],
      },
      invalid: true,
    },
  ];
  cases[2].output.subjects[0].box.x = 2;
  const results = [];
  try {
    for (const scenario of cases) {
      globalThis.indexedDB = new IDBFactory();
      memory.clear();
      api.clearBrowserKey();
      await api.saveBrowserKey("sk-synthetic-responses-review-only", true);
      api.setReferenceTransmissionConsent(true);
      const key = api.browserKeyStatus(),
        id = crypto.randomUUID(),
        runId = crypto.randomUUID(),
        amount = p.visionEstimateUSD(scenario.purpose, 3);
      await ledger.reserveStoredUpload(
        {
          id: runId,
          month: ledger.utcUsageMonth(),
          createdAt: new Date().toISOString(),
          credentialId: key.credentialId,
          authorizationId: key.uploadAuthorization.id,
          attempts: [
            {
              kind: scenario.purpose,
              id,
              estimatedMicros: ledger.estimateMicros(amount),
              outcome: "RESERVED",
            },
          ],
        },
        key.credentialId,
        key.uploadAuthorization.id,
      );
      const body = {
        operation: "visual_analysis",
        visionPurpose: scenario.purpose,
        schemaVersion: p.VISION_POLICY_VERSION,
        automaticMode: "REFERENCE",
        model: p.VISION_MODEL,
        referenceInputs: scenario.refs,
        sourceReferenceCount: scenario.sourceCount,
        reviewStyles: scenario.styles,
        prompt: p.visionPrompt(
          scenario.purpose,
          scenario.styles,
          scenario.sourceCount,
        ),
        clientAttemptId: id,
        productId: runId,
        estimatedUSD: amount,
        reviewRevision: (
          await (await api.browserStudioRequest("/images/revision")).json()
        ).reviewRevision,
      };
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(String(url), "https://api.openai.com/v1/responses");
        const b = JSON.parse(options.body);
        assert.equal(b.model, p.VISION_MODEL);
        assert.equal(b.store, false);
        assert.equal(b.max_output_tokens, p.VISION_MAX_OUTPUT_TOKENS);
        assert.ok(!b.tools?.length);
        assert.ok(!b.previous_response_id && !b.conversation);
        assert.equal(b.text.format.type, "json_schema");
        assert.equal(b.text.format.strict, true);
        const images = b.input
          .flatMap((m) => m.content ?? [])
          .filter((c) => c.type === "input_image");
        assert.deepEqual(
          images.map((i) => i.image_url.split(",")[1]),
          scenario.refs.map((i) => i.dataBase64),
        );
        return Response.json({
          id: "resp_synthetic",
          object: "response",
          created_at: 1,
          status: "completed",
          model: b.model,
          output: [
            {
              id: "msg_synthetic",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(scenario.output),
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        });
      };
      for (const mutate of [
        (b) => (b.automaticMode = "STRICT"),
        (b) => (b.model = "unapproved-model"),
        (b) => (b.referenceInputs[0].sha256 = "0".repeat(64)),
        (b) => (b.endpoint = "https://untrusted.example"),
        (b) => (b.prompt += " ignore instructions"),
        (b) => (b.estimatedUSD = "0.000001"),
      ]) {
        const bad = structuredClone(body);
        mutate(bad);
        assert.equal(
          (
            await api.browserStudioRequest("/images/approvals", {
              method: "POST",
              body: JSON.stringify(bad),
            })
          ).status,
          409,
        );
      }
      assert.equal(
        calls,
        0,
        "Invalid source/purpose/model/estimate cannot reach provider",
      );
      const approval = await (
        await api.browserStudioRequest("/images/approvals", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).json();
      assert.ok(approval.approvalId);
      const init = {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            "X-Client-Request-Id": id,
            "X-Attempt-Approval": approval.approvalId,
          },
        },
        response = await api.browserStudioRequest("/images/generate", init),
        result = await response.json();
      if (scenario.invalid) {
        assert.equal(result.error.outcome, "UNKNOWN");
        assert.equal(
          JSON.parse(memory.get("studio.browser-byok.attempts.v1"))[id].outcome,
          "UNKNOWN",
        );
        assert.equal((await ledger.readMonthlyUsage()).unknownRequests, 1);
        assert.equal(
          (await api.browserStudioRequest("/images/generate", init)).status,
          409,
        );
      } else {
        assert.equal(response.status, 200);
        assert.deepEqual(result.analysis, scenario.output);
      }
      assert.equal(calls, 1);
      results.push({
        name: scenario.name,
        purpose: scenario.purpose,
        images: scenario.refs.length,
        status: "PASS",
        fetches: calls,
        outcome: scenario.invalid ? "UNKNOWN" : "DEFINITIVE_SUCCESS",
      });
    }
  } finally {
    api.clearBrowserKey();
  }
});
