import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));
const { cdp, info } = await newPage();
async function ev(e) { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: String(r.exceptionDetails.text).slice(0,200) }; return r.result && r.result.value; }
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
await cdp.send('Network.setUserAgentOverride', { userAgent: MUA, platform: 'iPhone' });
const kws = JSON.parse(fs.readFileSync('raw\\_1688probe\\keywords.json', 'utf8'));
async function trySearch(kw, clear) {
  if (clear) { await cdp.send('Network.clearBrowserCookies'); await cdp.send('Network.clearBrowserCache'); }
  await cdp.send('Page.navigate', { url: kw.url });
  let len = 0;
  for (let i = 0; i < 15; i++) { await sleep(1200); len = await ev('document.body?document.body.innerText.length:0'); if (len > 1200) break; }
  const d = await ev(String.raw`({ href: location.href.slice(0,120), title: document.title, len: (document.body?document.body.innerText.length:0), head: (document.body?document.body.innerText:'').replace(/\s+/g,' ').slice(0,260) })`);
  return { keyword: kw.keyword, clear, ...d };
}
const out = [];
out.push(await trySearch(kws[1], true));
log(JSON.stringify(out.at(-1)));
out.push(await trySearch(kws[2], false));
log(JSON.stringify(out.at(-1)));
out.push(await trySearch(kws[3], true));
log(JSON.stringify(out.at(-1)));
fs.writeFileSync('raw\\_1688probe\\cookie-test.json', JSON.stringify(out, null, 1));
cdp.close(); await closePage(info);
process.exit(0);
