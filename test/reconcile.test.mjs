import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconcileMonth, formatReconcile } from '../src/commands/reconcile.mjs';
import { openDb } from '../src/db.mjs';

function dbWithRevenue(entries) {
  const handle = openDb();
  handle.migrate();
  for (const [date, revenue] of entries) {
    handle.db
      .prepare('INSERT INTO analytics_daily (date, sku, revenue_rub) VALUES (?, ?, ?)')
      .run(date, '', revenue);
  }
  return handle;
}

function balanceApi(revenue) {
  return {
    call: async () => ({
      ok: true,
      status: 200,
      json: { cashflows: { sales: { amount_details: { revenue: { value: revenue, currency_code: 'RUB' } } } } },
    }),
  };
}

test('reconcileMonth returns FACT_RUB when analytics matches settled revenue', async () => {
  const handle = dbWithRevenue([['2026-09-01', 100], ['2026-09-02', 80]]);
  try {
    const result = await reconcileMonth({ api: balanceApi(172.8), db: handle, month: '2026-09' });
    assert.equal(result.verdict, 'FACT_RUB');
    assert.equal(result.analyticsRub, 180);
    assert.equal(result.financeRub, 172.8);
  } finally {
    handle.close();
  }
});

test('reconcileMonth distinguishes ordered GMV from settled revenue', async () => {
  const handle = dbWithRevenue([['2026-09-01', 4379.63]]);
  try {
    const result = await reconcileMonth({ api: balanceApi(1545.82), db: handle, month: '2026-09' });
    assert.equal(result.verdict, 'RUB_GMV_VS_SETTLED');
    assert.match(result.note, /下单口径|结算/);
  } finally {
    handle.close();
  }
});

test('flags a currency mismatch instead of claiming both sides are RUB', async () => {
  const handle = dbWithRevenue([['2026-09-01', 4792.34]]);
  try {
    const api = {
      call: async () => ({
        ok: true,
        json: { cashflows: { sales: { amount_details: { revenue: { value: 630.5, currency_code: 'CNY' } } } } },
      }),
    };
    const result = await reconcileMonth({ api, db: handle, month: '2026-09' });
    assert.equal(result.verdict, 'CURRENCY_MISMATCH');
    assert.equal(result.analyticsCurrency, 'RUB');
    assert.equal(result.financeCurrency, 'CNY');
    assert.ok(!result.note.includes('两侧都是 RUB'));
  } finally {
    handle.close();
  }
});

test('formatReconcile labels analytics amounts as RUB explicitly', async () => {
  const handle = dbWithRevenue([['2026-09-01', 100]]);
  try {
    const api = { call: async () => ({ ok: true, json: { cashflows: { sales: { amount_details: { revenue: { value: 98, currency_code: 'RUB' } } } } } }) };
    const result = await reconcileMonth({ api, db: handle, month: '2026-09' });
    const text = formatReconcile(result);
    assert.match(text, /analytics 下单口径：100\.00 RUB/);
    assert.match(text, /finance 结算口径：98\.00 RUB/);
  } finally {
    handle.close();
  }
});
