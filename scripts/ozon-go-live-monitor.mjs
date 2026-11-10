import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
const WH = 1234567801;
const offers = ['DEMO-W2-1199','DEMO-P1-0699','DEMO-B1-0799','DEMO-H1-0699','DEMO-W4-0799'];
async function api(p, b) { const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { s: r.status, j, t }; }
const log = (m) => { const s = new Date().toISOString().slice(11,19) + ' ' + m; console.log(s); fs.appendFileSync('reports/go-live.log', s + '\n'); };
for (let round = 1; round <= 40; round++) {
  const info = await api('/v3/product/info/list', { offer_id: offers });
  const items = info.j.items || [];
  const pending = items.filter(it => ((it.statuses||{}).status_name || '').indexOf('Продается') < 0).map(it => it.offer_id);
  let stockMsg = '无需补库存';
  if (pending.length) {
    const st = await api('/v2/products/stocks', { stocks: pending.map(o => ({ offer_id: o, stock: 20, warehouse_id: WH })) });
    stockMsg = (st.j.result || []).map(x => x.offer_id.replace('DEMO-','') + (x.updated ? '=OK' : '=' + ((x.errors||[])[0]||{}).code)).join(' ');
  }
  const live = items.filter(it => ((it.statuses||{}).status_name || '').indexOf('Продается') >= 0).map(it => it.offer_id.replace('DEMO-',''));
  log('r' + round + ' live=' + live.length + ' [' + live.join(',') + '] | 库存: ' + stockMsg + ' | 状态: ' + items.map(it => it.offer_id.replace('DEMO-','') + '[' + ((it.statuses||{}).status) + ']').join(' '));
  fs.writeFileSync('raw/import-results/last-status.json', JSON.stringify(items.map(it => ({ o: it.offer_id, st: it.statuses, sku: it.sku, img: (it.images||[]).length, vd: it.visibility_details })), null, 2), 'utf8');
  if (live.length === 5) { log('全部 5 个在售，结束监控'); break; }
  await new Promise(r => setTimeout(r, 90000));
}