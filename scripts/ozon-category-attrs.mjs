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
  return { status: r.status, json: j, text: t.slice(0, 200) };
}
// 1) 全树找 грелка
const tree = JSON.parse(fs.readFileSync('raw/category-tree.json','utf8'));
const hits = [];
function walk(ns, p) {
  for (const n of ns) {
    const nm = String(n.category_name || n.type_name || '');
    if (/грел/i.test(nm)) hits.push({ path: p, catId: n.description_category_id, typeId: n.type_id, name: nm });
    if (n.children) walk(n.children, p + '/' + (n.category_name || ''));
  }
}
walk(tree.result || [], '');
console.log('грелка hits:'); for (const h of hits.slice(0, 10)) console.log('  ' + JSON.stringify(h));

// 2) 拉 5 个 SKU 的类目属性
const PAIRS = [
  { sku: 'W2', catId: 17027945, typeId: 970741954, catName: 'Товары для уборки, чистки автомобиля', typeName: 'Щетка автомобильная' },
  { sku: 'P1', catId: 17028968, typeId: 95240, catName: 'Товар для ухода за животными', typeName: 'Когтеточка' },
  { sku: 'B1', catId: 17028968, typeId: 95239, catName: 'Товар для ухода за животными', typeName: 'Когтерез' },
  { sku: 'H1', catId: 79560974, typeId: 94945, catName: 'Изоляционные материалы', typeName: 'Уплотнитель для окон, дверей' },
  { sku: 'W1', catId: 17027945, typeId: 92201, catName: 'Товары для уборки, чистки автомобиля', typeName: 'Скребок автомобильный' }
];
const all = {};
for (const p of PAIRS) {
  const res = await api('/v1/description-category/attribute', { description_category_id: p.catId, type_id: p.typeId, language: 'DEFAULT' });
  const attrs = (res.json && res.json.result) || [];
  all[p.sku] = { ...p, status: res.status, attrs };
  const req = attrs.filter(a => a.is_required);
  console.log(p.sku + ' ' + p.typeName + ' -> ' + res.status + ' attrs=' + attrs.length + ' required=' + req.length);
  await sleep(1300);
}
fs.mkdirSync('raw', { recursive: true });
fs.writeFileSync('raw/category-attrs.json', JSON.stringify(all, null, 1), 'utf8');

// 3) 生成报告
const md = ['# Ozon 类目必填属性（Seller API 实测）· 2026-11-09', '', '接口：`POST /v1/description-category/attribute`（免费，无需 Premium）', ''];
for (const p of PAIRS) {
  const d = all[p.sku];
  md.push('## ' + p.sku + ' · ' + d.catName + ' / ' + d.typeName);
  md.push('');
  md.push('category_id=' + p.catId + ' · type_id=' + p.typeId + ' · 属性 ' + d.attrs.length + ' 个，其中必填 ' + d.attrs.filter(a => a.is_required).length + ' 个');
  md.push('');
  md.push('| 必填属性名 | 属性ID | 类型 | 字典ID | 说明 |');
  md.push('|---|---|---|---|---|');
  for (const a of d.attrs.filter(x => x.is_required).slice(0, 30)) {
    md.push('| ' + a.name + ' | ' + a.id + ' | ' + a.type + ' | ' + (a.dictionary_id || '—') + ' | ' + (a.description || '').slice(0, 50) + ' |');
  }
  md.push('');
}
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/category-attrs-2026-11-09.md', md.join('\n'), 'utf8');
console.log('wrote raw/category-attrs.json + reports/category-attrs-2026-11-09.md');