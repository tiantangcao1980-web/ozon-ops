import fs from 'node:fs';
import path from 'node:path';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';
const ROOT = '.';
const OUT = path.join(ROOT, 'assets/design-system/plates');
fs.mkdirSync(OUT, { recursive: true });
const client = new RemoteMcpClient({ timeoutMs: 240000 });
function payload(res) {
  if (res && typeof res === 'object' && res.structuredContent) return res.structuredContent;
  const t = res?.content?.[0]?.text;
  if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } }
  return res;
}
const tool = async (n, a) => payload(await client.callTool(n, a));
const jobs = [
  { sku: 'W2', prompt: 'Photorealistic winter background plate for a product poster: a silver SUV covered with fresh snow parked on a quiet residential street at dusk, warm streetlight glow, falling snow, empty clean foreground, no people, no tools, no text, vertical composition, open sky area in the top third for text.' },
  { sku: 'P1', prompt: 'Photorealistic cozy living room background: light wooden floor, beige fabric sofa, warm afternoon sunlight, a grey tabby cat sitting on the floor looking aside, no scratching board, no product, no text, vertical composition, open wall area in the top third for text.' },
  { sku: 'H1', prompt: 'Photorealistic background: white entrance door with a visible narrow gap at the bottom in a modern hallway, cold blue winter light from outside, no seal strip, no product, no text, vertical composition, open wall area in the top third for text.' },
  { sku: 'W4', prompt: 'Photorealistic cozy background: person relaxing on a sofa wrapped in a soft beige knit blanket, hands empty on lap, warm evening lamp light, no hot water bottle, no product, no text, vertical composition, open area in the top third for text.' },
  { sku: 'B1', prompt: 'Photorealistic background: macro close-up of a fluffy cat paw on a soft light blue-grey studio background, shallow depth of field, no nail clipper, no tools, no text, vertical composition, clean open area in the top third for text.' },
];
const submitted = [];
for (const j of jobs) {
  try {
    const r = await tool('generate_image', { prompt: j.prompt, aspect_ratio: '3:4', n: 1 });
    const id = (r.task_ids || [])[0];
    submitted.push({ ...j, taskId: id, projectId: r.project_id });
    console.log('SUBMIT ' + j.sku + ' ' + id);
  } catch (e) { console.log('FAIL ' + j.sku + ' ' + String(e?.message || e).slice(0, 200)); }
}
for (const s of submitted) {
  let url = null;
  for (let i = 0; i < 24 && !url; i += 1) {
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const st = await tool('get_task_status', { task_id: s.taskId, project_id: s.projectId });
      if (String(st?.status) === 'completed') url = (st.artifacts || [])[0]?.url;
      if (/failed|error/i.test(String(st?.status))) { console.log('TASKFAIL ' + s.sku + ' ' + JSON.stringify(st).slice(0, 200)); break; }
    } catch {}
  }
  if (!url) { console.log('NO_URL ' + s.sku); continue; }
  const resp = await httpRequest({ url, method: 'GET', timeoutMs: 120000 });
  fs.writeFileSync(path.join(OUT, s.sku + '.png'), resp.body);
  console.log('SAVED ' + s.sku + ' ' + resp.body.length);
}
const credits = await tool('get_credits', {});
console.log('CREDITS ' + JSON.stringify(credits));
