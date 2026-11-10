import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.secrets/ozon.env','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2]) env[m[1]] = m[2].trim().replace(/^[\"']+|[\"']+$/g, '');
}
const cid = env.OZON_CLIENT_ID || '', key = env.OZON_API_KEY || '';
console.log('clientId len=' + cid.length + ' digits=' + /^[0-9]+$/.test(cid) + ' preview=' + cid.slice(0,3) + '***');
console.log('apiKey len=' + key.length + ' preview=' + key.slice(0,4) + '***');
const r = await fetch('https://api-seller.ozon.ru/v1/description-category/tree', {
  method: 'POST', headers: { 'Client-Id': cid, 'Api-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'DEFAULT' })
});
const t = await r.text();
console.log('tree ->', r.status, '::', t.slice(0, 200).replace(/\s+/g,' '));