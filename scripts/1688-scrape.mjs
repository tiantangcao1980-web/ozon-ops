import fs from 'node:fs';
import path from 'node:path';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';

const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(LOG, s + '\\n'); };
const OUT = process.env.OUT_DIR || ('raw\\1688-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12));
const LOG = path.join(OUT, 'scrape.log');
fs.mkdirSync(OUT, { recursive: true });
const sleepMs = Number(process.env.NAV_SLEEP || 1800);
const MAX_PER_KW = Number(process.env.MAX_PER_KW || 6);
const TARGET_PER_KW = Number(process.env.TARGET_PER_KW || 4);

const kws = JSON.parse(fs.readFileSync('raw\\_1688probe\\keywords.json', 'utf8'));
log('OUT=' + OUT, 'keywords=' + kws.length);

const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const DETAIL_JS = String.raw`(() => {
  const t = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
  if (/商品失效了|下架商品|商品已下架/.test(t.slice(0, 200))) return { expired: true, href: location.href.slice(0, 120) };
  const title = String(document.title || '').replace(/\s+/g, ' ').trim();
  const head = t.slice(0, 900);
  const pm = head.match(/[¥￥]\s*(\d+(?:\.\d+)?)\s*(?:-\s*[¥￥]?\s*(\d+(?:\.\d+)?))?/);
  const moqM = t.match(/(\d+)\s*件(混批|起批)/);
  const salesM = t.match(/已售\s*([\d.]+)(万\+?|\+)?\s*(件|把|个|套|只|张|条|箱)/);
  const monthM = t.match(/月销\s*([\d.]+)(万)?/);
  const sellerM = t.match(/([\u4e00-\u9fa5]{2,12}(?:有限公司|商行|经营部|厂))/);
  const cityM = t.match(/发货\s*([\u4e00-\u9fa5]{2,10})(?:\s|$)/);
  const medalM = t.match(/(深度验厂|深度验商|实力商家|诚信通\d+年)/g);
  const weightM = t.match(/(\d+(?:\.\d+)?)\s*(kg|KG|千克|公斤|g|克)(?![a-zA-Z])/g);
  const sizeM = t.match(/(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)(?:\s*[*x×]\s*(\d+(?:\.\d+)?))?\s*(cm|CM|mm|MM|厘米|毫米)/g);
  const idx = t.indexOf('属性');
  const attr = idx >= 0 ? t.slice(idx, idx + 260) : '';
  return { expired: false, title, priceMin: pm ? pm[1] : null, priceMax: pm && pm[2] ? pm[2] : null,
    moq: moqM ? moqM[1] : null, sales: salesM ? salesM[0] : null, month: monthM ? monthM[0] : null,
    seller: sellerM ? sellerM[1] : null, city: cityM ? cityM[1] : null, medals: medalM || [],
    weight: weightM || [], size: sizeM || [], attr, href: location.href.slice(0, 200), len: t.length };
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

const rows = [];
const perKw = [];
const failures = [];
const scrapedAt = new Date().toISOString();

for (const kw of kws) {
  const rec = { keyword: kw.keyword, gbkhex: kw.gbkhex, picUrl: 'https://tw.1688.com/pic/-' + kw.gbkhex + '.html', idsFound: 0, ids: [], offers: [], errors: [] };
  try {
    const len = await goto(rec.picUrl, 300);
    const d = await ev(IDS_JS);
    rec.picLen = len; rec.idsFound = (d && d.ids ? d.ids.length : 0); rec.ids = (d && d.ids ? d.ids : []).slice(0, MAX_PER_KW);
    log('[' + kw.keyword + '] pic len=' + len + ' ids=' + rec.idsFound);
    if (!rec.idsFound) { rec.errors.push('pic page yielded 0 offer ids; final=' + (d && d.href)); }
  } catch (e) { rec.errors.push('pic page error: ' + e.message); log('[' + kw.keyword + '] PIC ERROR ' + e.message); }

  let collected = 0;
  for (const id of rec.ids) {
    if (collected >= TARGET_PER_KW) break;
    await sleep(sleepMs);
    const url = 'https://detail.1688.com/offer/' + id + '.html';
    try {
      const len = await goto(url, 500);
      const d = await ev(DETAIL_JS);
      if (d.expired) { rec.errors.push(id + ': expired'); log('  ' + id + ' EXPIRED'); continue; }
      const o = { offer_id: id, ...d, url: 'https://detail.1688.com/offer/' + id + '.html' };
      rec.offers.push(o); collected++;
      log('  ' + id + ' ¥' + d.priceMin + ' moq=' + d.moq + ' seller=' + (d.seller || '') + ' len=' + d.len);
    } catch (e) { rec.errors.push(id + ': ' + e.message); log('  ' + id + ' DETAIL ERROR ' + e.message); }
  }
  perKw.push(rec);
  rows.push(...rec.offers.map((o) => ({ keyword: kw.keyword, ...o })));
  log('[' + kw.keyword + '] collected=' + rec.offers.length);
}

cdp.close(); await closePage(info);

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const header = ['keyword', 'offer_id', 'title', 'price_min_cny', 'price_max_cny', 'moq', 'weight_g', 'size_cm', 'seller', 'monthly_sales', 'trade_medal', 'url', 'scraped_at'];
const lines = [header.join(',')];
for (const r of rows) {
  lines.push([r.keyword, r.offer_id, r.title, r.priceMin, r.priceMax, r.moq,
    (Array.isArray(r.weight) && r.weight.length ? r.weight.join('|') : ''),
    (Array.isArray(r.size) && r.size.length ? r.size.join('|') : ''),
    r.seller, r.month || r.sales || '', (r.medals || []).join('|'),
    r.url, scrapedAt].map(csvCell).join(','));
}
fs.writeFileSync(path.join(OUT, 'offers.csv'), lines.join('\r\n') + '\r\n');
fs.writeFileSync(path.join(OUT, '1688-run.json'), JSON.stringify({ scrapedAt, out: OUT, perKw, rows: rows.length }, null, 1));
log('DONE rows=' + rows.length + ' -> ' + path.join(OUT, 'offers.csv'));
process.exit(0);
