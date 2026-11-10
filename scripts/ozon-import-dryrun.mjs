import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };

// ---- SKU 配置（类目/属性/字典值均已用 Seller API 实测）----
const A = (id, dict, val) => ({ id: id, values: dict ? [{ dictionary_value_id: dict, value: val }] : [{ value: val }] });
const BRAND = () => A(85, 126745801, 'Нет бренда');
const COUNTRY = () => A(4389, 90296, 'Китай');
const SKUS = [
  { code: 'W2', offer: 'DEMO-W2-1199', cat: 17027945, type: 970741954, price: '1199', old: '1499', w: 450, dims: [80, 450, 120],
    name: 'DEMO-W2-1199', attrs: [BRAND(), A(8229, 970741954, 'Щетка автомобильная'), A(9048, null, 'DEMO-W2-1199'), A(10096, 61574, 'черный'), A(7199, 61704, 'ABS пластик'), COUNTRY()] },
  { code: 'P1', offer: 'DEMO-P1-0699', cat: 17028968, type: 95240, price: '699', old: '899', w: 400, dims: [30, 400, 300],
    name: 'DEMO-P1-0699', attrs: [BRAND(), A(8229, 95240, 'Когтеточка'), A(9048, null, 'DEMO-P1-0699'), A(10096, 61575, 'коричневый'), COUNTRY()] },
  { code: 'B1', offer: 'DEMO-B1-0799', cat: 17028968, type: 95239, price: '799', old: '999', w: 80, dims: [30, 160, 100],
    name: 'DEMO-B1-0799', attrs: [BRAND(), A(8229, 95239, 'Когтерез'), { id: 4958, values: [{ dictionary_value_id: 33754, value: 'Для кошек' }, { dictionary_value_id: 33746, value: 'Для собак' }] }, A(9048, null, 'DEMO-B1-0799'), A(4967, 61969, 'Нержавеющая сталь'), A(10096, 61571, 'белый'), COUNTRY()] },
  { code: 'H1', offer: 'DEMO-H1-0699', cat: 79560974, type: 94945, price: '699', old: '899', w: 200, dims: [50, 200, 150],
    name: 'DEMO-H1-0699', attrs: [BRAND(), A(8229, 94945, 'Уплотнитель для окон, дверей'), A(9048, null, 'DEMO-H1-0699'), A(23507, 972886109, 'Лента'), A(10096, 61574, 'черный'), COUNTRY()] },
  { code: 'W4', offer: 'DEMO-W4-0799', cat: 200001548, type: 94569, price: '799', old: '999', w: 300, dims: [60, 280, 160],
    name: 'DEMO-W4-0799', attrs: [BRAND(), A(8229, 94569, 'Грелка'), A(9048, null, 'DEMO-W4-0799'), A(8219, 62059, 'Резина'), A(10096, 61579, 'красный'), COUNTRY()] }
];

// ---- 从 CSV 取标题（真实文案）----
function splitCsv(line){const c=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='\"'){if(line[i+1]==='\"'){cur+='\"';i++;}else q=false;}else cur+=ch;}else{if(ch==='\"')q=true;else if(ch===','){c.push(cur);cur='';}else cur+=ch;}}c.push(cur);return c;}
const csvLines = fs.readFileSync('assets/listing-batch-5sku.csv','utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
const head = splitCsv(csvLines[0]);
const titles = {};
for (const l of csvLines.slice(1)) { const c = splitCsv(l); const i = head.indexOf('title_ru'); titles[c[0]] = c[i]; }

// ---- 组装 payload ----
const items = [];
const report = [];
for (const s of SKUS) {
  const title = titles[s.code] || '';
  const item = {
    offer_id: s.offer,
    name: title,
    description_category_id: s.cat,
    type_id: s.type,
    price: s.price,
    old_price: s.old,
    currency_code: 'RUB',
    vat: '0',
    weight: s.w,
    weight_unit: 'g',
    depth: s.dims[0], width: s.dims[1], height: s.dims[2],
    dimension_unit: 'mm',
    attributes: s.attrs,
    images: [],
    primary_image: '',
    barcode: ''
  };
  items.push(item);
  const problems = [];
  if (!title) problems.push('缺标题');
  if (title.length < 110 || title.length > 170) problems.push('标题长度 ' + title.length + '（要求 110–170）');
  if (!s.w) problems.push('缺重量');
  if (!s.price) problems.push('缺价格');
  problems.push('缺图片（images/primary_image 为空，必须实拍后再提交）');
  problems.push('vat 暂填 0，需财务确认跨境卖家适用税率');
  report.push({ code: s.code, offer: s.offer, cat: s.cat, type: s.type, price: s.price, weight: s.w, titleLen: title.length, problems });
}
const payload = { items };
fs.mkdirSync('raw/import-payloads', { recursive: true });
fs.writeFileSync('raw/import-payloads/all-5-sku.json', JSON.stringify(payload, null, 2), 'utf8');
for (const it of items) fs.writeFileSync('raw/import-payloads/' + it.offer_id + '.json', JSON.stringify({ items: [it] }, null, 2), 'utf8');

// ---- 校验密钥是否具备写权限 ----
let roleText = '';
try {
  const r = await fetch('https://api-seller.ozon.ru/v1/roles', { method: 'POST', headers: H, body: '{}' });
  const j = await r.json();
  const roles = (j && j.result) || [];
  roleText = 'HTTP ' + r.status + '，角色数 ' + roles.length + '：' + JSON.stringify(roles).slice(0, 600);
} catch (e) { roleText = '查询失败: ' + e.message; }

// ---- 报告 ----
const md = ['# 5 个 SKU 的上架请求体 dry-run（未提交）· 2026-11-09', ''];
md.push('依据 `/v3/product/import` 真实 schema（必填：`description_category_id / type_id / offer_id / price`）。');
md.push('');
md.push('| SKU | offer_id | 类目 | 类型 | 价格 | 重(g) | 标题长度 | 待补 |');
md.push('|---|---|---|---|---|---|---|---|');
for (const r of report) md.push('| ' + r.code + ' | ' + r.offer + ' | ' + r.cat + ' | ' + r.type + ' | ' + r.price + ' | ' + r.weight + ' | ' + r.titleLen + ' | ' + r.problems.join('；') + ' |');
md.push('');
md.push('## 密钥权限');
md.push('');
md.push(roleText);
md.push('');
md.push('## 文件');
md.push('');
md.push('- `raw/import-payloads/all-5-sku.json`：5 条一起提交用');
md.push('- `raw/import-payloads/DEMO-*.json`：单条调试用');
md.push('');
md.push('## 提交前必须补齐');
md.push('');
md.push('1. **图片**：`images` 至少 1 张 + `primary_image`；Ozon 要求白底主图 ≥ 700×700。');
md.push('2. **实称重量**：现在用的是估算值（W2 450 g 必须复核 ≤500 g）。');
md.push('3. **vat**：跨境卖家税率需财务确认（当前占位 0）。');
md.push('4. **barcode**：rFBS 可留空由 Ozon 生成，若自贴标需填。');
md.push('5. **写权限**：确认密钥有商品写权限，否则 `import` 会 403。');
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/import-dryrun-2026-11-09.md', md.join('\n'), 'utf8');
console.log('payloads written to raw/import-payloads/');
for (const r of report) console.log(r.code + ' ' + r.offer + ' titleLen=' + r.titleLen + ' problems=' + r.problems.length);
console.log('roles:', roleText.slice(0, 300));