import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
async function api(p, b) { const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { s: r.status, j, t }; }
const per = JSON.parse(fs.readFileSync('raw/lovart/per-sku.json','utf8'));
const ids = { 'W2': 'DEMO-W2-1199', 'P1': 'DEMO-P1-0699', 'B1': 'DEMO-B1-0799', 'H1': 'DEMO-H1-0699', 'W4': 'DEMO-W4-0799' };
for (const [k, offer] of Object.entries(ids)) {
  const m = per[k] || {};
  const imgs = [m.main, m.scene, m.detail].filter(Boolean);
  if (!imgs.length) { console.log(k + ' 无图，跳过'); continue; }
  const r = await api('/v2/product/pictures/import', { items: [{ offer_id: offer, images: imgs, primary_image: imgs[0] }] });
  console.log(k + ' (' + offer + ') ' + imgs.length + ' 张 → HTTP ' + r.s + ' ' + r.t.slice(0, 120));
  await new Promise(res => setTimeout(res, 1500));
}