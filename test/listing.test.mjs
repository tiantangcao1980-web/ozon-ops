import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runListingQa } from '../src/rules/listing-qa.mjs';
import { buildListing } from '../src/commands/listing.mjs';
import { commitDraft, loadGlossary } from '../src/content/translate.mjs';
import { openDb } from '../src/db.mjs';

const DRAFT = {
  offerId: 'SY-TEST-1',
  zh: { name: '厨房硅胶锅铲 耐高温', bullets: ['耐高温'], attributes: { 1: '锅铲', 2: '硅胶' } },
  slots: {
    nameRu: 'Лопатка силиконовая для кухни, термостойкая',
    descriptionRu: 'Лопатка из силикона для кухни. Термостойкая, легко моется.',
    attributesRu: { 1: 'лопатка', 2: 'силикон' },
  },
  backTranslation: { nameZh: '厨房用硅胶锅铲，耐高温', descriptionZh: '厨房硅胶锅铲，耐高温。', attributesZh: { 1: '锅铲', 2: '硅胶' } },
  constraints: { nameMaxBytes: 200, descMaxBytes: 6000, requiredAttrs: [1, 2], attributes: [] },
};

const IMAGES = [
  { path: 'main.jpg', width: 900, height: 1200 },
  { path: 'extra1.jpg', width: 900, height: 1200 },
];

const FACTS = {
  offerId: 'SY-TEST-1',
  categoryId: 17027945,
  typeId: 970741954,
  priceRub: 500,
  barcode: '2000000000015',
  weightG: 120,
  dimsMm: [100, 80, 20],
  quantity: 20,
  warehouseId: 1234567801,
  hotTerms: ['лопатка силиконовая', 'кухонная лопатка'],
};

test('runListingQa passes a complete draft with 3:4 images', () => {
  const result = runListingQa({ draft: DRAFT, images: IMAGES });
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test('runListingQa reports missing attribute, wrong ratio and missing images', () => {
  const noAttr = runListingQa({ draft: { ...DRAFT, slots: { ...DRAFT.slots, attributesRu: { 1: 'лопатка' } } }, images: IMAGES });
  assert.ok(noAttr.issues.some((issue) => issue.code === 'MISSING_ATTRIBUTE'));
  assert.equal(noAttr.passed, false);

  const badRatio = runListingQa({ draft: DRAFT, images: [{ path: 'x.jpg', width: 800, height: 800 }] });
  assert.ok(badRatio.issues.some((issue) => issue.code === 'IMAGE_RATIO'));

  const noImages = runListingQa({ draft: DRAFT, images: [] });
  assert.ok(noImages.issues.some((issue) => issue.code === 'IMAGE_MISSING'));
});

test('runListingQa enforces barcode, weight, dimensions, quantity, tags and price', () => {
  const incomplete = runListingQa({
    draft: DRAFT,
    images: IMAGES,
    facts: { ...FACTS, barcode: '12345', weightG: 0, dimsMm: [], quantity: 0, hotTerms: [], priceRub: null, categoryId: null },
  });
  const codes = incomplete.issues.map((issue) => issue.code);
  for (const code of ['BARCODE_INVALID', 'WEIGHT_MISSING', 'DIMENSIONS_MISSING', 'QUANTITY_MISSING', 'TAGS_MISSING', 'PRICE_MISSING', 'CATEGORY_MISSING']) {
    assert.ok(codes.includes(code), `expected ${code} in ${codes.join(',')}`);
  }
  assert.equal(incomplete.passed, false);
  assert.ok(incomplete.completeness.ratio < 1);
});

test('runListingQa scores a fully filled card close to 100 and lists no issue', () => {
  const result = runListingQa({ draft: DRAFT, images: IMAGES, facts: FACTS });
  assert.equal(result.passed, true);
  assert.equal(result.completeness.ratio, 1);
});

test('buildListing writes import payload, stock payload, backend fields and qa files', () => {
  const handle = openDb();
  handle.migrate();
  const outDir = mkdtempSync(join(tmpdir(), 'ozon-listing-'));
  try {
    commitDraft({ db: handle, draft: DRAFT, glossary: loadGlossary() });
    const result = buildListing({
      db: handle,
      offerId: 'SY-TEST-1',
      outDir,
      images: IMAGES,
      facts: FACTS,
      now: () => '2026-11-06T00:00:00.000Z',
    });
    assert.equal(result.ok, true);
    for (const name of ['payload.ru.json', 'import.json', 'stocks.json', 'backend-fields.md', 'qa.json']) {
      assert.ok(existsSync(join(outDir, name)), `missing ${name}`);
    }
    const payload = JSON.parse(readFileSync(join(outDir, 'payload.ru.json'), 'utf8'));
    assert.equal(payload.offer_id, 'SY-TEST-1');
    assert.ok(payload.name.includes('Лопатка'));
    assert.equal(payload.images.length, 2);
    assert.equal(payload.weight, 120);
    assert.equal(payload.weight_unit, 'g');
    assert.equal(payload.barcode.length, 13);
    assert.equal(payload.price, '500');
    const stocks = JSON.parse(readFileSync(join(outDir, 'stocks.json'), 'utf8'));
    assert.deepEqual(stocks.stocks, [{ offer_id: 'SY-TEST-1', stock: 20, warehouse_id: 1234567801 }]);
    const backend = readFileSync(join(outDir, 'backend-fields.md'), 'utf8');
    assert.match(backend, /Штрихкод/);
    assert.match(backend, /лопатка силиконовая/);
    const importBody = JSON.parse(readFileSync(join(outDir, 'import.json'), 'utf8'));
    assert.equal(importBody.items.length, 1);
  } finally {
    handle.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('buildListing refuses to write a payload when QA fails', () => {
  const handle = openDb();
  handle.migrate();
  const outDir = mkdtempSync(join(tmpdir(), 'ozon-listing-fail-'));
  try {
    commitDraft({ db: handle, draft: DRAFT, glossary: loadGlossary() });
    const result = buildListing({
      db: handle,
      offerId: 'SY-TEST-1',
      outDir,
      images: [],
      facts: FACTS,
      now: () => '2026-11-06T00:00:00.000Z',
    });
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(outDir, 'payload.ru.json')), false);
    assert.ok(existsSync(join(outDir, 'qa.json')));
  } finally {
    handle.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('buildListing refuses to build without listing facts', () => {
  const handle = openDb();
  handle.migrate();
  const outDir = mkdtempSync(join(tmpdir(), 'ozon-listing-nofacts-'));
  try {
    commitDraft({ db: handle, draft: DRAFT, glossary: loadGlossary() });
    const result = buildListing({ db: handle, offerId: 'SY-TEST-1', outDir, images: IMAGES });
    assert.equal(result.ok, false);
    assert.ok(result.qa.issues.some((issue) => issue.code === 'FACTS_MISSING'));
  } finally {
    handle.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});