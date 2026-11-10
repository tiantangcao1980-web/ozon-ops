import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAdsCsv, importAds } from '../src/ads/import.mjs';
import { computeAcosAlerts, suggestBudgetChanges } from '../src/ads/rules.mjs';
import { renderAdsReport } from '../src/ads/report.mjs';
import { openDb } from '../src/db.mjs';

const CSV = `campaign_id;date;impressions;clicks;spend_rub;orders;revenue_rub
c1;2026-11-05;10000;200;1500;10;4000
c2;2026-11-05;5000;50;800;1;900
`;

test('parseAdsCsv reads semicolon csv and maps columns', () => {
  const { rows } = parseAdsCsv(CSV);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    campaignId: 'c1',
    date: '2026-11-05',
    impressions: 10000,
    clicks: 200,
    spendRub: 1500,
    orders: 10,
    revenueRub: 4000,
  });
  assert.equal(rows[1].campaignId, 'c2');
});

test('parseAdsCsv supports ru/en header aliases and comma separator', () => {
  const csv = 'Кампания,Дата,Показы,Клики,Расход,Заказы,Выручка\nc9,2026-11-04,100,10,50,1,500\n';
  const { rows } = parseAdsCsv(csv);
  assert.equal(rows[0].campaignId, 'c9');
  assert.equal(rows[0].spendRub, 50);
});

test('importAds upserts rows into ads_daily', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const first = importAds({ db: handle, csv: CSV });
    const second = importAds({ db: handle, csv: CSV });
    assert.equal(first.rows, 2);
    assert.equal(second.rows, 2);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM ads_daily').get().n, 2);
    const row = handle.db.prepare("SELECT spend_rub, revenue_rub FROM ads_daily WHERE campaign_id = 'c1'").get();
    assert.equal(row.spend_rub, 1500);
    assert.equal(row.revenue_rub, 4000);
  } finally {
    handle.close();
  }
});

test('computeAcosAlerts flags only campaigns above threshold', () => {
  const alerts = computeAcosAlerts(
    [
      { campaignId: 'c1', spendRub: 1500, revenueRub: 6000 },
      { campaignId: 'c2', spendRub: 800, revenueRub: 900 },
    ],
    { threshold: 0.3 },
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].campaignId, 'c2');
  assert.ok(Math.abs(alerts[0].acos - 0.89) < 0.01);
});

test('suggestBudgetChanges reduces losing campaigns and scales winners', () => {
  const suggestions = suggestBudgetChanges(
    [
      { campaignId: 'winner', spendRub: 1000, revenueRub: 6000 },
      { campaignId: 'loser', spendRub: 900, revenueRub: 1000 },
      { campaignId: 'nodata', spendRub: 0, revenueRub: 0 },
    ],
    { targetAcos: 0.25, maxIncreasePct: 0.3 },
  );
  const byId = Object.fromEntries(suggestions.map((item) => [item.campaignId, item]));
  assert.equal(byId.winner.action, 'increase');
  assert.equal(byId.loser.action, 'decrease');
  assert.equal(byId.nodata.action, 'keep');
  assert.match(byId.loser.reason, /ACOS/);
});

test('renderAdsReport includes totals, acos and suggestions', () => {
  const markdown = renderAdsReport({
    date: '2026-11-06',
    rows: [
      { campaignId: 'c1', spendRub: 1500, revenueRub: 4000 },
      { campaignId: 'c2', spendRub: 800, revenueRub: 900 },
    ],
    alerts: computeAcosAlerts([{ campaignId: 'c2', spendRub: 800, revenueRub: 900 }]),
    suggestions: suggestBudgetChanges([{ campaignId: 'c2', spendRub: 800, revenueRub: 900 }]),
  });
  assert.match(markdown, /广告/);
  assert.match(markdown, /ACOS/);
  assert.match(markdown, /c2/);
});

test('aggregateByCampaign sums daily rows per campaign', async () => {
  const { aggregateByCampaign } = await import('../src/ads/rules.mjs');
  const rows = aggregateByCampaign([
    { campaignId: 'c1', spendRub: 100, revenueRub: 300, clicks: 10, impressions: 100, orders: 1 },
    { campaignId: 'c1', spendRub: 50, revenueRub: 200, clicks: 5, impressions: 50, orders: 1 },
    { campaignId: 'c2', spendRub: 80, revenueRub: 100 },
  ]);
  const c1 = rows.find((row) => row.campaignId === 'c1');
  assert.equal(c1.spendRub, 150);
  assert.equal(c1.revenueRub, 500);
  assert.equal(c1.orders, 2);
  assert.equal(rows.length, 2);
});

test('parseAmount handles ru/en thousand and decimal separators', async () => {
  const { parseAmount } = await import('../src/ads/import.mjs');
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1234.56'), 1234.56);
  assert.equal(parseAmount('1 500'), 1500);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('')));
});

test('parseAdsCsv reports issues instead of silently zeroing bad amounts', async () => {
  const { parseAdsCsv } = await import('../src/ads/import.mjs');
  const csv = 'campaign_id;date;spend_rub;revenue_rub\nc1;2026-11-05;1 234,56;abc\nc2;not-a-date;100;200\n';
  const { rows, issues } = parseAdsCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].spendRub, 1234.56);
  assert.equal(rows[0].revenueRub, 0);
  assert.ok(issues.some((issue) => issue.reason === 'BAD_AMOUNT'));
  assert.ok(issues.some((issue) => issue.reason === 'BAD_DATE'));
});
