import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeText, detectLang, canonicalUrl, tokenize, similarity, dedupeKey, noiseReason, scoreItem, cleanItem, classifyTopic } from '../src/intel/clean.mjs';

test('normalizeText strips tags, entities and collapses whitespace', () => {
  const text = normalizeText('<p>Цена&nbsp;выросла &amp; 5%</p>\n\n  <b>сегодня</b>');
  assert.equal(text, 'Цена выросла & 5% сегодня');
  assert.ok(!/[<>]/.test(text));
  assert.equal(normalizeText('  \u200b  '), '');
  const long = normalizeText('а'.repeat(500), { maxChars: 20 });
  assert.ok(long.length <= 21);
  assert.ok(long.endsWith('…'));
});

test('detectLang separates ru / zh / en', () => {
  assert.equal(detectLang('Российский рынок вырос на пять процентов'), 'ru');
  assert.equal(detectLang('跨境卖家本季度销量大幅增长'), 'zh');
  assert.equal(detectLang('Ozon sellers report quarterly growth'), 'en');
  assert.equal(detectLang('12345 ₽ 678'), 'other');
});

test('canonicalUrl drops tracking params, fragment and trailing slash', () => {
  assert.equal(
    canonicalUrl('https://WWW.Ozon.ru/product/123/?utm_source=telegram&utm_medium=social#reviews'),
    'www.ozon.ru/product/123',
  );
  assert.equal(canonicalUrl('https://example.com/a/'), 'example.com/a');
  assert.equal(canonicalUrl('javascript:void(0)'), '');
  assert.equal(canonicalUrl(null), '');
});

test('tokenize and similarity catch near-duplicate titles', () => {
  assert.deepEqual(tokenize('Ozon вырос на 5% за квартал'), ['ozon', 'вырос', 'квартал']);
  const score = similarity('Ozon поднял комиссию для продавцов', 'Ozon повысил комиссию для всех продавцов');
  assert.ok(score > 0.4, 'overlapping topic should score: ' + score);
  assert.equal(similarity('совершенно другой текст', 'ozon логистика склад'), 0);
});

test('dedupeKey prefers canonical URL and falls back to title', () => {
  assert.match(dedupeKey({ url: 'https://ozon.ru/product/1?utm_source=x' }), /^u:/);
  assert.match(dedupeKey({ title: 'Новость о логистике' }), /^t:новость о логистике$/);
});

test('noiseReason flags promo, boilerplate, nav, stuffing, short and foreign text', () => {
  assert.equal(noiseReason({ title: 'Скидка 50% промокод купить сейчас, успейте' }), 'promo');
  assert.equal(noiseReason({ title: 'Политика конфиденциальности' }), 'boilerplate');
  assert.equal(noiseReason({ title: 'Главная Новости' }), 'nav');
  assert.equal(noiseReason({ title: 'склад склад склад склад логистика' }), 'stuffing');
  assert.equal(noiseReason({ title: 'Новость' }), 'too-short');
  assert.equal(noiseReason({ title: 'Официальный курс рубля заметно снизился за неделю' }), null);
});

test('scoreItem raises threat on risk markers and importance with recency', () => {
  const now = () => new Date('2026-11-10T12:00:00Z');
  const risky = scoreItem({ title: 'Задержка поставок и рост цен на логистику', publishedAt: '2026-11-10T11:00:00Z' }, { now });
  assert.equal(risky.threat, 'high');
  assert.ok(risky.importance >= 60);
  const stale = scoreItem({ title: 'Ozon обновил кабинет продавца', publishedAt: '2026-10-01T00:00:00Z' }, { now });
  const fresh = scoreItem({ title: 'Ozon обновил кабинет продавца', publishedAt: '2026-11-10T11:00:00Z' }, { now });
  assert.ok(fresh.importance > stale.importance);
});

test('cleanItem returns dropped reason or a scored normalized item', () => {
  const noisy = cleanItem({ title: 'Промокод скидка дешево купить сейчас' });
  assert.equal(noisy.dropped, true);
  assert.equal(noisy.reason, 'promo');

  const good = cleanItem({
    title: '  <b>Ozon</b> повысил комиссию&nbsp;для продавцов  ',
    url: 'https://www.ozon.ru/seller/news/?utm_source=x',
    source: 'RSS',
    category: 'market',
    publishedAt: new Date().toISOString(),
  });
  assert.equal(good.dropped, false);
  assert.equal(good.item.title, 'Ozon повысил комиссию для продавцов');
  assert.equal(good.item.lang, 'ru');
  assert.equal(good.item.url, 'www.ozon.ru/seller/news');
  assert.ok(good.item.importance > 0 && good.item.importance <= 100);
  assert.equal(good.item.dedupeKey, 'u:www.ozon.ru/seller/news');
});

test('classifyTopic routes news to ops topics and flags unrelated stories', () => {
  assert.equal(classifyTopic('OZON повысил комиссию для селлеров').category, 'platform');
  assert.equal(classifyTopic('Таможня ужесточила правила для поставок из Китая').category, 'logistics');
  assert.equal(classifyTopic('Курс рубля укрепился к юаню').category, 'finance');
  assert.equal(classifyTopic('Маркировка товаров станет обязательной').category, 'regulation');
  assert.equal(classifyTopic('Спрос на кухонные принадлежности вырос').category, 'market');
  assert.equal(classifyTopic('Спартак победил в матче').category, 'other');
  assert.equal(classifyTopic('МВД предлагает увеличить штрафы за привлечение нелегалов').category, 'other');
  assert.equal(classifyTopic('ГД приняла закон о регистрации прав на недвижимость без госпошлин').category, 'other');
});

test('cleanItem drops unrelated news as irrelevant but keeps fixed categories', () => {
  const sport = cleanItem({ title: 'Спартак победил Зенит в матче', source: 'RSS' });
  assert.equal(sport.dropped, true);
  assert.equal(sport.reason, 'irrelevant');

  const logistics = cleanItem({ title: 'Таможня ужесточила правила для поставок из Китая', source: 'RSS' });
  assert.equal(logistics.dropped, false);
  assert.equal(logistics.item.category, 'logistics');

  const fixed = cleanItem({ title: 'Задержка поставок в Новосибирске', source: 'OZON 数据巡检', category: 'alert', keepCategory: true });
  assert.equal(fixed.dropped, false);
  assert.equal(fixed.item.category, 'alert');
});

test('cleanItem strips detail that repeats the title and drops generic finance noise', () => {
  const repeated = cleanItem({ title: 'Ozon снизил комиссию для продавцов', detail: 'Ozon снизил комиссию для продавцов на 2 п.п. с ноября', source: 'RSS' });
  assert.equal(repeated.dropped, false);
  assert.ok(!repeated.item.detail.startsWith('Ozon снизил комиссию'), 'repeated prefix removed');

  assert.equal(classifyTopic('Убыток компании по МСФО за девять месяцев составил 612 млн рублей').category, 'other');
  assert.equal(classifyTopic('Курс юаня к рублю вырос на 2%').category, 'finance');
  assert.equal(classifyTopic('Спрос на кухонные принадлежности вырос на 18%').category, 'market');
});
