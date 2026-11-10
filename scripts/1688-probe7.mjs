import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));
const { cdp, info } = await newPage();
async function ev(e) { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: String(r.exceptionDetails.text).slice(0,200) }; return r.result && r.result.value; }
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const HEX = 'B9E8BDBAB9CEB5B6';
const urls = [
  'https://tw.1688.com/pic/-' + HEX + '.html',
  'https://tw.1688.com/offer_search/-' + HEX + '.html',
  'https://tw.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent('硅胶刮刀'),
  'https://www.bing.com/search?q=' + encodeURIComponent('site:detail.1688.com 硅胶刮刀'),
];
const out = [];
for (const url of urls) {
  const mobile = url.includes('1688.com');
  if (mobile) await cdp.send('Network.setUserAgentOverride', { userAgent: MUA, platform: 'iPhone' });
  else await cdp.send('Network.setUserAgentOverride', { userAgent: '', platform: '' }).catch(() => {});
  await cdp.send('Page.navigate', { url });
  let len = 0;
  for (let i = 0; i < 15; i++) { await sleep(1200); len = await ev('document.body?document.body.innerText.length:0'); if (len > 1000) break; }
  await sleep(1200);
  const d = await ev(String.raw`(() => {
    const t = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
    const ids = Array.from(document.querySelectorAll('a')).map(function(a){ var m = String(a.href||'').match(/offer\/(\d{6,})\.html/); return m ? m[1] : null; }).filter(Boolean);
    return { href: location.href.slice(0,140), title: document.title, len: t.length, uniqIds: Array.from(new Set(ids)).slice(0,10), idCount: new Set(ids).size, head: t.slice(0,300) };
  })()`);
  out.push({ url, ...d });
  log('RESULT', JSON.stringify({ url, ...d }).slice(0, 700));
}
fs.writeFileSync('raw\\_1688probe\\tw-test.json', JSON.stringify(out, null, 1));
cdp.close(); await closePage(info);
process.exit(0);
