import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG } from '../src/endpoints-catalog.mjs';
import { runProbe } from '../src/commands/probe.mjs';

test('catalog covers the endpoints the system depends on', () => {
  const paths = CATALOG.map((entry) => entry.path);
  for (const required of [
    '/v1/seller/info',
    '/v1/roles',
    '/v1/rating/summary',
    '/v2/warehouse/list',
    '/v3/product/list',
    '/v3/product/info/list',
    '/v5/product/info/prices',
    '/v4/product/info/stocks',
    '/v4/posting/fbs/list',
    '/v4/posting/fbs/unfulfilled/list',
    '/v1/analytics/data',
    '/v1/description-category/tree',
    '/v1/finance/balance',
  ]) {
    assert.ok(paths.includes(required), `catalog missing ${required}`);
  }
});

test('runProbe classifies usable, drifted and blocked endpoints', async () => {
  const statuses = {
    '/v1/seller/info': 200,
    '/v1/roles': 200,
    '/v1/rating/summary': 200,
    '/v2/warehouse/list': 200,
    '/v3/product/list': 200,
    '/v3/product/info/list': 200,
    '/v5/product/info/prices': 200,
    '/v4/product/info/stocks': 200,
    '/v4/posting/fbs/list': 200,
    '/v4/posting/fbs/unfulfilled/list': 200,
    '/v1/analytics/data': 200,
    '/v1/description-category/tree': 403,
    '/v1/finance/balance': 200,
    '/v3/posting/fbs/list': 404,
    '/v1/analytics/stocks': 400,
  };

  const api = {
    call: async (path) => {
      const status = statuses[path] ?? 404;
      if (status >= 400) {
        const error = new Error(status === 404 ? '404 page not found' : 'not available with existing subscription');
        error.status = status;
        error.code = status === 404 ? null : 7;
        throw error;
      }
      return { status, ok: true, json: { ok: true } };
    },
  };

  const writes = [];
  const result = await runProbe({
    api,
    catalog: [
      { path: '/v1/seller/info', body: {}, note: '店铺信息' },
      { path: '/v1/description-category/tree', body: { language: 'ZH_HANS' }, note: '类目树' },
      { path: '/v3/posting/fbs/list', body: {}, note: '旧版订单列表' },
      { path: '/v4/posting/fbs/list', body: { dir: 'ASC', limit: 1, offset: 0 }, note: '订单列表' },
      { path: '/v1/analytics/stocks', body: { skus: ['0'] }, note: '库存速度' },
    ],
    writeFile: async (path, content) => writes.push({ path, content }),
    now: () => '2026-11-06T00:00:00.000Z',
  });

  assert.deepEqual(result.usable, ['/v1/seller/info', '/v4/posting/fbs/list']);
  assert.deepEqual(result.drifted, ['/v3/posting/fbs/list']);
  assert.deepEqual(result.blocked, ['/v1/description-category/tree']);
  assert.deepEqual(result.needsParams, ['/v1/analytics/stocks']);
  assert.equal(writes.length, 1);
  const written = JSON.parse(writes[0].content);
  assert.deepEqual(written.usable, result.usable);
  assert.equal(written.generatedAt, '2026-11-06T00:00:00.000Z');
});
