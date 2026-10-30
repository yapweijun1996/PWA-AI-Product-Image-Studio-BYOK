export const STUDIO_PROMPT: string;
export const STUDIO_MODEL: 'gpt-image-2.5-flare';
export const STUDIO_QUALITY: 'low';
export const STUDIO_SIZE: '1024x1024';
export const STUDIO_PROMPT_VERSION: '1.0.0';
export const STUDIO_MAX_PNG_BYTES: number;
export function studioEstimateUSD(): string;
export const STUDIO_PRICING_SNAPSHOT: string;
export function studioObservedUSD(usage: unknown): string | null;
