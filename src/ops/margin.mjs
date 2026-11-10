/**
 * SKU 毛利表：最新售价 + 成本表 + 六档单位经济，输出单件贡献与状态。
 * 缺成本/汇率时返回 HOLD + gaps，不给假数字。
 */
import { computeUnitEconomics } from '../rules/economics.mjs';

export function computeSkuMargins({ db, fxRubPerCny }) {
  const products = db.db.prepare('SELECT offer_id, name, sku, archived FROM products ORDER BY offer_id').all();
  const results = [];
  for (const product of products) {
    const price = db.db
      .prepare('SELECT price_cny, captured_at FROM prices WHERE offer_id = ? ORDER BY captured_at DESC LIMIT 1')
      .get(product.offer_id);
    const cost = db.db.prepare('SELECT * FROM sku_costs WHERE offer_id = ?').get(product.offer_id);
    if (!price?.price_cny) {
      results.push({ offerId: product.offer_id, name: product.name, sku: product.sku, archived: product.archived, status: 'HOLD', gaps: ['price_missing'] });
      continue;
    }
    if (!cost) {
      results.push({
        offerId: product.offer_id,
        name: product.name,
        sku: product.sku,
        archived: product.archived,
        priceCny: price.price_cny,
        status: 'HOLD',
        gaps: ['cost_missing'],
      });
      continue;
    }
    let dimsCm = { l: 0, w: 0, h: 0 };
    try {
      const parts = String(cost.dims_cm ?? '').split('x').map(Number);
      if (parts.length === 3 && parts.every((value) => Number.isFinite(value) && value > 0)) dimsCm = { l: parts[0], w: parts[1], h: parts[2] };
    } catch {
      dimsCm = { l: 0, w: 0, h: 0 };
    }
    const gaps = [];
    if (dimsCm.l === 0) gaps.push('dims_missing');
    if (!Number.isFinite(Number(cost.weight_g)) || Number(cost.weight_g) <= 0) gaps.push('weight_missing');
    try {
      const economics = computeUnitEconomics({
        priceCny: Number(price.price_cny),
        fxRubPerCny,
        purchaseCny: Number(cost.purchase_cny ?? 0),
        domesticFreightCny: Number(cost.domestic_freight_cny ?? 0),
        packagingCny: Number(cost.packaging_cny ?? 0),
        actualWeightG: Number(cost.weight_g) || 1,
        dimsCm,
      });
      const status = economics.contributionRate < 0 ? 'NEGATIVE' : gaps.length > 0 ? 'INCOMPLETE' : economics.contributionRate < 0.1 ? 'THIN' : 'OK';
      results.push({
        offerId: product.offer_id,
        name: product.name,
        sku: product.sku,
        archived: product.archived,
        priceCny: Number(price.price_cny),
        logisticsCny: economics.logisticsCny,
        totalCostCny: economics.totalCostCny,
        contributionCny: economics.contributionCny,
        contributionRate: economics.contributionRate,
        tier: economics.tier,
        status,
        gaps,
      });
    } catch (error) {
      results.push({
        offerId: product.offer_id,
        name: product.name,
        sku: product.sku,
        archived: product.archived,
        priceCny: Number(price.price_cny),
        status: 'HOLD',
        gaps: [error?.code === 'INVALID_FX' ? 'fx_invalid' : 'invalid_input'],
        error: String(error?.message ?? error),
      });
    }
  }
  return results.sort((a, b) => (b.contributionRate ?? -9) - (a.contributionRate ?? -9));
}

export function renderMarginMarkdown({ date, rows, fxRubPerCny }) {
  const lines = [
    `# SKU 毛利表 · ${date}`,
    '',
    `汇率：1 CNY = ${fxRubPerCny} RUB · 口径：单件贡献（含 OGL 物流、电子费、佣金、收单、退货与广告计提）`,
    '',
    '| 商品 | 售价¥ | 物流¥ | 总成本¥ | 单件贡献¥ | 贡献率 | 档位 | 状态 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const fmt = (value) => (typeof value === 'number' ? value.toFixed(2) : '—');
    const rate = typeof row.contributionRate === 'number' ? `${(row.contributionRate * 100).toFixed(1)}%` : '—';
    lines.push(`| ${row.offerId} ${row.name ?? ''} | ${fmt(row.priceCny)} | ${fmt(row.logisticsCny)} | ${fmt(row.totalCostCny)} | ${fmt(row.contributionCny)} | ${rate} | ${row.tier ?? '—'} | ${row.status}${row.gaps?.length ? `（缺 ${row.gaps.join('/')}）` : ''} |`);
  }
  lines.push('', '> HOLD 表示缺成本/汇率/参数，不给建议；补齐 sku_costs 后重跑。', '');
  return lines.join('\n');
}
