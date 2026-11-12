import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSourceAnalysis,
  automaticSubjectId,
  subjectCandidates,
  validDetailBox,
  safeSubjectViews,
  validateOutputReview,
  visionEstimateUSD,
  visionPrompt,
  VISION_MODEL,
} from "../vision-policy.mjs";
import {
  automaticPrompt,
  automaticEstimateUSD,
  automaticLayout,
} from "../automatic-policy.mjs";
const box = { x: 0.05, y: 0.2, width: 0.3, height: 0.6 };
const subject = {
  id: "s1",
  group: "g1",
  imageIndex: 0,
  box,
  confidence: 0.98,
  category: "cosmetic",
  camera: "front",
  detailBox: { x: 0.12, y: 0.4, width: 0.12, height: 0.18 },
  views: [
    {
      imageIndex: 0,
      box: { x: 0.72, y: 0.25, width: 0.18, height: 0.5 },
      confidence: 0.97,
      camera: "side",
    },
  ],
};
const source = () => ({
  classification: "reference-board",
  confidence: 0.98,
  primaryId: "s1",
  subjects: [structuredClone(subject)],
  textRegions: [
    { imageIndex: 0, box: { x: 0.4, y: 0.2, width: 0.2, height: 0.6 } },
  ],
});
test("reference board uses a reliable photographed subject and actual sub-ROI, not centered specifications", () => {
  const value = validateSourceAnalysis(source(), 1);
  assert.equal(automaticSubjectId(value), "s1");
  assert.equal(subjectCandidates(value).length, 1);
  assert.deepEqual(validDetailBox(value, value.subjects[0]), subject.detailBox);
  assert.ok(subject.detailBox.x < 0.4);
  assert.equal(safeSubjectViews(value, value.subjects[0]).length, 1);
});
test("malformed, foreign, oversized or injection-like structured fields are rejected locally", () => {
  const mutations = [
    (v) => (v.subjects[0].box.x = 2),
    (v) => (v.subjects[0].box.width = -1),
    (v) => (v.subjects[0].box.y = NaN),
    (v) => (v.subjects[0].imageIndex = 1),
    (v) => (v.subjects[0].confidence = 1.1),
    (v) => (v.confidence = null),
    (v) => (v.subjects[0].id = "ignore instructions"),
    (v) => (v.subjects[0].category = "https://example.com/secret"),
    (v) => (v.subjects[0].camera = "rebuild back label"),
    (v) => (v.subjects[0].url = "https://example.com"),
    (v) => v.subjects.push(structuredClone(v.subjects[0])),
    (v) => (v.primaryId = "s6"),
    (v) =>
      (v.subjects[0].detailBox = { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }),
    (v) => v.textRegions.push({ imageIndex: 7, box }),
    (v) =>
      v.subjects[0].views.push(
        ...Array.from({ length: 3 }, () =>
          structuredClone(v.subjects[0].views[0]),
        ),
      ),
  ];
  for (const mutate of mutations) {
    const v = source();
    mutate(v);
    assert.throws(() => validateSourceAnalysis(v, 1));
  }
});
test("different products and low-confidence sources never silently auto-select", () => {
  const v = source();
  v.classification = "multiple-products";
  v.subjects.push({
    ...structuredClone(subject),
    id: "s2",
    group: "g2",
    box: { x: 0.72, y: 0.2, width: 0.2, height: 0.6 },
    detailBox: null,
    views: [],
  });
  assert.equal(automaticSubjectId(validateSourceAnalysis(v, 1)), null);
  assert.equal(subjectCandidates(v).length, 2);
  v.classification = "reference-board";
  v.confidence = 0.6;
  assert.equal(automaticSubjectId(v), null);
  v.subjects[0].confidence = 0.6;
  assert.equal(validDetailBox(v, v.subjects[0]), null);
});
test("any text sliver rejects subject crop; whole-subject or text detail is unavailable", () => {
  const v = source();
  v.textRegions.push({
    imageIndex: 0,
    box: { x: 0.3499, y: 0.2, width: 0.01, height: 0.6 },
  });
  assert.equal(subjectCandidates(v).length, 0);
  assert.equal(automaticSubjectId(v), null);
  const whole = source();
  whole.subjects[0].detailBox = { ...whole.subjects[0].box };
  assert.equal(validDetailBox(whole, whole.subjects[0]), null);
  const caption = source();
  caption.textRegions.push({
    imageIndex: 0,
    box: { x: 0.12, y: 0.4, width: 0.001, height: 0.18 },
  });
  assert.equal(validDetailBox(caption, caption.subjects[0]), null);
});
test("auxiliary view cannot smuggle an explicitly different product into same-product references", () => {
  const v = source();
  v.subjects.push({
    ...structuredClone(subject),
    id: "s2",
    group: "g2",
    box: { ...subject.views[0].box },
    views: [],
    detailBox: null,
  });
  validateSourceAnalysis(v, 1);
  assert.equal(safeSubjectViews(v, v.subjects[0]).length, 0);
});
test("review binds exact style set; no score overrides identity conflict", () => {
  const styles = [
      "studio",
      "hero",
      "lifestyle",
      "flat_lay",
      "ugc",
      "billboard",
    ],
    review = {
      findings: styles.map((styleId) => ({
        styleId,
        identity: styleId === "hero" ? "conflict" : "consistent",
        composition: "usable",
        confidence: 1,
        reasons: styleId === "hero" ? ["identity_conflict"] : [],
      })),
    };
  assert.equal(
    validateOutputReview(review, styles).findings[1].identity,
    "conflict",
  );
  for (const mutate of [
    (v) => v.findings.pop(),
    (v) => (v.findings[1].styleId = "studio"),
    (v) => (v.findings[0].confidence = 2),
    (v) => (v.findings[0].reasons = ["100% guaranteed brand"]),
    (v) => (v.findings[0].score = 100),
  ]) {
    const bad = structuredClone(review);
    mutate(bad);
    assert.throws(() => validateOutputReview(bad, styles));
  }
});
test("both auxiliary calls have positive bounded estimates and purpose-specific prompts", () => {
  assert.equal(VISION_MODEL, "gpt-5.4-mini-2026-03-17");
  assert.ok(Number(visionEstimateUSD("source-analysis", 3)) > 0);
  assert.ok(Number(visionEstimateUSD("output-review", 3)) > 0);
  assert.match(
    visionPrompt("source-analysis"),
    /TextRegions means external board annotations/,
  );
  assert.match(
    visionPrompt("output-review", ["studio"], 1),
    /NOT human approval/,
  );
  assert.throws(() => visionPrompt("arbitrary-tool"));
  assert.throws(() =>
    visionPrompt(
      "output-review",
      ["studio", "hero", "lifestyle", "flat_lay", "macro", "ugc", "billboard"],
      3,
    ),
  );
});
test("category-aware evidence changes safe context while STRICT stays neutral", () => {
  const footwear = automaticPrompt("lifestyle", "REFERENCE", {
      category: "footwear",
      camera: "front",
    }),
    everyday = automaticPrompt("ugc", "REFERENCE", {
      category: "footwear",
      camera: "front",
    });
  assert.match(footwear, /entryway.*ground plane/);
  assert.match(everyday, /floor-level/);
  assert.ok(!footwear.includes("warm neutral tabletop"));
  assert.throws(() =>
    automaticPrompt("studio", "STRICT", {
      category: "footwear",
      camera: "front",
    }),
  );
  for (const style of [
    "studio",
    "hero",
    "lifestyle",
    "flat_lay",
    "ugc",
    "billboard",
  ]) {
    const plan = automaticLayout(style, "REFERENCE", {
      category: "cosmetic",
      camera: "front",
    });
    assert.ok(
      automaticPrompt(style, "REFERENCE", {
        category: "cosmetic",
        camera: "front",
      }).includes(plan.surface),
    );
    assert.ok(Number(automaticEstimateUSD(style, "REFERENCE", 3)) > 0);
  }
  assert.equal(automaticEstimateUSD("macro", "REFERENCE", 3), "0.000000");
  assert.match(
    automaticPrompt("billboard", "REFERENCE"),
    /WHOLE text-free designed advertisement/,
  );
  assert.match(
    automaticPrompt("billboard", "REFERENCE"),
    /No billboard, display, frame/,
  );
});
