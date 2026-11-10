import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addCandidate, importEvidence, renderSelectionReport, runSelect } from '../src/commands/selection-cli.mjs';
import { openDb } from '../src/db.mjs';

const SETTINGS = {
  fxRubPerCny: 12.257,
  purchaseCny: 30,
  domesticFreightCny: 2,
  packagingCny: 1,
  commissionRate: 0.13,
};

const GOOD = {
  niche: '厨房硅胶小工具',
  ruQuery: 'силиконовая лопатка',
  priceCny: 200,
  actualWeightG: 600,
  dimsCm: { l: 20, w: 15, h: 8 },
  form: 'silicone_tool',
  purchaseCny: 30,
};

test('importEvidence imports valid CSV rows and skips malformed ones', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const id = addCandidate({ db: handle, candidate: GOOD });
    const csv = [
      'ru_query,cards_total,cards_100plus,cards_recent_reviews,avg_price_rub,sellers_count,top_share',
      'силиконовая лопатка,40,9,6,2400,12,0.35',
      'силиконовые формы,30,8,4,2100,9,0.4',
      'bad-row-without-columns',
    ].join('\n');
    const result = importEvidence({ db: handle, candidateId: id, csvText: csv });
    assert.equal(result.imported, 2);
    assert.equal(result.skipped, 1);
    const row = handle.db.prepare('SELECT evidence_json FROM candidates WHERE id = ?').get(id);
    const evidence = JSON.parse(row.evidence_json);
    assert.equal(evidence.length, 2);
  } finally {
    handle.close();
  }
});

test('renderSelectionReport renders a markdown table with verdicts and gaps', () => {
  const markdown = renderSelectionReport([
    {
      niche: '厨房硅胶小工具',
      ruQuery: 'силиконовая лопатка',
      evidenceCount: 2,
      economics: { priceWeightRatio: 0.33, contributionRate: 0.33 },
      verdict: 'TRY',
      gaps: ['rate_check'],
    },
    {
      niche: '旧尖嘴钳',
      ruQuery: 'плоскогубцы',
      evidenceCount: 0,
      economics: { priceWeightRatio: 0.05, contributionRate: -0.9 },
      verdict: 'REJECT',
      gaps: [],
    },
  ]);
  assert.match(markdown, /细分/);
  assert.match(markdown, /结论/);
  assert.match(markdown, /TRY/);
  assert.match(markdown, /REJECT/);
  assert.match(markdown, /rate_check/);
});

test('runSelect writes the report and holds candidates without evidence', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    addCandidate({ db: handle, candidate: GOOD });
    const writes = [];
    const rows = await runSelect({
      db: handle,
      settings: SETTINGS,
      today: '2026-11-06',
      writeFile: async (path, content) => writes.push({ path, content }),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].verdict, 'HOLD');
    assert.ok(rows[0].gaps.includes('market_evidence'));
    assert.equal(writes.length, 1);
    assert.match(writes[0].path, /selection-2026-11-06\.md$/);
  } finally {
    handle.close();
  }
});

test('holds candidates with missing fields instead of crashing the whole report', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    addCandidate({ db: handle, candidate: { niche: '缺箱规候选', ruQuery: 'q1', priceCny: 200, actualWeightG: 600, form: 'silicone_tool', purchaseCny: 30 } });
    addCandidate({ db: handle, candidate: { niche: '齐全候选', ruQuery: 'q2', priceCny: 200, actualWeightG: 600, dimsCm: { l: 20, w: 15, h: 8 }, form: 'silicone_tool', purchaseCny: 30, evidence: { cards_100plus: 9, top_share: 0.35 } } });
    const writes = [];
    const rows = await runSelect({
      db: handle,
      settings: { fxRubPerCny: 12.257, purchaseCny: 30, domesticFreightCny: 2, packagingCny: 1, commissionRate: 0.13 },
      today: '2026-11-06',
      writeFile: async (path, content) => writes.push({ path, content }),
    });
    assert.equal(rows.length, 2);
    const missing = rows.find((row) => row.niche === '缺箱规候选');
    assert.equal(missing.verdict, 'HOLD');
    assert.ok(missing.gaps.includes('dims_cm'));
    assert.equal(rows.find((row) => row.niche === '齐全候选').verdict, 'TRY');
    assert.equal(writes.length, 1);
  } finally {
    handle.close();
  }
});

test('holds candidates without a purchase cost and does not invent a positive contribution', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    addCandidate({ db: handle, candidate: { niche: '无采购价', ruQuery: 'q3', priceCny: 200, actualWeightG: 600, dimsCm: { l: 20, w: 15, h: 8 }, form: 'silicone_tool' } });
    const rows = await runSelect({
      db: handle,
      settings: { fxRubPerCny: 12.257, domesticFreightCny: 2, packagingCny: 1, commissionRate: 0.13 },
      today: '2026-11-06',
      writeFile: async () => {},
    });
    assert.equal(rows[0].verdict, 'HOLD');
    assert.ok(rows[0].gaps.includes('purchase_cost'));
    assert.equal(rows[0].economics.contributionRate, null);
  } finally {
    handle.close();
  }
});
test('runSelect flags missing listing facts and clears complete ones', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    addCandidate({ db: handle, candidate: { niche: '缺上架数据', ruQuery: 'q4', priceCny: 200, actualWeightG: 600, dimsCm: { l: 20, w: 15, h: 8 }, form: 'silicone_tool', purchaseCny: 30, evidence: { cards_100plus: 9, top_share: 0.35 } } });
    addCandidate({ db: handle, candidate: {
      niche: '上架数据齐全',
      ruQuery: 'q5',
      priceCny: 200,
      actualWeightG: 600,
      dimsCm: { l: 20, w: 15, h: 8 },
      form: 'silicone_tool',
      purchaseCny: 30,
      evidence: { cards_100plus: 9, top_share: 0.35 },
      listingFacts: { categoryId: 1, typeId: 2, weightG: 600, dimsMm: [200, 150, 80], priceRub: 2400, quantity: 20, nameRu: 'Лопатка', descriptionRu: 'Описание', hotTerms: ['лопатка'] },
    } });
    const rows = await runSelect({ db: handle, settings: SETTINGS, today: '2026-11-06', writeFile: async () => {} });
    const missing = rows.find((row) => row.niche === '缺上架数据');
    assert.ok(missing.gaps.includes('listing_facts'));
    const complete = rows.find((row) => row.niche === '上架数据齐全');
    assert.ok(!complete.gaps.includes('listing_facts'));
    for (const code of ['WEIGHT_MISSING', 'DIMENSIONS_MISSING', 'TAGS_MISSING', 'CATEGORY_MISSING']) {
      assert.ok(!complete.gaps.includes(code), `unexpected gap ${code}`);
    }
  } finally {
    handle.close();
  }
});
