import fs from 'node:fs';
import path from 'node:path';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';

const OUT = process.env.OUT_DIR || ('raw\\1688-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12));
const LOG = path.join(OUT, 'scrape-alibaba.log');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(LOG, s + '\\n'); };

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
  return { href: location.href.slice(0, 160), title: document.title, len: (document.body ? document.body.innerText.length : 0), offers: out };
})()`;

await ensureChrome((m) => log('[chrome] ' + m));
const { cdp, info } = await newPage();
async function ev(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page exception: ' + String(r.exceptionDetails.text).slice(0, 200));
  return r.result && r.result.value;
}
const perKw = []; const rows = [];
for (const [en, cn] of PAIRS) {
  const url = 'https://www.alibaba.com/trade/search?SearchText=' + encodeURIComponent(en);
  const rec = { keyword_en: en, keyword_cn: cn, url, offers: [], error: null, len: 0 };
  try {
    await cdp.send('Page.navigate', { url });
    for (let i = 0; i < 18; i++) { await sleep(1200); rec.len = (await ev('document.body?document.body.innerText.length:0')) || 0; if (rec.len > 4000) break; }
    await sleep(1500);
    const d = await ev(CARD_JS);
    rec.offers = (d && d.offers) || [];
    rec.finalUrl = d && d.href;
    log('[' + en + '] len=' + rec.len + ' offers=' + rec.offers.length);
    for (const o of rec.offers) rows.push({ keyword_en: en, keyword_cn: cn, source_site: 'alibaba.com', ...o });
  } catch (e) { rec.error = e.message; log('[' + en + '] ERROR ' + e.message); }
  perKw.push(rec);
  await sleep(1500);
}
cdp.close(); await closePage(info);

function cell(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const now = new Date().toISOString();
const header = ['keyword_en', 'keyword_cn', 'title', 'price_min', 'price_max', 'currency', 'moq', 'moq_unit', 'supplier', 'url', 'source_site', 'scraped_at'];
const lines = [header.join(',')];
for (const r of rows) lines.push([r.keyword_en, r.keyword_cn, r.title, r.priceMin, r.priceMax, r.currency, r.moq, r.moqUnit, r.supplier, r.url, 'alibaba.com', now].map(cell).join(','));
fs.writeFileSync(path.join(OUT, 'offers-alibaba.csv'), lines.join('\r\n') + '\r\n');
fs.writeFileSync(path.join(OUT, 'alibaba-run.json'), JSON.stringify({ scrapedAt: now, perKw }, null, 1));
log('DONE rows=' + rows.length + ' -> ' + path.join(OUT, 'offers-alibaba.csv'));
process.exit(0);
