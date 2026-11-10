import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeUnitEconomics, selectTier } from '../src/rules/economics.mjs';

const BASE = {
  fxRubPerCny: 12.257,
  purchaseCny: 30,
  domesticFreightCny: 2,
  packagingCny: 1,
  commissionRate: 0.13,
  acquiringRate: 0.0015,
  returnRate: 0.08,
  adRate: 0.12,
};

test('selectTier follows value band then actual weight', () => {
  assert.equal(selectTier({ priceCny: 120, actualWeightG: 400 }).tier, 'extra_small');
  assert.equal(selectTier({ priceCny: 120, actualWeightG: 600 }).tier, 'budget');
  assert.equal(selectTier({ priceCny: 135.01, actualWeightG: 600 }).tier, 'small');
  assert.equal(selectTier({ priceCny: 200, actualWeightG: 2500 }).tier, 'big');
  assert.equal(selectTier({ priceCny: 700, actualWeightG: 4000 }).tier, 'premium_small');
  assert.equal(selectTier({ priceCny: 700, actualWeightG: 6000 }).tier, 'premium_big');
});

test('extra small logistics is fix plus per-gram rate', () => {
  const result = computeUnitEconomics({ ...BASE, priceCny: 120, actualWeightG: 400, dimsCm: { l: 15, w: 10, h: 5 } });
  assert.equal(result.tier, 'extra_small');
  assert.equal(result.chargeableG, 400);
  assert.equal(result.logisticsCny, 12.78);
});

test('501 g in the <=135 value band falls into the budget trap', () => {
  const result = computeUnitEconomics({ ...BASE, priceCny: 120, actualWeightG: 600, dimsCm: { l: 20, w: 15, h: 8 } });
  assert.equal(result.tier, 'budget');
  assert.equal(result.logisticsCny, 32.09);
});

test('big tier bills the larger of actual and volumetric weight', () => {
  const result = computeUnitEconomics({ ...BASE, priceCny: 200, actualWeightG: 2500, dimsCm: { l: 40, w: 30, h: 20 } });
  assert.equal(result.tier, 'big');
  assert.equal(result.chargeableG, 2500);
  assert.equal(result.logisticsCny, 75.82);
});

test('volumetric weight wins when package is bulky', () => {
  const result = computeUnitEconomics({ ...BASE, priceCny: 200, actualWeightG: 2100, dimsCm: { l: 50, w: 40, h: 33 } });
  assert.equal(result.tier, 'big');
  assert.equal(result.chargeableG, 5500);
});

test('electronic service fee respects the 15 RUB floor', () => {
  const result = computeUnitEconomics({ ...BASE, priceCny: 9.8, actualWeightG: 200, dimsCm: { l: 10, w: 8, h: 5 } });
  const expected = 15 / BASE.fxRubPerCny;
  assert.ok(Math.abs(result.electronicFeeCny - expected) < 0.01, `got ${result.electronicFeeCny}`);
});

test('missing commission is assumed at 17 percent and labelled', () => {
  const result = computeUnitEconomics({ ...BASE, commissionRate: undefined, priceCny: 200, actualWeightG: 400, dimsCm: { l: 15, w: 10, h: 5 } });
  assert.equal(result.labels.commission_assumed, 17);
  assert.equal(result.labels.rate_confidence, 'E');
});

test('hard limits are rejected instead of guessed', () => {
  assert.throws(() => computeUnitEconomics({ ...BASE, priceCny: 300, actualWeightG: 36_000, dimsCm: { l: 10, w: 10, h: 10 } }), /实重/);
  assert.throws(() => computeUnitEconomics({ ...BASE, priceCny: 23_000, actualWeightG: 400, dimsCm: { l: 10, w: 10, h: 10 } }), /货值/);
});

test('contribution rate is derived from price minus total cost', () => {
  const result = computeUnitEconomics({ ...BASE, priceCny: 160, actualWeightG: 600, dimsCm: { l: 20, w: 15, h: 8 } });
  assert.equal(result.tier, 'small');
  const expectedTotal =
    BASE.purchaseCny +
    BASE.domesticFreightCny +
    BASE.packagingCny +
    result.logisticsCny +
    result.electronicFeeCny +
    160 * 0.13 +
    160 * 0.0015 +
    160 * 0.08 +
    160 * 0.12;
  assert.ok(Math.abs(result.totalCostCny - expectedTotal) < 0.05);
  assert.ok(Math.abs(result.contributionCny - (160 - expectedTotal)) < 0.05);
  assert.ok(result.contributionRate > 0);
});

test('invalid fx is rejected instead of producing NaN/Infinity', async () => {
  const { computeUnitEconomics, EconomicsError, assertValidFx } = await import('../src/rules/economics.mjs');
  const base = { priceCny: 100, actualWeightG: 300, dimsCm: { l: 20, w: 10, h: 5 } };
  for (const fx of [0, -3, Number.NaN, undefined, 0.08, 500]) {
    assert.throws(() => computeUnitEconomics({ ...base, fxRubPerCny: fx }), (error) => error instanceof EconomicsError && error.code === 'INVALID_FX');
  }
  assert.equal(assertValidFx(12.257), 12.257);
  assert.throws(() => computeUnitEconomics({ ...base, priceCny: 0, fxRubPerCny: 12.257 }), (error) => error.code === 'INVALID_PRICE');
  assert.throws(() => computeUnitEconomics({ ...base, actualWeightG: 0, fxRubPerCny: 12.257 }), (error) => error.code === 'INVALID_WEIGHT');
});

test('selection returns HOLD with fx_invalid gap when fx is broken', async () => {
  const { evaluateCandidate } = await import('../src/rules/selection.mjs');
  const result = evaluateCandidate(
    { niche: '厨房小工具', ruQuery: 'лопатка', priceCny: 100, actualWeightG: 300, dimsCm: { l: 20, w: 10, h: 5 }, evidence: null },
    { fxRubPerCny: 0 },
  );
  assert.equal(result.verdict, 'HOLD');
  assert.ok(result.gaps.includes('fx_invalid'));
  assert.equal(result.economics, null);
});
