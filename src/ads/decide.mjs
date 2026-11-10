/**
 * 广告搜索词判定引擎（重建自 2026-11-06 的 reports/ads-decide-*.{json,md} 产物）。
 *
 * 输入：Performance 后台「搜索词报告」CSV（俄/英表头、金额 RUB 或 CNY）。
 * 输出：逐词判定（规则 #1/#2/#4/#5/#8/#10）+ 动作聚合 + 预算分配（§8 权重）。
 * 规则 3/6/7/9 需要两周对照数据，这里只保留结构不做判定。
 */
const HEADER_ALIASES = {
  'поисковыйзапрос': 'term',
  'поисковаяфраза': 'term',
  'поисковыйзапрос/фраза': 'term',
  term: 'term',
  'searchterm': 'term',
  'поисковыйзапрос(фраза)': 'term',
  sku: 'sku',
  артикул: 'sku',
  'sku/广告': 'sku',
  реклама: 'advert',
  advert: 'advert',
  показы: 'impressions',
  impressions: 'impressions',
  клики: 'clicks',
  clicks: 'clicks',
  расход: 'spend',
  spend: 'spend',
  заказы: 'orders',
  orders: 'orders',
  выручка: 'revenue',
  revenue: 'revenue',
  корзины: 'cart',
  'вкорзину': 'cart',
  cart: 'cart',
  'вназвании': 'inTitle',
  вназваниитовара: 'inTitle',
  intitle: 'inTitle',
  'длинныйхвост': 'longTail',
  longtail: 'longTail',
  'названиетовара': 'productName',
  'названиетовара(дляпроверки)': 'productName',
  productname: 'productName',
};

export const DEFAULT_THRESHOLDS = {
  impMin: 3000,
  ctrFail: 0.008,
  clicksMin: 30,
  cartMin: 0.02,
  cvrMin: 0.005,
  clicksGood: 20,
  acosGood: 0.25,
  acosHold: 0.4,
  acosBad: 0.6,
  spendBadCny: 150,
  impTiny: 500,
  ordersTitle: 3,
  budGet: 5000,
  floor: 150,
  cap: 0.4,
};

const ACTIONS = {
  pause: '暂停该词（或降到最低出价）',
  fixCard: '不暂停，先改主图/价格，2 周后再看',
  raise: '加价 10-20%，并加进标题/后台关键词',
  title: '把词加进标题/后台关键词',
  hold: '维持出价，观察 7 天',
  upgrade: '连续 2 周 <=25% 且自然单在涨 -> 升级大词（需第 2 周数据）',
};

function normalizeHeader(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s«»"]/g, '');
  return HEADER_ALIASES[key] ?? null;
}

function parseNumber(raw) {
  const text = String(raw ?? '').trim().replace(/[\s\u00A0]/g, '');
  if (!text) return NaN;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let normalized = text;
  if (lastComma >= 0 && lastDot >= 0) normalized = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  else if (lastComma >= 0) normalized = text.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

export function parseSearchTermCsv(text, { fx = 12.257, spendCurrency = 'RUB' } = {}) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return { rows: [], unknownColumns: [] };
  const sample = lines.slice(0, 3).join('\n');
  const separator = (sample.match(/;/g)?.length ?? 0) >= (sample.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rawHeaders = lines[0].split(separator).map((cell) => cell.trim());
  const headers = rawHeaders.map(normalizeHeader);
  const unknownColumns = rawHeaders.filter((_, index) => !headers[index]);

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(separator).map((cell) => cell.trim());
    const raw = {};
    headers.forEach((header, index) => {
      if (header) raw[header] = cells[index] ?? '';
    });
    if (!raw.term) continue;
    const spend = parseNumber(raw.spend) || 0;
    const revenue = parseNumber(raw.revenue) || 0;
    const normalize = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const termNorm = normalize(raw.term);
    const productNorm = normalize(raw.productName);
    const words = termNorm.split(' ').filter(Boolean).length;
    const inTitle = raw.inTitle != null
      ? /^(да|yes|true|1)$/i.test(String(raw.inTitle).trim())
      : Boolean(productNorm) && productNorm.includes(termNorm);
    const spendCny = spendCurrency === 'CNY' ? spend : spend / fx;
    const revenueCny = revenue / fx;
    rows.push({
      term: raw.term,
      sku: raw.sku ?? '',
      advert: raw.advert ?? '',
      impressions: parseNumber(raw.impressions) || 0,
      clicks: parseNumber(raw.clicks) || 0,
      spendCny: Math.round(spendCny * 100) / 100,
      revenueCny: Math.round(revenueCny * 100) / 100,
      orders: parseNumber(raw.orders) || 0,
      cart: parseNumber(raw.cart) || 0,
      inTitle,
      longTail: raw.longTail == null ? words >= 3 : /^(да|yes|true|1)$/i.test(String(raw.longTail).trim()),
      headTerm: raw.headTerm == null ? words <= 2 : /^(да|yes|true|1)$/i.test(String(raw.headTerm).trim()),
    });
  }
  return { rows: rows.map(enrichRow), unknownColumns };
}

