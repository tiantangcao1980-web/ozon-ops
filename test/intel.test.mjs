import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePriceRub,
  parseRating,
  parseCardText,
  isChallenge,
  parseReviewItems,
} from '../src/intel/ozon-front.mjs';
import { saveCompetitors, saveReviews } from '../src/intel/store.mjs';
import { openDb } from '../src/db.mjs';

test('parsePriceRub handles russian grouping and currency suffix', () => {
  assert.equal(parsePriceRub('96 ₽'), 96);
  assert.equal(parsePriceRub('1 300 ₽'), 1300);
  assert.equal(parsePriceRub('12 345,50 ₽'), 12345.5);
  assert.equal(parsePriceRub('нет цены'), null);
});

test('parseRating extracts rating and review count', () => {
  assert.deepEqual(parseRating('4.9 7 694 отзыва'), { rating: 4.9, reviews: 7694 });
  assert.deepEqual(parseRating('5.0 13 518'), { rating: 5, reviews: 13518 });
  assert.deepEqual(parseRating('без рейтинга'), { rating: null, reviews: null });
});

test('parseCardText turns a real ozon card text into a competitor record', () => {
  const card = parseCardText(
    'Распродажа 106 ₽ 1 300 ₽ 1 300 ₽ −91% Стало дешевле Лопатка кулинарная силиконовая для кухни Daddy Chef 4.9 7 694 отзыва 9 ноября',
  );
  assert.equal(card.priceRub, 106);
  assert.equal(card.oldPriceRub, 1300);
  assert.equal(card.discountPct, 91);
  assert.equal(card.rating, 4.9);
  assert.equal(card.reviews, 7694);
  assert.match(card.title, /Daddy Chef/);
});

test('isChallenge detects the antibot page', () => {
  assert.equal(isChallenge({ title: 'Antibot Challenge Page', url: 'https://www.ozon.ru/x' }), true);
  assert.equal(isChallenge({ title: 'силиконовая лопатка - купить на OZON', url: 'https://www.ozon.ru/category/x' }), false);
});

test('parseReviewItems normalizes raw DOM review items', () => {
  const reviews = parseReviewItems([
    { id: 'r1', author: 'Eduardo', date: '5 ноября 2026', rating: '5', text: 'Очень удобная лопатка', photos: 2 },
    { id: '', author: '', date: '', rating: '', text: '', photos: 0 },
  ]);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].reviewId, 'r1');
  assert.equal(reviews[0].rating, 5);
  assert.equal(reviews[0].text, 'Очень удобная лопатка');
});

test('saveCompetitors upserts competitor and snapshot rows', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const items = [
      { sku: '1234567851', title: 'Лопатка 28 см', priceRub: 96, oldPriceRub: 99, discountPct: 3, rating: 5, reviews: 13518, seller: 'Ozon', url: 'https://www.ozon.ru/product/1234567851/' },
    ];
    saveCompetitors(handle, items, { keyword: 'силиконовая лопатка', capturedAt: '2026-11-06T00:00:00.000Z' });
    saveCompetitors(handle, [{ ...items[0], priceRub: 90 }], { keyword: 'силиконовая лопатка', capturedAt: '2026-11-07T00:00:00.000Z' });
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM competitors').get().n, 1);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM competitor_snapshots').get().n, 2);
    assert.equal(handle.db.prepare('SELECT price_rub FROM competitors').get().price_rub, 90);
  } finally {
    handle.close();
  }
});

test('saveReviews dedupes by review id', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const reviews = [
      { reviewId: 'r1', rating: 5, text: 'good', date: '2026-11-05', hasPhoto: true },
      { reviewId: 'r2', rating: 4, text: 'ok', date: '2026-11-04', hasPhoto: false },
    ];
    saveReviews(handle, '1234567851', reviews, { capturedAt: '2026-11-06T00:00:00.000Z' });
    saveReviews(handle, '1234567851', reviews, { capturedAt: '2026-11-07T00:00:00.000Z' });
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM reviews_raw').get().n, 2);
  } finally {
    handle.close();
  }
});

