import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pullProducts } from '../src/pull/products.mjs';
import { openDb } from '../src/db.mjs';

function fakeApi() {
  const pages = {
    ALL: [
      { items: [{ product_id: 1, offer_id: 'A', sku: 11, archived: false }, { product_id: 2, offer_id: 'B', sku: 12, archived: false }], total: 2 },
      { items: [], total: 2 },
    ],
  };
  let pageIndex = 0;
  return {
    call: async (path, body) => {
      if (path === '/v3/product/list') {
        const list = pages.ALL[Math.min(pageIndex, pages.ALL.length - 1)];
        pageIndex += 1;
        return { ok: true, status: 200, json: { result: list } };
      }
      if (path === '/v3/product/info/list') {
        return {
          ok: true,
          status: 200,
          json: {
            items: (body.product_id ?? []).map((id) => ({ id, name: `name-${id}`, category_id: 17028653 })),
          },
        };
      }
      if (path === '/v5/product/info/prices') {
        return {
          ok: true,
          status: 200,
          json: {
            items: (body.filter?.offer_id ?? []).map((offerId) => ({
              offer_id: offerId,
              price: { price: '9.8', old_price: '30', currency_code: 'CNY' },
              commissions: { sales_percent_rfbs: 12 },
              acquiring: 0.1,
              volume_weight: 0.2,
            })),
          },
        };
      }
      if (path === '/v4/product/info/stocks') {
        return { ok: true, status: 200, json: { items: [{ offer_id: 'A', stocks: [{ present: 3, reserved: 1, warehouse_id: 9 }] }] } };
      }
      throw new Error(`unexpected path ${path}`);
    },
  };
}

test('pullProducts paginates, upserts products, prices and stocks', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const api = fakeApi();
    const result = await pullProducts({ api, db: handle, pageSize: 2, now: () => '2026-11-06T00:00:00.000Z' });

    assert.equal(result.products, 2);
    assert.equal(result.pages, 3); // ALL 2 pages + ARCHIVED 1 page

    const products = handle.db.prepare('SELECT * FROM products ORDER BY product_id').all();
    assert.equal(products.length, 2);
    assert.equal(products[0].name, 'name-1');

    const price = handle.db.prepare('SELECT * FROM prices WHERE offer_id = ?').get('A');
    assert.equal(price.price_cny, 9.8);
    assert.equal(price.commission_rate, 0.12);
    assert.equal(price.currency, 'CNY');

    const stock = handle.db.prepare('SELECT * FROM stocks').all();
    assert.equal(stock.length, 1);
    assert.equal(stock[0].present, 3);
    assert.equal(stock[0].reserved, 1);
  } finally {
    handle.close();
  }
});

test('pullProducts is idempotent on re-run', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    await pullProducts({ api: fakeApi(), db: handle, pageSize: 2, now: () => '2026-11-06T00:00:00.000Z' });
    await pullProducts({ api: fakeApi(), db: handle, pageSize: 2, now: () => '2026-11-06T00:00:00.000Z' });
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM products').get().n, 2);
  } finally {
    handle.close();
  }
});
