import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = '.chrome-scrape';
const PORT = 9333;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitDevtools() { for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return await r.json(); } catch {} await sleep(300);} throw new Error('no devtools'); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && c.pending.has(m.id)) { const p = c.pending.get(m.id); c.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) { const hs = c.handlers.get(m.method) || []; for (const h of hs) h(m.params); } };
    return c; }
  on(m, fn) { const a = this.handlers.get(m) || []; a.push(fn); this.handlers.set(m, a); }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  close() { try { this.ws.close(); } catch (e) {} }
}
let ver;
try { ver = await waitDevtools(); } catch (e) {
  const child = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', '--window-size=1400,950', '--window-position=-2400,-2400', '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36', 'about:blank'], { stdio: 'ignore', detached: true });
  child.unref();
  ver = await waitDevtools();
}
const out = { browser: ver.Browser, app: {}, bundles: [], endpoints: [] };
const tr = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
const info = await tr.json();
const cdp = await CDP.connect(info.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Runtime.enable');
const xhr = []; const bodies = []; const reqs = new Map();
cdp.on('Network.requestWillBeSent', (p) => { const u = p.request.url; if (/xhr|fetch/i.test(p.type) || /\/api\//.test(u) || /p-api/.test(u)) { xhr.push(p.request.method + ' ' + u.slice(0, 240)); reqs.set(p.requestId, u); } });
cdp.on('Network.loadingFinished', async (p) => { if (bodies.length >= 15) return; const u = reqs.get(p.requestId); if (!u) return; try { const b = await cdp.send('Network.getResponseBody', { requestId: p.requestId }); bodies.push({ url: u, body: String(b.body).slice(0, 1200) }); } catch (e) {} });
async function ev(expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; }
await cdp.send('Page.navigate', { url: 'https://data.ozon.ru/app' });
for (let i = 0; i < 12; i++) { await sleep(2500); const n = await ev('document.body?document.body.innerText.length:0'); if (n > 200) break; }
out.app = { url: await ev('location.href'), title: await ev('document.title'), len: await ev('document.body?document.body.innerText.length:0'), text: await ev("document.body?document.body.innerText.slice(0,1200):''") };
out.xhr = xhr.slice(0, 40); out.bodies = bodies;
// grab script srcs and inline nuxt payload
out.scripts = await ev("Array.from(document.querySelectorAll('script[src]')).map(function(s){return s.src}).slice(0,40)");
out.payload = await ev("(()=>{try{return JSON.stringify(window.__NUXT__).slice(0,1500)}catch(e){return 'none'}})()");
const html = await ev('document.documentElement.outerHTML.length');
out.htmlLen = html;
console.log(JSON.stringify(out, null, 1));
process.exit(0);