import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCandidate } from '../src/rules/selection.mjs';

const SETTINGS = {
  fxRubPerCny: 12.257,
  purchaseCny: 30,
  domesticFreightCny: 2,
  packagingCny: 1,
  commissionRate: 0.13,
};

const FULL_EVIDENCE = {
  cards_total: 40,
  cards_100plus: 9,
  cards_recent_reviews: 6,
  avg_price_rub: 2400,
  sellers_count: 12,
  top_share: 0.35,
};

function candidate(overrides = {}) {
  return {
    niche: '厨房硅胶小工具',
    ruQuery: 'силиконовая лопатка',
    priceCny: 200,
    actualWeightG: 600,
    dimsCm: { l: 20, w: 15, h: 8 },
    form: 'silicone_tool',
    ...overrides,
  };
}

test('rejects the archived ¥9.8 / 200 g shape as structurally loss-making', () => {
  const result = evaluateCandidate(candidate({ priceCny: 9.8, actualWeightG: 200, dimsCm: { l: 10, w: 8, h: 5 } }), SETTINGS);
  assert.equal(result.verdict, 'REJECT');
  assert.ok(result.blockers.some((blocker) => /价重比|售价/.test(blocker)));
});

test('holds when unit economics pass but market evidence is missing', () => {
  const result = evaluateCandidate(
    candidate({ priceCny: 60, actualWeightG: 80, dimsCm: { l: 10, w: 8, h: 4 }, purchaseCny: 12, evidence: undefined }),
    { ...SETTINGS, purchaseCny: 12 },
  );
  assert.equal(result.verdict, 'HOLD');
  assert.ok(result.gaps.includes('market_evidence'));
});

test('tries a candidate that passes hard filters, economics and evidence', () => {
  const result = evaluateCandidate(candidate({ evidence: FULL_EVIDENCE }), SETTINGS);
  assert.equal(result.verdict, 'TRY');
  assert.ok(result.economics.contributionRate >= 0.2);
});

test('holds when contribution lands in the 10-20 percent grey zone', () => {
  const result = evaluateCandidate(candidate({ evidence: FULL_EVIDENCE, purchaseCny: 68 }), SETTINGS);
  assert.equal(result.verdict, 'HOLD');
  assert.ok(result.gaps.includes('rate_check'));
});

test('rejects the budget trap and bulky first-round shapes', () => {
  const trap = evaluateCandidate(candidate({ priceCny: 120, actualWeightG: 600, dimsCm: { l: 20, w: 15, h: 8 }, evidence: FULL_EVIDENCE }), SETTINGS);
  assert.equal(trap.verdict, 'REJECT');
  const heavy = evaluateCandidate(candidate({ priceCny: 300, actualWeightG: 2500, dimsCm: { l: 30, w: 20, h: 10 }, evidence: FULL_EVIDENCE }), SETTINGS);
  assert.equal(heavy.verdict, 'REJECT');
  const bulky = evaluateCandidate(candidate({ priceCny: 200, actualWeightG: 900, dimsCm: { l: 50, w: 40, h: 30 }, evidence: FULL_EVIDENCE }), SETTINGS);
  assert.equal(bulky.verdict, 'REJECT');
  assert.ok(bulky.blockers.some((blocker) => /抛货/.test(blocker)));
});

test('rejects non-compliant forms outright', () => {
  const result = evaluateCandidate(candidate({ form: 'battery', evidence: FULL_EVIDENCE }), SETTINGS);
  assert.equal(result.verdict, 'REJECT');
  assert.ok(result.blockers.some((blocker) => /带电|禁入形态/.test(blocker)));
});

test('holds a candidate when the commission rate is unknown', () => {
  const result = evaluateCandidate(candidate({ evidence: FULL_EVIDENCE }), {
    fxRubPerCny: 12.257,
    purchaseCny: 30,
    domesticFreightCny: 2,
    packagingCny: 1,
  });
  assert.equal(result.verdict, 'HOLD');
  assert.ok(result.gaps.includes('commission_check'));
  assert.equal(result.economics.labels.commission_assumed, 17);
});