test('ingestSearch persists MCP-extracted cards', async () => {
  const { ingestSearch } = await import('../src/intel/commands.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    const raw = [
      { sku: '111', text: 'Распродажа 96 ₽ 99 ₽ −3% Лопатка силиконовая 5.0 13 518 отзывов Завтра', url: 'https://www.ozon.ru/product/111/' },
      { sku: '222', text: '106 ₽ 1 300 ₽ −91% Лопатка Daddy Chef 4.9 7 694 отзыва', url: 'https://www.ozon.ru/product/222/' },
    ];
    const result = ingestSearch({ db: handle, query: 'силиконовая лопатка', raw, capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(result.items, 2);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM competitors').get().n, 2);
    const row = handle.db.prepare("SELECT * FROM competitors WHERE sku = '222'").get();
    assert.equal(row.price_rub, 106);
    assert.equal(row.reviews, 7694);
  } finally {
    handle.close();
  }
});

test('ingestReviews persists MCP-extracted review nodes', async () => {
  const { ingestReviews } = await import('../src/intel/commands.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    const raw = [
      { id: 'r1', text: 'Очень удобная лопатка', rating: '5' },
      { id: 'r2', text: 'Рукоятка скользит', rating: '3' },
      { id: '', text: 'без id не сохраняем', rating: '4' },
    ];
    const result = ingestReviews({ db: handle, sku: '111', raw, capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(result.inserted, 3);
    const again = ingestReviews({ db: handle, sku: '111', raw, capturedAt: '2026-11-07T00:00:00.000Z' });
    assert.equal(again.inserted, 0);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM reviews_raw').get().n, 3);
  } finally {
    handle.close();
  }
});

test('analyzePainPoints groups reviews into themes with samples', async () => {
  const { analyzePainPoints } = await import('../src/intel/pains.mjs');
  const reviews = [
    { text: 'Ручка отвалилась через месяц, качество плохое', rating: 1 },
    { text: 'Край толстоватый, неудобно', rating: 3 },
    { text: 'Отличная лопатка, удобная ручка', rating: 5 },
    { text: 'Упаковка была порвана при доставке', rating: 2 },
    { text: 'Силикон мягкий, хорошо моется', rating: 5 },
  ];
  const result = analyzePainPoints(reviews);
  const themes = Object.fromEntries(result.map((item) => [item.theme, item.count]));
  assert.equal(themes.quality, 1);
  assert.equal(themes.edge, 1);
  assert.equal(themes.packaging, 1);
  assert.ok(result[0].samples.length >= 1);
  assert.equal(result[0].count >= result[result.length - 1].count, true);
});

test('runIntelPains stores themes and samples for a sku', async () => {
  const { runIntelPains } = await import('../src/intel/commands.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    handle.db.prepare("INSERT INTO reviews_raw (review_id, sku, rating, text, captured_at) VALUES ('r1','999',2,'Ручка отвалилась, качество плохое','2026-11-06')").run();
    handle.db.prepare("INSERT INTO reviews_raw (review_id, sku, rating, text, captured_at) VALUES ('r2','999',5,'Отличная лопатка','2026-11-06')").run();
    const rows = runIntelPains({ db: handle, sku: '999', niche: '厨房硅胶小工具', now: () => '2026-11-06T00:00:00.000Z' });
    assert.ok(rows.length >= 2);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM pain_points').get().n, rows.length);
    assert.equal(handle.db.prepare("SELECT theme FROM pain_points WHERE theme = 'quality'").get().theme, 'quality');
  } finally {
    handle.close();
  }
});

test('buildEvidence aggregates competitors, reviews and pains into the candidate', async () => {
  const { buildEvidence } = await import('../src/intel/commands.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    handle.db.prepare("INSERT INTO candidates (id, niche, ru_query, created_at) VALUES (7, '厨房硅胶小工具', 'силиконовая лопатка', '2026-11-06')").run();
    const items = [
      { sku: '1', title: 'A', priceRub: 100, rating: 4.9, reviews: 50, seller: 'S1' },
      { sku: '2', title: 'B', priceRub: 200, rating: 4.9, reviews: 150, seller: 'S1' },
      { sku: '3', title: 'C', priceRub: 300, rating: 4.8, reviews: 500, seller: 'S2' },
    ];
    const { saveCompetitors } = await import('../src/intel/store.mjs');
    saveCompetitors(handle, items, { keyword: 'силиконовая лопатка', capturedAt: '2026-11-06T00:00:00.000Z' });
    handle.db.prepare("INSERT INTO reviews_raw (review_id, sku, rating, text) VALUES ('r1','3',1,'Ручка отвалилась, качество плохое')").run();
    handle.db.prepare("INSERT INTO reviews_raw (review_id, sku, rating, text) VALUES ('r2','3',5,'Край тонкий, удобно')").run();

    const result = buildEvidence({ db: handle, candidateId: 7, keyword: 'силиконовая лопатка', sku: '3' });
    assert.equal(result.evidence.cards_total, 3);
    assert.equal(result.evidence.cards_100plus, 2);
    assert.equal(result.evidence.sellers_count, 2);
    assert.ok(result.evidence.pains.some((item) => item.theme === 'quality'));
    const row = handle.db.prepare('SELECT evidence_json, verdict FROM candidates WHERE id = 7').get();
    assert.equal(row.verdict, 'EVIDENCE_READY');
    assert.equal(JSON.parse(row.evidence_json)[0].cards_100plus, 2);
  } finally {
    handle.close();
  }
});