function enrichRow(row) {
  const ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
  const cartRate = row.clicks > 0 ? row.cart / row.clicks : 0;
  const cvr = row.clicks > 0 ? row.orders / row.clicks : 0;
  const acos = row.revenueCny > 0 ? row.spendCny / row.revenueCny : 99;
  const cpc = row.clicks > 0 ? row.spendCny / row.clicks : 0;
  return { ...row, ctr, cartRate, cvr, acos, cpc };
}

/** 规则表：返回 hit 或 null；顺序即优先级（primary = 第一个命中）。 */
const RULES = [
  {
    id: 1,
    level: '低',
    test: (row, t) => row.impressions >= t.impMin && row.ctr < t.ctrFail,
    verdict: '词或商品卡不匹配',
    action: ACTIONS.pause,
  },
  {
    id: 2,
    level: '低',
    test: (row, t) => row.impressions >= t.impMin && row.clicks >= t.clicksMin && row.cartRate < t.cartMin,
    verdict: '商品卡/价格无说服力',
    action: ACTIONS.fixCard,
  },
  {
    id: 4,
    level: '高',
    test: (row, t) => row.clicks >= t.clicksGood && row.acos <= t.acosGood,
    verdict: '词在赚钱',
    action: ACTIONS.raise,
  },
  {
    id: 10,
    level: '中',
    test: (row, t) => !row.inTitle && row.clicks >= t.clicksMin && row.acos <= t.acosGood,
    verdict: '漏词（免费流量入口）',
    action: ACTIONS.title,
  },
  {
    id: 8,
    level: '中',
    test: (row, t) => row.longTail && row.clicks >= 10 && row.orders >= 1 && row.acos <= t.acosGood,
    verdict: '长尾赚钱候选',
    action: ACTIONS.upgrade,
  },
  {
    id: 5,
    level: '中',
    test: (row, t) => row.acos > t.acosGood && row.acos <= t.acosHold && row.clicks >= t.clicksGood,
    verdict: '边缘',
    action: ACTIONS.hold,
  },
];

export function decideSearchTerms(rows, thresholds = DEFAULT_THRESHOLDS) {
  return (rows ?? []).map((row) => {
    const hits = RULES.filter((rule) => rule.test(row, thresholds)).map((rule) => ({
      id: rule.id,
      level: rule.level,
      verdict: rule.verdict,
      action: rule.action,
    }));
    return { ...row, hits, primary: hits[0] ?? null };
  });
}

/**
 * §8 预算分配：W = 广告销售额 / (1 + ACOS)，按 W 占比分预算，再夹在 [floor, cap*budget]。
 */
