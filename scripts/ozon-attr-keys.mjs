import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
async function api(p, body) {
  const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text(); let j=null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j };
}
const pairs = [
  { sku:'W2', catId:17027945, typeId:970741954 },
  { sku:'P1', catId:17028968, typeId:95240 },
  { sku:'B1', catId:17028968, typeId:95239 },
  { sku:'H1', catId:79560974, typeId:94945 },
  { sku:'W4', catId:200001548, typeId:94569 }
];
const brandIds = {}; const countryIds = {}; const typeVals = {};
for (const p of pairs) {
  const b = await api('/v1/description-category/attribute/values/search', { description_category_id: p.catId, type_id: p.typeId, attribute_id: 85, value: 'Нет бренда', limit: 10, language: 'DEFAULT' });
  const bv = (b.json && b.json.result) || [];
  brandIds[p.sku] = bv.slice(0,3).map(v => v.id + '=' + v.value);
  const c = await api('/v1/description-category/attribute/values/search', { description_category_id: p.catId, type_id: p.typeId, attribute_id: 4389, value: 'Китай', limit: 10, language: 'DEFAULT' });
  const cv = (c.json && c.json.result) || [];
  countryIds[p.sku] = cv.slice(0,3).map(v => v.id + '=' + v.value);
  const t = await api('/v1/description-category/attribute/values', { description_category_id: p.catId, type_id: p.typeId, attribute_id: 8229, limit: 50, language: 'DEFAULT' });
  typeVals[p.sku] = ((t.json && t.json.result) || []).map(v => v.id + '=' + v.value);
  console.log(p.sku + ' | brand:' + JSON.stringify(brandIds[p.sku]) + ' | country:' + JSON.stringify(countryIds[p.sku]));
  console.log('   Тип: ' + typeVals[p.sku].join(' / '));
  await new Promise(r => setTimeout(r, 1300));
}
fs.writeFileSync('raw/category-attr-key-ids.json', JSON.stringify({ brandIds, countryIds, typeVals }, null, 1), 'utf8');