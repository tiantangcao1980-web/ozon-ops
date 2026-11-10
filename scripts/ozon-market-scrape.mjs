// Ozon 公开市场数据抓取：通过本机代理 + 真实 Chrome + composer-api
// 用法: node ozon-market-scrape.mjs --queries=scripts/market-queries.json --pages=6 --out=raw/market-YYYYMMDDHHmmss
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = '.chrome-proxy';
const PORT = Number(process.env.CDP_PORT || 9335);
const PROXY = process.env.PROXY || 'http://127.0.0.1:7897';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const QFILE = arg('queries', 'scripts\\market-queries.json');
const PAGES = Number(arg('pages', '6'));
const OUT = arg('out', 'raw/market-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14));

async function devtoolsUp() { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); return r.ok; } catch { return false; } }
async function ensureChrome() {
  if (await devtoolsUp()) return 'reused';
  fs.mkdirSync(PROFILE, { recursive: true });
  const flags = ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled', '--proxy-server=' + PROXY, '--lang=ru-RU',
    '--window-size=1400,900', '--window-position=-2400,-2400',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'about:blank'];
  const child = spawn(CHROME, flags, { stdio: 'ignore', detached: true });
  child.unref();
  for (let i = 0; i < 100; i++) { if (await devtoolsUp()) return 'spawned'; await sleep(300); }
  throw new Error('chrome devtools not up');
}

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

const IN_PAGE = `
window.__oz = {
  num(t){ if(t==null) return null; const s=String(t).replace(/[^0-9]/g,''); return s===''?null:Number(s); },
  price(t){ if(t==null) return null; const s=String(t).replace(/[^0-9,.]/g,'').replace(',', '.'); if(!s) return null; const v=Number(s); return isFinite(v)?v:null; },
  parseTile(it){
    const o={sku:String(it.sku||it.id||''),name:null,price:null,orig:null,discount:null,rating:null,reviews:null,badges:[],labels:[]};
    for(const s of (it.mainState||[])){
      if(s.type==='priceV2'){
        for(const x of (s.priceV2.price||[])){ if(x.textStyle==='PRICE')o.price=this.price(x.text); if(x.textStyle==='ORIGINAL_PRICE')o.orig=this.price(x.text); }
        o.discount=s.priceV2.discount||null;
      } else if(s.type==='textDS'&&s.id==='name'){ o.name=s.textDS.text; }
      else if(s.type==='labelListV2'){
        const txt=(s.labelListV2.items||[]).filter(i=>i.type==='text').map(i=>i.text.text);
        o.labels.push(...txt);
        for(const t of txt){
          if(/отзыв/.test(t)) o.reviews=this.num(t);
          else if(/^[0-9]+([.,][0-9]+)?$/.test(t.replace(/\\s/g,''))) o.rating=Number(t.replace(',','.'));
        }
      }
    }
    if(it.tileImage&&it.tileImage.leftBottomBadgeV2) o.badges.push(it.tileImage.leftBottomBadgeV2.text);
    return o;
  },
  async grab(pathOrUrl){
    const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent(pathOrUrl);
    const r=await fetch(u,{headers:{accept:'application/json'}});
    if(!r.ok) return {status:r.status,rows:[],next:null,meta:{}};
    const j=await r.json();
    const ws=j.widgetStates||{};
    const rows=[];
    for(const k of Object.keys(ws).filter(k=>/^tileGridDesktop/.test(k))){
      let w; try{ w=JSON.parse(ws[k]); }catch(e){ continue; }
      for(const it of (w.items||[])) if(it.sku||it.id) rows.push(this.parseTile(it));
    }
    let next=null;
    for(const k of Object.keys(ws).filter(k=>/^infiniteVirtualPaginator/.test(k))){
      try{ const v=JSON.parse(ws[k]); if(v&&v.nextPage) next=v.nextPage; }catch(e){}
    }
    let brands=[];
    for(const k of Object.keys(ws).filter(k=>/^categoryBrandList/.test(k))){
      try{ const v=JSON.parse(ws[k]); const arr=v.items||v.brands||[]; brands=arr.map(x=>(x.name||x.title||(x.brand&&x.brand.name)||'')).filter(Boolean).slice(0,40); }catch(e){}
    }
    return {status:200,rows,next,meta:{pageType:j.pageInfo&&j.pageInfo.pageType,categoryId:j.pageInfo&&j.pageInfo.analyticsInfo&&j.pageInfo.analyticsInfo.categoryId,brands,url:j.pageInfo&&j.pageInfo.url}};
  }
};
`;

async function main() {
  const mode = await ensureChrome();
  const tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  let page = tabs.find(t => t.type === 'page');
  if (!page) { const nr = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' }); page = await nr.json(); }
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: 'https://www.ozon.ru/' });
  await sleep(5000);
  await cdp.send('Runtime.evaluate', { expression: IN_PAGE, returnByValue: true });

  const queries = JSON.parse(fs.readFileSync(QFILE, 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const all = [];
  const niches = [];
  for (const q of queries) {
    const label = q.label || q.query;
    const rows = [];
    const seen = new Set();
    const basePath = '/search/?text=' + encodeURIComponent(q.query);
    let p = basePath;
    let meta = null; let pagesFetched = 0;
    for (let i = 0; i < PAGES; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: 'window.__oz.grab(' + JSON.stringify(p) + ')', awaitPromise: true, returnByValue: true });
      const v = r.result && r.result.value;
      if (!v || v.status !== 200) { niches.push({ key: label, query: q.query, error: v ? 'status ' + v.status : 'no value', rows: rows.length }); break; }
      meta = meta || v.meta;
      pagesFetched++;
      for (const row of v.rows) { if (!row.sku || seen.has(row.sku)) continue; seen.add(row.sku); rows.push(row); }
      if (i === PAGES - 1) break;
      p = basePath + '&page=' + (i + 2);
      await sleep(700 + Math.random() * 700);
    }
    for (const row of rows) all.push({ niche: label, query: q.query, ...row });
    niches.push({ key: label, query: q.query, fetchedAt: new Date().toISOString(), pages: pagesFetched, products: rows.length, meta, rows });
    console.log('[ok] ' + label + ' products=' + rows.length + ' pages=' + pagesFetched + ' cat=' + (meta && meta.categoryId));
    await sleep(1200);
  }
  cdp.close();
  fs.writeFileSync(path.join(OUT, 'niches.json'), JSON.stringify(niches, null, 1), 'utf8');
  const cols = ['niche', 'query', 'sku', 'name', 'price', 'orig', 'discount', 'rating', 'reviews', 'badges', 'labels'];
  const csv = [cols.join(',')].concat(all.map(r => cols.map(c => {
    let v = r[c];
    if (Array.isArray(v)) v = v.join('|');
    if (v == null) return '';
    v = String(v).replace(/"/g, '""');
    return /[",\n]/.test(v) ? '"' + v + '"' : v;
  }).join(','))).join('\r\n');
  fs.writeFileSync(path.join(OUT, 'products.csv'), csv, 'utf8');
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ chrome: mode, pagesPerNiche: PAGES, totalRows: all.length, niches: niches.length, startedFrom: QFILE }, null, 1), 'utf8');
  console.log('OUT=' + OUT + ' rows=' + all.length);
  process.exit(0);
}
main().catch(e => { console.error('FAIL', e && e.message); process.exit(1); });
