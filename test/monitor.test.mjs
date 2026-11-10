import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMonitorState, renderMonitorHtml } from '../src/render/monitor.mjs';
import { openDb } from '../src/db.mjs';

function seed(handle) {
  handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (1,'A',11,'Лопатка',0)").run();
  handle.db.prepare("INSERT INTO stocks (sku, warehouse_id, present, reserved, captured_at) VALUES (11,0,0,0,'2026-11-09')").run();
  handle.db.prepare("INSERT INTO postings (posting_number, status, created_at, shipment_date, amount_total, amount_currency, pending_shipment) VALUES ('P1','awaiting_deliver','2026-11-09T00:00:00Z','2026-11-10T00:00:00Z',100,'CNY',1)").run();
  handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub, currency) VALUES ('2026-11-08','',5,500,'RUB')").run();
  handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub, currency) VALUES ('2026-11-09','',7,700,'RUB')").run();
  handle.db.prepare("INSERT INTO fx_rates (date, rub_per_cny, source, captured_at) VALUES ('2026-11-09',12.3,'CBR','2026-11-09T00:00:00Z')").run();
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, captured_at) VALUES ('9001','лопатка',1000,'2026-11-01')").run();
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, captured_at) VALUES ('9001','лопатка',860,'2026-11-09')").run();
  handle.db.prepare("INSERT INTO competitors (sku, title, keyword, price_rub) VALUES ('9001','Лопатка конкурент','лопатка',860)").run();
  handle.db.prepare("INSERT INTO api_calls (path, status, called_at) VALUES ('/v1/test', 200, '2026-11-09T01:00:00Z')").run();
}

test('buildMonitorState returns kpis, alerts, timeline, movers and freshness', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const state = buildMonitorState({ db: handle, now: () => new Date('2026-11-09T02:00:00Z') });
    assert.ok(state.kpis.units7 >= 12);
    assert.ok(state.kpis.revenue7 >= 1200);
    assert.equal(state.kpis.pendingShipments, 1);
    assert.equal(state.kpis.productsActive, 1);
    assert.equal(state.kpis.competitors, 1);
    assert.ok(Array.isArray(state.alerts));
    assert.ok(state.alerts.some((alert) => alert.type === 'stockout'));
    assert.ok(state.timeline.length >= 2);
    assert.equal(state.movers[0].sku, '9001');
    assert.ok(typeof state.movers[0].change === 'number');
    assert.equal(state.store.fx.rubPerCny, 12.3);
    assert.ok(state.freshness.lastApiCall.startsWith('2026-11-09'));
  } finally {
    handle.close();
  }
});

test('renderMonitorHtml is a self-contained dark dashboard with live polling', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const state = buildMonitorState({ db: handle, now: () => new Date('2026-11-09T02:00:00Z') });
    const html = renderMonitorHtml(state);
    assert.match(html, /<html/);
    assert.match(html, /OZON Monitor/);
    assert.match(html, /\/api\/state/);
    assert.match(html, /预警|Alerts/);
    assert.match(html, /竞品|Movers/);
    assert.match(html, /<svg/);
    assert.ok(!/<script src=/i.test(html), 'no external scripts');
    assert.ok(!/<link[^>]+href="http/i.test(html), 'no external stylesheets');
  } finally {
    handle.close();
  }
});

test('monitor html prefers SSE with polling fallback', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const state = buildMonitorState({ db: handle, now: () => new Date('2026-11-09T02:00:00Z') });
    const html = renderMonitorHtml(state);
    assert.match(html, /EventSource\(/);
    assert.match(html, /\/events/);
    assert.match(html, /readyState === 2/);
  } finally {
    handle.close();
  }
});
