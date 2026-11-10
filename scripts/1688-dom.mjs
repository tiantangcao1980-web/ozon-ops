import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));
const { cdp, info } = await newPage();
async function ev(e) {
  const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 400) };
  return r.result && r.result.value;
}
await cdp.send('Page.navigate', { url: 'https://m.1688.com/offer_search/-B9E8BDBAB9F8B2F9.html' });
for (let i = 0; i < 20; i++) { await sleep(1000); const l = await ev('document.body?document.body.innerText.length:0'); if (l > 1000) break; }
await sleep(2000);
const script = String.raw`(() => {
  const anchors = Array.from(document.querySelectorAll('a')).map(function(a){ return { href: String(a.href || '').slice(0,140), text: String(a.innerText || '').replace(/\s+/g,' ').slice(0,70), cls: String(a.className || '').slice(0,60) }; });
  const dls = anchors.filter(function(x){ return x.href.indexOf('/offer/') >= 0; });
  const clsCount = {};
  const els = document.querySelectorAll('*');
  for (let i = 0; i < els.length; i++) {
    const c = String(els[i].className || '');
    if (/offer|item|card|product|list/i.test(c)) { const parts = c.split(/\s+/); for (const k of parts) if (k) clsCount[k] = (clsCount[k] || 0) + 1; }
  }
  const topCls = Object.keys(clsCount).map(function(k){ return [k, clsCount[k]]; }).sort(function(a,b){ return b[1]-a[1]; }).slice(0,25);
  let sample = null;
  const cand = document.querySelector('[class*="offer-item"],[class*="offerItem"],[class*="card"],[class*="product"]');
  if (cand) sample = cand.outerHTML.slice(0, 2000);
  return { detailLinkCount: dls.length, detailLinks: dls.slice(0,5), topCls: topCls, sample: sample };
})()`;
const dump = await ev(script);
console.log(JSON.stringify(dump, null, 1).slice(0, 6000));
cdp.close(); await closePage(info);
process.exit(0);
