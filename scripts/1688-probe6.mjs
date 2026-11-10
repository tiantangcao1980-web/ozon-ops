import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));
const { cdp, info } = await newPage();
async function ev(e) { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: String(r.exceptionDetails.text).slice(0,200) }; return r.result && r.result.value; }
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ids = ['1234567831', '1234567832', '1234567833'];
const out = [];
await cdp.send('Network.setUserAgentOverride', { userAgent: MUA, platform: 'iPhone' });
for (const id of ids) {
  for (const url of ['https://detail.1688.com/offer/' + id + '.html', 'https://m.1688.com/offer/' + id + '.html']) {
    await cdp.send('Page.navigate', { url });
    let len = 0;
    for (let i = 0; i < 15; i++) { await sleep(1200); len = await ev('document.body?document.body.innerText.length:0'); if (len > 800) break; }
    const d = await ev(String.raw`(() => {
      const t = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
      return { href: location.href.slice(0, 130), title: document.title, len: t.length,
        price: (t.match(/[¥￥]\s*[\d.]+\s*(起|\/件)?/g) || []).slice(0,4),
        moq: (t.match(/\d+\s*件(混批|起批)/g) || []).slice(0,3),
        weight: (t.match(/[\d.]+\s*(kg|KG|g|克|千克|斤)/g) || []).slice(0,5),
        size: (t.match(/[\d.]+\s*(cm|CM|mm|MM|寸|英寸)/g) || []).slice(0,5),
        seller: (t.match(/[\u4e00-\u9fa5A-Za-z0-9（）()]{3,30}(有限公司|商行|厂|店)/g) || []).slice(0,3),
        sales: (t.match(/已售\s*[\d.]+[万+]*\s*件|成交\s*[\d.]+[万+]*\s*笔/g) || []).slice(0,3),
        head: t.slice(0, 350) };
    })()`);
    out.push({ id, url, ...d });
    log(id, url, JSON.stringify(d).slice(0, 500));
    if (d.len > 700) break;
  }
}
fs.writeFileSync('raw\\_1688probe\\detail-test.json', JSON.stringify(out, null, 1));
cdp.close(); await closePage(info);
process.exit(0);
