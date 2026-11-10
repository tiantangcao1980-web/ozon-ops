// 抓 Ozon 商品"关于商品"特性（含重量/尺寸）——合规：单并发、3.5–5s 抖动、异常熔断
import fs from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9335);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const targets = JSON.parse(fs.readFileSync('raw/sku-targets.json', 'utf8'));
const OUT = 'raw/sku-chars';
fs.mkdirSync(OUT, { recursive: true });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && c.pending.has(m.id)) { const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
    return c;
  }
  send(m, p = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  close() { try { this.ws.close(); } catch {} }
}

const EXPR = (sku) => `(async()=>{
  const base='/api/entrypoint-api.bx/page/json/v2?url=';
  const u=base+encodeURIComponent('/product/${sku}/characteristics/');
  const t0=Date.now();
  const r=await fetch(u,{headers:{accept:'application/json'}});
  const ms=Date.now()-t0;
  if(!r.ok) return {sku:'${sku}',status:r.status,ms};
  let j; try{ j=await r.json(); }catch(e){ return {sku:'${sku}',status:'parse-fail',ms}; }
  const ws=j.widgetStates||{};
  const pairs=[];
  const seen=new Set();
  for(const k of Object.keys(ws)){
    let w; try{ w=JSON.parse(ws[k]); }catch(e){ continue; }
    const arrs=[];
    if(Array.isArray(w.characteristics)) arrs.push(w.characteristics);
    if(w.items&&Array.isArray(w.items.characteristics)) arrs.push(w.items.characteristics);
    if(w.content&&Array.isArray(w.content.characteristics)) arrs.push(w.content.characteristics);
    for(const arr of arrs){
      for(const ch of arr){
        const t=(ch.title&&ch.title.textRs&&ch.title.textRs[0]&&ch.title.textRs[0].content)||(ch.title&&ch.title.text)||(typeof ch.title==='string'?ch.title:'')||'';
        const v=(ch.values||[]).map(x=>x.text||'').join(' ').replace(/\s+/g,' ').trim();
        if(!t||!v) continue;
        const kk=t+'='+v;
        if(seen.has(kk)) continue; seen.add(kk); pairs.push([t,v]);
      }
    }
  }
  const interesting=pairs.filter(([t])=>/Вес|Габарит|Ширин|Высот|Глубин|Длин|Размер|Материал|Страна|Объем/i.test(t));
  return {sku:'${sku}',status:200,ms,pairs:interesting,total:pairs.length};
})()`;

const tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = tabs.find(t => t.type === 'page');
const cdp = await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const out = [];
let bad = 0;
for (const t of targets) {
  const r = await cdp.send('Runtime.evaluate', { expression: EXPR(t.sku), awaitPromise: true, returnByValue: true });
  const v = (r.result && r.result.value) || { sku: t.sku, status: 'no-value' };
  v.tag = t.tag; v.niche = t.niche;
  out.push(v);
  const ok = v.status === 200;
  bad = ok ? 0 : bad + 1;
  const spec = (v.pairs || []).map(([a, b]) => a + ':' + b).join(' | ');
  console.log('[' + t.tag + '] ' + t.sku + ' status=' + v.status + ' ms=' + (v.ms || '-') + ' ' + spec.slice(0, 220));
  if (bad >= 3) { console.log('CIRCUIT OPEN'); break; }
  await sleep(3500 + Math.random() * 1500);
}
cdp.close();
fs.writeFileSync(OUT + '/chars.json', JSON.stringify(out, null, 1), 'utf8');
console.log('DONE rows=' + out.length);
process.exit(0);
