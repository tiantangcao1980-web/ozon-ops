import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
async function api(p, b) { const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { s: r.status, j, t }; }
const fmt = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const from = fmt(new Date(now.getTime() - 6 * 86400000));
const to = fmt(now);
const METRICS = ['hits_view_search','hits_view_pdp','hits_view','hits_tocart','session_view_pdp','ordered_units','revenue'];
const an = await api('/v1/analytics/data', { date_from: from, date_to: to, dimension: ['sku'], metrics: METRICS, limit: 1000, offset: 0 });
const rows = (((an.j||{}).result||{}).data) || [];
console.log('区间 ' + from + ' ~ ' + to + ' | 行数 ' + rows.length + ' | HTTP ' + an.s);
const our = ['1234567861','1234567864','1234567865','1234567862','1234567863'];
const NAME = { '1234567861': 'P1 猫抓板', '1234567864': 'H1 门缝条', '1234567865': 'W2 扫雪刷', '1234567862': 'B1 指甲剪', '1234567863': 'W4 热水袋' };
const pick = rows.filter(r => our.indexOf((r.dimensions||[])[0] && (r.dimensions||[])[0].id) >= 0);
const out = [];
for (const r of pick) {
  const id = r.dimensions[0].id;
  const m = r.metrics || [];
  const rec = { sku: id, name: NAME[id] || r.dimensions[0].name, 搜索曝光: m[0], 商品页曝光: m[1], 总曝光: m[2], 加购: m[3], 商品页会话: m[4], 下单件数: m[5], 销售额: m[6] };
  out.push(rec);
}
out.sort((a,b) => b.商品页曝光 - a.商品页曝光);
console.log('');
for (const r of out) console.log(`${r.name} | 搜索曝光 ${r.搜索曝光} | 商品页曝光 ${r.商品页曝光} | 加购 ${r.加购} | 会话 ${r.商品页会话} | 下单 ${r.下单件数} | 销售额 ${r.销售额}`);
const missing = our.filter(s => !out.some(r => r.sku === s));
if (missing.length) console.log('无数据 SKU: ' + missing.join(', '));
fs.mkdirSync('raw/traffic', { recursive: true });
fs.writeFileSync('raw/traffic/baseline-' + to + '.json', JSON.stringify({ from, to, rows: out }, null, 2), 'utf8');
const csv = 'date,sku,name,hits_search,hits_pdp,hits_total,tocart,sessions,ordered,revenue\n' + out.map(r => [to, r.sku, r.name, r.搜索曝光, r.商品页曝光, r.总曝光, r.加购, r.商品页会话, r.下单件数, r.销售额].join(',')).join('\n');
fs.writeFileSync('raw/traffic/traffic-' + to + '.csv', csv, 'utf8');
console.log('\n已保存 raw/traffic/baseline-' + to + '.json + traffic-' + to + '.csv');