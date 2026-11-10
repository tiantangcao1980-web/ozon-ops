// 分析 niches.json -> 每个细分类目的真实市场指标
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const fx = Number(process.argv[3] || 12.2570); // RUB per 1 CNY
const niches = JSON.parse(fs.readFileSync(path.join(dir, 'niches.json'), 'utf8'));

const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const cny = (rub) => rub == null ? null : Math.round(rub / fx);

const rows = [];
for (const n of niches) {
  const items = (n.rows || []).filter(r => r.price);
  const prices = items.map(r => r.price);
  const reviews = items.map(r => r.reviews || 0);
  const totalRev = reviews.reduce((a, b) => a + b, 0);
  const sorted = [...items].sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
  const top10Rev = sorted.slice(0, 10).reduce((a, b) => a + (b.reviews || 0), 0);
  const disc = items.map(r => { const m = String(r.discount || '').match(/(\d+)/); return m ? Number(m[1]) : null; }).filter(x => x != null);
  const inBand = items.filter(r => r.price >= 490 && r.price <= 1500).length;
  const reviewsGte100 = items.filter(r => (r.reviews || 0) >= 100).length;
  rows.push({
    niche: n.key, query: n.query, categoryId: n.meta && n.meta.categoryId, pages: n.pages,
    products: items.length,
    price_med_rub: q(prices, 0.5), price_p25_rub: q(prices, 0.25), price_p75_rub: q(prices, 0.75),
    price_med_cny: cny(q(prices, 0.5)),
    price_min_rub: prices.length ? Math.min(...prices) : null,
    price_max_rub: prices.length ? Math.max(...prices) : null,
    reviews_total: totalRev,
    reviews_med: q(reviews, 0.5),
    reviews_gte100: reviewsGte100,
    top10_review_share: totalRev ? Math.round(top10Rev / totalRev * 1000) / 10 : null,
    max_reviews: sorted[0] ? sorted[0].reviews : null,
    max_reviews_name: sorted[0] ? sorted[0].name : null,
    disc_med: q(disc, 0.5),
    in_490_1500_share: items.length ? Math.round(inBand / items.length * 1000) / 10 : null,
  });
}
rows.sort((a, b) => (b.reviews_total || 0) - (a.reviews_total || 0));
const cols = ['niche', 'query', 'categoryId', 'products', 'price_med_rub', 'price_med_cny', 'price_p25_rub', 'price_p75_rub', 'reviews_total', 'reviews_med', 'reviews_gte100', 'top10_review_share', 'max_reviews', 'disc_med', 'in_490_1500_share'];
const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => {
  let v = r[c]; if (v == null) return ''; v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}).join(','))).join('\r\n');
fs.writeFileSync(path.join(dir, 'niche-stats.csv'), csv, 'utf8');
console.log(csv);
console.log('\nFX RUB/CNY=' + fx + '  dir=' + dir);
