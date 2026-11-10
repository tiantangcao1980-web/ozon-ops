import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeAlerts } from '../src/rules/alerts.mjs';
import { openDb } from '../src/db.mjs';

function seed(handle) {
  handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (1,'A',11,'Лопатка',0)").run();
  handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (2,'B',12,'无库存行',0)").run();
  // 同 SKU 多快照：旧 5 件、新 0 件 → 必须只看最新
  handle.db.prepare("INSERT INTO stocks (sku, warehouse_id, present, reserved, captured_at) VALUES (11,0,5,0,'2026-11-01')").run();
  handle.db.prepare("INSERT INTO stocks (sku, warehouse_id, present, reserved, captured_at) VALUES (11,0,0,0,'2026-11-06')").run();
  // 价格指数：旧 RED、新 GREEN → 不应告警
  handle.db.prepare("INSERT INTO prices (sku, offer_id, price_cny, price_index_color, captured_at) VALUES (11,'A',120,'RED','2026-11-01')").run();
  handle.db.prepare("INSERT INTO prices (sku, offer_id, price_cny, price_index_color, captured_at) VALUES (11,'A',120,'GREEN','2026-11-06')").run();
}

test('stockout uses the latest snapshot per sku and ignores products without stock rows', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const alerts = computeAlerts({ db: handle, now: () => new Date('2026-11-06T02:00:00Z') });
    const stockouts = alerts.filter((alert) => alert.type === 'stockout');
    assert.equal(stockouts.length, 1);
    assert.equal(stockouts[0].target, 'A');
    assert.match(stockouts[0].message, /可用 0/);
  } finally {
    handle.close();
  }
});

test('price index checks only the latest snapshot', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const alerts = computeAlerts({ db: handle, now: () => new Date('2026-11-06T02:00:00Z') });
    assert.equal(alerts.filter((alert) => alert.type === 'price_index').length, 0);
  } finally {
    handle.close();
  }
});

test('pending shipment alerts only within threshold', () => {
  const handle = openDb();
  handle.migrate();
  try {
    handle.db.prepare("INSERT INTO postings (posting_number, status, shipment_date) VALUES ('P1','awaiting_deliver','2026-11-06T03:00:00Z')").run();
    handle.db.prepare("INSERT INTO postings (posting_number, status, shipment_date) VALUES ('P2','awaiting_deliver','2026-11-20T03:00:00Z')").run();
    const alerts = computeAlerts({ db: handle, now: () => new Date('2026-11-06T02:00:00Z'), thresholds: { pendingHours: 12, returnRate: 0.15 } });
    const pending = alerts.filter((alert) => alert.type === 'pending_shipment');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].target, 'P1');
  } finally {
    handle.close();
  }
});

function seedCompetitor(handle) {
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, rating, reviews, captured_at) VALUES ('9001','лопатка',1000,4.8,10,'2026-11-01')").run();
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, rating, reviews, captured_at) VALUES ('9001','лопатка',850,4.8,10,'2026-11-06')").run();
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, rating, reviews, captured_at) VALUES ('9002','лопатка',500,4.9,5,'2026-11-01')").run();
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, rating, reviews, captured_at) VALUES ('9002','лопатка',560,4.9,5,'2026-11-06')").run();
}

test('competitor price drop raises P1 and rise raises P2', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seedCompetitor(handle);
    const alerts = computeAlerts({ db: handle, now: () => new Date('2026-11-06T02:00:00Z') });
    const drop = alerts.find((alert) => alert.type === 'competitor_price_drop');
    const rise = alerts.find((alert) => alert.type === 'competitor_price_rise');
    assert.equal(drop.severity, 'P1');
    assert.equal(drop.target, '9001');
    assert.match(drop.message, /-15/);
    assert.equal(rise.severity, 'P2');
    assert.equal(rise.target, '9002');
  } finally {
    handle.close();
  }
});
