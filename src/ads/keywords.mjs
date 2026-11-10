/**
 * 关键词包：把广告搜索词判定的结果转成可执行的上架素材。
 *
 * - titleCandidates：判定「漏词/赚钱」且当前不在标题里的词 → 建议补进标题
 * - backendKeywords：所有赚钱词/长尾候选/漏词 → 后台关键词（去重、按规则优先级排序）
 * - avoid：词或商品卡不匹配、无说服力的词 → 不要写进标题/关键词
 */
const WIN_RULES = new Set([4, 8, 10]);

export function buildKeywordPack(decidedRows = [], { limit = 40 } = {}) {
  const winners = [];
  const titleCandidates = [];
  const avoid = [];
  const hits = {};

  for (const row of decidedRows) {
    const term = String(row?.term ?? '').trim();
    if (!term) continue;
    const ids = (row.hits ?? []).map((hit) => hit.id);
    hits[term] = ids.join('+');
    const primary = ids[0];
    if (primary === 1 || primary === 2 || ids.includes(2)) {
      avoid.push(term);
      continue;
    }
    if (ids.some((id) => WIN_RULES.has(id))) {
      winners.push({ term, ids, priority: ids.includes(4) ? 0 : ids.includes(10) ? 1 : 2, inTitle: Boolean(row.inTitle) });
    }
  }

  winners.sort((a, b) => a.priority - b.priority);
  for (const winner of winners) {
    if (!winner.inTitle && (winner.ids.includes(10) || winner.ids.includes(4))) titleCandidates.push(winner.term);
  }

  const dedupe = (list) => [...new Set(list)];
  return {
    titleCandidates: dedupe(titleCandidates).slice(0, limit),
    backendKeywords: dedupe(winners.map((winner) => winner.term)).slice(0, limit),
    avoid: dedupe(avoid).slice(0, limit),
    hits,
  };
}

export function renderKeywordPackMarkdown({ date, pack, sku = null }) {
  const lines = [
    `# 关键词包 · ${date}${sku ? ` · ${sku}` : ''}`,
    '',
    '## 标题补充（当前不在标题里，且词在赚钱 / 属漏词）',
    '',
    ...(pack.titleCandidates.length ? pack.titleCandidates.map((term) => `- ${term}`) : ['- 无']),
    '',
    '## 后台关键词（复制到后台「Ключевые слова」）',
    '',
    '```',
    pack.backendKeywords.join(', ') || '',
    '```',
    '',
    '## 不要用（词或商品卡不匹配 / 无说服力）',
    '',
    ...(pack.avoid.length ? pack.avoid.map((term) => `- ${term}`) : ['- 无']),
    '',
  ];
  return lines.join('\n');
}
