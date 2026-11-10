import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const OUT = 'raw\\1688-202611061238';
const log = (...a) => console.log(a.join(' '));
const PAIRS = [
  ['vegetable grater', '多功能切菜器'],
  ['cat nail clipper', '猫指甲剪'],
  ['car vent organizer', '车载出风口收纳'],
  ['fridge storage container', '冰箱收纳盒'],
];
const CARD_JS = String.raw`(() => {
  const links = Array.prototype.slice.call(document.querySelectorAll('a[href*="/product-detail/"]'));
  const seen = new Set(); const out = [];
  for (const a of links) {
    const m = String(a.href || '').match(/product-detail\/[^/]*_(\d+)\.html/);
    if (!m) continue; const id = m[1];
    if (seen.has(id)) continue;
    let card = a, node = a;
    for (let i = 0; i < 12 && node; i++) {
      node = node.parentElement; if (!node) break;
      const t = node.innerText || '';
      if (/最低起订量|Min\.?\s*order/i.test(t) && /[¥$€]/.test(t) && t.length < 500) { card = node; break; }
    }
    const t = (card.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!/[¥$€]/.test(t)) continue;
    seen.add(id);
    const pm = t.match(/([¥$€])\s*([\d,]+(?:\.\d+)?)(?:\s*-\s*[¥$€]?\s*([\d,]+(?:\.\d+)?))?/);
    const moqM = t.match(/(?:最低起订量|Min\.?\s*order)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]+|套|件|个|只|条|张)/i);
    const supM = t.match(/([A-Z][A-Za-z0-9&.,'()\- ]{2,70}?(?:Co\.,?\s*Ltd\.?|Inc\.?|Corporation|Company|Ltd\.?|Group|Factory|Industries|Industry|Trading))/);
    out.push({ id: id, title: String(a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      cardText: t, currency: pm ? pm[1] : null, priceMin: pm ? pm[2].replace(/,/g, '') : null,
      priceMax: pm && pm[3] ? pm[3].replace(/,/g, '') : null,
      moq: moqM ? moqM[1].replace(/,/g, '') : null, moqUnit: moqM ? moqM[2] : null,
      supplier: supM ? supM[1].trim() : null,
      url: 'https://www.alibaba.com/product-detail/x_' + id + '.html' });
    if (out.length >= 20) break;
  }
  return { href: location.href.slice(0, 160), len: (document.body ? document.body.innerText.length : 0), offers: out };
})()`;
await ensureChrome((m) => log('[chrome] ' + m));
const { cdp, info } = await newPage();
async function ev(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page exception: ' + String(r.exceptionDetails.text).slice(0, 200));
  return r.result && r.result.value;
}
const perKw = [];
for (const [en, cn] of PAIRS) {
  const url = 'https://www.alibaba.com/trade/search?SearchText=' + encodeURIComponent(en);
  const rec = { keyword_en: en, keyword_cn: cn, url, offers: [], error: null, len: 0, attempts: 0 };
  for (let att = 0; att < 3 && rec.offers.length === 0; att++) {
    rec.attempts = att + 1;
    try {
      await cdp.send('Page.navigate', { url });
      for (let i = 0; i < 25; i++) { await sleep(1200); rec.len = (await ev('document.body?document.body.innerText.length:0')) || 0; if (rec.len > 4000) break; }
      if (rec.len < 3000) { await sleep(3000); rec.len = (await ev('document.body?document.body.innerText.length:0')) || 0; }
      await sleep(1500);
      let d = await ev(CARD_JS);
      if ((!d || !d.offers || d.offers.length === 0) && att < 2) {
        const alt = 'https://www.alibaba.com/showroom/' + en.replace(/\s+/g, '-') + '.html';
        log('  retry alt ' + alt);
        await cdp.send('Page.navigate', { url: alt });
        for (let i = 0; i < 20; i++) { await sleep(1200); rec.len = (await ev('document.body?document.body.innerText.length:0')) || 0; if (rec.len > 4000) break; }
        await sleep(1500);
        d = await ev(CARD_JS);
        rec.finalUrl = d && d.href;
      }
      rec.offers = (d && d.offers) || [];
      rec.finalUrl = (d && d.href) || rec.finalUrl;
      log('[' + en + '] att=' + rec.attempts + ' len=' + rec.len + ' offers=' + rec.offers.length);
      if (rec.offers.length === 0) await sleep(2500);
    } catch (e) { rec.error = e.message; log('[' + en + '] ERROR ' + e.message); }
  }
  perKw.push(rec);
}
cdp.close(); await closePage(info);
fs.writeFileSync(OUT + '\\alibaba-retry.json', JSON.stringify({ scrapedAt: new Date().toISOString(), perKw }, null, 1));
log('RETRY DONE');
process.exit(0);
