import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));
const { cdp, info } = await newPage();
async function ev(e) { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: String(r.exceptionDetails.text).slice(0,200) }; return r.result && r.result.value; }
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
await cdp.send('Network.setUserAgentOverride', { userAgent: MUA, platform: 'iPhone' });
await cdp.send('Page.navigate', { url: 'https://m.1688.com/offer_search/-B9E8BDBAB9F8B2F9.html' });
for (let i = 0; i < 15; i++) { await sleep(1200); const l = await ev('document.body?document.body.innerText.length:0'); log(i, 'len', l); if (l > 1200) break; }
const d = await ev(String.raw`({ href: location.href, title: document.title, len: (document.body?document.body.innerText.length:0), head: (document.body?document.body.innerText:'').replace(/\s+/g,' ').slice(0,400), cookies: document.cookie.length, anchors: document.querySelectorAll('a').length })`);
console.log(JSON.stringify(d, null, 1));
cdp.close(); await closePage(info);
process.exit(0);
