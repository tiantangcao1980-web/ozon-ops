import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadGlossary, prepareDraft, draftCoverage, commitDraft, DraftError } from '../src/content/translate.mjs';
import { openDb } from '../src/db.mjs';

const CATEGORY_SCHEMA = {
  nameMaxBytes: 200,
  descMaxBytes: 6000,
  attributes: [
    { id: 1, name: 'Тип', required: true, values: ['лопатка', 'скребок'] },
    { id: 2, name: 'Материал', required: true, values: ['силикон'] },
    { id: 3, name: 'Цвет', required: false, values: ['белый', 'чёрный'] },
  ],
};

function filledDraft() {
  return {
    offerId: 'SY-TEST-1',
    zh: { name: '厨房硅胶锅铲 耐高温 防滑', bullets: ['耐高温', '易清洗', '加厚'], attributes: { 1: '锅铲', 2: '硅胶' } },
    slots: {
      nameRu: 'Лопатка силиконовая для кухни, термостойкая',
      descriptionRu: 'Лопатка из силикона для кухни. Термостойкая, легко моется, утолщённая ручка.',
      attributesRu: { 1: 'лопатка', 2: 'силикон' },
    },
    backTranslation: {
      nameZh: '厨房用硅胶锅铲，耐高温',
      descriptionZh: '厨房硅胶锅铲。耐高温、易清洗、加厚手柄。',
      attributesZh: { 1: '锅铲', 2: '硅胶' },
    },
    constraints: CATEGORY_SCHEMA,
  };
}

test('loadGlossary has terms and forbidden words', () => {
  const glossary = loadGlossary();
  assert.ok(glossary.terms.length >= 20);
  assert.ok(glossary.forbidden.includes('гарантия'));
});

test('prepareDraft builds empty slots with schema constraints and glossary hints', () => {
  const draft = prepareDraft({
    offerId: 'SY-TEST-1',
    zh: { name: '厨房硅胶锅铲 耐高温', bullets: ['耐高温', '易清洗'], attributes: { 1: '锅铲', 2: '硅胶' } },
    categorySchema: CATEGORY_SCHEMA,
  });
  assert.equal(draft.slots.nameRu, '');
  assert.equal(draft.slots.descriptionRu, '');
  assert.deepEqual(draft.constraints.requiredAttrs, [1, 2]);
  assert.ok(draft.glossaryHints.some((item) => item.zh === '硅胶'));
  assert.equal(draftCoverage(draft).ratio, 0);
});

test('draftCoverage counts glossary hits in ru text', () => {
  const draft = filledDraft();
  const coverage = draftCoverage(draft);
  assert.ok(coverage.ratio > 0.5, `ratio=${coverage.ratio}`);
});

test('commitDraft stores a valid draft', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const result = commitDraft({ db: handle, draft: filledDraft(), glossary: loadGlossary() });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    const row = handle.db.prepare('SELECT * FROM listing_drafts WHERE offer_id = ?').get('SY-TEST-1');
    assert.equal(row.status, 'DRAFT_READY');
  } finally {
    handle.close();
  }
});

test('commitDraft rejects missing back-translation', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const draft = filledDraft();
    draft.backTranslation = { nameZh: '', descriptionZh: '', attributesZh: {} };
    assert.throws(
      () => commitDraft({ db: handle, draft, glossary: loadGlossary() }),
      (error) => error instanceof DraftError && error.code === 'BACKTRANSLATION_MISSING',
    );
  } finally {
    handle.close();
  }
});

test('commitDraft rejects forbidden claims and chinese residue', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const forbidden = filledDraft();
    forbidden.slots.nameRu = 'Лопатка силиконовая гарантия лучшая';
    assert.throws(
      () => commitDraft({ db: handle, draft: forbidden, glossary: loadGlossary() }),
      (error) => error.code === 'FORBIDDEN_WORD',
    );
    const residue = filledDraft();
    residue.slots.descriptionRu = 'Лопатка 硅胶 для кухни';
    assert.throws(
      () => commitDraft({ db: handle, draft: residue, glossary: loadGlossary() }),
      (error) => error.code === 'CHINESE_RESIDUE',
    );
  } finally {
    handle.close();
  }
});

test('commitDraft rejects low glossary coverage and oversized name', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const sparse = filledDraft();
    sparse.slots.nameRu = 'Инструмент';
    sparse.slots.descriptionRu = 'Инструмент для готовки';
    assert.throws(
      () => commitDraft({ db: handle, draft: sparse, glossary: loadGlossary() }),
      (error) => error.code === 'LOW_GLOSSARY_COVERAGE',
    );
    const longName = filledDraft();
    longName.slots.nameRu = 'Лопатка ' + 'силиконовая '.repeat(40);
    assert.throws(
      () => commitDraft({ db: handle, draft: longName, glossary: loadGlossary() }),
      (error) => error.code === 'NAME_TOO_LONG',
    );
  } finally {
    handle.close();
  }
});

test('commitDraft allows drafts with zero applicable glossary terms', async () => {
  const { commitDraft } = await import('../src/content/translate.mjs');
  const { openDb } = await import('../src/db.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    const draft = {
      offerId: 'NO-GLOSSARY-1',
      zh: { name: 'EXAMPLE-77', bullets: [], attributes: {} },
      slots: { nameRu: 'Органайзер EXAMPLE-77', descriptionRu: 'Органайзер для хранения.', attributesRu: {} },
      backTranslation: { nameZh: '收纳盒 EXAMPLE-77', descriptionZh: '用于收纳的收纳盒。', attributesZh: {} },
      constraints: { nameMaxBytes: 200, descMaxBytes: 6000, requiredAttrs: [], attributes: [], forbidden: [] },
    };
    const result = commitDraft({ db: handle, draft });
    assert.equal(result.coverage.total, 0);
    assert.equal(result.coverage.ratio, 1);
    assert.ok(result.version >= 1);
  } finally {
    handle.close();
  }
});
