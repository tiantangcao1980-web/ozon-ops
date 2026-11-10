import { test } from 'node:test';
import { writeFileSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';

import { openDb } from '../src/db.mjs';
import { ingestIntel, listIntel, intelStats } from '../src/intel/ingest.mjs';
import { itemsFromDb, harvestRss, itemsFromFile, parseRss } from '../src/intel/harvest.mjs';

const NOW = () => new Date('2026-11-10T12:00:00Z');

function fresh() {
  const handle = openDb();
  handle.migrate();
  return handle;
}

const GOOD = [
  { title: 'Ozon повысил комиссию для продавцов категории дом', url: 'https://www.ozon.ru/seller/news/1', source: 'RSS', category: 'market', publishedAt: '2026-11-10T10:00:00Z' },
  { title: 'Задержка поставок и рост цен на логистику Китай-Россия', url: 'https://tass.ru/economy/2', source: 'RSS', category: 'logistics', publishedAt: '2026-11-10T11:00:00Z' },
  { title: '跨境卖家本季度在 OZON 的销量大幅增长', url: 'https://example.cn/news/3', source: '抓取', category: 'market', publishedAt: '2026-11-10T09:00:00Z' },
];

test('ingestIntel cleans, scores and stores accepted items', () => {
  const handle = fresh();
  try {
    const stats = ingestIntel({ db: handle, items: GOOD, now: NOW });
    assert.equal(stats.received, 3);
    assert.equal(stats.kept, 3);
    assert.equal(stats.dropped, 0);
    const rows = listIntel({ db: handle, limit: 10 });
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.importance > 0 && row.credibility > 0));
    assert.ok(rows.some((row) => row.lang === 'ru'));
    assert.ok(rows.some((row) => row.lang === 'zh'));
    assert.equal(rows[0].importance >= rows[rows.length - 1].importance, true);
  } finally {
    handle.close();
  }
});

test('ingestIntel drops noise, exact duplicates and near duplicates', () => {
  const handle = fresh();
  try {
    ingestIntel({ db: handle, items: GOOD, now: NOW });
    const stats = ingestIntel({
      db: handle,
      items: [
        { title: 'Ozon повысил комиссию для продавцов категории дом', url: 'https://www.ozon.ru/seller/news/1?utm_source=tg', source: 'RSS' },
        { title: 'Ozon повысил комиссию для всех продавцов категории дом', url: 'https://www.ozon.ru/seller/news/9', source: 'RSS' },
        { title: 'Скидка 50% промокод купить сейчас срочно', source: 'RSS' },
        { title: 'Главная Новости', source: 'RSS' },
      ],
      now: NOW,
    });
    assert.equal(stats.kept, 0);
    assert.equal(stats.duplicates, 1, 'same canonical url is exact duplicate');
    assert.equal(stats.nearDuplicates, 1, 'similar title is near duplicate');
    assert.ok(stats.byReason.promo >= 1);
    assert.ok(stats.byReason.nav >= 1);
    assert.equal(listIntel({ db: handle, limit: 10 }).length, 3);
  } finally {
    handle.close();
  }
});

test('listIntel filters by category and language; intelStats aggregates', () => {
  const handle = fresh();
  try {
    ingestIntel({ db: handle, items: GOOD, now: NOW });
    assert.equal(listIntel({ db: handle, category: 'logistics' }).length, 1);
    assert.equal(listIntel({ db: handle, lang: 'zh' }).length, 1);
    const stats = intelStats({ db: handle, now: NOW });
    assert.equal(stats.total, 3);
    assert.equal(stats.latest24h, 3);
    assert.ok(stats.bySource.some((row) => row.key === 'RSS' && row.count === 2));
    assert.ok(stats.byLang.some((row) => row.key === 'ru'));
  } finally {
    handle.close();
  }
});

