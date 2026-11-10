import { mkdirSync } from 'node:fs';
import { writeFile as writeFileFs } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluateCandidate } from '../rules/selection.mjs';
import { normalizeFacts, listingDataGaps } from '../content/listing-facts.mjs';

const CSV_COLUMNS = [
  'ru_query',
  'cards_total',
  'cards_100plus',
  'cards_recent_reviews',
  'avg_price_rub',
  'sellers_count',
  'top_share',
];

export function addCandidate({ db, candidate }) {
  const info = db.db
    .prepare(
      'INSERT INTO candidates (niche, ru_query, spec_json, evidence_json, verdict, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      candidate.niche,
      candidate.ruQuery ?? null,
      JSON.stringify(candidate),
      candidate.evidence ? JSON.stringify([candidate.evidence]) : null,
      'PENDING',
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * 导入人工采集的市场证据（CSV）。每行写进 candidates.evidence_json 数组。
 */
export function importEvidence({ db, candidateId, csvText }) {
  const lines = String(csvText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { imported: 0, skipped: 0 };

  const header = parseCsvLine(lines[0]);
  const index = (name) => header.indexOf(name);
  const required = CSV_COLUMNS.filter((name) => index(name) === -1);
  if (required.length > 0) throw new Error(`CSV 缺少列：${required.join('、')}`);

  const existingRow = db.db.prepare('SELECT evidence_json FROM candidates WHERE id = ?').get(candidateId);
  if (!existingRow) throw new Error(`候选 ${candidateId} 不存在`);
  const evidence = existingRow.evidence_json ? JSON.parse(existingRow.evidence_json) : [];

  let imported = 0;
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length < CSV_COLUMNS.length) {
      skipped += 1;
      continue;
    }
    const record = {
      ru_query: cells[index('ru_query')],
      cards_total: Number(cells[index('cards_total')]),
      cards_100plus: Number(cells[index('cards_100plus')]),
      cards_recent_reviews: Number(cells[index('cards_recent_reviews')]),
      avg_price_rub: Number(cells[index('avg_price_rub')]),
      sellers_count: Number(cells[index('sellers_count')]),
      top_share: Number(cells[index('top_share')]),
    };
    if (!record.ru_query || Object.values(record).some((value) => typeof value === 'number' && Number.isNaN(value))) {
      skipped += 1;
      continue;
    }
    evidence.push(record);
    imported += 1;
  }

  db.db
    .prepare('UPDATE candidates SET evidence_json = ?, verdict = ? WHERE id = ?')
    .run(JSON.stringify(evidence), evidence.length > 0 ? 'EVIDENCE_READY' : 'PENDING', candidateId);
  return { imported, skipped };
}

const REQUIRED_FIELDS = [
  ['priceCny', 'price_cny'],
  ['actualWeightG', 'actual_weight_g'],
  ['dimsCm', 'dims_cm'],
];

function missingFieldGaps(spec, settings) {
  const gaps = [];
  for (const [field, token] of REQUIRED_FIELDS) {
    if (spec[field] === undefined || spec[field] === null) gaps.push(token);
  }
  const purchase = spec.purchaseCny ?? settings.purchaseCny;
  if (purchase === undefined || purchase === null || purchase <= 0) gaps.push('purchase_cost');
  return gaps;
}

const INCOMPLETE_ECONOMICS = {
  priceWeightRatio: null,
  contributionRate: null,
  contributionCny: null,
  tier: null,
  labels: { rate_confidence: 'E' },
};

export function renderSelectionReport(rows) {
  const lines = [
    '| 细分 | 俄语词 | 证据条数 | 价重比 | 贡献率 | 结论 | 缺口 |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const ratio = row.economics?.priceWeightRatio ?? '—';
    const rate = row.economics?.contributionRate == null ? '—' : `${(row.economics.contributionRate * 100).toFixed(1)}%`;
    lines.push(
      `| ${row.niche} | ${row.ruQuery ?? '—'} | ${row.evidenceCount} | ${ratio} | ${rate} | ${row.verdict} | ${row.gaps.length ? row.gaps.join('、') : '—'} |`,
    );
  }
  return lines.join('\n');
}

export async function runSelect({
  db,
  settings,
  today = new Date().toISOString().slice(0, 10),
  reportsDir = join(process.cwd(), 'reports'),
  writeFile = (path, content) => writeFileFs(path, content, 'utf8'),
}) {
  const candidates = db.db.prepare('SELECT * FROM candidates ORDER BY id').all();
  const rows = candidates.map((row) => {
    const spec = row.spec_json ? JSON.parse(row.spec_json) : {};
    const evidence = row.evidence_json ? JSON.parse(row.evidence_json) : [];
    const mergedEvidence = evidence.length > 0 ? evidence[0] : undefined;
    const missing = missingFieldGaps(spec, settings);

    let verdict;
    let gaps;
    let score = null;
    let economics;
    if (missing.length > 0) {
      verdict = 'HOLD';
      gaps = [...missing, ...(mergedEvidence ? [] : ['market_evidence'])];
      economics = INCOMPLETE_ECONOMICS;
    } else {
      const evaluated = evaluateCandidate({ ...spec, evidence: mergedEvidence }, settings);
      verdict = evaluated.verdict;
      gaps = evaluated.gaps;
      score = evaluated.score;
      economics = evaluated.economics;
    }

    // 选品阶段就把上架要填的数据收齐：重量/尺寸/数量/条码/标签/简介，缺什么写进缺口列。
    const listingSource = spec.listingFacts ?? spec.listing ?? null;
    if (listingSource) {
      gaps = [...gaps, ...listingDataGaps(normalizeFacts({ offerId: spec.offerId ?? spec.ruQuery ?? row.niche, ...listingSource }))];
    } else if (verdict !== 'REJECT') {
      gaps = [...gaps, 'listing_facts'];
    }

    db.db
      .prepare('UPDATE candidates SET score = ?, verdict = ? WHERE id = ?')
      .run(score, verdict, row.id);
    return {
      niche: row.niche,
      ruQuery: row.ru_query,
      evidenceCount: evidence.length,
      economics,
      verdict,
      gaps,
      blockers: missing,
    };
  });

  const markdown = `# 选品评估 · ${today}\n\n${renderSelectionReport(rows)}\n`;
  mkdirSync(reportsDir, { recursive: true });
  const path = join(reportsDir, `selection-${today}.md`);
  await writeFile(path, markdown);
  return rows.map((row) => ({ ...row, reportPath: path }));
}

export { CSV_COLUMNS };