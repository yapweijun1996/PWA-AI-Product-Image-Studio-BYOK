import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';

const result = await build({
  configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/visualReviewRules.ts', formats: ['es'], fileName: 'visual-review-rules' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { evaluateVisualReview } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const scores = { design: '4.25', typography: '4.25', geometry: '4.25', realism: '4.25', style: '4.25' };
const checks = { product: 'MATCH', typography: 'MATCH', claims: 'MATCH', viewpoint: 'MATCH', source: 'MATCH', mask: 'MATCH' };
const evaluate = (s = scores, c = checks, variant = 'default') => evaluateVisualReview(s, c, variant);

test('exactly 85 is a candidate; the next lower micro-score is not rounded up', () => {
  const boundary = evaluate();
  assert.equal(boundary.weightedScore, 85);
  assert.equal(boundary.status, 'PASS_CANDIDATE');
  assert.deepEqual(boundary.hardVetoFindings, []);
  const below = evaluate({ ...scores, design: '4.249999' });
  assert.equal(below.weightedScore, 84.999993);
  assert.equal(below.status, 'REVIEW_REQUIRED');
});

test('fractional component scores use all rubric weights', () => {
  const result = evaluate({ design: '4.123456', typography: '3.5', geometry: '2.25', realism: '1.5', style: '0.125' });
  assert.deepEqual(result.scores, { design: 4.123456, typography: 3.5, geometry: 2.25, realism: 1.5, style: 0.125 });
  assert.equal(result.weightedScore, 57.864192);
  assert.equal(result.status, 'REVIEW_REQUIRED');
});
test('human-selected mismatches veto even a high score and unknown checks', () => {
  const result = evaluate({ design: '5', typography: '5', geometry: '5', realism: '5', style: '5' }, { ...checks, typography: 'MISMATCH', source: 'UNKNOWN' });
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.weightedScore, 100);
  assert.equal(result.hardVetoFindings.length, 1);
  assert.match(result.hardVetoFindings[0].code, /TYPOGRAPHY/);
  assert.equal(result.hardVetoFindings[0].severity, 'BLOCKER');
});

test('unknown source or label is unverifiable; unbranded scoring is unavailable', () => {
  for (const key of ['source', 'typography']) {
    const result = evaluate(scores, { ...checks, [key]: 'UNKNOWN' });
    assert.equal(result.status, 'UNVERIFIABLE');
    assert.deepEqual(result.hardVetoFindings, []);
  }
  assert.throws(() => evaluate(scores, checks, 'unbranded'), /unbranded weighting.*OPEN-009/i);
  assert.throws(() => evaluate(scores, { ...checks, product: 'MISMATCH' }, 'unbranded'), /unbranded weighting.*OPEN-009/i);
});

test('common fractional shorthand is evaluated without rounding', () => {
  const result = evaluate({ ...scores, design: '.5' });
  assert.equal(result.scores.design, 0.5);
  assert.equal(result.weightedScore, 58.75);
});

test('rejects malformed fields, values, precision and variants', () => {
  for (const invalid of ['', '5.000001', '5.1', '-1', '1.1234567', '1.', '01', '1e0', ' 1', 1, null]) {
    assert.throws(() => evaluate({ ...scores, design: invalid }));
  }
  assert.throws(() => evaluate({ ...scores, extra: '1' }));
  const { style, ...missingScore } = scores;
  assert.throws(() => evaluate(missingScore));
  assert.throws(() => evaluate(scores, { ...checks, extra: 'MATCH' }));
  const { mask, ...missingCheck } = checks;
  assert.throws(() => evaluate(scores, missingCheck));
  for (const key of Object.keys(checks)) assert.throws(() => evaluate(scores, { ...checks, [key]: 'PASS' }));
  assert.throws(() => evaluate(scores, checks, 'other'));
  assert.throws(() => evaluate(null));
});
