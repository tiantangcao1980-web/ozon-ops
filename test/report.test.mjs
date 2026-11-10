import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeAlerts } from '../src/rules/alerts.mjs';
import { openDb } from '../src/db.mjs';
import { renderDailyReport, renderDashboardHtml } from '../src/render/report.mjs';

function seed(handle) {
  handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (1,'A',11,'Лопатка',0)").run();
  handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (2,'B',12,'Архив',1)").run();
  handle.db.prepare("INSERT INTO stocks (sku, warehouse_id, present, reserved, captured_at) VALUES (11,0,0,0,'2026-11-06')").run();
  handle.db.prepare("INSERT INTO postings (posting_number, status, shipment_date) VALUES ('P1','awaiting_deliver','2026-11-06T01:00:00Z')").run();
  handle.db.prepare("INSERT INTO postings (posting_number, status, shipment_date) VALUES ('P2','delivered','2026-11-01T01:00:00Z')").run();
  handle.db.prepare("INSERT INTO prices (sku, offer_id, price_cny, price_index_color, captured_at) VALUES (11,'A',120,'YELLOW','2026-11-06')").run();
  handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub, returns) VALUES ('2026-11-05','',10,1000,3)").run();
}

test('computeAlerts flags stockout, pending shipment, price index and return rate', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const alerts = computeAlerts({
      db: handle,
      now: () => new Date('2026-11-06T02:00:00Z'),
      thresholds: { pendingHours: 12, returnRate: 0.15 },
    });
    const types = alerts.map((alert) => alert.type);
    assert.ok(types.includes('stockout'), types.join(','));
    assert.ok(types.includes('pending_shipment'));
    assert.ok(types.includes('price_index'));
    assert.ok(types.includes('return_rate'));
    assert.ok(alerts.every((alert) => ['P0', 'P1', 'P2'].includes(alert.severity)));
    const stockout = alerts.find((alert) => alert.type === 'stockout');
    assert.equal(stockout.severity, 'P0');
  } finally {
    handle.close();
  }
});

test('computeAlerts ignores archived products and delivered postings', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const alerts = computeAlerts({ db: handle, now: () => new Date('2026-11-06T02:00:00Z') });
    assert.ok(!alerts.some((alert) => String(alert.message).includes('Архив')));
    assert.ok(!alerts.some((alert) => String(alert.message).includes('P2')));
  } finally {
    handle.close();
  }
});

test('renderDailyReport includes yesterday metrics, alerts and todo', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const alerts = computeAlerts({ db: handle, now: () => new Date('2026-11-06T02:00:00Z') });
    const report = renderDailyReport({
      db: handle,
      date: '2026-11-06',
      alerts,
      fx: { rubPerCny: 12.257, date: '2026-11-06' },
    });
    assert.match(report, /日报/);
    assert.match(report, /下单件数/);
    assert.match(report, /RUB/);
    assert.match(report, /库存/);
    assert.match(report, /待办/);
    assert.match(report, /stockout|断货/);
  } finally {
    handle.close();
  }
});

test('renderDashboardHtml is a self-contained html with inline svg', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const alerts = computeAlerts({ db: handle, now: () => new Date('2026-11-06T02:00:00Z') });
    const html = renderDashboardHtml({ db: handle, date: '2026-11-06', alerts, fx: { rubPerCny: 12.257, date: '2026-11-06' } });
    assert.match(html, /<html/);
    assert.match(html, /<svg/);
    assert.ok(!/<script src=/i.test(html), 'no external scripts');
    assert.match(html, /断货|stockout/);
  } finally {
    handle.close();
  }
});

test('renderWeeklyReport compares this week with last week', async () => {
  const { renderWeeklyReport } = await import('../src/render/report.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub) VALUES ('2026-11-05','',10,1000)").run();
    handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub) VALUES ('2026-11-01','',4,400)").run();
    handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub) VALUES ('2026-10-28','',5,500)").run();
    handle.db.prepare("INSERT INTO candidates (niche, verdict, created_at) VALUES ('厨房硅胶小工具','TRY','2026-11-05')").run();
    handle.db.prepare("INSERT INTO candidates (niche, verdict, created_at) VALUES ('宠物梳子','HOLD','2026-11-05')").run();
    const report = renderWeeklyReport({ db: handle, date: '2026-11-06', alerts: [], fx: { rubPerCny: 12.257, date: '2026-11-06' } });
    assert.match(report, /周报/);
    assert.match(report, /本周/);
    assert.match(report, /上周/);
    assert.match(report, /1,400|1400/);
    assert.match(report, /TRY 1/);
    assert.match(report, /HOLD 1/);
  } finally {
    handle.close();
  }
});
