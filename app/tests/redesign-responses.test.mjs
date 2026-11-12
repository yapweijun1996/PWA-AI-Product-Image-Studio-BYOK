import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
test("Responses distinguishes completed unusable results from genuine UNKNOWN without resend or refunds", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, ""),
    require = createRequire(root + "/package.json"),
    { IDBFactory, IDBObjectStore } = await import(
      require.resolve("fake-indexeddb")
    );
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
  const pixel = {
    classification: "single-product",
    confidence: 0.99,
    primaryId: "shoe_0",
    subjects: [
      {
        id: "shoe_0",
        group: "g0",
        imageIndex: 0,
        box: { x: 27, y: 44, width: 968, height: 597 },
        detailBox: { x: 416, y: 242, width: 86, height: 86 },
        category: "footwear",
        camera: "three-quarter",
        confidence: 0.99,
        views: [],
      },
    ],
    textRegions: [],
  };
  cases.push({
    ...cases[2],
    name: "owner reported completed pixel boxes and shoe_0 IDs",
    output: pixel,
  });
  const crossField = structuredClone(source);
  crossField.subjects[0].box = { x: 0.8, y: 0.1, width: 0.4, height: 0.8 };
  crossField.subjects[0].detailBox = null;
  cases.push({
    ...cases[2],
    name: "schema-valid fields but invalid containment",
    output: crossField,
  });
  for (const transport of [
    "incomplete-valid",
    "incomplete-invalid",
    "malformed-json",
    "malformed-envelope",
    "network",
    "interrupted",
    "missing-error",
    "failed-status",
    "journal-failure",
    "ledger-failure",
  ])
    cases.push({
      ...cases[2],
      name: transport,
      transport,
      output: transport === "incomplete-valid" ? source : pixel,
      unknown: true,
    });
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
        if (scenario.purpose === "source-analysis") {
          const props = b.text.format.schema.properties,
            subject = props.subjects.items.properties;
          assert.deepEqual(subject.id.enum, [
            "s1",
            "s2",
            "s3",
            "s4",
            "s5",
            "s6",
          ]);
          assert.deepEqual(subject.group.enum, [
            "g1",
            "g2",
            "g3",
            "g4",
            "g5",
            "g6",
          ]);
          assert.equal(subject.imageIndex.maximum, scenario.sourceCount - 1);
          assert.equal(subject.box.properties.x.minimum, 0);
          assert.equal(subject.box.properties.x.maximum, 1);
          assert.equal(subject.box.properties.width.minimum, 0.01);
          assert.equal(props.subjects.maxItems, 6);
          assert.equal(props.textRegions.maxItems, 24);
          assert.equal(subject.views.maxItems, 2);
        } else {
          assert.deepEqual(
            b.text.format.schema.properties.findings.items.properties.styleId
              .enum,
            scenario.styles,
          );
          assert.equal(
            b.text.format.schema.properties.findings.maxItems,
            scenario.styles.length,
          );
        }

        const images = b.input
          .flatMap((m) => m.content ?? [])
          .filter((c) => c.type === "input_image");
        assert.deepEqual(
          images.map((i) => i.image_url.split(",")[1]),
          scenario.refs.map((i) => i.dataBase64),
        );
        if (scenario.transport === "network")
          throw Error("Synthetic connection loss");
        if (scenario.transport === "interrupted")
          return new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{"status":"completed",'));
                c.error(Error("Synthetic interruption"));
              },
            }),
          );
        if (scenario.transport === "malformed-envelope")
          return Response.json({ status: "completed", error: null });
        return Response.json({
          id: "resp_synthetic",
          object: "response",
          created_at: 1,
          status: scenario.transport?.startsWith("incomplete")
            ? "incomplete"
            : scenario.transport === "failed-status"
              ? "failed"
              : "completed",
          ...(scenario.transport === "missing-error" ? {} : { error: null }),
          incomplete_details: null,
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
                  text:
                    scenario.transport === "malformed-json"
                      ? "{broken"
                      : JSON.stringify(scenario.output),
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
      const originalPut = IDBObjectStore.prototype.put,
        originalSet = localStorage.setItem;
      if (scenario.transport === "journal-failure")
        localStorage.setItem = (name, value) => {
          if (
            name === "studio.browser-byok.attempts.v1" &&
            JSON.parse(value)[id]?.outcome === "DEFINITIVE_SUCCESS"
          )
            throw new DOMException(
              "Synthetic journal quota",
              "QuotaExceededError",
            );
          originalSet(name, value);
        };
      if (scenario.transport === "ledger-failure")
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (
            this.name === "usage" &&
            value.attempts?.some(
              (a) => a.id === id && a.outcome === "DEFINITIVE_SUCCESS",
            )
          )
            throw new DOMException(
              "Synthetic ledger quota",
              "QuotaExceededError",
            );
          return originalPut.call(this, value, ...args);
        };
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
      localStorage.setItem = originalSet;
      IDBObjectStore.prototype.put = originalPut;
      const unusable = scenario.invalid && !scenario.unknown;
      if (scenario.invalid) {
        const outcome = unusable ? "DEFINITIVE_SUCCESS" : "UNKNOWN";
        assert.equal(result.error.outcome, outcome, scenario.name);
        if (unusable) {
          assert.equal(response.status, 422);
          assert.equal(
            result.error.code,
            scenario.purpose === "source-analysis"
              ? "SOURCE_ANALYSIS_INVALID"
              : "OUTPUT_REVIEW_INVALID",
          );
          assert.equal(result.analysis, undefined);
        }
        assert.equal(
          JSON.parse(memory.get("studio.browser-byok.attempts.v1"))[id].outcome,
          outcome,
          scenario.name,
        );
        assert.equal(
          (await ledger.readMonthlyUsage()).unknownRequests,
          unusable ? 0 : 1,
          scenario.name,
        );
      } else {
        assert.equal(response.status, 200);
        assert.deepEqual(result.analysis, scenario.output);
      }
      const usage = await ledger.readMonthlyUsage();
      assert.equal(usage.reservedMicros, ledger.estimateMicros(amount));
      assert.equal(usage.recordedRequests, 1);
      assert.equal(
        (await api.browserStudioRequest("/images/generate", init)).status,
        409,
        "No completed or unknown request is resent",
      );
      assert.ok(
        !JSON.stringify([...memory]).includes("shoe_0"),
        "Raw model result is not journaled",
      );
      if (scenario === cases[0]) {
        const historicId = crypto.randomUUID(),
          journal = JSON.parse(memory.get("studio.browser-byok.attempts.v1"));
        journal[historicId] = { outcome: "UNKNOWN" };
        memory.set("studio.browser-byok.attempts.v1", JSON.stringify(journal));
        const next = { ...body, clientAttemptId: crypto.randomUUID() };
        assert.equal(
          (
            await api.browserStudioRequest("/images/approvals", {
              method: "POST",
              body: JSON.stringify(next),
            })
          ).status,
          409,
        );
        assert.equal(
          JSON.parse(memory.get("studio.browser-byok.attempts.v1"))[historicId]
            .outcome,
          "UNKNOWN",
          "Historical UNKNOWN is never retroactively reclassified",
        );
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
