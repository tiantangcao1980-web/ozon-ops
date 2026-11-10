// 单件经济模型：OGL 真实费率 + 佣金 + 广告 + 退货计提
// 用法: node unit-econ.mjs candidates.json [fx]
import fs from 'node:fs';
const fx = Number(process.argv[3] || 12.257); // RUB per CNY
const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const E_SERVICE_RATE = 11.2174; // 官方示例 RUB/CNY，仅用于电子服务费换算
const TIERS = [
  { name: 'Extra Small', vmin: 0.01, vmax: 135, wmin: 1, wmax: 500, fix: 2.90, per: 0.0247, dim: false },
  { name: 'Budget', vmin: 0.01, vmax: 135, wmin: 501, wmax: 35000, fix: 22.25, per: 0.0164, dim: false },
  { name: 'Small', vmin: 135.01, vmax: 635, wmin: 1, wmax: 2000, fix: 15.48, per: 0.0242, dim: false },
  { name: 'Big', vmin: 135.01, vmax: 635, wmin: 2001, wmax: 35000, fix: 34.82, per: 0.0164, dim: true },
  { name: 'Premium Small', vmin: 635.01, vmax: 22525, wmin: 1, wmax: 5000, fix: 21.28, per: 0.0242, dim: false },
  { name: 'Premium Big', vmin: 635.01, vmax: 22525, wmin: 5001, wmax: 35000, fix: 59.97, per: 0.0222, dim: true },
];
function calc(c) {
  const retailCny = c.price_rub / fx;
  const value = c.cost_cny + (c.domestic_cny == null ? 3 : c.domestic_cny);
  const dimW = c.dims ? Math.max(1, (c.dims[0] * c.dims[1] * c.dims[2]) / 12) : 0;
  let tier = TIERS.find(t => value >= t.vmin && value <= t.vmax && c.weight_g >= t.wmin && c.weight_g <= t.wmax);
  if (!tier && dimW) tier = TIERS.find(t => t.dim && value >= t.vmin && value <= t.vmax && dimW >= t.wmin && dimW <= t.wmax);
  if (!tier) return { ...c, error: 'no tier (value=' + value.toFixed(1) + ' weight=' + c.weight_g + ')' };
  const billW = tier.dim ? Math.max(c.weight_g, dimW) : c.weight_g;
  const ship = tier.fix + tier.per * billW;
  const esvc = Math.min(200, Math.max(15, value * E_SERVICE_RATE * 0.02)) / E_SERVICE_RATE;
  const commission = retailCny * (c.commission_pct / 100);
  const acquiring = retailCny * 0.002;
  const ads = retailCny * (c.ads_pct == null ? 12 : c.ads_pct) / 100;
  const returns = retailCny * (c.returns_pct == null ? 6 : c.returns_pct) / 100;
  const pack = c.pack_cny == null ? 2 : c.pack_cny;
  const totalCost = c.cost_cny + (c.domestic_cny == null ? 3 : c.domestic_cny) + pack + ship + esvc + commission + acquiring + ads + returns;
  const profit = retailCny - totalCost;
  return { key: c.key, price_rub: c.price_rub, price_cny: +retailCny.toFixed(1), weight_g: c.weight_g, value_cny: +value.toFixed(1), tier: tier.name, bill_w: Math.round(billW), ship: +ship.toFixed(2), ship_pct: +(ship / retailCny * 100).toFixed(1), esvc: +esvc.toFixed(2), commission: +commission.toFixed(2), ads: +ads.toFixed(2), returns: +returns.toFixed(2), cost_total: +totalCost.toFixed(2), profit: +profit.toFixed(2), margin_pct: +(profit / retailCny * 100).toFixed(1) };
}
const out = items.map(calc);
const cols = ['key', 'price_rub', 'price_cny', 'weight_g', 'value_cny', 'tier', 'bill_w', 'ship', 'ship_pct', 'esvc', 'commission', 'ads', 'returns', 'cost_total', 'profit', 'margin_pct'];
const hdr = ['方案','售价₽','售价¥','实重g','货值¥','档位','计费重g','运输¥','运输占比%','电子费¥','佣金¥','广告¥','退货¥','总成本¥','单件毛利¥','毛利率%'];
const md = ['| ' + hdr.join(' | ') + ' |', '|' + hdr.map(() => '---').join('|') + '|'];
for (const r of out) { if (r.error) { md.push('| ' + r.key + ' | ERROR: ' + r.error + ' |'); continue; } md.push('| ' + cols.map(c => r[c]).join(' | ') + ' |'); }
console.log(md.join('\n'));
fs.writeFileSync(process.argv[2].replace(/\.json$/, '') + '-econ.json', JSON.stringify(out, null, 1), 'utf8');