import fs from 'node:fs';
import path from 'node:path';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';
const ROOT = '.';
const OUT = path.join(ROOT, 'assets/video');
const client = new RemoteMcpClient({ timeoutMs: 300000 });
function payload(res) { if (res?.structuredContent) return res.structuredContent; const t = res?.content?.[0]?.text; if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } } return res; }
const call = async (n, a) => payload(await client.callTool(n, a || {}));
const SHOTS = {
  P1: [
    { img: 'assets/P1/raw/01_main.png', prompt: 'Handheld UGC phone footage, vertical 9:16, warm daylight in a cozy living room. A young woman places this curved cardboard cat scratcher on a wooden floor; a grey tabby cat walks up to it, realistic amateur look, slight shake, no text, no logos.' },
    { img: 'assets/P1/raw/02_scene.png', prompt: 'Handheld UGC phone footage, vertical 9:16. A grey tabby cat scratches the curved corrugated cardboard cat scratcher on a wooden floor, warm home light, realistic, slight shake, no text.' },
    { img: 'assets/P1/raw/03_layers.png', prompt: 'Handheld UGC macro footage, vertical 9:16. Close-up of five layers of dense corrugated cardboard being scratched by cat claws, tiny dust-free surface, warm light, realistic, no text.' },
    { img: 'assets/P1/raw/04_wall.png', prompt: 'Handheld UGC phone footage, vertical 9:16. The cardboard cat scratcher is mounted on a living-room wall; a cat stretches and scratches it, cozy interior, realistic, no text.' },
  ],
  H1: [
    { img: 'assets/H1/raw/01_main.png', prompt: 'Handheld UGC phone footage, vertical 9:16. A man kneels at a white entrance door and holds up this black self-adhesive door seal coil, winter light from the doorway, realistic amateur look, slight shake, no text.' },
    { img: 'assets/H1/raw/05_kit.png', prompt: 'Handheld UGC phone footage, vertical 9:16. Unboxing on a hallway floor: hands show the black door seal coil and a small cleaning wipe, winter daylight, realistic, no text.' },
    { img: 'assets/H1/raw/04_profile.png', prompt: 'Handheld UGC macro footage, vertical 9:16. Hands peel the protective tape from the self-adhesive door seal and press it along the bottom edge of a white door, close-up, realistic, no text.' },
    { img: 'assets/H1/raw/03_before_after.png', prompt: 'Handheld UGC phone footage, vertical 9:16. A person closes the entrance door with the new seal, then moves a hand along the bottom gap to show no draught, warm hallway, realistic, no text.' },
  ],
  W4: [
    { img: 'assets/W4/raw/01_main.png', prompt: 'Handheld UGC phone footage, vertical 9:16, warm evening light. A young woman on a sofa holds this pink hot water bottle in a plush cover on her lap, cozy blanket, realistic amateur look, slight shake, no text.' },
    { img: 'assets/W4/raw/03_cap.png', prompt: 'Handheld UGC phone footage, vertical 9:16. Close-up of hands filling the pink rubber hot water bottle with warm water from a kettle, then screwing the cap, kitchen light, realistic, no text.' },
    { img: 'assets/W4/raw/04_use.png', prompt: 'Handheld UGC phone footage, vertical 9:16. A young woman relaxes on a sofa with the pink hot water bottle under a blanket, evening lamp light, calm realistic home footage, no text.' },
    { img: 'assets/W4/raw/02_loop.png', prompt: 'Handheld UGC phone footage, vertical 9:16. The pink hot water bottle hangs by its loop on a bathroom hook to dry, water droplets, soft daylight, realistic, no text.' },
  ],
  B1: [
    { img: 'assets/B1/raw/02_features.png', prompt: 'Handheld UGC phone footage, vertical 9:16. A woman holds this blue and white pet nail clipper with LED light next to a fluffy cat paw, soft daylight, realistic amateur look, slight shake, no text.' },
    { img: 'assets/B1/raw/03_paw.png', prompt: 'Handheld UGC macro footage, vertical 9:16. Close-up of the LED nail clipper trimming a cat claw, small transparent nail container catching the clipping, soft light, realistic, no text.' },
    { img: 'assets/B1/raw/04_container.png', prompt: 'Handheld UGC macro footage, vertical 9:16. Close-up of the clipper container with a trimmed cat claw inside, hand opens it and empties it, clean bright table, realistic, no text.' },
    { img: 'assets/B1/raw/01_main.png', prompt: 'Handheld UGC phone footage, vertical 9:16. The blue and white cat nail clipper lies on a light table, a fluffy cat walks in the background, calm home light, realistic, no text.' },
  ],
};
const order = ['H1', 'W4', 'B1'];
const results = {};
for (const SKU of order) {
  const dir = path.join(OUT, SKU); fs.mkdirSync(dir, { recursive: true });
  const shots = SHOTS[SKU];
  const before = await call('get_credits');
  console.log('SKU ' + SKU + ' start credits ' + before.credits);
  const urls = [];
  for (const s of shots) {
    const jpg = path.join(dir, path.basename(s.img).replace(/\.(png|jpe?g)$/i, '') + '-ref.jpg');
    if (!fs.existsSync(jpg)) {
      const { execFileSync } = await import('node:child_process');
      const py = (process.env.OZON_PYTHON || 'python');
      execFileSync(py, ['-c', 'from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert("RGB");im.thumbnail((1200,1200));im.save(sys.argv[2],"JPEG",quality=88)', path.join(ROOT, s.img), jpg]);
    }
    const up = await call('upload_asset', { data_base64: fs.readFileSync(jpg).toString('base64'), filename: path.basename(jpg) });
    urls.push(up.url);
  }
  const run = async (i) => {
    const existing = path.join(dir, 'shot-' + (i + 1) + '.mp4');
    if (fs.existsSync(existing) && fs.statSync(existing).size > 1000000) { console.log(SKU + ' shot' + (i + 1) + ' exists'); return existing; }
    const res = await call('generate_video', { model: 'wan/wan-3-0', prompt: shots[i].prompt, first_frame: urls[i], duration: 8, aspect_ratio: '9:16', params: { resolution: '720P', audio: true } });
    const taskId = (res.task_ids || [])[0];
    if (!taskId) { console.log(SKU + ' shot' + i + ' NO TASK'); return null; }
    for (let n = 0; n < 70; n += 1) {
      await new Promise((r) => setTimeout(r, 10000));
      const st = await call('get_task_status', { task_id: taskId, project_id: res.project_id });
      const s = String(st.status);
      if (s === 'completed') {
        const art = (st.artifacts || [])[0];
        if (!art?.url) return null;
        const v = await httpRequest({ url: art.url, method: 'GET', timeoutMs: 240000 });
        const p = path.join(dir, 'shot-' + (i + 1) + '.mp4');
        fs.writeFileSync(p, v.body);
        console.log(SKU + ' shot' + (i + 1) + ' saved');
        return p;
      }
      if (/fail|error|moderat/i.test(s)) { console.log(SKU + ' shot' + i + ' FAIL ' + JSON.stringify(st).slice(0, 200)); return null; }
    }
    return null;
  };
  const res = [];
  for (let i = 0; i < shots.length; i += 2) {
    const pair = await Promise.all([run(i), run(Math.min(i + 1, shots.length - 1))]);
    res.push(...pair);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const after = await call('get_credits');
  console.log('SKU ' + SKU + ' done credits ' + before.credits + ' -> ' + after.credits);
  results[SKU] = res.filter(Boolean).length;
}
console.log('ALL DONE ' + JSON.stringify(results));
