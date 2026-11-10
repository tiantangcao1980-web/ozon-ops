import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[<>\"'\s]+|[<>\"'\s]+$/g, '');
}
const H = { 'Client-Id': env.OZON_CLIENT_ID, 'Api-Key': env.OZON_API_KEY, 'Content-Type': 'application/json' };
const file = process.argv[2] || 'raw/import-payloads/DEMO-W2-1199.json';
const body = fs.readFileSync(file, 'utf8');
const item = JSON.parse(body).items[0];
console.log('提交文件:', file);
console.log('offer_id:', item.offer_id, '| name len:', item.name.length, '| cat:', item.description_category_id, '/', item.type_id, '| price:', item.price);

const r = await fetch('https://api-seller.ozon.ru/v3/product/import', { method: 'POST', headers: H, body: body });
const t = await r.text();
console.log('\n[v3/product/import] HTTP', r.status);
console.log(t.slice(0, 800));
let j = null; try { j = JSON.parse(t); } catch {}
fs.mkdirSync('raw/import-results', { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.writeFileSync('raw/import-results/submit-' + ts + '.json', JSON.stringify({ file: file, status: r.status, response: j || t }, null, 2), 'utf8');

const taskId = j && (j.result && j.result.task_id);
if (!taskId) { console.log('\n没有 task_id，提交未通过校验'); process.exit(0); }
console.log('\ntask_id =', taskId, '→ 轮询结果');
for (let i = 0; i < 8; i++) {
  await new Promise(res => setTimeout(res, 4000));
  const ir = await fetch('https://api-seller.ozon.ru/v1/product/import/info', { method: 'POST', headers: H, body: JSON.stringify({ task_id: taskId }) });
  const it = await ir.text();
  let ij = null; try { ij = JSON.parse(it); } catch {}
  const items = (ij && ij.result && ij.result.items) || [];
  console.log('poll ' + (i + 1) + ': HTTP ' + ir.status + ' items=' + items.length);
  if (items.length) {
    for (const x of items) console.log('   offer=' + x.offer_id + ' status=' + x.status + ' errors=' + JSON.stringify(x.errors || []).slice(0, 300));
    fs.writeFileSync('raw/import-results/info-' + ts + '.json', JSON.stringify(ij, null, 2), 'utf8');
    const pending = items.some(x => /pending|processing|imported/i.test(String(x.status || '')) && !(x.errors && x.errors.length));
    if (!pending) break;
  }
}