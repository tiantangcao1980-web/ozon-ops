import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
async function api(p, b) { const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { s: r.status, j, t }; }
const per = JSON.parse(fs.readFileSync('raw/lovart/per-sku.json','utf8'));
const vids = JSON.parse(fs.readFileSync('raw/lovart/video-urls-10s.json','utf8'));
const vid = Object.fromEntries(vids.map(v => [v.sku, v.url]));
const plan = [
  ['W2', 'raw/import-payloads/DEMO-W2-1199.scraper.json'],
  ['P1', 'raw/import-payloads/DEMO-P1-0699.final.json'],
  ['B1', 'raw/import-payloads/DEMO-B1-0799.final.json'],
  ['H1', 'raw/import-payloads/DEMO-H1-0699.white2.json'],
  ['W4', 'raw/import-payloads/DEMO-W4-0799.final.json']
];
for (const [k, f] of plan) {
  const item = JSON.parse(fs.readFileSync(f,'utf8')).items[0];
  item.images = [per[k].main, per[k].scene, per[k].detail].filter(Boolean);
  item.primary_image = item.images[0];
  item.complex_attributes = [{ attributes: [
    { complex_id: 100001, id: 21841, values: [{ value: vid[k] }] },
    { complex_id: 100001, id: 21837, values: [{ value: 'video_1' }] }
  ]}];
  const r = await api('/v3/product/import', { items: [item] });
  const task = r.j && r.j.result && r.j.result.task_id;
  console.log(k + ' video import -> ' + r.s + ' task=' + task + (task ? '' : ' :: ' + r.t.slice(0, 300)));
  await new Promise(res => setTimeout(res, 1800));
}