export function allocateBudget(decidedRows, { budget = 5000, floor = 150, cap = 0.4 } = {}) {
  const groups = new Map();
  for (const row of decidedRows ?? []) {
    const key = row.sku || row.advert || row.term;
    const bucket = groups.get(key) ?? { key, revenueCny: 0, spendCny: 0, orders: 0 };
    bucket.revenueCny += row.revenueCny;
    bucket.spendCny += row.spendCny;
    bucket.orders += row.orders;
    groups.set(key, bucket);
  }
  const list = [...groups.values()].map((group) => {
    const acos = group.revenueCny > 0 ? group.spendCny / group.revenueCny : 9.99;
    const w = group.revenueCny / (1 + acos);
    return { ...group, acos, w };
  });
  const totalW = list.reduce((sum, group) => sum + group.w, 0);
  const capAmount = budget * cap;
  for (const group of list) {
    const raw = totalW > 0 ? (group.w / totalW) * budget : 0;
    group.raw = Math.round(raw * 100) / 100;
    group.alloc = Math.round(Math.min(capAmount, Math.max(floor, raw)) * 100) / 100;
    group.share = Math.round((group.alloc / budget) * 10000) / 10000;
  }
  return list.sort((a, b) => b.w - a.w);
}

export function renderDecideMarkdown({ date, rows, groups, unknownColumns = [], fx = 12.257, spendCur = 'RUB', budget = 5000 }) {
  const decided = rows.filter((row) => row.primary);
  const lines = [
    `# 广告搜索词判定 · ${date}`,
    '',
    `源文件行数 ${rows.length} · 汇率 1 CNY = ${fx} RUB · 花费币种 ${spendCur}`,
    '',
    '## 1. 逐词判定（按花费降序）',
    '',
    '| 搜索词 | 曝光 | 点击 | CTR | 加购率 | CVR | 花费¥ | ACOS | 判定 | 动作 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of [...rows].sort((a, b) => b.spendCny - a.spendCny)) {
    const hit = row.primary;
    lines.push(
      `| ${row.term} | ${row.impressions} | ${row.clicks} | ${(row.ctr * 100).toFixed(2)}% | ${(row.cartRate * 100).toFixed(2)}% | ${(row.cvr * 100).toFixed(2)}% | ${row.spendCny.toFixed(2)} | ${row.acos >= 0.99 ? '>100%' : `${(row.acos * 100).toFixed(2)}%`} | ${hit ? `#${hit.id} ${hit.verdict}` : '无命中'} | ${hit ? hit.action : '—'} |`,
    );
  }
  const byAction = new Map();
  for (const row of decided) {
    const list = byAction.get(row.primary.action) ?? [];
    list.push(row.term);
    byAction.set(row.primary.action, list);
  }
  lines.push('', '## 2. 按动作聚合', '', '| 动作 | 词数 | 词（前 8 个） |', '|---|---|---|');
  for (const [action, terms] of byAction) lines.push(`| ${action} | ${terms.length} | ${terms.slice(0, 8).join(', ')} |`);

  lines.push(
    '',
    '## 3. 预算分配（§8 权重 W = 广告销售额 / (1+ACOS)，下限 150 元 / 上限 40%）',
    '',
    '| SKU/广告 | 广告销售额¥ | 花费¥ | ACOS | 权重W | 下周预算¥ | 占比 |',
    '|---|---|---|---|---|---|---|',
  );
  for (const group of groups) {
    lines.push(
      `| ${group.key} | ${group.revenueCny.toFixed(2)} | ${group.spendCny.toFixed(2)} | ${group.acos >= 0.99 ? '>100%' : `${(group.acos * 100).toFixed(2)}%`} | ${group.w.toFixed(1)} | ${group.alloc.toFixed(2)} | ${(group.share * 100).toFixed(2)}% |`,
    );
  }
  const allocated = groups.reduce((sum, group) => sum + group.alloc, 0);
  const leftover = Math.round((budget - allocated) * 100) / 100;
  if (leftover > 0) lines.push('', `> 上限压制后仍有 ${leftover} 元未分配，留作储备（不要硬塞给某个 SKU）。`);
  if (unknownColumns.length > 0) lines.push('', '## 4. 未识别的列（如有）', ...unknownColumns.map((column) => `- ${column}`));
  lines.push('', '> 规则 8/9 需要两周数据，本次只输出候选；把两周 JSON 都保留，第二周再判定升级/退守。', '');
  return lines.join('\n');
}
