import fs from 'node:fs';
import path from 'node:path';

const ENV = '.secrets/ozon.env';
const env = {};
for (const line of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const CID = env.OZON_CLIENT_ID, KEY = env.OZON_API_KEY;
if (!CID || !KEY) { console.error('缺少凭据'); process.exit(2); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(p, body) {
  const r = await fetch('https://api-seller.ozon.ru' + p, {
    method: 'POST',
    headers: { 'Client-Id': CID, 'Api-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t.slice(0, 300) };
}

const WANT = [
  { sku: 'W2', cat: 8631, kw: ['щетк', 'скребок', 'снего'] },
  { sku: 'P1', cat: 30230, kw: ['когтеточ'] },
  { sku: 'H1', cat: 9759, kw: ['уплотнит', 'герметик'] },
  { sku: 'W4', cat: 32170, kw: ['грелк'] },
  { sku: 'B1', cat: 12373, kw: ['когтерез', 'ножниц', 'когт'] }
];

const treeRes = await api('/v1/description-category/tree', { language: 'DEFAULT' });
fs.mkdirSync('raw', { recursive: true }); fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('raw/category-tree.json', JSON.stringify(treeRes.json, null, 1), 'utf8');
console.log('tree status:', treeRes.status, '| result len:', Array.isArray(treeRes.json && treeRes.json.result) ? treeRes.json.result.length : 'n/a');

const roots = (treeRes.json && treeRes.json.result) || [];
const flatCats = [];
function walk(nodes, parentPath) {
  for (const n of nodes) {
    const name = n.category_name || n.type_name || '';
    if (Array.isArray(n.children) && n.children.length) {
      if (n.description_category_id) flatCats.push({ id: n.description_category_id, name: name, path: parentPath });
      walk(n.children, parentPath + '/' + name);
    }
  }
}
walk(roots, '');
console.log('flat categories:', flatCats.length);
for (const w of WANT) {
  const hit = flatCats.find(c => Number(c.id) === w.cat);
  console.log(w.sku + ' cat ' + w.cat + ' -> ' + (hit ? hit.name + '  [' + hit.path + ']' : 'NOT FOUND'));
}
fs.writeFileSync('raw/category-flat.json', JSON.stringify(flatCats, null, 1), 'utf8');