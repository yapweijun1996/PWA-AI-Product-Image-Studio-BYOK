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
