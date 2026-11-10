import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeRestockPlan, extractSoldFromPostings } from '../src/ops/restock.mjs';
import { computeSkuMargins } from '../src/ops/margin.mjs';
import { openDb } from '../src/db.mjs';

test('extractSoldFromPostings sums quantities per offer in window', () => {
  const postings = [
    { posting_number: 'P1', status: 'delivered', created_at: '2026-11-05T00:00:00Z', items_json: JSON.stringify([{ offer_id: 'A', quantity: 2 }, { offer_id: 'B', quantity: 1 }]) },
    { posting_number: 'P2', status: 'delivered', created_at: '2026-10-20T00:00:00Z', items_json: JSON.stringify([{ offer_id: 'A', quantity: 3 }]) },
    { posting_number: 'P3', status: 'delivered', created_at: '2026-08-01T00:00:00Z', items_json: JSON.stringify([{ offer_id: 'A', quantity: 9 }]) },
  ];
  const sold = extractSoldFromPostings(postings, { since: '2026-10-10T00:00:00Z' });
  assert.equal(sold.get('A'), 5);
  assert.equal(sold.get('B'), 1);
});

test('computeRestockPlan flags P0 when days of cover below lead time', () => {
  const plan = computeRestockPlan({
    available: 10,
    sold30: 60,
    leadTimeDays: 14,
    safetyDays: 14,
    packSize: 5,
  });
  assert.equal(plan.velocity, 2);
  assert.equal(plan.daysOfCover, 5);
  assert.equal(plan.suggestedQty, 50); // ceil(2*(14+14) - 10) = 46 → 50（按 5 的倍数）
  assert.equal(plan.urgency, 'P0');
});

test('computeRestockPlan returns idleness for stale/zero sales', () => {
  const plan = computeRestockPlan({ available: 100, sold30: 0, leadTimeDays: 14, safetyDays: 14 });
  assert.equal(plan.velocity, 0);
  assert.equal(plan.daysOfCover, null);
  assert.equal(plan.suggestedQty, 0);
  assert.equal(plan.urgency, 'P2');
});

test('computeSkuMargins joins latest price/cost and flags missing cost as HOLD', () => {
  const handle = openDb();
  handle.migrate();
  try {
    handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (1,'A',11,'Лопатка',0)").run();
    handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (2,'B',12,'Без себестоимости',0)").run();
    handle.db.prepare("INSERT INTO prices (sku, offer_id, price_cny, currency_code, captured_at) VALUES (11,'A',119, 'CNY','2026-11-06')").run();
    handle.db.prepare("INSERT INTO prices (sku, offer_id, price_cny, currency_code, captured_at) VALUES (12,'B',50, 'CNY','2026-11-06')").run();
    handle.db.prepare("INSERT INTO sku_costs (offer_id, purchase_cny, domestic_freight_cny, packaging_cny, weight_g, dims_cm, updated_at) VALUES ('A',25,5,2,300,'20x10x5','2026-11-06')").run();
    const rows = computeSkuMargins({ db: handle, fxRubPerCny: 12.257 });
    const a = rows.find((row) => row.offerId === 'A');
    const b = rows.find((row) => row.offerId === 'B');
    assert.ok(a.contributionCny > 0);
    assert.ok(typeof a.contributionRate === 'number');
    assert.equal(a.status, 'OK');
    assert.equal(b.status, 'HOLD');
    assert.ok(b.gaps.includes('cost_missing'));
  } finally {
    handle.close();
  }
});

test('setSkuCost upserts and validates weight/purchase', async () => {
  const { setSkuCost, listSkuCosts } = await import('../src/ops/costs.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    setSkuCost({ db: handle, offerId: 'A', purchaseCny: 25, domesticFreightCny: 5, weightG: 300, dimsCm: '20x10x5' });
    setSkuCost({ db: handle, offerId: 'A', purchaseCny: 26, weightG: 310 });
    const rows = listSkuCosts({ db: handle });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].purchase_cny, 26);
    assert.equal(rows[0].dims_cm, '20x10x5');
    assert.throws(() => setSkuCost({ db: handle, offerId: 'B', purchaseCny: -1, weightG: 100 }), /purchaseCny/);
    assert.throws(() => setSkuCost({ db: handle, offerId: 'B', purchaseCny: 1, weightG: 0 }), /weightG/);
    assert.throws(() => setSkuCost({ db: handle, offerId: 'B', purchaseCny: 1, weightG: 100, dimsCm: '1x2' }), /dimsCm/);
  } finally {
    handle.close();
  }
});
