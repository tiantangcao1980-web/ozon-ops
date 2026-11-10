import fs from 'node:fs';
import path from 'node:path';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';

const ROOT = '.';
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/image-plan.json'), 'utf8'));
const BATCH = 6;
const client = new RemoteMcpClient({ timeoutMs: 240000 });
function payload(res) {
  if (res && typeof res === 'object' && res.structuredContent) return res.structuredContent;
  const t = res?.content?.[0]?.text;
  if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } }
  return res;
}
const tool = async (n, a) => payload(await client.callTool(n, a));

function readJson(p, d = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

const creditsBefore = await tool('get_credits', {});
console.log('CREDITS_BEFORE ' + JSON.stringify(creditsBefore));

// per-sku context
const ctx = {};
for (const sku of Object.keys(plan.skus)) {
  const cfg = plan.skus[sku];
  const dir = path.join(ROOT, 'assets', sku);
  const raw = (name) => path.join(dir, 'raw', name + '.png');
  const manifestPath = path.join(dir, 'raw-manifest.json');
  const manifest = readJson(manifestPath, { sku, projectId: null, generatedAt: null, items: [] });
  const pending = cfg.images.filter((img) => !fs.existsSync(raw(img.file)));
  ctx[sku] = { cfg, dir, raw, manifest, manifestPath, pending, refUrl: null, projectId: manifest.projectId || null, newItems: [] };
  if (pending.length) console.log('PENDING ' + sku + ' ' + pending.map((p) => p.file).join(','));
}

// upload references for skus with pending work
for (const sku of Object.keys(ctx)) {
  const c = ctx[sku];
  if (!c.pending.length) continue;
  if (c.cfg.source) {
    const cache = readJson(path.join(c.dir, 'ref-url.json'), null);
    if (cache?.url) { c.refUrl = cache.url; console.log('REF cached ' + sku); }
    else {
      const abs = path.join(ROOT, c.cfg.source);
      if (fs.existsSync(abs)) {
        const b64 = fs.readFileSync(abs).toString('base64');
        const r = await tool('upload_asset', { data_base64: b64, filename: sku + '-ref.png' });
        if (r?.url) { c.refUrl = r.url; writeJson(path.join(c.dir, 'ref-url.json'), { url: r.url }); console.log('REF uploaded ' + sku + ' ' + r.url); }
        else console.log('REF upload failed ' + sku + ' ' + JSON.stringify(r).slice(0, 200));
      }
    }
  }
}

// build queue
const queue = [];
for (const sku of Object.keys(ctx)) for (const img of ctx[sku].pending) queue.push({ sku, img });
console.log('QUEUE ' + queue.length);

let done = 0, failed = 0;
for (let i = 0; i < queue.length; i += BATCH) {
  const batch = queue.slice(i, i + BATCH);
  const submitted = [];
  for (const item of batch) {
    const c = ctx[item.sku];
    const args = { prompt: item.img.prompt, aspect_ratio: '1:1', n: 1 };
    if (c.refUrl) args.ref_images = [c.refUrl];
    if (c.projectId) args.project_id = c.projectId;
    try {
      const r = await tool('generate_image', args);
      if (r?.error) { console.log('SUBMIT_ERR ' + item.sku + ' ' + item.img.file + ' ' + JSON.stringify(r.error).slice(0, 160)); failed += 1; continue; }
      if (!c.projectId && r.project_id) c.projectId = r.project_id;
      const taskId = (r.task_ids || [])[0];
      submitted.push({ ...item, taskId });
      console.log('SUBMIT ' + item.sku + ' ' + item.img.file + ' ' + taskId);
    } catch (e) { console.log('SUBMIT_THROW ' + item.sku + ' ' + item.img.file + ' ' + String(e?.message || e).slice(0, 160)); failed += 1; }
  }
  // wait for this batch
  let deadline = Date.now() + 4 * 60 * 1000;
  for (const s of submitted) s.status = 'pending';
  while (Date.now() < deadline && submitted.some((s) => s.status === 'pending')) {
    await new Promise((r) => setTimeout(r, 10000));
    for (const s of submitted.filter((x) => x.status === 'pending')) {
      try {
        const st = await tool('get_task_status', { task_id: s.taskId, project_id: ctx[s.sku].projectId });
        const status = String(st?.status || '');
        if (status === 'completed') { s.status = 'completed'; s.url = (st.artifacts || [])[0]?.url; }
        else if (/failed|error|cancel/i.test(status)) { s.status = 'failed'; s.error = st?.error || st; }
      } catch (e) { /* retry next tick */ }
    }
  }
  for (const s of submitted) {
    const c = ctx[s.sku];
    const rec = { sku: s.sku, file: s.img.file, taskId: s.taskId, projectId: c.projectId, status: s.status, url: s.url || null };
    if (s.status === 'completed' && s.url) {
      try {
        const dir = path.join(c.dir, 'raw'); fs.mkdirSync(dir, { recursive: true });
        const resp = await httpRequest({ url: s.url, method: 'GET', timeoutMs: 120000 });
        fs.writeFileSync(path.join(dir, s.img.file + '.png'), resp.body);
        rec.localPath = 'assets/' + s.sku + '/raw/' + s.img.file + '.png';
        done += 1; console.log('SAVED ' + rec.localPath + ' ' + resp.body.length);
      } catch (e) { rec.downloadError = String(e?.message || e); failed += 1; console.log('DL_FAIL ' + s.sku + ' ' + s.img.file); }
    } else { failed += 1; console.log('BATCH_FAIL ' + s.sku + ' ' + s.img.file + ' ' + JSON.stringify(s.error || 'timeout').slice(0, 200)); }
    c.newItems.push(rec);
  }
}

for (const sku of Object.keys(ctx)) {
  const c = ctx[sku];
  if (!c.newItems.length) continue;
  const merged = [...(c.manifest.items || []).filter((i) => !c.newItems.some((n) => n.file === i.file)), ...c.newItems];
  writeJson(c.manifestPath, { sku, projectId: c.projectId || c.manifest.projectId, generatedAt: new Date().toISOString(), items: merged });
  console.log('MANIFEST ' + sku + ' files=' + merged.filter((i) => i.localPath).length);
}

const creditsAfter = await tool('get_credits', {});
console.log('CREDITS_AFTER ' + JSON.stringify(creditsAfter));
console.log('DONE_BATCH ok=' + done + ' failed=' + failed);
