import type { StudioStyleId } from "./studio-policy.mjs";
export type AutomaticMode = "STRICT" | "REFERENCE";
export type AutomaticLayout = {
  lens?: string;
  framing?: string;
  purpose?: string;
  maxWidth: number;
  maxHeight: number;
  centerX: number;
  bottom: number;
  surface: string;
  light: string;
};
export const AUTOMATIC_PROMPT_VERSION: "2.0.0";
export const AUTOMATIC_MODES: readonly AutomaticMode[];
export const AUTOMATIC_MAX_REFERENCES: number;
export const AUTOMATIC_REFERENCE_MAX_EDGE: number;
export const AUTOMATIC_REFERENCE_MAX_BYTES: number;
export const AUTOMATIC_REFERENCE_INPUT_TOKENS_ASSUMPTION: number;
export const AUTOMATIC_LAYOUTS: Readonly<
  Record<StudioStyleId, Readonly<AutomaticLayout>>
>;
export function automaticStyleLabel(
  style: StudioStyleId,
  mode?: AutomaticMode,
  context?: { category: string; camera: string },
): string;
export function automaticPrompt(
  style: StudioStyleId,
  mode?: AutomaticMode,
  context?: { category: string; camera: string },
): string;
export function automaticEstimateUSD(
  style: StudioStyleId,
  mode?: AutomaticMode,
  referenceCount?: number,
): string;

export function automaticLayout(
  style: StudioStyleId,
  mode?: AutomaticMode,
  context?: { category: string; camera: string },
): AutomaticLayout;
