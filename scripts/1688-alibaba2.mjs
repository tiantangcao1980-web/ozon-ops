import fs from 'node:fs';
import path from 'node:path';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const OUT = 'raw\\1688-202611061238';
const log = (...a) => console.log(a.join(' '));
const PAIRS = [
  ['silicone spatula', '硅胶刮刀'],
  ['silicone turner kitchen', '硅胶锅铲'],
  ['silicone kitchen brush', '硅胶刷'],
  ['desk organizer', '桌面收纳盒'],
  ['pen holder', '笔筒'],
  ['cat toy ball', '猫玩具球'],
  ['silicone baking mold', '硅胶蛋糕模具'],
  ['garden trowel', '园艺小铲'],
  ['bathroom shelf no drill', '免打孔浴室置物架'],
  ['vegetable grater', '多功能切菜器'],
  ['cat nail clipper', '猫指甲剪'],
  ['car vent organizer', '车载出风口收纳'],
  ['fridge storage container', '冰箱收纳盒'],
];
const CARD_JS = String.raw`(() => {
  const out = []; const seen = new Set();
  const links = Array.prototype.slice.call(document.querySelectorAll('a[href*="/product-detail/"]'));
  for (const a of links) {
    const m = String(a.href || '').match(/product-detail\/[^/]*_(\d+)\.html/);
    if (!m) continue; const id = m[1];
    if (seen.has(id)) continue;
    let card = null, node = a;
    for (let i = 0; i < 14 && node; i++) {
      node = node.parentElement; if (!node) break;
      const t = node.innerText || '';
      if (/最低起订量|Min\.?\s*order/i.test(t) && t.length < 900) { card = node; break; }
    }
    if (!card) continue;
    const raw = (card.innerText || '').replace(/\s+/g, ' ').trim();
    const moqIdx = raw.search(/最低起订量|Min\.?\s*order/i);
    const pre = moqIdx > 0 ? raw.slice(0, moqIdx) : raw;
    const re = /([¥$€￥])\s*([\d,]+(?:\.\d+)?)(?:\s*-\s*[¥$€￥]?\s*([\d,]+(?:\.\d+)?))?/g;
    let pl = null, mm; while ((mm = re.exec(pre)) !== null) pl = { sym: mm[1], min: mm[2], max: mm[3], index: mm.index, text: mm[0] };
    let title = '';
    const h = card.querySelector('h2,h3,[class*="title"],[class*="Title"]');
    if (h) title = String(h.innerText || '').replace(/\s+/g, ' ').trim();
    if (!title && pl) title = pre.slice(0, pl.index).replace(/^(Ad|广告)\s*/, '').trim();
    if (!title) { const im = card.querySelector('img[alt]'); if (im) title = String(im.alt || '').trim(); }
    const moqM = raw.slice(moqIdx < 0 ? 0 : moqIdx).match(/(?:最低起订量|Min\.?\s*order)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]+|套|件|个|只|条|张)/i);
    const supM = raw.match(/([A-Z][A-Za-z0-9&.,'()\- ]{2,70}?(?:Co\.,?\s*Ltd\.?|Inc\.?|Corporation|Company|Ltd\.?|Group|Factory|Industries|Industry|Trading))/);
    seen.add(id);
    out.push({ id: id, title: title.slice(0, 200), cardText: raw.slice(0, 500),
      currency: pl ? pl.sym : null, priceMin: pl ? pl.min.replace(/,/g, '') : null,
      priceMax: pl && pl.max ? pl.max.replace(/,/g, '') : null,
      moq: moqM ? moqM[1].replace(/,/g, '') : null, moqUnit: moqM ? moqM[2] : null,
      supplier: supM ? supM[1].trim() : null,
      url: 'https://www.alibaba.com/product-detail/x_' + id + '.html' });
    if (out.length >= 20) break;
  }
  return { href: location.href.slice(0, 200), len: (document.body ? document.body.innerText.length : 0), offers: out };
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
      const d = await ev(CARD_JS);
      rec.offers = (d && d.offers) || [];
      rec.finalUrl = d && d.href;
      log('[' + en + '] att=' + att + ' len=' + (d && d.len) + ' offers=' + rec.offers.length + (rec.offers[0] ? ' sample=' + rec.offers[0].title.slice(0, 30) + ' ' + rec.offers[0].currency + rec.offers[0].priceMin : ''));
      if (rec.offers.length === 0) await sleep(3000);
    } catch (e) { rec.error = e.message; log('[' + en + '] ERROR ' + e.message); }
  }
  perKw.push(rec);
  await sleep(1200);
}
cdp.close(); await closePage(info);
fs.writeFileSync(OUT + '\\alibaba-run2.json', JSON.stringify({ scrapedAt: new Date().toISOString(), perKw }, null, 1));
log('DONE alibaba2');
process.exit(0);
