import fs from 'node:fs';
import path from 'node:path';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';

const ROOT = '.';
const sku = process.argv[2];
const projectId = process.argv[3];
const pairs = JSON.parse(process.argv[4]); // [{file, taskId}]
const client = new RemoteMcpClient({ timeoutMs: 240000 });
function payload(res) {
  if (res && typeof res === 'object' && res.structuredContent) return res.structuredContent;
  const text = res?.content?.[0]?.text;
  if (typeof text === 'string') { try { return JSON.parse(text); } catch { return { text }; } }
  return res;
}
const tool = async (n, a) => payload(await client.callTool(n, a));

const results = pairs.map((p) => ({ ...p, ok: false, url: null, status: 'pending' }));
const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  const pending = results.filter((r) => !r.ok && !r.failed);
  if (!pending.length) break;
  await new Promise((r) => setTimeout(r, 12000));
  for (const r of pending) {
    try {
      const st = await tool('get_task_status', { task_id: r.taskId, project_id: projectId });
      const status = String(st?.status || '');
      const art = (st?.artifacts || [])[0];
      if (status === 'completed' && art?.url) { r.ok = true; r.status = status; r.url = art.url; console.log('DONE ' + sku + ' ' + r.file + ' ' + art.url); }
      else if (/failed|error|cancel/i.test(status)) { r.failed = true; r.status = status; console.log('FAILED ' + sku + ' ' + r.file + ' ' + JSON.stringify(st).slice(0, 300)); }
    } catch (e) { console.log('ERR ' + r.file + ' ' + String(e?.message || e).slice(0, 200)); }
  }
  console.log('pending ' + results.filter((r) => !r.ok && !r.failed).length);
}

const manifest = { sku, projectId, generatedAt: new Date().toISOString(), items: [] };
for (const r of results) {
  const item = { ...r };
  if (r.ok && r.url) {
    try {
      const dir = path.join(ROOT, 'assets', sku, 'raw');
      fs.mkdirSync(dir, { recursive: true });
      const resp = await httpRequest({ url: r.url, method: 'GET', timeoutMs: 120000 });
      fs.writeFileSync(path.join(dir, r.file + '.png'), resp.body);
      item.localPath = 'assets/' + sku + '/raw/' + r.file + '.png';
      console.log('SAVED ' + item.localPath + ' ' + resp.body.length + ' bytes');
    } catch (e) { item.downloadError = String(e?.message || e); console.log('DL_FAIL ' + r.file + ' ' + item.downloadError.slice(0, 200)); }
  }
  manifest.items.push(item);
}
fs.writeFileSync(path.join(ROOT, 'assets', sku, 'raw-manifest.json'), JSON.stringify(manifest, null, 2));
const credits = await tool('get_credits', {});
console.log('CREDITS ' + JSON.stringify(credits));
console.log('OK ' + manifest.items.filter((i) => i.localPath).length + '/' + pairs.length);
