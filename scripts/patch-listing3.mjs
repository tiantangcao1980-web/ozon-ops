import fs from 'node:fs';
// 1) CSV 标题同步
const CP = 'assets/listing-batch-1.csv';
let lines = fs.readFileSync(CP, 'utf8').split(/\r?\n/);
const titles = {
  A1: 'Органайзер в машину на панель и дверь на зажиме, карман для телефона до 6.7 дюйма и очков из экокожи, не отклеивается, черный',
  W1: 'Скребок для льда и снега автомобильный с ровной кромкой, чистит всей плоскостью, морозостойкий до −40 °C, для стёкол и зеркал'
};
function setTitle(line, t) {
  const cells = []; let cur = ''; let q = false;
  for (let j = 0; j < line.length; j++) { const c = line[j];
    if (c === '"') { if (q && line[j+1] === '"') { cur += '"'; j++; } else q = !q; }
    else if (c === ',' && !q) { cells.push(cur); cur = ''; } else cur += c; }
  cells.push(cur); cells[2] = t;
  return cells.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',');
}
lines = lines.map(l => { for (const k of Object.keys(titles)) if (l.startsWith(k + ',')) return setTitle(l, titles[k]); return l; });
fs.writeFileSync(CP, lines.join('\r\n'), 'utf8');

// 2) 在 §0.3 后插入「已按痛点重写」索引
const P = 'Ozon-上架物料包-标题属性主图-20261106.md';
let doc = fs.readFileSync(P, 'utf8');
const block = [
  '',
  '### 0.4 哪些 SKU 已按真实差评重写（以及它们的“第一卖点”）',
  '',
  '| SKU | 第一卖点（来自差评） | 差评证据 |',
  '|---|---|---|',
  '| **A 车载收纳** | Держится на зажиме, а не на скотче | «скотч вообще не держит» 出现 10 次，1★ 占 10% |',
  '| **W1 除冰刮** | Ровная кромка — чистит всей плоскостью | «чистят только края», «посередине огромный просвет» |',
  '| **W2 扫雪刷** | Мягкая щетина — не царапает кузов | YouTube 685 000 播放 + «щетина жёсткая» |',
  '| **P1 猫抓板** | Не оставляет крошек | YouTube 439 000 播放 + «пришла в негодность за 1,5 месяца» |',
  '',
  '> 其余 SKU（B/C/W3/W4/H1）只是做了局部回填，未做整篇重写。',
  ''
].join('\n');
const anchor = '## 1. SKU-A';
doc = doc.replace(anchor, block + '\n' + anchor);
fs.writeFileSync(P, doc, 'utf8');
console.log('doc bytes=' + doc.length);
for (const l of fs.readFileSync(CP, 'utf8').split(/\r?\n/)) if (/^(A1|W1),/.test(l)) console.log(l.slice(0, 140));