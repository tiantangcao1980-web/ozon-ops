import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) { const m=line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/); if(m&&m[2]) env[m[1]]=m[2].trim(); }
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
const cases = [
  ['tree empty', '/v1/description-category/tree', {}],
  ['tree lang', '/v1/description-category/tree', { language: 'DEFAULT' }],
  ['tree RU', '/v1/description-category/tree', { language: 'RU' }],
  ['attr probe', '/v1/description-category/attribute', { description_category_id: 8631, type_id: 98058, language: 'DEFAULT' }]
];
for (const [name, p, body] of cases) {
  const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  console.log('== ' + name + ' -> ' + r.status + ' :: ' + t.slice(0, 240).replace(/\s+/g,' '));
}