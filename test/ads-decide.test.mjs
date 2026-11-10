import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSearchTermCsv, decideSearchTerms, allocateBudget, renderDecideMarkdown } from '../src/ads/decide.mjs';

const CSV = `Период;Поисковый запрос;SKU;Показы;Клики;Расход;Заказы;Выручка;Корзины;В названии
01.11-07.11;когтеточка для кошек;P1;4100;58;2320;3;8990;6;да
01.11-07.11;щётка для снега автомобильная;W2;1900;44;1690;4;12796;9;нет
01.11-07.11;скребок для снега с машины;W2;8600;31;1180;0;0;0;нет
01.11-07.11;коврик для кота точилка;P1;5200;24;980;0;0;0;нет
01.11-07.11;скребок для льда;W2;380;15;520;1;1199;2;нет
01.11-07.11;когтерезка для кошек с подсветкой;P1;430;12;410;2;3198;3;нет
01.11-07.11;уплотнитель для двери;H1;6100;9;260;0;0;1;да
`;

test('parseSearchTermCsv maps russian headers and money in RUB', () => {
  const parsed = parseSearchTermCsv(CSV, { fx: 12.257 });
  assert.equal(parsed.rows.length, 7);
  const row = parsed.rows[0];
  assert.equal(row.term, 'когтеточка для кошек');
  assert.equal(row.sku, 'P1');
  assert.equal(row.impressions, 4100);
  assert.equal(Math.round(row.spendCny), 189);
  assert.equal(row.orders, 3);
  assert.equal(row.revenueCny, Math.round((8990 / 12.257) * 100) / 100);
  assert.ok(parsed.unknownColumns.includes('Период'));
});

test('decideSearchTerms applies rules 1/2/4/5/8/10 in order', () => {
  const { rows } = parseSearchTermCsv(CSV, { fx: 12.257 });
  const decided = decideSearchTerms(rows);
  const byTerm = Object.fromEntries(decided.map((row) => [row.term, row]));
  assert.deepEqual(byTerm['скребок для снега с машины'].hits.map((hit) => hit.id), [1, 2]);
  assert.deepEqual(byTerm['когтеточка для кошек'].hits.map((hit) => hit.id), [5]);
  assert.deepEqual(byTerm['щётка для снега автомобильная'].hits.map((hit) => hit.id), [4, 10, 8]);
  assert.deepEqual(byTerm['когтерезка для кошек с подсветкой'].hits.map((hit) => hit.id), [8]);
  assert.equal(byTerm['коврик для кота точилка'].primary.id, 1);
});

test('allocateBudget uses weight revenue/(1+acos), floor and cap', () => {
  const { rows } = parseSearchTermCsv(CSV, { fx: 12.257 });
  const decided = decideSearchTerms(rows);
  const groups = allocateBudget(decided, { budget: 5000, floor: 150, cap: 0.4 });
  const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));
  assert.equal(byKey.P1.alloc, 2000);
  assert.equal(byKey.W2.alloc, 2000);
  assert.equal(byKey.H1.alloc, 150);
  const totalAlloc = groups.reduce((sum, group) => sum + group.alloc, 0);
  assert.equal(Math.round(5000 - totalAlloc), 850);
});

test('renderDecideMarkdown contains verdict table and budget section', () => {
  const { rows, unknownColumns } = parseSearchTermCsv(CSV, { fx: 12.257 });
  const decided = decideSearchTerms(rows);
  const groups = allocateBudget(decided, { budget: 5000, floor: 150, cap: 0.4 });
  const markdown = renderDecideMarkdown({ date: '2026-11-06', rows: decided, groups, unknownColumns, fx: 12.257, spendCur: 'RUB' });
  assert.match(markdown, /广告搜索词判定/);
  assert.match(markdown, /#1/);
  assert.match(markdown, /预算分配/);
  assert.match(markdown, /850/);
});

test('regression: decisions on the original 2026-11-06 sample match the archived report', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseSearchTermCsv, decideSearchTerms, allocateBudget } = await import('../src/ads/decide.mjs');
  const csv = readFileSync(new URL('./fixtures/ads-sample.csv', import.meta.url), 'utf8');
  const { rows } = parseSearchTermCsv(csv, { fx: 12.257 });
  const decided = decideSearchTerms(rows);
  const actual = Object.fromEntries(decided.map((row) => [row.term, row.hits.map((hit) => hit.id).join('+')]));
  assert.deepEqual(actual, {
    'коврик для кота точилка': '1',
    'когтеточка для кошек': '5',
    'скребок для снега с машины': '1+2',
    'щётка для снега автомобильная': '4+10+8',
    'когтерезка для кошек с подсветкой': '8',
    'уплотнитель для двери': '1',
    'скребок для льда': '',
  });
  const groups = allocateBudget(decided, { budget: 5000, floor: 150, cap: 0.4 });
  const alloc = Object.fromEntries(groups.map((group) => [group.key, group.alloc]));
  assert.deepEqual(alloc, { P1: 2000, W2: 2000, H1: 150 });
});
