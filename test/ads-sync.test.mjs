import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAdsSync } from '../src/ads/sync.mjs';
import { openDb } from '../src/db.mjs';

test('runAdsSync does not fabricate daily rows from the campaign list', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const responses = [
      { status: 200, body: { access_token: 't', expires_in: 1800 } },
      { status: 200, body: { result: [{ id: 'c1', title: 'camp' }] } },
    ];
    const fetchImpl = async () => {
      const next = responses.shift();
      return { ok: next.status < 400, status: next.status, text: async () => JSON.stringify(next.body), headers: { get: () => null } };
    };
    const result = await runAdsSync({ db: handle, env: { OZON_PERF_CLIENT_ID: 'a', OZON_PERF_CLIENT_SECRET: 'b' }, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.campaigns, 1);
    assert.equal(result.stored, 0);
    assert.match(result.note ?? '', /daily stats/);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM ads_daily').get().n, 0);
  } finally {
    handle.close();
  }
});

test('runAdsSync reports HTTP failure instead of ok:true', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const responses = [
      { status: 200, body: { access_token: 't', expires_in: 1800 } },
      { status: 401, body: { message: 'unauthorized' } },
    ];
    const fetchImpl = async () => {
      const next = responses.shift();
      return { ok: next.status < 400, status: next.status, text: async () => JSON.stringify(next.body), headers: { get: () => null } };
    };
    const result = await runAdsSync({ db: handle, env: { OZON_PERF_CLIENT_ID: 'a', OZON_PERF_CLIENT_SECRET: 'b' }, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'HTTP_ERROR');
    assert.equal(result.status, 401);
  } finally {
    handle.close();
  }
});
