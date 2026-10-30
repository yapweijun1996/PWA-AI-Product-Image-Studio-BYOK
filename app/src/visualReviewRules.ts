import type { StudioStyleId } from '../studio-policy.mjs';

export type ReviewScores = {
  design: string;
  typography: string;
  geometry: string;
  realism: string;
  style: string;
};

export type ReviewCheck = 'MATCH' | 'MISMATCH' | 'UNKNOWN';
export type ReviewChecks = {
  product: ReviewCheck;
  typography: ReviewCheck;
  claims: ReviewCheck;
  viewpoint: ReviewCheck;
  source: ReviewCheck;
  mask: ReviewCheck;
};
export type ReviewVariant = 'default' | 'unbranded';
export type StyleReviewChecks = Record<string, ReviewCheck>;
export const STYLE_REVIEW_FIELDS: Record<StudioStyleId, ReadonlyArray<readonly [string, string]>> = {
  studio: [['scene', 'The scene contains no invented product, text, logo or claim']],
  hero: [['support', 'Support, reflections and lighting do not alter the protected product']],
  lifestyle: [['context', 'The setting and props do not imply unsupported use or claims']],
  flat_lay: [['view', 'The original source viewpoint supports the declared overhead or source-angle result']],
  macro: [['crop', 'The detail is a truthful crop of the visible original'], ['detail', 'The source detail is clear enough without invented enhancement'], ['protected', 'Required brand, labels and SKU are visible and unchanged; if omitted or unreadable, choose Cannot verify']],
  ugc: [['endorsement', 'No fictional customer, testimonial or endorsement is represented as real']],
  billboard: [['ad', 'The complete ad contains the intact original product'], ['copy', 'Ad copy is exactly seller-supplied or absent'], ['display', 'The whole ad fits the inspected front-facing display without clipping'], ['surroundings', 'The surrounding scene contains no invented text, logos or claims']],
};

const scoreKeys = ['design', 'typography', 'geometry', 'realism', 'style'] as const;
const checkKeys = ['product', 'typography', 'claims', 'viewpoint', 'source', 'mask'] as const;
const weights = [35, 25, 15, 15, 10] as const;
const descriptions: Record<keyof ReviewChecks, string> = {
  product: 'Reviewer selected a product mismatch.',
  typography: 'Reviewer selected a logo or typography mismatch.',
  claims: 'Reviewer selected a claims mismatch.',
  viewpoint: 'Reviewer selected a viewpoint mismatch.',
  source: 'Reviewer selected a source mismatch.',
  mask: 'Reviewer selected a mask or composite mismatch.',
};

function requireExactKeys(value: unknown, keys: readonly string[], name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== keys.length ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`Invalid ${name} fields`);
  }
}

// Six decimal places are an input limit, not a decision about score rounding.
function scoreMicros(value: unknown): number {
  if (typeof value !== 'string') throw new TypeError('Scores must be decimal strings from 0 to 5 with at most six fractional digits');
  const decimal = value.startsWith('.') ? `0${value}` : value;
  if (!/^(?:[0-4](?:\.\d{1,6})?|5(?:\.0{1,6})?)$/.test(decimal)) {
    throw new TypeError('Scores must be decimal strings from 0 to 5 with at most six fractional digits');
  }
  const [whole, fraction = ''] = decimal.split('.');
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
}

export type VisualReviewEvaluation = {
  scores: { design: number; typography: number; geometry: number; realism: number; style: number };
  weightedScore: number;
  status: 'PASS_CANDIDATE' | 'REVIEW_REQUIRED' | 'UNVERIFIABLE' | 'REJECTED';
  hardVetoFindings: Array<{ code: string; description: string; severity: 'BLOCKER' }>;
};

export function evaluateVisualReview(scores: ReviewScores, checks: ReviewChecks, variant: ReviewVariant,
  styleId?: StudioStyleId, styleChecks?: StyleReviewChecks): VisualReviewEvaluation {
  requireExactKeys(scores, scoreKeys, 'score');
  requireExactKeys(checks, checkKeys, 'check');
  if (variant !== 'default' && variant !== 'unbranded') throw new TypeError('Invalid weighting variant');
  if (variant === 'unbranded') throw new Error('Unbranded weighting is unresolved (OPEN-009); visual review is unavailable');
  let styleFields: ReadonlyArray<readonly [string, string]> = [];
  if (styleId !== undefined) {
    if (!Object.hasOwn(STYLE_REVIEW_FIELDS, styleId)) throw new TypeError('Invalid review style');
    styleFields = STYLE_REVIEW_FIELDS[styleId];
    requireExactKeys(styleChecks, styleFields.map(([key]) => key), 'style check');
    for (const [key] of styleFields) if (styleChecks[key] !== 'MATCH' && styleChecks[key] !== 'MISMATCH' && styleChecks[key] !== 'UNKNOWN') {
      throw new TypeError(`Invalid ${key} style check`);
    }
  } else if (styleChecks !== undefined) throw new TypeError('A style is required for style checks');

  const micros = scoreKeys.map((key) => scoreMicros(scores[key]));
  for (const key of checkKeys) {
    if (checks[key] !== 'MATCH' && checks[key] !== 'MISMATCH' && checks[key] !== 'UNKNOWN') {
      throw new TypeError(`Invalid ${key} check`);
    }
  }
  const hardVetoFindings = checkKeys.filter((key) => checks[key] === 'MISMATCH').map((key) => ({
    code: `HUMAN_${key.toUpperCase()}_MISMATCH`, description: descriptions[key], severity: 'BLOCKER' as const,
  }));
  for (const [key, label] of styleFields) if (styleChecks?.[key] === 'MISMATCH') {
    hardVetoFindings.push({ code: `HUMAN_${styleId!.toUpperCase()}_${key.toUpperCase()}_MISMATCH`, description: `Reviewer selected a mismatch: ${label}.`, severity: 'BLOCKER' });
  }
  const numerator = micros.reduce((sum, value, index) => sum + value * weights[index], 0);
  const status = hardVetoFindings.length ? 'REJECTED'
    : checkKeys.some((key) => checks[key] === 'UNKNOWN') || styleFields.some(([key]) => styleChecks?.[key] === 'UNKNOWN') ? 'UNVERIFIABLE'
    : numerator >= 85 * 5_000_000 ? 'PASS_CANDIDATE' : 'REVIEW_REQUIRED';
  return {
    scores: { design: micros[0] / 1_000_000, typography: micros[1] / 1_000_000, geometry: micros[2] / 1_000_000, realism: micros[3] / 1_000_000, style: micros[4] / 1_000_000 },
    weightedScore: numerator / 5_000_000,
    status,
    hardVetoFindings,
  };
}
