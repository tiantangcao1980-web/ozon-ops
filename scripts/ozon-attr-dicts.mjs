import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(p, body) {
  const r = await fetch('https://api-seller.ozon.ru' + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t.slice(0, 160) };
}
const pairs = [
  { sku: 'W2', catId: 17027945, typeId: 970741954 },
  { sku: 'P1', catId: 17028968, typeId: 95240 },
  { sku: 'B1', catId: 17028968, typeId: 95239 },
  { sku: 'H1', catId: 79560974, typeId: 94945 },
  { sku: 'W4', catId: 200001548, typeId: 94569 },
  { sku: 'W1', catId: 17027945, typeId: 92201 }
];
const out = {};
for (const p of pairs) {
  const attrRes = await api('/v1/description-category/attribute', { description_category_id: p.catId, type_id: p.typeId, language: 'DEFAULT' });
  const attrs = (attrRes.json && attrRes.json.result) || [];
  const rec = { catId: p.catId, typeId: p.typeId, attrs: attrs, dicts: {} };
  const dictAttrs = attrs.filter(a => a.dictionary_id);
  const wanted = dictAttrs.filter(a => a.is_required || /бренд|^тип$|цвет|материал|предназначено|страна|особенност|комплектац|вес|габарит|размер/i.test(a.name));
  for (const a of wanted.slice(0, 6)) {
    const vRes = await api('/v1/description-category/attribute/values', { description_category_id: p.catId, type_id: p.typeId, attribute_id: a.id, limit: 200, language: 'DEFAULT' });
    const vals = (vRes.json && vRes.json.result) || [];
    rec.dicts[a.id] = { name: a.name, dictId: a.dictionary_id, count: vals.length, values: vals.slice(0, 120).map(v => ({ id: v.id, value: v.value })) };
    console.log(p.sku + ' attr ' + a.id + ' ' + a.name + ' -> ' + vRes.status + ' values=' + vals.length);
    await sleep(1200);
  }
  out[p.sku] = rec;
  await sleep(800);
}
fs.writeFileSync('raw/category-attr-dicts.json', JSON.stringify(out, null, 1), 'utf8');
console.log('saved raw/category-attr-dicts.json');
// 打印关键字典里含 'нет бренда' / 'грелк' / 'щетк' 的候选
for (const sku of Object.keys(out)) {
  const d = out[sku].dicts;
  for (const k of Object.keys(d)) {
    const hit = d[k].values.filter(v => /нет бренда/i.test(v.value)).slice(0, 3);
    if (hit.length) console.log(sku + ' БРЕНД候选: ' + JSON.stringify(hit));
  }
}