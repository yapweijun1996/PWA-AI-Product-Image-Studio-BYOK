// One empty background scene only: never include product or user-provided facts.
export const STUDIO_PROMPT = 'A neutral, empty professional photo studio scene with a seamless light gray backdrop and soft, even lighting. No products, objects, people, text, logos, branding, or claims.';
export const STUDIO_MODEL = 'gpt-image-2.5-flare';
export const STUDIO_QUALITY = 'low';
export const STUDIO_SIZE = '1024x1024';
export const STUDIO_PROMPT_VERSION = '1.0.0';
export const STUDIO_MAX_PNG_BYTES = 12 * 1024 * 1024;
// Estimate only, not a cap or guaranteed charge: 196 output tokens at $30/1M
// ($0.005880), plus an assumption of 100 text input tokens at $5/1M ($0.000500).
// Pricing snapshot 2026-10-29: https://developers.openai.com/api/docs/guides/image-generation
export function studioEstimateUSD() { return '0.006380'; }

export const STUDIO_PRICING_SNAPSHOT = '2026-10-29 Images API USD/1M: text input 5, image input 8, image output 30';

// This calculation is a snapshot-based estimate, never an invoice or a spend cap.
export function studioObservedUSD(usage) {
  const input = usage?.input_tokens_details, output = usage?.output_tokens_details;
  const values = [usage?.input_tokens, usage?.output_tokens, input?.text_tokens, input?.image_tokens, output?.text_tokens, output?.image_tokens];
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  if (BigInt(input.text_tokens) + BigInt(input.image_tokens) !== BigInt(usage.input_tokens) ||
      output.text_tokens !== 0 || output.image_tokens !== usage.output_tokens) return null;
  const micros = BigInt(input.text_tokens) * 5n + BigInt(input.image_tokens) * 8n + BigInt(output.image_tokens) * 30n;
  return `${micros / 1_000_000n}.${String(micros % 1_000_000n).padStart(6, '0')}`;
}
