// 把 niches.json 汇总成可决策的市场指标（含"软肋区"：低评价商品的占比与价位）
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const fx = Number(process.argv[3] || 12.257); // RUB per CNY
const niches = JSON.parse(fs.readFileSync(path.join(dir, 'niches.json'), 'utf8'));
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const r0 = (x) => x == null ? null : Math.round(x);
const rows = [];
for (const n of niches) {
  const items = (Array.isArray(n.rows) ? n.rows : []).filter(r => r.price);
  if (!items.length) { rows.push({ niche: n.key, query: n.query, products: 0 }); continue; }
  const prices = items.map(r => r.price);
  const revs = items.map(r => r.reviews || 0);
  const totalRev = revs.reduce((a, b) => a + b, 0);
  const s = [...items].sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
  const top10 = s.slice(0, 10).reduce((a, b) => a + (b.reviews || 0), 0);
  const soft = items.filter(r => (r.reviews || 0) < 100);
  const band = items.filter(r => r.price >= 490 && r.price <= 1500);
  const bandLow = items.filter(r => r.price >= 300 && r.price < 490);
  rows.push({
    niche: n.key, query: n.query, cat: n.meta && n.meta.categoryId, products: items.length,
    p25: r0(q(prices, .25)), p50: r0(q(prices, .5)), p75: r0(q(prices, .75)),
    p50_cny: (q(prices, .5) / fx).toFixed(1),
    rev_p50: r0(q(revs, .5)), rev_p75: r0(q(revs, .75)), rev_p90: r0(q(revs, .9)),
    top10_share: totalRev ? Math.round(top10 / totalRev * 1000) / 10 : null,
    soft_n: soft.length, soft_share: Math.round(soft.length / items.length * 1000) / 10,
    soft_p50: r0(q(soft.map(r => r.price), .5)),
    band_n: band.length, band_share: Math.round(band.length / items.length * 1000) / 10,
    bandLow_n: bandLow.length,
    max_rev: s[0] ? s[0].reviews : null,
  });
}
rows.sort((a, b) => (b.soft_share || 0) - (a.soft_share || 0));
fs.writeFileSync(path.join(dir, 'niche-metrics.json'), JSON.stringify(rows, null, 1), 'utf8');

const hdr = ['细分', '词', '样本', '价格p25', '价格p50', '价格p75', 'p50=¥', '评价p50', '评价p75', '评价p90', 'Top10评价占比%', '低评(<100)数量', '低评占比%', '低评价位p50', '490-1500₽数量', '490-1500₽占比%', '最高评价数'];
const lines = ['| ' + hdr.join(' | ') + ' |', '|' + hdr.map(() => '---').join('|') + '|'];
for (const r of rows) {
  lines.push('| ' + [r.niche, r.query, r.products, r.p25, r.p50, r.p75, r.p50_cny, r.rev_p50, r.rev_p75, r.rev_p90, r.top10_share, r.soft_n, r.soft_share, r.soft_p50, r.band_n, r.band_share, r.max_rev].map(x => x == null ? '' : x).join(' | ') + ' |');
}
const md = 'FX 1CNY=' + fx + ' RUB\n\n' + lines.join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'niche-metrics.md'), md, 'utf8');
console.log(md);
