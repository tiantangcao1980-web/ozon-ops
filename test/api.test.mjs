import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApi, ApiError } from '../src/api.mjs';

function jsonResponse(status, payload, headers = {}) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => text,
  };
}

function makeApi(responses, { audit = [], sleeps = [] } = {}) {
  let index = 0;
  const fetchImpl = async () => {
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof next === 'function' ? next() : next;
  };
  const api = createApi({
    clientId: '1234567',
    apiKey: 'secret-api-key-value',
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 1000,
    audit: (row) => audit.push(row),
  });
  return { api, audit, sleeps, calls: () => index };
}

test('retries 429 with Retry-After seconds then succeeds', async () => {
  const { api, audit, sleeps, calls } = makeApi([
    jsonResponse(429, { code: 8, message: 'ResourceExhausted' }, { 'retry-after': '1' }),
    jsonResponse(200, { ok: true }),
  ]);

  const result = await api.call('/v1/seller/info', {});

  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.deepEqual(result.json, { ok: true });
  assert.equal(result.fromCache, false);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(calls(), 2);
  assert.equal(audit.length, 2);
  assert.equal(audit[0].status, 429);
  assert.equal(audit[1].status, 200);
});

test('retries 5xx with linear backoff and surfaces the last error', async () => {
  const { api, sleeps } = makeApi([
    jsonResponse(503, { code: 13, message: 'unavailable' }),
    jsonResponse(500, { code: 13, message: 'boom' }),
    jsonResponse(400, { code: 3, message: 'Request validation error' }),
  ]);

  await assert.rejects(
    () => api.call('/v1/analytics/data', { date_from: '2026-09-01' }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, 'Request validation error');
      assert.ok(!JSON.stringify(error).includes('secret-api-key-value'));
      return true;
    },
  );
  assert.deepEqual(sleeps, [1500, 3000]);
});

test('caches responses while ttlMs is positive', async () => {
  const { api, calls } = makeApi([jsonResponse(200, { items: [1, 2] })]);
  const first = await api.call('/v5/product/info/prices', { filter: { visibility: 'ALL' } }, { ttlMs: 60_000 });
  const second = await api.call('/v5/product/info/prices', { filter: { visibility: 'ALL' } }, { ttlMs: 60_000 });

  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.deepEqual(second.json, first.json);
  assert.equal(calls(), 1);
});

test('throws ApiError with grpc code and status for non-retryable failures', async () => {
  const { api } = makeApi([jsonResponse(403, { code: 7, message: 'Method available with Premium Pro subscription' })]);
  await assert.rejects(
    () => api.call('/v1/search-queries/top', { limit: '10' }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 7);
      assert.match(error.message, /Premium Pro/);
      return true;
    },
  );
});
