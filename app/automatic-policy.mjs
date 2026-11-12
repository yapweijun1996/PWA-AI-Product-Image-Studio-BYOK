// Automatic-only policy. The advanced gateway scene contract remains unchanged.
export const AUTOMATIC_PROMPT_VERSION = '1.0.0';
export const AUTOMATIC_MODES = Object.freeze(['STRICT', 'REFERENCE']);
export const AUTOMATIC_MAX_REFERENCES = 3;
export const AUTOMATIC_REFERENCE_MAX_EDGE = 1024;
export const AUTOMATIC_REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
// Conservative planning allowance per bounded reference, NOT a token prediction.
// Flare's token consumption is not documented by the GPT Image 2 calculator.
export const AUTOMATIC_REFERENCE_INPUT_TOKENS_ASSUMPTION = 8192;
export const AUTOMATIC_LAYOUTS = Object.freeze({
  studio: Object.freeze({ maxWidth: .68, maxHeight: .70, centerX: .50, bottom: .84, surface: 'seamless neutral studio sweep', light: 'soft broad upper-left light' }),
  hero: Object.freeze({ maxWidth: .76, maxHeight: .76, centerX: .57, bottom: .87, surface: 'dark matte campaign floor with no platform', light: 'dramatic upper-left side light and restrained rim light' }),
  lifestyle: Object.freeze({ maxWidth: .48, maxHeight: .60, centerX: .34, bottom: .82, surface: 'warm neutral tabletop with distant domestic architectural depth, no category-specific props', light: 'diffuse left window daylight' }),
  flat_lay: Object.freeze({ maxWidth: .62, maxHeight: .62, centerX: .50, bottom: .83, surface: 'pale tactile tabletop at an unspecified source-compatible angle', light: 'soft upper-left daylight' }),
  macro: Object.freeze({ maxWidth: .94, maxHeight: .94, centerX: .50, bottom: .97, surface: 'local detail crop', light: 'unaltered source lighting' }),
  ugc: Object.freeze({ maxWidth: .46, maxHeight: .57, centerX: .67, bottom: .85, surface: 'simple everyday desk with distant softly imperfect room depth', light: 'natural ambient light from left' }),
  billboard: Object.freeze({ maxWidth: .64, maxHeight: .70, centerX: .58, bottom: .84, surface: 'full-bleed graphic campaign canvas with subtle geometric color fields and generous negative space', light: 'soft upper-left studio light' }),
});
export const automaticStyleLabel = (style, mode = 'STRICT') => ({ studio: 'Studio', hero: 'Hero', lifestyle: 'Lifestyle', flat_lay: mode === 'REFERENCE' ? 'Tabletop concept' : 'Tabletop · source angle', macro: 'Visible detail crop', ugc: 'Everyday', billboard: 'Billboard' })[style];
export function automaticPrompt(style, mode = 'STRICT') {
  if (!Object.hasOwn(AUTOMATIC_LAYOUTS, style) || !AUTOMATIC_MODES.includes(mode) || style === 'macro') throw new TypeError('Invalid automatic prompt.');
  const layout = AUTOMATIC_LAYOUTS[style];
  const identity = mode === 'STRICT'
    ? 'Generate only an empty background. The original product is a separate immutable local foreground; never draw any product, packaging, people, text, logos, badges or claims. Product category, camera angle and lighting are unknown; do not infer them.'
    : 'Use the supplied product photographs as visual references for one product. Preserve its visible geometry, colors, logo and existing label as far as generative editing allows. Do not invent hidden surfaces, readable text, product facts, claims, people or endorsements. Keep the primary reference camera angle; additional views are evidence only, never proof of unseen details. This is a reference-guided concept, not pixel-preserved artwork.';
  return `${identity} Style: ${style === 'flat_lay' ? 'source-angle tabletop; no unsupported overhead view' : style}. Composition in normalized 1024-square coordinates: ${JSON.stringify(layout)}. Leave the product footprint centered at x=${layout.centerX}, with its bottom contacting the surface at y=${layout.bottom}; maximum product width=${layout.maxWidth}, height=${layout.maxHeight}. Surface must meet that baseline, with no generated pedestal or object obstructing it. Light: ${layout.light}. ${style === 'billboard' ? 'Create the WHOLE text-free designed advertisement canvas, edge to edge. No billboard, display, frame, street, mount or inset panel: the complete ad will be placed into a controlled billboard locally.' : 'Photographic surroundings with clear foreground support and restrained depth.'} No extra copy, watermark, discount, certification or invented use case.`;
}
export function automaticEstimateUSD(style, mode = 'STRICT', referenceCount = 1) {
  if (!AUTOMATIC_MODES.includes(mode) || !Number.isInteger(referenceCount) || referenceCount < 1 || referenceCount > AUTOMATIC_MAX_REFERENCES) throw new TypeError('Invalid automatic estimate.');
  if (style === 'macro') return '0.000000';
  // Historical low-output planning assumption (196 image tokens), not a confirmed
  // Flare output count or upper bound. USD/1M: text5, image input8, output30.
  const micros = 196 * 30 + new TextEncoder().encode(automaticPrompt(style, mode)).length * 5 + (mode === 'REFERENCE' ? referenceCount * AUTOMATIC_REFERENCE_INPUT_TOKENS_ASSUMPTION * 8 : 0);
  return (micros / 1e6).toFixed(6);
}
