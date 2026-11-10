import fs from 'node:fs';
import path from 'node:path';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';

const OUT = process.env.OUT_DIR || ('raw\\1688-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12));
const LOG = path.join(OUT, 'scrape2.log');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(LOG, s + '\\n'); };
const sleepMs = Number(process.env.NAV_SLEEP || 1500);
const TARGET_PER_KW = Number(process.env.TARGET_PER_KW || 4);
const MAX_PER_KW = Number(process.env.MAX_PER_KW || 8);
const kws = JSON.parse(fs.readFileSync('raw\\_1688probe\\keywords.json', 'utf8'));
log('OUT=' + OUT);

const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const DETAIL_JS = String.raw`(() => {
  const t = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
  if (/商品失效了|下架商品|商品已下架/.test(t.slice(0, 200))) return { expired: true, href: location.href.slice(0, 120) };
  const title = String(document.title || '').replace(/\s+/g, ' ').trim();
  const head = t.slice(0, 1200);
  const pm = head.match(/[¥￥]\s*(\d+(?:\.\d+)?)\s*(?:-\s*[¥￥]?\s*(\d+(?:\.\d+)?))?/);
  const moqPatterns = [/(\d+)\s*件\s*(?:混批|起批)/, /起批[量]?\s*[:：]?\s*(\d+)/, /(\d+)\s*件起/];
  let moq = null; for (const p of moqPatterns) { const m = t.match(p); if (m) { moq = m[1]; break; } }
  const salesM = t.match(/已售\s*([\d.]+)(万\+?|\+)?\s*(件|把|个|套|只|张|条|箱|支|片|台)/);
  const monthM = t.match(/月销\s*([\d.]+)(万)?/);
  let seller = null;
  const em = t.match(/([\u4e00-\u9fa5]{2,18}(?:有限公司|股份有限公司|商行|经营部|工贸))/);
  if (em) seller = em[1];
  const cityM = t.match(/发货\s*([\u4e00-\u9fa5]{2,10})(?:\s|$)/);
  const medalM = t.match(/(深度验厂|深度验商|实力商家|诚信通\d+年|超级工厂|源头工厂)/g);
  const weightM = t.match(/(?:重量|毛重|净重)[^\u4e00-\u9fa5]{0,4}(\d+(?:\.\d+)?)\s*(kg|KG|千克|公斤|g|克)/g);
  const weight2 = t.match(/(\d+(?:\.\d+)?)\s*(kg|千克|公斤)(?![a-zA-Z])/g);
  const sizeM = t.match(/(?:尺寸|规格)[^\u4e00-\u9fa5]{0,6}(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)(?:\s*[*x×]\s*(\d+(?:\.\d+)?))?\s*(cm|CM|mm|MM|厘米|毫米)/g);
  const idx = t.indexOf('属性');
  const attr = idx >= 0 ? t.slice(idx, idx + 300) : '';
  const companyEl = document.querySelector('[class*="company"],[class*="seller"],[class*="shop-name"],[class*="shopName"]');
  return { expired: false, title, priceMin: pm ? pm[1] : null, priceMax: pm && pm[2] ? pm[2] : null,
    moq: moq, moqRaw: (t.match(/(?:\d+\s*件\s*(?:混批|起批)|起批[量]?\s*[:：]?\s*\d+|\d+\s*件起)/) || [null])[0],
    sales: salesM ? salesM[0] : null, month: monthM ? monthM[0] : null, seller,
    city: cityM ? cityM[1] : null, medals: medalM || [],
    weight: (weightM || weight2 || []), size: sizeM || [], attr,
    companyEl: companyEl ? String(companyEl.innerText || '').replace(/\s+/g, ' ').slice(0, 80) : null,
    href: location.href.slice(0, 200), len: t.length, rawT: t.slice(0, 1400) };
})()`;

