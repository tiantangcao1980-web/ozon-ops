// 目标价格带（¥40–135 ≈ 490–1655 ₽）内的真实竞争画像
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const fx = Number(process.argv[3] || 12.257);
const lo = Number(process.argv[4] || 490), hi = Number(process.argv[5] || 1655);
const niches = JSON.parse(fs.readFileSync(path.join(dir, 'niches.json'), 'utf8'));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, l = Math.floor(i), h = Math.ceil(i); return l === h ? s[l] : s[l] + (s[h] - s[l]) * (i - l); };
const r0 = x => x == null ? null : Math.round(x);
const out = [];
for (const n of niches) {
  const items = (Array.isArray(n.rows) ? n.rows : []).filter(r => r.price);
  const band = items.filter(r => r.price >= lo && r.price <= hi);
  const revs = band.map(r => r.reviews || 0);
  const total = revs.reduce((a, b) => a + b, 0);
  const s = [...band].sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
  const top5 = s.slice(0, 5).reduce((a, b) => a + (b.reviews || 0), 0);
  out.push({
    niche: n.key, total: items.length, band_n: band.length,
    band_share: items.length ? Math.round(band.length / items.length * 1000) / 10 : 0,
    band_p50: r0(q(band.map(r => r.price), .5)),
    band_p50_cny: band.length ? (q(band.map(r => r.price), .5) / fx).toFixed(1) : null,
    band_rev_p50: r0(q(revs, .5)), band_rev_p75: r0(q(revs, .75)),
    band_soft100: band.filter(r => (r.reviews || 0) < 100).length,
    band_soft500: band.filter(r => (r.reviews || 0) < 500).length,
    band_top5_share: total ? Math.round(top5 / total * 1000) / 10 : null,
    band_max_rev: s[0] ? s[0].reviews : null,
  });
}
out.sort((a, b) => (b.band_soft500 || 0) - (a.band_soft500 || 0));
fs.writeFileSync(path.join(dir, 'band-metrics.json'), JSON.stringify(out, null, 1), 'utf8');
const hdr = ['细分','总样本','带内数量','带内占比%','带内价格p50','带内p50=CNY','带内评价p50','带内评价p75','带内<100评','带内<500评','带内Top5评价占比%','带内最高评价'];
const lines = ['| ' + hdr.join(' | ') + ' |', '|' + hdr.map(() => '---').join('|') + '|'];
for (const r of out) lines.push('| ' + [r.niche, r.total, r.band_n, r.band_share, r.band_p50, r.band_p50_cny, r.band_rev_p50, r.band_rev_p75, r.band_soft100, r.band_soft500, r.band_top5_share, r.band_max_rev].map(x => x == null ? '' : x).join(' | ') + ' |');
const md = 'FX 1CNY=' + fx + ' RUB / band ' + lo + '-' + hi + ' RUB\n\n' + lines.join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'band-metrics.md'), md, 'utf8');
console.log(md);