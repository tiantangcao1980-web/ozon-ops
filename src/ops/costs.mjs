/**
 * 成本表维护（sku_costs）：采购价、国内运费、包装、重量、尺寸。
 * 选品与毛利表都依赖它；没有成本时结论必须是 HOLD。
 */
export function setSkuCost({ db, offerId, purchaseCny, domesticFreightCny = 0, packagingCny = 0, weightG, dimsCm = null, supplier = null, now = () => new Date().toISOString() }) {
  if (!offerId) throw new Error('offerId 必填');
  if (!Number.isFinite(Number(purchaseCny)) || Number(purchaseCny) < 0) throw new Error('purchaseCny 必须是非负数');
  if (!Number.isFinite(Number(weightG)) || Number(weightG) <= 0) throw new Error('weightG 必须是正数（克）');
  const existing = db.db.prepare('SELECT * FROM sku_costs WHERE offer_id = ?').get(String(offerId));
  let dims = existing?.dims_cm ?? null;
  if (dimsCm) {
    const parts = String(dimsCm).split('x').map(Number);
    if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error('dimsCm 必须是 "长x宽x高"（厘米，正数）');
    }
    dims = parts.join('x');
  }
  db.upsert(
    'sku_costs',
    {
      offer_id: String(offerId),
      purchase_cny: Number(purchaseCny),
      domestic_freight_cny: Number(domesticFreightCny) || 0,
      packaging_cny: Number(packagingCny) || 0,
      weight_g: Number(weightG),
      dims_cm: dims,
      supplier: supplier ?? existing?.supplier ?? null,
      updated_at: now(),
    },
    ['offer_id'],
  );
  return { offerId, purchaseCny: Number(purchaseCny), weightG: Number(weightG), dimsCm: dims };
}

export function listSkuCosts({ db }) {
  return db.db.prepare('SELECT * FROM sku_costs ORDER BY offer_id').all();
}

export function renderCostsMarkdown({ costs }) {
  const lines = ['# 成本表', '', '| 商品 | 采购价¥ | 国内运费¥ | 包装¥ | 重量g | 尺寸cm | 供应商 |', '|---|---|---|---|---|---|---|'];
  if (costs.length === 0) lines.push('| — | — | — | — | — | — | 暂无（用 ozon cost set 添加） |');
  for (const cost of costs) {
    lines.push(`| ${cost.offer_id} | ${cost.purchase_cny} | ${cost.domestic_freight_cny} | ${cost.packaging_cny} | ${cost.weight_g} | ${cost.dims_cm ?? '—'} | ${cost.supplier ?? '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}
