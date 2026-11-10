import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
async function api(p, b) { const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { s: r.status, j, t }; }
const WH = 1234567801;
const offers = ['DEMO-W2-1199','DEMO-P1-0699','DEMO-B1-0799','DEMO-H1-0699','DEMO-W4-0799'];
const stocks = offers.map(o => ({ offer_id: o, stock: 20, warehouse_id: WH }));
const r = await api('/v2/products/stocks', { stocks });
console.log('=== 库存上传 HTTP ' + r.s + ' ===');
for (const x of (r.j.result || [])) console.log(' ' + x.offer_id + ' | updated=' + x.updated + ' | ' + JSON.stringify(x.errors || []).slice(0, 100));

console.log('\n=== 状态轮询 ===');
for (let i = 0; i < 6; i++) {
  await new Promise(res => setTimeout(res, 20000));
  const info = await api('/v3/product/info/list', { offer_id: offers });
  const items = info.j.items || [];
  console.log('t+' + (i+1)*20 + 's: ' + items.map(it => it.offer_id.replace('DEMO-','') + '[' + ((it.statuses||{}).status) + '/' + ((it.statuses||{}).status_name) + ']').join(' '));
  fs.writeFileSync('raw/import-results/after-stock2.json', JSON.stringify(info.j, null, 2), 'utf8');
  const selling = items.filter(it => ((it.statuses||{}).status_name || '').indexOf('Продается') >= 0).length;
  if (selling === 5) { console.log('5 个全部在售'); break; }
}
const fin = await api('/v3/product/info/list', { offer_id: offers });
console.log('\n=== 明细 ===');
for (const it of (fin.j.items || [])) {
  const st = it.statuses || {};
  console.log(it.offer_id + ' | ' + st.status + ' | ' + st.status_name + ' | ' + st.status_description + ' | img=' + (it.images||[]).length + ' | stock=' + ((it.visibility_details||{}).has_stock) + ' | sku=' + (it.sku || '-'));
}