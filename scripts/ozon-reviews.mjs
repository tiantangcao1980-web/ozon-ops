// 抓 Ozon 竞品评论（正文/优点/缺点/评分/日期）——单并发、3.5–5s 抖动、异常熔断
import fs from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9335);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const files = ['raw/market-run2/niches.json', 'raw/market-hpw/niches.json'];
const want = ['汽车内饰小件', '宠物清洁小件', '汽车除冰刮', '汽车扫雪刷', '猫抓板贴', '热水袋', '门缝防风密封条'];
const picks = [];
for (const f of files) {
  const niches = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const key of want) {
    const n = niches.find(x => x.key === key);
    if (!n || !Array.isArray(n.rows)) continue;
    const band = n.rows.filter(r => r.price && r.sku);
    band.sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
    const top = band.slice(0, 2);
    const low = band.filter(r => (r.reviews || 0) < 200 && (r.reviews || 0) > 0).slice(0, 1);
    for (const r of [...top, ...low]) {
      if (picks.find(p => p.sku === String(r.sku))) continue;
      picks.push({ niche: key, sku: String(r.sku), listPrice: r.price, listReviews: r.reviews, name: r.name });
    }
  }
}
fs.writeFileSync('raw/review-targets.json', JSON.stringify(picks, null, 1), 'utf8');
console.log('targets=' + picks.length);

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

const EXPR = (sku, page) => `(async()=>{
  const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/product/${sku}/reviews/?page=${page}');
  const t0=Date.now();
  const r=await fetch(u,{headers:{accept:'application/json'}});
  const ms=Date.now()-t0;
  if(!r.ok) return {sku:'${sku}',page:${page},status:r.status,ms};
  let j; try{ j=await r.json(); }catch(e){ return {sku:'${sku}',page:${page},status:'parse-fail',ms}; }
  const ws=j.widgetStates||{};
  const k=Object.keys(ws).find(x=>/^webListReviews/.test(x));
  if(!k) return {sku:'${sku}',page:${page},status:'no-widget',ms};
  let w; try{ w=JSON.parse(ws[k]); }catch(e){ return {sku:'${sku}',page:${page},status:'widget-parse-fail',ms}; }
  const reviews=(w.reviews||[]).map(r=>({
    score:(r.content&&r.content.score)||null,
    comment:(r.content&&r.content.comment)||'',
    positive:(r.content&&r.content.positive)||'',
    negative:(r.content&&r.content.negative)||'',
    photos:(r.content&&r.content.photos)?r.content.photos.length:0,
    date:r.createdAt||r.publishedAt||null,
    author:(r.author&&r.author.firstName)||'',
    useful:(r.usefulness&&r.usefulness.useful)||0
  }));
  const ps=w.productScore||null;
  const paging=w.paging||null;
  return {sku:'${sku}',page:${page},status:200,ms,productScore:ps,paging,count:reviews.length,reviews};
})()`;

const tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = tabs.find(t => t.type === 'page');
const cdp = await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');

const out = [];
let bad = 0;
for (const t of picks) {
  for (const pg of [1, 2]) {
    const r = await cdp.send('Runtime.evaluate', { expression: EXPR(t.sku, pg), awaitPromise: true, returnByValue: true });
    const v = (r.result && r.result.value) || { sku: t.sku, status: 'no-value' };
    if (v.reviews) { v.niche = t.niche; v.listPrice = t.listPrice; v.listName = t.name; out.push(v); }
    console.log('[' + t.niche + '] ' + t.sku + ' p' + pg + ' status=' + v.status + ' ms=' + (v.ms || '-') + ' n=' + (v.count || 0));
    const ok = v.status === 200 && (v.count || 0) > 0;
    bad = ok ? 0 : bad + 1;
    if (bad >= 4) { console.log('CIRCUIT OPEN'); break; }
    await sleep(3500 + Math.random() * 1500);
  }
  if (bad >= 4) break;
}
cdp.close();
fs.mkdirSync('raw/reviews', { recursive: true });
fs.writeFileSync('raw/reviews/reviews.json', JSON.stringify(out, null, 1), 'utf8');
const total = out.reduce((a, x) => a + (x.count || 0), 0);
console.log('DONE skus=' + out.length + ' reviews=' + total);
process.exit(0);
