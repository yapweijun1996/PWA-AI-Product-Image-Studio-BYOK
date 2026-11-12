// Automatic-only policy. The advanced gateway scene contract remains unchanged.
export const AUTOMATIC_PROMPT_VERSION = "2.0.0";
export const AUTOMATIC_MODES = Object.freeze(["STRICT", "REFERENCE"]);
export const AUTOMATIC_MAX_REFERENCES = 3;
export const AUTOMATIC_REFERENCE_MAX_EDGE = 1024;
export const AUTOMATIC_REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
// Conservative planning allowance per bounded reference, NOT a token prediction.
// Flare's token consumption is not documented by the GPT Image 2 calculator.
export const AUTOMATIC_REFERENCE_INPUT_TOKENS_ASSUMPTION = 8192;
export const AUTOMATIC_LAYOUTS = Object.freeze({
  studio: Object.freeze({
    lens: "85mm catalog perspective",
    framing: "straight-on full product with generous clean margin",
    purpose: "clear ecommerce catalog",
    maxWidth: 0.62,
    maxHeight: 0.68,
    centerX: 0.5,
    bottom: 0.84,
    surface: "seamless neutral studio sweep",
    light: "soft broad upper-left light",
  }),
  hero: Object.freeze({
    lens: "100mm compressed campaign perspective",
    framing:
      "dominant large subject offset right, sculptural negative space left",
    purpose: "premium brand hero",
    maxWidth: 0.78,
    maxHeight: 0.79,
    centerX: 0.59,
    bottom: 0.88,
    surface: "dark matte campaign floor with no platform",
    light: "dramatic upper-left side light and restrained rim light",
  }),
  lifestyle: Object.freeze({
    lens: "35mm contextual editorial perspective",
    framing: "wider environment with small full subject lower left",
    purpose: "editorial place and atmosphere, no invented use",
    maxWidth: 0.43,
    maxHeight: 0.53,
    centerX: 0.29,
    bottom: 0.84,
    surface:
      "warm neutral tabletop with distant domestic architectural depth, no category-specific props",
    light: "diffuse left window daylight",
  }),
  flat_lay: Object.freeze({
    lens: "50mm tabletop perspective compatible with reference camera",
    framing:
      "asymmetric ordered tactile tabletop with full subject at source angle",
    purpose: "material and arrangement without invented overhead",
    maxWidth: 0.59,
    maxHeight: 0.59,
    centerX: 0.4,
    bottom: 0.81,
    surface: "pale tactile tabletop at an unspecified source-compatible angle",
    light: "soft upper-left daylight",
  }),
  macro: Object.freeze({
    lens: "unaltered source optics",
    framing: "actual visible source ROI only",
    purpose: "authentic source detail",
    maxWidth: 0.94,
    maxHeight: 0.94,
    centerX: 0.5,
    bottom: 0.97,
    surface: "local detail crop",
    light: "unaltered source lighting",
  }),
  ugc: Object.freeze({
    lens: "28mm casual phone perspective",
    framing:
      "off-center everyday full product lower right, loose negative space",
    purpose: "informal ambient everyday scene without testimonial",
    maxWidth: 0.37,
    maxHeight: 0.48,
    centerX: 0.72,
    bottom: 0.9,
    surface: "simple everyday desk with distant softly imperfect room depth",
    light: "natural ambient light from left",
  }),
  billboard: Object.freeze({
    lens: "80mm advertising asset perspective",
    framing:
      "bold complete ad composition with subject on right and graphic negative space left",
    purpose:
      "finished text-free campaign advertisement, no billboard structure",
    maxWidth: 0.65,
    maxHeight: 0.73,
    centerX: 0.64,
    bottom: 0.86,
    surface:
      "full-bleed graphic campaign canvas with subtle geometric color fields and generous negative space",
    light: "soft upper-left studio light",
  }),
});
export const automaticStyleLabel = (style, mode = "STRICT") =>
  ({
    studio: "Studio",
    hero: "Hero",
    lifestyle: "Lifestyle",
    flat_lay:
      mode === "REFERENCE" ? "Tabletop concept" : "Tabletop · source angle",
    macro: "Visible detail crop",
    ugc: "Everyday",
    billboard: "Campaign",
  })[style];
