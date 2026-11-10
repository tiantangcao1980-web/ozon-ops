import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { buildKeywordPack, renderKeywordPackMarkdown } from '../src/ads/keywords.mjs';
import { buildListing } from '../src/commands/listing.mjs';
import { openDb } from '../src/db.mjs';

function decided(term, hits, extra = {}) {
  return { term, sku: 'P1', hits: hits.map((id) => ({ id })), inTitle: false, ...extra };
}

test('buildKeywordPack splits winners, title candidates and avoid list', () => {
  const pack = buildKeywordPack([
    decided('щётка для снега', [4, 10, 8]),
    decided('когтеточка для кошек', [5]),
    decided('скребок для снега с машины', [1, 2]),
    decided('когтерезка с подсветкой', [8]),
  ]);
  assert.deepEqual(pack.titleCandidates, ['щётка для снега']);
  assert.deepEqual(pack.backendKeywords, ['щётка для снега', 'когтерезка с подсветкой']);
  assert.deepEqual(pack.avoid, ['скребок для снега с машины']);
  assert.equal(pack.hits['щётка для снега'], '4+10+8');
});

test('buildKeywordPack respects limit and dedupes', () => {
  const rows = Array.from({ length: 40 }, (_, index) => decided(`kw ${index}`, [4]));
  const pack = buildKeywordPack(rows, { limit: 10 });
  assert.equal(pack.backendKeywords.length, 10);
  assert.equal(new Set(pack.backendKeywords).size, 10);
});

test('renderKeywordPackMarkdown contains three sections and copy-ready lines', () => {
  const pack = buildKeywordPack([
    decided('щётка для снега', [4, 10, 8]),
    decided('скребок для снега с машины', [1, 2]),
  ]);
  const markdown = renderKeywordPackMarkdown({ date: '2026-11-09', pack });
  assert.match(markdown, /关键词包/);
  assert.match(markdown, /标题补充/);
  assert.match(markdown, /后台关键词/);
  assert.match(markdown, /不要用/);
  assert.match(markdown, /щётка для снега/);
});

test('listing build writes keywords into backend-fields when provided', () => {
  const handle = openDb();
  handle.migrate();
  try {
    handle.db
      .prepare('INSERT INTO listing_drafts (offer_id, version, payload_json, qa_json, created_at) VALUES (?,?,?,?,?)')
      .run(
        'KW-1',
        1,
        JSON.stringify({
          slots: { nameRu: 'Лопатка силиконовая', descriptionRu: 'Описание', attributesRu: {} },
          zh: { name: '硅胶锅铲', bullets: [] },
        }),
        null,
        '2026-11-09T00:00:00Z',
      );
    const outDir = mkdtempSync(join(tmpdir(), 'kw-listing-'));
    const result = buildListing({
      db: handle,
      offerId: 'KW-1',
      outDir,
      images: [
        { path: 'a.png', width: 900, height: 1200 },
        { path: 'b.png', width: 900, height: 1200 },
        { path: 'c.png', width: 900, height: 1200 },
      ],
      keywords: { backendKeywords: ['щётка для снега'], titleCandidates: ['щётка'], avoid: [] },
      facts: {
        offerId: 'KW-1',
        categoryId: 17027945,
        typeId: 970741954,
        priceRub: 500,
        weightG: 120,
        dimsMm: [100, 80, 20],
        quantity: 20,
        warehouseId: 1234567801,
        hotTerms: ['щётка для снега'],
      },
    });
    assert.equal(result.ok, true);
    const backend = readFileSync(join(outDir, 'backend-fields.md'), 'utf8');
    assert.match(backend, /щётка для снега/);
    rmSync(outDir, { recursive: true, force: true });
  } finally {
    handle.close();
  }
});