const IDS_JS = String.raw`(() => {
  const ids = [];
  const as = document.querySelectorAll('a');
  for (let i = 0; i < as.length; i++) {
    const m = String(as[i].href || '').match(/offer\/(\d{6,})\.html/);
    if (m) ids.push(m[1]);
  }
  return { href: location.href.slice(0, 140), title: document.title, len: (document.body ? document.body.innerText.length : 0), ids: Array.from(new Set(ids)) };
})()`;

await ensureChrome((m) => log('[chrome] ' + m));
const { cdp, info } = await newPage();
await cdp.send('Network.setUserAgentOverride', { userAgent: MUA, platform: 'iPhone' });
async function ev(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page exception: ' + String(r.exceptionDetails.text).slice(0, 200));
  return r.result && r.result.value;
}
async function goto(url, minLen) {
  await cdp.send('Page.navigate', { url });
  let len = 0;
  for (let i = 0; i < 14; i++) { await sleep(1000); len = (await ev('document.body?document.body.innerText.length:0')) || 0; if (len > minLen) break; }
  return len;
}
const perKw = []; const rows = []; const scrapedAt = new Date().toISOString();
for (const kw of kws) {
  const rec = { keyword: kw.keyword, gbkhex: kw.gbkhex, picUrl: 'https://tw.1688.com/pic/-' + kw.gbkhex + '.html', idsFound: 0, offers: [], errors: [] };
  try {
    const len = await goto(rec.picUrl, 300);
    const d = await ev(IDS_JS);
    rec.picLen = len; rec.idsFound = d && d.ids ? d.ids.length : 0;
    const ids = (d && d.ids ? d.ids : []).slice(0, MAX_PER_KW);
    log('[' + kw.keyword + '] pic len=' + len + ' ids=' + rec.idsFound);
    if (!rec.idsFound) rec.errors.push('pic page 0 ids; final=' + (d && d.href));
    let got = 0;
    for (const id of ids) {
      if (got >= TARGET_PER_KW) break;
      await sleep(sleepMs);
      const url = 'https://detail.1688.com/offer/' + id + '.html';
      try {
        let l2 = await goto(url, 500);
        if (l2 < 300) { await sleep(1500); l2 = await goto(url, 500); }
        const o = await ev(DETAIL_JS);
        if (o.expired) { rec.errors.push(id + ': expired'); continue; }
        rec.offers.push({ offer_id: id, ...o, url }); got++;
        log('  ' + id + ' ¥' + o.priceMin + ' moq=' + o.moq + ' seller=' + (o.seller || '') + ' len=' + o.len);
      } catch (e) { rec.errors.push(id + ': ' + e.message); log('  ' + id + ' ERR ' + e.message); }
    }
    log('[' + kw.keyword + '] collected=' + rec.offers.length);
  } catch (e) { rec.errors.push('pic error: ' + e.message); log('[' + kw.keyword + '] PIC ERR ' + e.message); }
  perKw.push(rec);
  for (const o of rec.offers) rows.push({ keyword: kw.keyword, ...o });
}
cdp.close(); await closePage(info);
function cell(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const header = ['keyword', 'offer_id', 'title', 'price_min_cny', 'price_max_cny', 'moq', 'weight_g', 'size_cm', 'seller', 'monthly_sales', 'trade_medal', 'url', 'scraped_at'];
const lines = [header.join(',')];
for (const r of rows) lines.push([r.keyword, r.offer_id, r.title, r.priceMin, r.priceMax, r.moq,
  (Array.isArray(r.weight) && r.weight.length ? r.weight.join('|') : ''), (Array.isArray(r.size) && r.size.length ? r.size.join('|') : ''),
  r.seller, r.month || r.sales || '', (r.medals || []).join('|'), r.url, scrapedAt].map(cell).join(','));
fs.writeFileSync(path.join(OUT, 'offers.csv'), lines.join('\r\n') + '\r\n');
fs.writeFileSync(path.join(OUT, '1688-run2.json'), JSON.stringify({ scrapedAt, perKw, rows: rows.length }, null, 1));
log('DONE2 rows=' + rows.length + ' -> ' + path.join(OUT, 'offers.csv'));
process.exit(0);
