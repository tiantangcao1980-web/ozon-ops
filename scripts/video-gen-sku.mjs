import fs from 'node:fs';
import path from 'node:path';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';

const ROOT = '.';
const OUT = path.join(ROOT, 'assets/video');
fs.mkdirSync(OUT, { recursive: true });
const client = new RemoteMcpClient({ timeoutMs: 300000 });
function payload(res) { if (res?.structuredContent) return res.structuredContent; const t = res?.content?.[0]?.text; if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } } return res; }
const call = async (n, a) => payload(await client.callTool(n, a || {}));

const SKU = process.argv[2] || 'W2';
const SHOTS = {
  W2: [
    { img: 'assets/W2/raw/01_main.png', prompt: 'Handheld UGC phone footage, vertical 9:16, natural dusk light. A man in a black winter jacket and gloves holds this green telescopic snow brush up to the camera on a snowy residential street, slight handheld shake, realistic amateur look, authentic fabric and snow texture, no text, no logos.' },
    { img: 'assets/W2/raw/02_scene.png', prompt: 'Handheld UGC phone footage, vertical 9:16. The man sweeps thick snow off a car windshield with the green brush head; snow falls, his breath fogs, natural dusk light, slight camera shake, realistic, no text.' },
    { img: 'assets/W2/raw/04_scraper.png', prompt: 'Handheld UGC phone footage, vertical 9:16, close-up. The black ABS scraper clears ice from the side window of a snowy car, ice crackles and falls off, natural winter light, realistic, no text.' },
    { img: 'assets/W2/raw/03_bristles.png', prompt: 'Handheld UGC macro footage, vertical 9:16. Soft green PVC bristles sweep snow off dark glossy car paint without leaving scratches, shallow depth of field, natural light, realistic, no text.' },
    { img: 'assets/W2/raw/01_main.png', prompt: 'Handheld UGC phone footage, vertical 9:16. The man collapses the telescopic handle and puts the green snow brush into the car trunk, closes the trunk and walks away, snowy dusk street, realistic, slight shake, no text.' },
  ],
};
const shots = SHOTS[SKU];
if (!shots) { console.log('NO SHOTS'); process.exit(1); }
const dir = path.join(OUT, SKU);
fs.mkdirSync(dir, { recursive: true });

function jpgFor(img) {
  return path.join(dir, path.basename(img).replace(/.(png|jpe?g)$/i, '') + '-ref.jpg');
}
async function prepRef(img) {
  const jpg = jpgFor(img);
  if (!fs.existsSync(jpg)) {
    const { execFileSync } = await import('node:child_process');
    const py = (process.env.OZON_PYTHON || 'python');
    execFileSync(py, ['-c', 'from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert("RGB");im.thumbnail((1200,1200));im.save(sys.argv[2],"JPEG",quality=88)', path.join(ROOT, img), jpg]);
  }
  const b64 = fs.readFileSync(jpg).toString('base64');
  const up = await call('upload_asset', { data_base64: b64, filename: path.basename(jpg) });
  return up.url;
}

const before = await call('get_credits');
console.log('SKU ' + SKU + ' credits ' + before.credits);

async function runShot(i) {
  const shot = shots[i];
  const url = await prepRef(shot.img);
  const res = await call('generate_video', { model: 'wan/wan-3-0', prompt: shot.prompt, first_frame: url, duration: 8, aspect_ratio: '9:16', params: { resolution: '720P', audio: true } });
  const taskId = (res.task_ids || [])[0];
  if (!taskId) { console.log('SHOT ' + i + ' NO TASK ' + JSON.stringify(res).slice(0, 200)); return null; }
  for (let n = 0; n < 60; n += 1) {
    await new Promise((r) => setTimeout(r, 10000));
    const st = await call('get_task_status', { task_id: taskId, project_id: res.project_id });
    const s = String(st.status);
    if (s === 'completed') {
      const art = (st.artifacts || [])[0];
      if (!art?.url) { console.log('SHOT ' + i + ' NO ART'); return null; }
      const video = await httpRequest({ url: art.url, method: 'GET', timeoutMs: 240000 });
      const p = path.join(dir, 'shot-' + (i + 1) + '.mp4');
      fs.writeFileSync(p, video.body);
      console.log('SHOT ' + i + ' saved ' + p + ' ' + video.body.length);
      return p;
    }
    if (/fail|error|moderat/i.test(s)) { console.log('SHOT ' + i + ' FAIL ' + JSON.stringify(st).slice(0, 300)); return null; }
  }
  console.log('SHOT ' + i + ' TIMEOUT');
  return null;
}

// run with limited concurrency, keep order
const results = new Array(shots.length).fill(null);
const queue = shots.map((_, i) => i);
async function worker() {
  while (queue.length) {
    const i = queue.shift();
    try { results[i] = await runShot(i); } catch (e) { console.log('SHOT ' + i + ' ERR ' + String(e?.message || e).slice(0, 200)); }
  }
}
await Promise.all([worker(), worker()]);
const after = await call('get_credits');
console.log('DONE credits ' + before.credits + ' -> ' + after.credits);
console.log('RESULTS ' + JSON.stringify(results));
