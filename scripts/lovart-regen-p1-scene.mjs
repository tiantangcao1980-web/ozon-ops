import fs from 'node:fs';
import path from 'node:path';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';
const ROOT = '.';
const client = new RemoteMcpClient({ timeoutMs: 240000 });
function payload(res) {
  if (res && typeof res === 'object' && res.structuredContent) return res.structuredContent;
  const t = res?.content?.[0]?.text;
  if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } }
  return res;
}
const tool = async (n, a) => payload(await client.callTool(n, a));
const refPath = path.join(ROOT, 'assets/P1/ref-small.jpg');
const b64 = fs.readFileSync(refPath).toString('base64');
const up = await tool('upload_asset', { data_base64: b64, filename: 'p1-main-ref.jpg' });
console.log('UPLOAD ' + JSON.stringify(up).slice(0, 300));
const prompt = 'Photorealistic interior scene: a grey tabby cat scratching the EXACT wave-shaped corrugated cardboard cat scratcher shown in the reference image (the product, not a box), with light wood-pattern side panels, placed on a light wooden floor in a cozy living room, sofa blurred in background, warm morning light, product clearly visible and identical to the reference. Clear empty upper area for a text overlay. No text, no watermark, no logos, no cardboard box.';
const gen = await tool('generate_image', { prompt, ref_images: [up.url], aspect_ratio: '1:1', n: 1 });
console.log('GEN ' + JSON.stringify(gen).slice(0, 500));
const taskId = (gen.task_ids || [])[0];
const projectId = gen.project_id;
let url = null;
for (let i = 0; i < 18 && !url; i += 1) {
  await new Promise((r) => setTimeout(r, 10000));
  const st = await tool('get_task_status', { task_id: taskId, project_id: projectId });
  const status = String(st?.status || '');
  if (status === 'completed') url = (st.artifacts || [])[0]?.url || null;
  console.log('poll ' + status + ' ' + url);
  if (/failed|error/i.test(status)) break;
}
if (!url) { console.log('NO_URL'); process.exit(1); }
const resp = await httpRequest({ url, method: 'GET', timeoutMs: 120000 });
fs.writeFileSync(path.join(ROOT, 'assets/P1/raw/02_scene.png'), resp.body);
console.log('SAVED P1 02_scene ' + resp.body.length);
const credits = await tool('get_credits', {});
console.log('CREDITS ' + JSON.stringify(credits));
