import type { StudioStyleId } from "./studio-policy.mjs";
export type Box = { x: number; y: number; width: number; height: number };
export type SourceView = {
  imageIndex: number;
  box: Box;
  camera: string;
  confidence: number;
};
export type SourceSubject = SourceView & {
  id: string;
  group: string;
  category: string;
  detailBox: Box | null;
  views: SourceView[];
};
export type SourceAnalysis = {
  classification: string;
  confidence: number;
  primaryId: string | null;
  subjects: SourceSubject[];
  textRegions: { imageIndex: number; box: Box }[];
};
export type QualityFinding = {
  styleId: StudioStyleId;
  identity: "consistent" | "conflict" | "uncertain";
  composition: "usable" | "attention" | "uncertain";
  confidence: number;
  reasons: string[];
};
export type OutputReview = { findings: QualityFinding[] };
export type VisionPurpose = "source-analysis" | "output-review";
export const VISION_MODEL: "gpt-5.4-mini-2026-03-17";
export const VISION_POLICY_VERSION: "1.0.0";
export const VISION_MAX_OUTPUT_TOKENS: number;
export const SOURCE_IMAGE_LIMIT: number;
export const REVIEW_IMAGE_LIMIT: number;
export const CATEGORIES: readonly string[];
export const CAMERAS: readonly string[];
export const REASON_CODES: readonly string[];
export const SOURCE_ANALYSIS_SCHEMA: Record<string, unknown>;
export const OUTPUT_REVIEW_SCHEMA: Record<string, unknown>;
export function visionPrompt(
  purpose: VisionPurpose,
  styles?: StudioStyleId[],
  referenceCount?: number,
): string;
export function visionEstimateUSD(
  purpose: VisionPurpose,
  sourceCount?: number,
): string;
export function validateBox(value: unknown): Box;
export function intersectionArea(a: Box, b: Box): number;
export function containsBox(a: Box, b: Box): boolean;
export function validateSourceAnalysis(
  value: unknown,
  imageCount: number,
): SourceAnalysis;
export function subjectCandidates(
  value: SourceAnalysis,
  minConfidence?: number,
): SourceSubject[];
export function reliableSubjects(value: SourceAnalysis): SourceSubject[];
export function automaticSubjectId(value: SourceAnalysis): string | null;
export function validDetailBox(
  value: SourceAnalysis,
  subject: SourceSubject,
): Box | null;
export function validateOutputReview(
  value: unknown,
  styles: StudioStyleId[],
): OutputReview;

export function safeSubjectViews(
  value: SourceAnalysis,
  subject: SourceSubject,
): SourceView[];

export function visionResponseSchema(
  purpose: VisionPurpose,
  imageCount: number,
  styles?: StudioStyleId[],
): any;
