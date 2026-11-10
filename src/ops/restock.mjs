/**
 * 补货预测：用「最新库存快照 + 近 30 天销量（订单明细）」算覆盖天数与建议补货量。
 * 纯函数 + 一个读库函数，不调 API。
 */
export const DEFAULTS = { windowDays: 30, leadTimeDays: 14, safetyDays: 14, packSize: 1 };

export function extractSoldFromPostings(postings, { since } = {}) {
  const sinceMs = since ? new Date(since).getTime() : 0;
  const sold = new Map();
  for (const posting of postings ?? []) {
    const created = new Date(posting.created_at ?? 0).getTime();
    if (Number.isFinite(sinceMs) && sinceMs > 0 && (!Number.isFinite(created) || created < sinceMs)) continue;
    let items;
    try {
      items = JSON.parse(posting.items_json ?? '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const offerId = item?.offer_id ?? item?.offerId;
      if (!offerId) continue;
      sold.set(offerId, (sold.get(offerId) ?? 0) + (Number(item.quantity) || 0));
    }
  }
  return sold;
}

export function computeRestockPlan({
  available = 0,
  sold30 = 0,
  leadTimeDays = DEFAULTS.leadTimeDays,
  safetyDays = DEFAULTS.safetyDays,
  packSize = DEFAULTS.packSize,
} = {}) {
  const velocity = Math.round((sold30 / 30) * 100) / 100;
  const daysOfCover = velocity > 0 ? Math.round((available / velocity) * 10) / 10 : null;
  const targetUnits = velocity * (leadTimeDays + safetyDays);
  const rawQty = Math.max(0, Math.ceil(targetUnits - available));
  const pack = Math.max(1, Math.round(packSize) || 1);
  const suggestedQty = Math.ceil(rawQty / pack) * pack;
  let urgency = 'P2';
  if (daysOfCover !== null && daysOfCover <= leadTimeDays) urgency = 'P0';
  else if (daysOfCover !== null && daysOfCover <= leadTimeDays + safetyDays) urgency = 'P1';
  if (velocity === 0) urgency = 'P2';
  return { velocity, daysOfCover, targetUnits: Math.ceil(targetUnits), suggestedQty, urgency };
}

export function buildRestockPlan({ db, now = () => new Date(), windowDays = DEFAULTS.windowDays, leadTimeDays = DEFAULTS.leadTimeDays, safetyDays = DEFAULTS.safetyDays }) {
  const since = new Date(now().getTime() - windowDays * 86_400_000).toISOString();
  const postings = db.db
    .prepare('SELECT posting_number, created_at, items_json FROM postings WHERE created_at >= ?')
    .all(since);
  const sold = extractSoldFromPostings(postings, { since });

  // 每个 SKU 的最新库存快照
  const stockRows = db.db
    .prepare(
      `WITH latest AS (SELECT sku, MAX(captured_at) AS captured_at FROM stocks GROUP BY sku)
       SELECT p.offer_id, p.name, p.sku, COALESCE(SUM(s.present - s.reserved), 0) AS available
       FROM products p
       JOIN stocks s ON s.sku = p.sku
       JOIN latest l ON l.sku = s.sku AND l.captured_at = s.captured_at
       WHERE p.archived = 0
       GROUP BY p.sku`,
    )
    .all();

  return stockRows
    .map((row) => {
      const sold30 = sold.get(row.offer_id) ?? 0;
      const plan = computeRestockPlan({ available: Number(row.available) || 0, sold30, leadTimeDays, safetyDays });
      return { offerId: row.offer_id, name: row.name, sku: row.sku, available: Number(row.available) || 0, sold30, ...plan };
    })
    .sort((a, b) => {
      const order = { P0: 0, P1: 1, P2: 2 };
      return (order[a.urgency] ?? 9) - (order[b.urgency] ?? 9) || b.sold30 - a.sold30;
    });
}

export function renderRestockMarkdown({ date, plans, windowDays = DEFAULTS.windowDays, leadTimeDays = DEFAULTS.leadTimeDays }) {
  const lines = [
    `# 补货预测 · ${date}`,
    '',
    `口径：近 ${windowDays} 天订单明细销量、提前期 ${leadTimeDays} 天、安全库存 ${DEFAULTS.safetyDays} 天。`,
    '',
    '| 商品 | 可用库存 | 近30天销量 | 日均 | 覆盖天数 | 建议补货 | 级别 |',
    '|---|---|---|---|---|---|---|',
  ];
  if (plans.length === 0) lines.push('| — | — | — | — | — | — | 无在售商品或无库存数据 |');
  for (const plan of plans) {
    lines.push(
      `| ${plan.offerId} ${plan.name ?? ''} | ${plan.available} | ${plan.sold30} | ${plan.velocity} | ${plan.daysOfCover ?? '—'} | ${plan.suggestedQty} | ${plan.urgency} |`,
    );
  }
  lines.push('', '> 补货量按 (提前期+安全库存)×日均 − 当前可用 向上取整；为 0 表示暂不需补。', '');
  return lines.join('\n');
}
