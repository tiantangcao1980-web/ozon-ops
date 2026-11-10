import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPerformanceClient, hasPerformanceCredentials } from '../src/ads/performance.mjs';
import { runAdsSync, computeAcosAlerts } from '../src/ads/sync.mjs';
import { openDb } from '../src/db.mjs';

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} });
    const next = responses.shift();
    return {
      ok: next.status < 400,
      status: next.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(next.body ?? {}),
    };
  };
  return { impl, calls };
}

test('hasPerformanceCredentials detects missing credentials', () => {
  assert.equal(hasPerformanceCredentials({}), false);
  assert.equal(hasPerformanceCredentials({ OZON_PERF_CLIENT_ID: 'a', OZON_PERF_CLIENT_SECRET: 'b' }), true);
});

test('createPerformanceClient exchanges credentials for a bearer token', async () => {
  const { impl, calls } = fakeFetch([
    { status: 200, body: { access_token: 'tok_1', expires_in: 1800 } },
    { status: 200, body: { result: [{ id: 1, title: 'camp' }] } },
  ]);
  const client = createPerformanceClient({ clientId: 'cid', clientSecret: 'sec', fetchImpl: impl });
  const result = await client.get('/api/client/campaign');
  assert.deepEqual(result.json, { result: [{ id: 1, title: 'camp' }] });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /api-performance\.ozon\.ru\/api\/client\/token$/);
  assert.equal(calls[0].body.grant_type, 'client_credentials');
  assert.match(calls[1].url, /\/api\/client\/campaign$/);
  assert.equal(calls[1].headers.Authorization, 'Bearer tok_1');
});

test('runAdsSync reports NO_CREDENTIALS without calling the API', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const result = await runAdsSync({ db: handle, env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NO_CREDENTIALS');
    assert.match(result.hint, /OZON_PERF_CLIENT_ID/);
  } finally {
    handle.close();
  }
});

test('computeAcosAlerts flags campaigns above threshold', () => {
  const alerts = computeAcosAlerts([
    { campaignId: 'c1', spendRub: 500, revenueRub: 1000 },
    { campaignId: 'c2', spendRub: 100, revenueRub: 2000 },
  ], { threshold: 0.3 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].campaignId, 'c1');
  assert.equal(alerts[0].acos, 0.5);
});
