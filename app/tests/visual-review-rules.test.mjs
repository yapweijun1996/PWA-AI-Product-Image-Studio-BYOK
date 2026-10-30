import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';

const result = await build({
  configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/visualReviewRules.ts', formats: ['es'], fileName: 'visual-review-rules' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { evaluateVisualReview, validateReviewFindings } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

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

test('style-specific unresolved or mismatched evidence cannot be approved even at 100', () => {
  const max = { design: '5', typography: '5', geometry: '5', realism: '5', style: '5' };
  const cases = {
    studio: ['scene'], hero: ['support'], lifestyle: ['context'], flat_lay: ['view'],
    macro: ['crop', 'detail', 'protected'], ugc: ['endorsement'], billboard: ['ad', 'copy', 'display', 'surroundings'],
  };
  for (const [styleId, fields] of Object.entries(cases)) {
    const all = Object.fromEntries(fields.map((key) => [key, 'MATCH']));
    assert.equal(evaluateVisualReview(max, checks, 'default', styleId, all).status, 'PASS_CANDIDATE');
    for (const field of fields) {
      assert.equal(evaluateVisualReview(max, checks, 'default', styleId, { ...all, [field]: 'UNKNOWN' }).status, 'UNVERIFIABLE');
      const veto = evaluateVisualReview(max, checks, 'default', styleId, { ...all, [field]: 'MISMATCH' });
      assert.equal(veto.status, 'REJECTED');
      assert.equal(veto.hardVetoFindings[0].severity, 'BLOCKER');
    }
    assert.throws(() => evaluateVisualReview(max, checks, 'default', styleId, {}));
    assert.throws(() => evaluateVisualReview(max, checks, 'default', styleId, { ...all, extra: 'MATCH' }));
  }
});

test('new findings enforce evidence and independently veto at full score', () => {
  const max = Object.fromEntries(Object.keys(scores).map((key) => [key, '5']));
  const blocker = { severity: 'BLOCKER', description: 'Wrong label', unlocalized: true };
  const warn = { severity: 'WARN', description: 'Label unclear', unlocalized: true };
  const run = (c, findings, styleId, styleChecks) => evaluateVisualReview(max, c, 'default', styleId, styleChecks, findings);
  assert.equal(run(checks, [blocker]).status, 'REJECTED');
  assert.deepEqual(run(checks, [blocker]).hardVetoFindings, [{ code: 'HUMAN_FINDING_1', description: 'Wrong label', severity: 'BLOCKER' }]);
  assert.throws(() => run({ ...checks, source: 'MISMATCH' }, [warn]), /BLOCKER/);
  assert.throws(() => run({ ...checks, source: 'UNKNOWN' }, []), /WARN/);
  assert.equal(run({ ...checks, source: 'UNKNOWN' }, [warn]).status, 'UNVERIFIABLE');
  assert.throws(() => run(checks, [], 'studio', { scene: 'MISMATCH' }), /BLOCKER/);
  assert.throws(() => run(checks, [], 'studio', { scene: 'UNKNOWN' }), /WARN/);
  assert.equal(evaluateVisualReview(max, { ...checks, source: 'MISMATCH' }, 'default').hardVetoFindings.length, 1);
});

test('finding shape, localization and pixel boundaries are strict', () => {
  const valid = { severity: 'INFO', description: 'Edge', unlocalized: false,
    sourceRegion: { x: 1, y: 0, width: 1, height: 1 }, outputRegion: { x: 1023, y: 1023, width: 1, height: 1 } };
  validateReviewFindings([valid], { width: 2, height: 1 });
  for (const invalid of [
    { ...valid, sourceRegion: { ...valid.sourceRegion, x: 2 } },
    { ...valid, outputRegion: { ...valid.outputRegion, width: 2 } },
    { ...valid, sourceRegion: { ...valid.sourceRegion, width: 0 } },
    { ...valid, sourceRegion: { ...valid.sourceRegion, x: 0.5 } },
    { ...valid, sourceRegion: { ...valid.sourceRegion, extra: 1 } },
    { ...valid, unlocalized: true }, { severity: 'INFO', description: 'Edge', unlocalized: false },
    { ...valid, description: ' Edge' }, { ...valid, description: 'x'.repeat(501) }, { ...valid, extra: true },
  ]) assert.throws(() => validateReviewFindings([invalid], { width: 2, height: 1 }));
  assert.throws(() => validateReviewFindings(Array(21).fill(valid), { width: 2, height: 1 }));
});
