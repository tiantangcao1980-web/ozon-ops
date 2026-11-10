import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
async function api(p, b) { const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { s: r.status, j, t }; }
const map = JSON.parse(fs.readFileSync('raw/1688-img/image-map.json','utf8'));
const clean = {};
for (const [sku, arr] of Object.entries(map)) {
  const urls = [...new Set(arr.map(u => u.replace(/_\.webp$/,'').replace(/_$/,'').replace(/_sum\.jpg$/,'')))]
    .filter(u => /\.(jpg|jpeg|png)$/i.test(u)).slice(0, 5);
  clean[sku] = urls;
  console.log(sku + ' → ' + urls.length + ' 张 | 主图: ' + urls[0]);
}
fs.writeFileSync('raw/1688-img/image-map-clean.json', JSON.stringify(clean, null, 2), 'utf8');
const probe = await fetch(clean['DEMO-W2-1199'][0], { method: 'HEAD' });
console.log('\n主图可达性: HTTP ' + probe.status + ' | type=' + probe.headers.get('content-type') + ' | len=' + probe.headers.get('content-length'));
console.log('\n=== 上传图片 ===');
for (const [sku, urls] of Object.entries(clean)) {
  if (!urls.length) { console.log(sku + ' 跳过（无图）'); continue; }
  const r = await api('/v2/product/pictures/import', { items: [{ offer_id: sku, images: urls, primary_image: urls[0] }] });
  console.log(sku + ' → HTTP ' + r.s + ' ' + r.t.slice(0, 160));
  await new Promise(res => setTimeout(res, 1200));
}