import fs from 'node:fs';
const P = 'Ozon-上架物料包-标题属性主图-20261106.md';
let lines = fs.readFileSync(P, 'utf8').split('\n');
const a = fs.readFileSync('raw/_sec-a.md', 'utf8').split('\n');
const w1 = fs.readFileSync('raw/_sec-w1.md', 'utf8').split('\n');
function replaceSection(lines, headingPrefix, newLines) {
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (/^## /.test(lines[i])) starts.push(i);
  const at = starts.find(i => lines[i].startsWith(headingPrefix));
  if (at == null) throw new Error('not found: ' + headingPrefix);
  const next = starts.find(i => i > at);
  const tail = next == null ? [] : lines.slice(next);
  return [...lines.slice(0, at), ...newLines, ...tail];
}
lines = replaceSection(lines, '## 1. SKU-A', a);
lines = replaceSection(lines, '## 4. SKU-W1', w1);
const doc = lines.join('\n');
fs.writeFileSync(P, doc, 'utf8');
const heads = doc.split('\n').filter(l => /^## /.test(l));
console.log('lines=' + lines.length + ' sections=' + heads.length);
console.log(heads.join('\n'));
for (const k of ['на зажиме, а не на скотче', 'Телефон 6.7 дюйма — горизонтально', 'ровной кромкой', 'Ровная кромка — чистит всей плоскостью', 'Жёсткий пластик', 'Способ крепления']) {
  console.log((doc.includes(k) ? 'OK   ' : 'MISS ') + k);
}