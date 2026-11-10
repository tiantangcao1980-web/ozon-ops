import fs from 'node:fs';
import path from 'node:path';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';

const ROOT = '.';
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/image-plan.json'), 'utf8'));
const only = process.argv.slice(2);
const skuList = only.length ? only : Object.keys(plan.skus);

function payload(res) {
  if (res && typeof res === 'object' && res.structuredContent) return res.structuredContent;
  const text = res?.content?.[0]?.text;
  if (typeof text === 'string') { try { return JSON.parse(text); } catch { return { text }; } }
  return res;
}
const client = new RemoteMcpClient({ timeoutMs: 240000 });
const tool = async (n, a) => payload(await client.callTool(n, a));

async function upload(filePath, filename) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const r = await tool('upload_asset', { data_base64: b64, filename });
  return { raw: r, url: r?.url || null };
}

const jobs = [];
const creditsBefore = await tool('get_credits', {});
console.log('CREDITS_BEFORE ' + JSON.stringify(creditsBefore));

for (const sku of skuList) {
  const cfg = plan.skus[sku];
  if (!cfg) { console.log('skip ' + sku); continue; }
  const existing = path.join(ROOT, 'assets', sku, 'raw-manifest.json');
  if (fs.existsSync(existing)) { console.log('SKIP ' + sku + ' (already has raw-manifest)'); continue; }
  let refImages = [];
  if (cfg.source) {
    const abs = path.join(ROOT, cfg.source);
    if (fs.existsSync(abs)) {
      const up = await upload(abs, sku + '-ref.png');
      console.log('UPLOAD ' + sku + ' ' + JSON.stringify(up.raw).slice(0, 300));
      if (up.url) refImages = [up.url];
    }
  }
  let projectId = null;
  for (const img of cfg.images) {
    const args = { prompt: img.prompt, aspect_ratio: '1:1', n: 1 };
    if (refImages.length) args.ref_images = refImages;
    if (projectId) args.project_id = projectId;
    try {
      const r = await tool('generate_image', args);
      if (!projectId && r.project_id) projectId = r.project_id;
      const taskIds = r.task_ids || (r.task_id ? [r.task_id] : []);
      console.log('SUBMIT ' + sku + ' ' + img.file + ' project=' + projectId + ' tasks=' + JSON.stringify(taskIds));
      jobs.push({ sku, file: img.file, taskId: taskIds[0], projectId });
    } catch (e) {
      console.log('SUBMIT_FAIL ' + sku + ' ' + img.file + ' ' + String(e?.message || e).slice(0, 200));
    }
  }
  await new Promise((r) => setTimeout(r, 500));
}

const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  const pending = jobs.filter((j) => j.status !== 'completed' && !j.failed);
  if (!pending.length) break;
  await new Promise((r) => setTimeout(r, 12000));
  for (const j of pending) {
    try {
      const st = await tool('get_task_status', { task_id: j.taskId, project_id: j.projectId });
      const status = String(st?.status || '');
      const art = (st?.artifacts || [])[0];
      if (status === 'completed') { j.status = status; j.url = art?.url || null; console.log('DONE ' + j.sku + ' ' + j.file); }
      else if (/failed|error|cancel/i.test(status)) { j.status = status; j.failed = true; console.log('FAILED ' + j.sku + ' ' + j.file + ' ' + JSON.stringify(st).slice(0, 240)); }
    } catch (e) { console.log('ERR ' + j.file + ' ' + String(e?.message || e).slice(0, 160)); }
  }
  console.log('POLL remaining=' + jobs.filter((j) => j.status !== 'completed' && !j.failed).length);
}

// download and group per sku
const bySku = new Map();
for (const j of jobs) {
  const item = { ...j };
  if (j.status === 'completed' && j.url) {
    try {
      const dir = path.join(ROOT, 'assets', j.sku, 'raw');
      fs.mkdirSync(dir, { recursive: true });
      const resp = await httpRequest({ url: j.url, method: 'GET', timeoutMs: 120000 });
      fs.writeFileSync(path.join(dir, j.file + '.png'), resp.body);
      item.localPath = 'assets/' + j.sku + '/raw/' + j.file + '.png';
      console.log('SAVED ' + item.localPath + ' ' + resp.body.length);
    } catch (e) { item.downloadError = String(e?.message || e); }
  }
  if (!bySku.has(j.sku)) bySku.set(j.sku, []);
  bySku.get(j.sku).push(item);
}
for (const [sku, items] of bySku) {
  const projectId = items[0]?.projectId || null;
  fs.writeFileSync(path.join(ROOT, 'assets', sku, 'raw-manifest.json'), JSON.stringify({ sku, projectId, generatedAt: new Date().toISOString(), items }, null, 2));
  console.log('MANIFEST ' + sku + ' ok=' + items.filter((i) => i.localPath).length + '/' + items.length);
}
const creditsAfter = await tool('get_credits', {});
console.log('CREDITS_AFTER ' + JSON.stringify(creditsAfter));
