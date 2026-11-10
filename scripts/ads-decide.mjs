/**
 * 广告搜索词判定 CLI（重建版，原名 scripts/ads-decide.mjs）。
 *
 * 用法：
 *   node scripts/ads-decide.mjs --file raw/ads-sample.csv [--fx 12.257] [--budget 5000] [--date YYYY-MM-DD] [--spend-cur RUB]
 *
 * 输出：reports/ads-decide-<date>.md 与 .json（同 ozon ads decide）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  allocateBudget,
  decideSearchTerms,
  parseSearchTermCsv,
  renderDecideMarkdown,
  DEFAULT_THRESHOLDS,
} from '../src/ads/decide.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const file = arg('file');
if (!file) {
  console.error('用法: node scripts/ads-decide.mjs --file <search-terms.csv> [--fx 12.257] [--budget 5000] [--date YYYY-MM-DD] [--spend-cur RUB] [--out-dir reports]');
  process.exit(2);
}

const fx = Number(arg('fx', '12.257'));
const budget = Number(arg('budget', '5000'));
const spendCur = String(arg('spend-cur', 'RUB')).toUpperCase();
const date = arg('date', new Date().toISOString().slice(0, 10));
const outDir = arg('out-dir', join(import.meta.dirname, '..', 'reports'));

const { rows, unknownColumns } = parseSearchTermCsv(readFileSync(file, 'utf8'), { fx, spendCurrency: spendCur });
const decided = decideSearchTerms(rows);
const groups = allocateBudget(decided, { budget, floor: 150, cap: 0.4 });
const markdown = renderDecideMarkdown({ date, rows: decided, groups, unknownColumns, fx, spendCur, budget });

mkdirSync(outDir, { recursive: true });
const mdPath = join(outDir, `ads-decide-${date}.md`);
const jsonPath = join(outDir, `ads-decide-${date}.json`);
writeFileSync(mdPath, markdown, 'utf8');
writeFileSync(
  jsonPath,
  `${JSON.stringify({ date, thresholds: DEFAULT_THRESHOLDS, rows: decided, budgetGroups: groups, unknownColumns }, null, 2)}\n`,
  'utf8',
);

console.log(`搜索词 ${decided.length} 个，有动作 ${decided.filter((row) => row.primary).length} 个`);
console.log(`报告：${mdPath}`);
console.log(`数据：${jsonPath}`);
for (const group of groups) console.log(`  ${group.key}: ${group.alloc.toFixed(0)} 元（ACOS ${(group.acos * 100).toFixed(0)}%）`);
if (unknownColumns.length) console.log(`未识别列：${unknownColumns.join(', ')}`);