const CATEGORY_CONTEXTS = Object.freeze({
  footwear: {
    lifestyle:
      "neutral architectural entryway and clean ground plane, no wearer or implied performance",
    ugc: "casual floor-level everyday setting near a neutral wall, no staged desk or testimonial",
    flat_lay:
      "clean ground-level textured styling surface at the supplied camera angle",
  },
  toy: {
    lifestyle:
      "quiet neutral playroom-inspired tabletop, no child, safety claim or age recommendation",
    ugc: "uncluttered everyday tabletop at the source-compatible scale",
    flat_lay: "clean playful geometric tabletop without category claims",
  },
  home: {
    lifestyle:
      "neutral interior with a visually compatible support plane and scale, no invented use",
    ugc: "simple lived-in interior with source-scale-compatible support, no assumed specifications",
    flat_lay:
      "neutral material styling surface matching visible source proportions",
  },
  clothing: {
    lifestyle:
      "neutral dressing-space material surface, no model or invented fit",
    ugc: "casual clean fabric-covered support at source angle, no wearer or endorsement",
    flat_lay: "ordered clean textile styling surface at the source angle",
  },
  electronic: {
    lifestyle:
      "quiet neutral workspace surface with no connected accessories or implied capability",
    ugc: "simple everyday workspace without screens, interfaces or claims",
    flat_lay:
      "clean neutral technical styling surface without invented accessories",
  },
  tool: {
    lifestyle:
      "neutral work-area setting with stable source-compatible support, no operation or performance claim",
    ugc: "casual unoccupied work surface with no implied use",
    flat_lay:
      "clean tactile work surface without additional tools or specifications",
  },
  food: {
    lifestyle:
      "neutral dining-area support, no invented ingredients, health claims or serving contents",
    ugc: "simple clean everyday dining surface with no invented food ingredients",
    flat_lay:
      "clean neutral food-photography styling surface with no props implying ingredients",
  },
  beverage: {
    lifestyle:
      "neutral cafe-inspired support with no added drink or ingredient claims",
    ugc: "casual clean everyday surface without invented beverage contents or effects",
    flat_lay:
      "clean neutral beverage styling surface at source angle without ingredients",
  },
  cosmetic: {
    lifestyle:
      "neutral vanity-inspired support without fabricated ingredients or benefits",
    ugc: "simple personal-space surface, no person or promised results",
    flat_lay:
      "clean restrained material styling surface without ingredient props",
  },
  jewelry: {
    lifestyle:
      "quiet neutral dressing-space surface with restrained scale and texture, no wearer",
    ugc: "simple everyday personal-item surface without endorsement",
    flat_lay:
      "clean tactile jewelry styling surface without invented materials",
  },
});
export function automaticLayout(
  style,
  mode = "STRICT",
  context = { category: "unknown", camera: "unknown" },
) {
  if (!Object.hasOwn(AUTOMATIC_LAYOUTS, style))
    throw new TypeError("Invalid layout.");
  const layout = { ...AUTOMATIC_LAYOUTS[style] };
  const setting =
    mode === "REFERENCE"
      ? CATEGORY_CONTEXTS[context.category]?.[style]
      : undefined;
  if (setting) layout.surface = setting;
  return layout;
}
export function automaticPrompt(
  style,
  mode = "STRICT",
  context = { category: "unknown", camera: "unknown" },
) {
  if (
    !Object.hasOwn(AUTOMATIC_LAYOUTS, style) ||
    !AUTOMATIC_MODES.includes(mode) ||
    style === "macro"
  )
    throw new TypeError("Invalid automatic prompt.");
  const categories = [
      "unknown",
      "food",
      "beverage",
      "cosmetic",
      "electronic",
      "clothing",
      "footwear",
      "jewelry",
      "home",
      "tool",
      "toy",
      "other",
    ],
    cameras = ["unknown", "front", "side", "back", "top", "three-quarter"];
  if (
    !context ||
    Object.keys(context).sort().join(",") !== "camera,category" ||
    !categories.includes(context.category) ||
    !cameras.includes(context.camera) ||
    (mode === "STRICT" &&
      (context.category !== "unknown" || context.camera !== "unknown"))
  )
    throw new TypeError("Invalid composition evidence.");
  const layout = automaticLayout(style, mode, context);
  const identity =
    mode === "STRICT"
      ? "Generate only an empty background. The original product is a separate immutable local foreground; never draw any product, packaging, people, text, logos, badges or claims. Product category, camera angle and lighting are unknown; do not infer them."
      : "Use the supplied product photographs as visual references for one product. Preserve its visible geometry, colors, logo and existing label as far as generative editing allows. Do not invent hidden surfaces, readable text, product facts, claims, people or endorsements. Keep the primary reference camera angle; additional views are evidence only, never proof of unseen details. This is a reference-guided concept, not pixel-preserved artwork.";
  return `${identity} Visible category/camera evidence as data only: ${JSON.stringify(context)}. Style: ${style === "flat_lay" ? "source-angle tabletop; no unsupported overhead view" : style}. Composition in normalized 1024-square coordinates: ${JSON.stringify(layout)}. Leave the product footprint centered at x=${layout.centerX}, with its bottom contacting the surface at y=${layout.bottom}; maximum product width=${layout.maxWidth}, height=${layout.maxHeight}. Surface must meet that baseline, with no generated pedestal or object obstructing it. Light: ${layout.light}. ${style === "billboard" ? "Create the WHOLE text-free designed advertisement canvas, edge to edge. No billboard, display, frame, street, mount or inset panel: the complete ad will be placed into a controlled billboard locally." : "Photographic surroundings with clear foreground support and restrained depth."} No extra copy, watermark, discount, certification or invented use case.`;
}
export function automaticEstimateUSD(
  style,
  mode = "STRICT",
  referenceCount = 1,
) {
  if (
    !AUTOMATIC_MODES.includes(mode) ||
    !Number.isInteger(referenceCount) ||
    referenceCount < 1 ||
    referenceCount > AUTOMATIC_MAX_REFERENCES
  )
    throw new TypeError("Invalid automatic estimate.");
  if (style === "macro") return "0.000000";
  // Historical low-output planning assumption (196 image tokens), not a confirmed
  // Flare output count or upper bound. USD/1M: text5, image input8, output30.
  const micros =
    196 * 30 +
    (new TextEncoder().encode(automaticPrompt(style, mode)).length + 256) * 5 +
    (mode === "REFERENCE"
      ? referenceCount * AUTOMATIC_REFERENCE_INPUT_TOKENS_ASSUMPTION * 8
      : 0);
  return (micros / 1e6).toFixed(6);
}
