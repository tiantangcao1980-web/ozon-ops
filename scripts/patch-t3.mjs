import fs from 'node:fs';
const P = 'Ozon-上架物料包-标题属性主图-20261106.md';
let lines = fs.readFileSync(P, 'utf8').split('\n');
const sec = fs.readFileSync('raw/_sec-t3.md', 'utf8').split('\n');
function idx(prefix) { for (let i = 0; i < lines.length; i++) if (lines[i].startsWith(prefix)) return i; return -1; }
const a = idx('## 7. SKU-W3'); const b = idx('## 10. 通用上架检查清单');
if (a < 0 || b < 0) throw new Error('anchors missing ' + a + ' ' + b);
lines = [...lines.slice(0, a), ...sec, ...lines.slice(b)];
const doc = lines.join('\n');
fs.writeFileSync(P, doc, 'utf8');
const heads = doc.split('\n').filter(l => /^## /.test(l));
console.log('lines=' + lines.length);
console.log(heads.join('\n'));
for (const k of ['Наушники для ушей зимние теплые меховые', 'Ушко для сушки', '5,5 м — реальная', 'Реальная длина 5,5 м']) console.log((doc.includes(k) ? 'OK   ' : 'MISS ') + k);