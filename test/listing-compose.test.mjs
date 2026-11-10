import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHashtags,
  composeDescriptionRu,
  composeListing,
} from '../src/content/listing-compose.mjs';
import { isValidEan13 } from '../src/content/barcode.mjs';

const FACTS = {
  offerId: 'DEMO-W2-1199',
  skuCode: 'W2',
  categoryId: 17027945,
  typeId: 970741954,
  nameRu: 'Щетка для снега автомобильная 2 в 1, телескопическая ручка',
  priceRub: 1199,
  oldPriceRub: 1499,
  weightG: 487,
  dimsMm: [450, 120, 80],
  quantity: 20,
  warehouseId: 1234567801,
  attributes: [
    { id: 85, value: 'Нет бренда', dictionaryValueId: 126745801 },
    { id: 8229, value: 'Щетка автомобильная', dictionaryValueId: 970741954 },
    { id: 9048, value: 'DEMO-W2-1199' },
  ],
  hotTerms: [
    { term: 'щетка автомобильная для снега', volume: 76562 },
    { term: 'щетка для автомобиля от снега', volume: 13129 },
    'скребок для снега',
  ],
  bulletsRu: ['Мягкая щетина не царапает лак', 'Скребок снимает лёд со стекла'],
};

const IMAGES = [{ url: 'https://cdn.example/1.jpg' }, { url: 'https://cdn.example/2.jpg' }];

test('buildHashtags lowercases, underscores and lists every term', () => {
  const result = buildHashtags(FACTS.hotTerms);
  assert.ok(result.value.includes('#щетка_автомобильная_для_снега'));
  assert.ok(result.value.includes('#скребок_для_снега'));
  assert.equal(result.included.length, 3);
  assert.deepEqual(result.dropped, []);
});

test('buildHashtags caps the string and reports dropped terms', () => {
  const terms = Array.from({ length: 300 }, (_, index) => `слово номер ${index} для поиска`);
  const result = buildHashtags(terms, { maxChars: 80 });
  assert.ok(result.value.length <= 80);
  assert.ok(result.dropped.length > 0);
});

test('composeDescriptionRu writes a generated description from name and bullets', () => {
  const text = composeDescriptionRu({
    nameRu: FACTS.nameRu,
    bulletsRu: FACTS.bulletsRu,
    specs: ['Вес — 487 г', 'Цвет — чёрный'],
    packageRu: 'Щётка со скребком — 1 шт',
    usageRu: 'Подходит для легковых автомобилей.',
  });
  assert.ok(text.length > 120);
  assert.ok(text.includes('Мягкая щетина'));
  assert.ok(text.includes('Вес — 487 г'));
  assert.ok(text.includes('Щётка со скребком — 1 шт'));
});

test('composeListing fills barcode, weight, dimensions, quantity, hashtags and description', () => {
  const result = composeListing({ offerId: FACTS.offerId, facts: FACTS, images: IMAGES });
  const { payload, stockPayload, backendMarkdown } = result;

  assert.equal(payload.offer_id, 'DEMO-W2-1199');
  assert.equal('barcode' in payload, false); // 没给真实条码就不编，交给 Ozon 自动生成
  assert.equal(payload.weight, 487);
  assert.equal(payload.weight_unit, 'g');
  assert.deepEqual([payload.width, payload.height, payload.depth], [450, 120, 80]);
  assert.equal(payload.dimension_unit, 'mm');
  assert.equal(payload.price, '1199');
  assert.equal(payload.currency_code, 'RUB');
  assert.equal(payload.description_category_id, 17027945);
  assert.equal(payload.type_id, 970741954);
  assert.equal(payload.primary_image, 'https://cdn.example/1.jpg');
  assert.equal(payload.images.length, 2);
  assert.ok(payload.description.length > 120, 'description must be generated when missing');

  const byId = new Map(payload.attributes.map((attribute) => [attribute.id, attribute]));
  assert.equal(byId.get(85).values[0].dictionary_value_id, 126745801);
  assert.equal(byId.get(9048).values[0].value, 'DEMO-W2-1199');
  assert.equal(byId.get(4383).values[0].value, '487');
  assert.equal(byId.get(4180).values[0].value, FACTS.nameRu);
  const hashtags = byId.get(23171).values[0].value;
  assert.ok(hashtags.includes('#щетка_автомобильная_для_снега'));

  assert.deepEqual(stockPayload, {
    stocks: [{ offer_id: 'DEMO-W2-1199', stock: 20, warehouse_id: 1234567801 }],
  });

  assert.match(backendMarkdown, /Штрихкод/);
  assert.match(backendMarkdown, /Вес/);
  assert.match(backendMarkdown, /Количество/);
  assert.match(backendMarkdown, /#Хештеги/);
  for (const term of ['щетка автомобильная для снега', 'скребок для снега']) {
    assert.ok(backendMarkdown.includes(term), `backend list must contain ${term}`);
  }
});

test('composeListing keeps a provided description instead of generating', () => {
  const result = composeListing({
    offerId: 'DEMO-W2-1199',
    facts: { ...FACTS, descriptionRu: 'Готовое описание товара для проверки.' },
    images: IMAGES,
  });
  assert.equal(result.payload.description, 'Готовое описание товара для проверки.');
});