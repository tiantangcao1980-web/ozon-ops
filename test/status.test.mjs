import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runStatus } from '../src/commands/status.mjs';

function fakeApi(handler) {
  return {
    call: async (path, body) => handler(path, body),
  };
}

const HANDLER = (path, body) => {
  if (path === '/v1/seller/info') {
    return {
      ok: true,
      json: {
        company: { name: 'Demo Store', currency: 'CNY', country: 'CHN' },
        subscription: { is_premium: false, type: 'UNSPECIFIED' },
      },
    };
  }
  if (path === '/v1/roles') {
    return { ok: true, json: { roles: [{ name: 'Admin' }, { name: 'ReadOnly' }] } };
  }
  if (path === '/v3/product/list') {
    const total = body.filter.visibility === 'ARCHIVED' ? 5 : 0;
    return { ok: true, json: { result: { items: [], total, total_items: total } } };
  }
  if (path === '/v2/warehouse/list') {
    return { ok: true, json: { warehouses: [{ warehouse_id: 1, name: 'main-warehouse' }] } };
  }
  throw new Error(`unexpected path ${path}`);
};

test('runStatus renders the store summary without leaking credentials', async () => {
  const output = await runStatus({
    config: { maskedClientId: '1234***' },
    api: fakeApi(HANDLER),
  });

  assert.match(output, /Demo Store/);
  assert.match(output, /Premium: 否/);
  assert.match(output, /商品: 0 在售 \/ 5 归档/);
  assert.match(output, /仓库: 1/);
  assert.match(output, /角色: Admin, ReadOnly/);
  assert.match(output, /Client-Id: 1234\*\*\*/);
  assert.ok(!output.includes('1234567'));
  assert.ok(!output.includes('secret-api-key-value'));
});

test('runStatus marks premium subscriptions', async () => {
  const output = await runStatus({
    config: { maskedClientId: '1234***' },
    api: fakeApi((path, body) => {
      if (path === '/v1/seller/info') {
        return { ok: true, json: { company: { name: 'X', currency: 'CNY' }, subscription: { is_premium: true } } };
      }
      return HANDLER(path, body);
    }),
  });
  assert.match(output, /Premium: 是/);
});
