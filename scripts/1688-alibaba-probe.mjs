import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const OUT = 'raw\\_1688probe';
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[alibaba chrome] ' + m));
const { cdp, info } = await newPage();
async function ev(e) { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: String(r.exceptionDetails.text).slice(0, 300) }; return r.result && r.result.value; }
const URL = 'https://www.alibaba.com/trade/search?SearchText=' + encodeURIComponent('silicone spatula');
await cdp.send('Page.navigate', { url: URL });
let len = 0;
for (let i = 0; i < 20; i++) { await sleep(1500); len = await ev('document.body?document.body.innerText.length:0'); log('len', len); if (len > 2000) break; }
await sleep(2000);
const d = await ev(String.raw`(() => {
  const t = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
  const pd = Array.from(document.querySelectorAll('a')).map(function(a){ return String(a.href||''); }).filter(function(h){ return h.indexOf('/product-detail/') >= 0; });
  const uniq = Array.from(new Set(pd)).slice(0, 8);
  let sample = null;
  const el = document.querySelector('[data-content*="ProductCard"], [class*="search-card"], [class*="fy23-search-card"]');
  if (el) sample = el.outerHTML.slice(0, 1800);
  return { href: location.href.slice(0,150), title: document.title, len: t.length, head: t.slice(0, 700), pdLinks: uniq.length, sample: sample };
})()`);
console.log(JSON.stringify(d, null, 1).slice(0, 5000));
const sh = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
if (sh?.data) fs.writeFileSync(OUT + '\\alibaba-probe.png', Buffer.from(sh.data, 'base64'));
const js = await ev(String.raw`(() => {
  const as = Array.from(document.querySelectorAll('a'));
  const links = as.filter(function(a){ return String(a.href||'').indexOf('/product-detail/') >= 0; }).slice(0,5).map(function(a){ return { href: String(a.href).slice(0,160), text: String(a.innerText||'').replace(/\s+/g,' ').slice(0,120) }; });
  return { links: links, bodyLen: (document.body?document.body.innerText.length:0) };
})()`);
console.log('LINKS', JSON.stringify(js, null, 1).slice(0, 3000));
const txt = await ev("(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,1200)");
console.log('TEXT', String(txt).slice(0, 1300));
cdp.close(); await closePage(info);
process.exit(0);
