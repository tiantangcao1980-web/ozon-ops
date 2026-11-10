import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chunkDateRange, pullAnalytics } from '../src/pull/analytics.mjs';
import { syncFx, parseCbrXml } from '../src/pull/fx.mjs';
import { openDb } from '../src/db.mjs';

test('chunkDateRange splits into contiguous windows of at most 31 days', () => {
  const chunks = chunkDateRange('2026-09-01', '2026-10-31', 31);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], { from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual(chunks[1], { from: '2026-10-02', to: '2026-10-31' });
  for (const chunk of chunks) {
    const days = (Date.parse(chunk.to) - Date.parse(chunk.from)) / 86_400_000 + 1;
    assert.ok(days <= 31, `chunk ${chunk.from}..${chunk.to} is ${days} days`);
  }
});

test('pullAnalytics writes revenue_rub rows for every chunk', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const calls = [];
    const api = {
      call: async (path, body) => {
        calls.push({ path, body });
        return {
          ok: true,
          status: 200,
          json: {
            result: {
              data: [
                {
                  dimensions: [{ id: `${body.date_from}`, name: '' }],
                  metrics: [1, 103.3783, 0, 0, 10, 5, 3, 1, 1, 2, 0.5, 20],
                },
              ],
            },
          },
        };
      },
    };

    const result = await pullAnalytics({ api, db: handle, from: '2026-09-01', to: '2026-10-31', sleep: async () => {}, now: () => 1_000_000 });

    assert.equal(result.chunks, 2);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].body.metrics.includes('revenue'));
    const rows = handle.db.prepare('SELECT * FROM analytics_daily ORDER BY date').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].revenue_rub, 103.3783);
    assert.equal(rows[0].ordered_units, 1);
  } finally {
    handle.close();
  }
});

test('parseCbrXml converts CNY quote to rub_per_cny with comma decimals', () => {
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="06.11.2026" name="Foreign Currency Market">
  <Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>Доллар</Name><Value>82,5</Value></Valute>
  <Valute ID="R01375"><NumCode>156</NumCode><CharCode>CNY</CharCode><Nominal>10</Nominal><Name>Юань</Name><Value>112,174</Value></Valute>
</ValCurs>`;
  assert.equal(parseCbrXml(xml), 11.2174);
});

test('syncFx stores one rate per day', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const fetchImpl = async () => ({
      ok: true,
      text: async () =>
        '<ValCurs><Valute><CharCode>CNY</CharCode><Nominal>10</Nominal><Value>112,174</Value></Valute></ValCurs>',
    });
    const first = await syncFx({ db: handle, fetchImpl, today: new Date('2026-11-06T00:00:00Z') });
    const second = await syncFx({ db: handle, fetchImpl, today: new Date('2026-11-06T00:00:00Z') });
    assert.equal(first.rubPerCny, 11.2174);
    assert.equal(second.rubPerCny, 11.2174);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM fx_rates').get().n, 1);
  } finally {
    handle.close();
  }
});


test('syncFx falls back to open.er-api.com when CBR is unreachable', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      if (url.includes('cbr.ru')) throw new Error('fetch failed');
      return {
        ok: true,
        text: async () => JSON.stringify({ result: 'success', rates: { RUB: 11.31 } }),
      };
    };
    const result = await syncFx({ db: handle, fetchImpl, today: new Date('2026-11-06T00:00:00Z') });
    assert.equal(result.rubPerCny, 11.31);
    assert.equal(result.source, 'open.er-api.com');
    assert.ok(seen.some((url) => url.includes('open.er-api.com')));
    const row = handle.db.prepare('SELECT * FROM fx_rates WHERE date = ?').get('2026-11-06');
    assert.equal(row.rub_per_cny, 11.31);
  } finally {
    handle.close();
  }
});

test('pullAnalytics with bySku stores sku dimension rows', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const api = {
      call: async (path, body) => {
        assert.deepEqual(body.dimension, ['sku', 'day']);
        return {
          ok: true,
          status: 200,
          json: {
            result: {
              data: [
                { dimensions: [{ id: '111', name: 'A' }, { id: '2026-11-08', name: '' }], metrics: [2, 200, 0, 0, 5, 2, 1, 1, 0, 1, 0.2, 10] },
                { dimensions: [{ id: '222', name: 'B' }, { id: '2026-11-08', name: '' }], metrics: [1, 100, 0, 0, 3, 1, 1, 0, 1, 1, 0.1, 8] },
              ],
            },
          },
        };
      },
    };
    const result = await pullAnalytics({ api, db: handle, from: '2026-11-08', to: '2026-11-08', bySku: true, sleep: async () => {}, now: () => 1_000_000 });
    assert.equal(result.rows, 2);
    const rows = handle.db.prepare("SELECT sku, date, revenue_rub FROM analytics_daily WHERE sku != '' ORDER BY sku").all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sku, '111');
    assert.equal(rows[0].revenue_rub, 200);
    assert.equal(rows[1].sku, '222');
  } finally {
    handle.close();
  }
});