test('itemsFromDb converts local signals into raw intel items', () => {
  const handle = fresh();
  try {
    handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, captured_at) VALUES ('9001','лопатка',1000,'2026-11-01')").run();
    handle.db.prepare("INSERT INTO competitor_snapshots (sku, keyword, price_rub, captured_at) VALUES ('9001','лопатка',860,'2026-11-09')").run();
    handle.db.prepare("INSERT INTO reviews_raw (review_id, sku, rating, text, published_at) VALUES ('R1','11',2,'Ручка отвалилась через неделю','2026-11-09T00:00:00Z')").run();
    handle.db.prepare("INSERT INTO social_posts (source, channel, text, published_at, url) VALUES ('VK','home','Кухонные лопатки обсуждают','2026-11-09T00:00:00Z','https://vk.com/wall1')").run();
    handle.db.prepare("INSERT INTO pain_points (niche, theme, count, generated_at) VALUES ('home','易变形',18,'2026-11-09')").run();

    const items = itemsFromDb({ db: handle, now: NOW });
    assert.ok(items.length >= 4);
    assert.ok(items.some((item) => item.category === 'competition'));
    assert.ok(items.some((item) => item.category === 'voice'));
    assert.ok(items.some((item) => item.category === 'social'));
    assert.ok(items.some((item) => item.category === 'pain'));

    const stats = ingestIntel({ db: handle, items, now: NOW });
    assert.ok(stats.kept >= 3, 'derived signals survive cleaning: ' + JSON.stringify(stats.byReason));
  } finally {
    handle.close();
  }
});

test('parseRss handles RSS and Atom entries', () => {
  const rss = '<rss><channel><item><title><![CDATA[Ozon меняет правила]]></title><link>https://ozon.ru/news/1</link><description>Новые правила для селлеров</description><pubDate>Mon, 10 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const parsed = parseRss(rss, { source: 'RSS', category: 'market' });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Ozon меняет правила');
  assert.equal(parsed[0].url, 'https://ozon.ru/news/1');
  assert.ok(parsed[0].detail.includes('Новые правила'));

  const atom = '<feed><entry><title>Курс рубля укрепился</title><link href="https://tass.ru/1"/><summary>Курс вырос на 2%</summary><updated>2026-11-10T10:00:00Z</updated></entry></feed>';
  const entries = parseRss(atom);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, 'https://tass.ru/1');
});

test('harvestRss reports per-feed failures without throwing', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('bad')) return { ok: false, status: 503 };
    return { ok: true, text: async () => '<rss><channel><item><title>Новость о складе</title><link>https://ok.ru/1</link></item></channel></rss>' };
  };
  const result = await harvestRss({ feeds: ['https://ok.ru/feed', 'https://bad.example/feed'], fetchImpl });
  assert.equal(result.items.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].status, 503);
});

test('itemsFromFile reads JSON payloads produced by crawl4ai/crawlee', () => {
  const path = 'test/.intel-fixture.json';
  writeFileSync(path, JSON.stringify([{ title: 'Ozon открыл новый склад в Новосибирске', url: 'https://ozon.ru/news/77', summary: 'Логистика ускорится', source: '抓取' }]));
  try {
    const items = itemsFromFile(path);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, '抓取');
    assert.ok(items[0].detail.includes('Логистика'));
  } finally {
    unlinkSync(path);
  }
});

test('itemsFromDb aggregates repeated alerts of the same type into one item', () => {
  const handle = fresh();
  try {
    for (const sku of [11, 12]) {
      handle.db.prepare('INSERT INTO products (product_id, offer_id, sku, name, archived) VALUES (?, ?, ?, ?, 0)').run(sku, 'A' + sku, sku, 'Товар ' + sku);
      handle.db.prepare("INSERT INTO stocks (sku, warehouse_id, present, reserved, captured_at) VALUES (?,0,0,0,'2026-11-09')").run(sku);
    }
    const items = itemsFromDb({ db: handle, now: NOW });
    const alertItems = items.filter((item) => item.category === 'alert');
    assert.ok(alertItems.length >= 1);
    assert.ok(alertItems.length <= 2, 'alerts are grouped by type: ' + alertItems.length);
    assert.ok(alertItems.some((item) => item.title.includes('×')), 'grouped title carries the count');
  } finally {
    handle.close();
  }
});
