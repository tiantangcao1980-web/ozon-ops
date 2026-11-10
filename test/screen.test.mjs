import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/db.mjs';
import { buildScreenState, renderScreenHtml, CORRIDOR_NODES, INTEL_CATEGORIES, RISK_COMPONENTS } from '../src/render/screen.mjs';
import { ingestIntel } from '../src/intel/ingest.mjs';

function seed(handle) {
  handle.db.prepare("INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (1,'A',11,'Лопатка',0)").run();
  handle.db.prepare("INSERT INTO stocks (sku, warehouse_id, present, reserved, captured_at) VALUES (11,0,2,1,'2026-11-09')").run();
  handle.db.prepare("INSERT INTO postings (posting_number, status, created_at, shipment_date, pending_shipment) VALUES ('P1','awaiting_deliver','2026-11-02T00:00:00Z','2026-11-03T00:00:00Z',1)").run();
  handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub, hits_view, currency) VALUES ('2026-11-03','',5,500,100,'RUB')").run();
  handle.db.prepare("INSERT INTO analytics_daily (date, sku, ordered_units, revenue_rub, hits_view, currency) VALUES ('2026-11-09','',8,800,150,'RUB')").run();
  handle.db.prepare("INSERT INTO fx_rates (date, rub_per_cny, source, captured_at) VALUES ('2026-11-09',12.3,'CBR','2026-11-09T00:00:00Z')").run();
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, captured_at) VALUES ('9001','лопатка',1000,'2026-11-01')").run();
  handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, captured_at) VALUES ('9001','лопатка',860,'2026-11-09')").run();
  handle.db.prepare("INSERT INTO competitors (sku, title, keyword, price_rub) VALUES ('9001','Лопатка конкурент','лопатка',860)").run();
  handle.db.prepare("INSERT INTO reviews_raw (review_id, sku, rating, text, published_at, captured_at) VALUES ('R1','11',2,'Неудобно','2026-11-09T00:00:00Z','2026-11-09T00:00:00Z')").run();
  handle.db.prepare("INSERT INTO api_calls (path, status, called_at) VALUES ('/v1/test', 200, '2026-11-09T01:00:00Z')").run();
}

const NOW = () => new Date('2026-11-09T02:00:00Z');

test('buildScreenState exposes kpis, risk, intel, corridor, quotes, coverage, ticker', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const state = buildScreenState({ db: handle, now: NOW });
    assert.equal(state.demo, false);
    assert.ok(state.kpis.units7 >= 8);
    assert.ok(state.kpis.revenue7 >= 800);
    assert.equal(state.kpis.pending, 1);
    assert.equal(state.kpis.activeSkus, 1);
    assert.equal(state.kpis.stockRisk, 1);
    assert.ok(state.risk.score >= 0 && state.risk.score <= 100);
    assert.equal(state.risk.components.length, RISK_COMPONENTS.length);
    assert.equal(state.intel.items.length > 0, true);
    assert.equal(state.intel.categories.length, INTEL_CATEGORIES.length);
    assert.ok(state.intel.items.some((item) => item.category === 'voice'));
    assert.ok(state.intel.items.some((item) => item.category === 'competition'));
    assert.equal(state.corridor.nodes.length, CORRIDOR_NODES.length);
    assert.ok(state.corridor.routes.length > 0);
    assert.ok(state.quotes.some((quote) => quote.symbol === 'CNYRUB'));
    assert.equal(state.trend.length, 30);
    assert.ok(state.coverage.sources.length >= 6);
    assert.ok(Array.isArray(state.ticker) && state.ticker.length > 3);
    assert.equal(state.store.fx.rubPerCny, 12.3);
  } finally {
    handle.close();
  }
});

test('buildScreenState demo mode is deterministic and labelled', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const first = buildScreenState({ db: handle, now: NOW, demo: true });
    const second = buildScreenState({ db: handle, now: NOW, demo: true });
    assert.equal(first.demo, true);
    assert.deepEqual(first.trend, second.trend);
    assert.ok(first.kpis.units7 > 0);
    assert.ok(first.risk.components.every((component) => component.value >= 0 && component.value <= 100));
    assert.equal(first.intel.items.length >= 9, true);
  } finally {
    handle.close();
  }
});

test('renderScreenHtml is a self-contained 1920x1080 big screen without external assets', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const state = buildScreenState({ db: handle, now: NOW });
    const html = renderScreenHtml(state);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /OZON/);
    assert.match(html, /width:1920px/);
    assert.match(html, /height:1080px/);
    assert.match(html, /\/api\/state/);
    assert.match(html, /EventSource\(/);
    assert.match(html, /<svg class="map"/);
    assert.match(html, /情报流|Intel Feed/);
    assert.match(html, /风险|Risk/);
    assert.match(html, /中俄物流节点|Corridor/);
    assert.ok(!/<script src=/i.test(html), 'no external scripts');
    assert.ok(!/<link[^>]+href="http/i.test(html), 'no external stylesheets');
    assert.ok(!/https?:\/\/cdn\./i.test(html), 'no CDN references');
  } finally {
    handle.close();
  }
});

test('screen state json stays serializable for the API route', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    const state = buildScreenState({ db: handle, now: NOW });
    const json = JSON.stringify(state);
    assert.ok(json.length > 1000);
    const parsed = JSON.parse(json);
    assert.equal(parsed.version, 'screen-v1');
    assert.ok(!/<script/i.test(json));
  } finally {
    handle.close();
  }
});

test('screen prefers the cleaned intel pipeline once populated and shows pipeline stats', () => {
  const handle = openDb();
  handle.migrate();
  try {
    seed(handle);
    ingestIntel({
      db: handle,
      now: NOW,
      items: [
        { title: 'Ozon открыл новый склад в Новосибирске', url: 'https://ozon.ru/news/101', source: 'RSS', category: 'market', publishedAt: '2026-11-09T00:30:00Z' },
        { title: 'Скидка 90% промокод купить сейчас', source: 'RSS', category: 'market' },
      ],
    });
    const state = buildScreenState({ db: handle, now: NOW });
    assert.equal(state.intel.source, 'pipeline');
    assert.ok(state.intel.items.some((item) => item.title.includes('Новосибирске')));
    assert.ok(!state.intel.items.some((item) => item.title.includes('промокод')));
    assert.ok(state.pipeline.total >= 1);
    assert.ok(state.coverage.sources.some((source) => source.key === 'intel'));
    const html = renderScreenHtml(state);
    assert.match(html, /情报管道/);
  } finally {
    handle.close();
  }
});
