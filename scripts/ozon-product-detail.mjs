// 商品详情页抓取（合规：单并发、3–5s 随机间隔、命中异常即停）
import fs from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9335);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const targets = JSON.parse(fs.readFileSync('raw/sku-targets.json', 'utf8'));
const OUT = process.argv[2] || 'raw/sku-detail';
fs.mkdirSync(OUT, { recursive: true });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws err')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && c.pending.has(m.id)) { const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
    return c;
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { try { this.ws.close(); } catch {} }
}

const EXPR = (sku) => `(async()=>{
  const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/product/${sku}/');
  const t0=Date.now();
  const r=await fetch(u,{headers:{accept:'application/json'}});
  const ms=Date.now()-t0;
  if(!r.ok) return {sku:'${sku}',status:r.status,ms};
  let j; try{ j=await r.json(); }catch(e){ return {sku:'${sku}',status:'parse-fail',ms}; }
  const ws=j.widgetStates||{};
  const out={sku:'${sku}',status:200,ms,url:(j.pageInfo&&j.pageInfo.url)||null,widgets:Object.keys(ws).length};
  for(const k of Object.keys(ws)){
    if(/^webProductHeading/.test(k)){ try{const w=JSON.parse(ws[k]); if(w.title) out.name=String(w.title).trim();}catch(e){} }
    if(/^webPrice/.test(k)){ try{const w=JSON.parse(ws[k]); out.price=w.price||null; out.cardPrice=w.cardPrice||null; out.originalPrice=w.originalPrice||null;}catch(e){} }
    if(/^webSale/.test(k)){ try{ out.sale=JSON.stringify(JSON.parse(ws[k])).slice(0,700);}catch(e){} }
    if(/^webCurrentSeller/.test(k)){ try{ out.seller=JSON.stringify(JSON.parse(ws[k])).slice(0,700);}catch(e){} }
    if(/^webReviewProductScore/.test(k)||/^webSingleProductScore/.test(k)){ try{ out.reviews=JSON.stringify(JSON.parse(ws[k])).slice(0,600);}catch(e){} }
    if(/^webQuestionCount/.test(k)){ try{ out.questions=JSON.stringify(JSON.parse(ws[k])).slice(0,300);}catch(e){} }
    if(/^webDelivery/.test(k)){ try{ out.delivery=JSON.stringify(JSON.parse(ws[k])).slice(0,500);}catch(e){} }
    if(/^webDetailSKU/.test(k)){ try{ out.variants=JSON.stringify(JSON.parse(ws[k])).slice(0,400);}catch(e){} }
  }
  const pairs=[];
  function walk(o,d){ if(!o||d>7)return; if(Array.isArray(o)){for(const x of o)walk(x,d+1);return;} if(typeof o!=='object')return;
    const t=o.title||o.name||o.label||o.key; const v=o.value||o.text||o.content;
    if(typeof t==='string'&&typeof t.length==='number'&&t.length<60&&(typeof v==='string'||typeof v==='number')) pairs.push([t,String(v)]);
    for(const k of Object.keys(o)) walk(o[k],d+1);
  }
  for(const k of Object.keys(ws)){
    if(/^webPdpGrid/.test(k)||/customHtml/i.test(k)||/webShortCharacteristics/i.test(k)||/webAspects/i.test(k)){
      try{ walk(JSON.parse(ws[k]),0); }catch(e){}
    }
  }
  const seen=new Set();
  out.specs=pairs.filter(([t,v])=>/Вес|Габарит|Размер|Ширин|Высот|Глубин|Длин|Материал|Страна|Бренд|Тип|Комплект|Объем|Количество/i.test(t))
    .filter(([t,v])=>{const k=t+'='+v; if(seen.has(k))return false; seen.add(k); return true;}).slice(0,40);
  out.pairsTotal=pairs.length;
  return out;
})()`;

const tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = tabs.find(t => t.type === 'page');
const cdp = await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');

const results = [];
let consecutiveFail = 0;
for (const t of targets) {
  const r = await cdp.send('Runtime.evaluate', { expression: EXPR(t.sku), awaitPromise: true, returnByValue: true });
  const v = (r.result && r.result.value) || { sku: t.sku, status: 'no-value' };
  v.tag = t.tag; v.niche = t.niche; v.listPrice = t.price; v.listReviews = t.reviews;
  results.push(v);
  const bad = v.status !== 200 || (v.ms && v.ms > 15000);
  consecutiveFail = bad ? consecutiveFail + 1 : 0;
  console.log('[' + t.tag + '] ' + t.sku + ' status=' + v.status + ' ms=' + (v.ms || '-') + ' specs=' + ((v.specs || []).length) + ' name=' + String(v.name || '').slice(0, 50));
  if (consecutiveFail >= 3) { console.log('CIRCUIT OPEN: 连续失败/超时 3 次，停止抓取'); break; }
  await sleep(3500 + Math.random() * 1500);
}
cdp.close();
fs.writeFileSync(OUT + '/skus.json', JSON.stringify(results, null, 1), 'utf8');
console.log('DONE rows=' + results.length + ' -> ' + OUT);
process.exit(0);
