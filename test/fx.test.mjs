import { test } from 'node:test';
import assert from 'node:assert/strict';


test('syncFx rejects reversed or absurd rates and falls through sources', async () => {
  const { syncFx, isSaneFx } = await import('../src/pull/fx.mjs');
  const { openDb } = await import('../src/db.mjs');
  assert.equal(isSaneFx(12.257), true);
  assert.equal(isSaneFx(0.08), false);
  assert.equal(isSaneFx(500), false);
  const handle = openDb();
  handle.migrate();
  try {
    const responses = [
      { ok: true, status: 200, text: async () => '<Valute><CharCode>CNY</CharCode><Nominal>1</Nominal><Value>0,0815</Value></Valute>' },
      { ok: true, status: 200, text: async () => JSON.stringify({ rates: { RUB: 12.257 } }) },
    ];
    const result = await syncFx({ db: handle, fetchImpl: async () => responses.shift(), today: new Date('2026-11-06T00:00:00Z') });
    assert.equal(result.source, 'open.er-api.com');
    assert.equal(result.rubPerCny, 12.257);
    const row = handle.db.prepare('SELECT rub_per_cny FROM fx_rates WHERE date = ?').get('2026-11-06');
    assert.equal(row.rub_per_cny, 12.257);
  } finally {
    handle.close();
  }
});

test('syncFx throws when every source is out of range', async () => {
  const { syncFx } = await import('../src/pull/fx.mjs');
  const { openDb } = await import('../src/db.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    const responses = [
      { ok: true, status: 200, text: async () => '<Valute><CharCode>CNY</CharCode><Nominal>1</Nominal><Value>0,08</Value></Valute>' },
      { ok: true, status: 200, text: async () => JSON.stringify({ rates: { RUB: 0.08 } }) },
    ];
    await assert.rejects(() => syncFx({ db: handle, fetchImpl: async () => responses.shift() }), /汇率同步失败/);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM fx_rates').get().n, 0);
  } finally {
    handle.close();
  }
});
