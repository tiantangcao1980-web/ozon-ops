import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
async function api(p, b) { const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { s: r.status, j, t }; }
const descs = JSON.parse(fs.readFileSync('raw/import-payloads/descriptions-ru.json','utf8'));
const imgs = JSON.parse(fs.readFileSync('raw/1688-img/image-map-clean.json','utf8'));
const FX = 12.257;
const RUB = { 'DEMO-W2-1199': [1199,1499], 'DEMO-P1-0699': [699,899], 'DEMO-B1-0799': [799,999], 'DEMO-H1-0699': [699,899], 'DEMO-W4-0799': [799,999] };
const results = [];
for (const [sku, desc] of Object.entries(descs)) {
  const src = JSON.parse(fs.readFileSync('raw/import-payloads/' + sku + '.json','utf8')).items[0];
  const [rub, oldRub] = RUB[sku];
  src.currency_code = 'CNY';
  src.price = (rub / FX).toFixed(2);
  src.old_price = (oldRub / FX).toFixed(2);
  src.description = desc;
  const urls = imgs[sku] || [];
  src.images = urls;
  src.primary_image = urls[0] || '';
  if (sku === 'DEMO-W2-1199') src.weight = 487;
  fs.writeFileSync('raw/import-payloads/' + sku + '.final.json', JSON.stringify({ items: [src] }, null, 2), 'utf8');
  const r = await api('/v3/product/import', { items: [src] });
  const task = r.j && r.j.result && r.j.result.task_id;
  console.log(sku + ' | import ' + r.s + ' task=' + task + ' | desc=' + desc.length + ' | imgs=' + urls.length + ' | price=' + src.price + ' CNY');
  if (!task) { console.log('   ' + r.t.slice(0, 200)); continue; }
  results.push([sku, task]);
  await new Promise(res => setTimeout(res, 1500));
}
console.log('\n=== import info ===');
for (const [sku, task] of results) {
  await new Promise(res => setTimeout(res, 3500));
  const info = await api('/v1/product/import/info', { task_id: task });
  for (const x of ((info.j.result||{}).items || [])) console.log(sku + ' → ' + x.status + ' ' + JSON.stringify(x.errors || []).slice(0, 250));
}