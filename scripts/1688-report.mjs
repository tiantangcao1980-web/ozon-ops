import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'raw\\1688-202611061238';
const load = (p) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8')); } catch { return null; } };

// ---------- 1688 ----------
const run1688 = load('1688-run2.json') || load('1688-run.json');
if (!run1688) throw new Error('no 1688 run json in ' + DIR);

function cleanSeller(rawT, fallback) {
  if (!rawT) return fallback || '';
  const junk = /^(从源头|源头|阿里|1688|深度验|实力商家|超级工厂)/;
  const cands = [];
  const re1 = /([\u4e00-\u9fa5]{2,20}?(?:有限公司|股份有限公司|商行|经营部|贸易商行|工贸))/g;
  let m; while ((m = re1.exec(rawT)) !== null) cands.push(m[1]);
  const re2 = /([\u4e00-\u9fa5]{2,10}?(?:市|县|省)[\u4e00-\u9fa5]{2,14}?(?:有限公司|商行|经营部|厂))/g;
  while ((m = re2.exec(rawT)) !== null) cands.push(m[1]);
  const ok = cands.filter((c) => !junk.test(c) && !/阿里巴巴|认证|旗舰|官方/.test(c));
  if (ok.length) {
    ok.sort((a, b) => b.length - a.length);
    return ok[0];
  }
  return fallback || '';
}
function pickWeight(rawT) {
  if (!rawT) return '';
  const out = [];
  const re = /(?:重量|毛重|净重|产品重量)\s*[:：]?\s*([\d.]+)\s*(kg|KG|千克|公斤|g|克)/g;
  let m; while ((m = re.exec(rawT)) !== null) out.push(m[1] + m[2]);
  if (out.length) return out.join('|');
  const re2 = /(\d+(?:\.\d+)?)\s*(?:kg|千克|公斤)(?![a-zA-Z])/g;
  const o2 = []; while ((m = re2.exec(rawT)) !== null) o2.push(m[1] + 'kg');
  return o2.slice(0, 2).join('|');
}
function pickSize(rawT) {
  if (!rawT) return '';
  const re = /(?:尺寸|规格|长宽|产品尺寸)\s*[:：]?\s*([\d.]+\s*[*x×]\s*[\d.]+(?:\s*[*x×]\s*[\d.]+)?\s*(?:cm|CM|mm|MM|厘米|毫米))/g;
  const out = []; let m; while ((m = re.exec(rawT)) !== null) out.push(m[1].replace(/\s+/g, ''));
  if (out.length) return out.join('|');
  const re2 = /([\d.]+)\s*[*x×]\s*([\d.]+)(?:\s*[*x×]\s*([\d.]+))?\s*(cm|CM|mm|MM|厘米|毫米)/g;
  const o2 = []; while ((m = re2.exec(rawT)) !== null) o2.push(m[0].replace(/\s+/g, ''));
  return o2.slice(0, 2).join('|');
}
function pickMoq(o) {
  if (o.moq) return o.moq;
  if (!o.rawT) return '';
  const pats = [/(\d+)\s*件\s*(?:混批|起批)/, /起批[量]?\s*[:：]?\s*(\d+)/, /(\d+)\s*件起/];
  for (const p of pats) { const m = o.rawT.match(p); if (m) return m[1]; }
  return '';
}

const rows1688 = [];
for (const kw of (run1688.perKw || [])) {
  for (const o of (kw.offers || [])) {
    if (o.expired) continue;
    if (/验证码|滑块|拦截/.test(String(o.title || ''))) continue;
    if (!o.title && !o.priceMin) continue;
    const seller = cleanSeller(o.rawT, o.seller);
    const weight = pickWeight(o.rawT) || (Array.isArray(o.weight) && o.weight.length ? o.weight.join('|') : '');
    const size = pickSize(o.rawT) || (Array.isArray(o.size) && o.size.length ? o.size.join('|') : '');
    const sales = String(o.sales || '').replace(/已售\s*/, '已售');
    rows1688.push({
      keyword: kw.keyword, offer_id: o.offer_id, title: o.title || '',
      price_min_cny: o.priceMin || '', price_max_cny: o.priceMax || '',
      moq: pickMoq(o), weight_g: weight, size_cm: size, seller,
      monthly_sales: o.month ? ('月销' + o.month.replace(/^月销\s*/, '')) : (sales ? (sales + '(累计)') : ''),
      trade_medal: (o.medals || []).join('|'), url: o.url, scraped_at: run1688.scrapedAt || '',
    });
  }
}
function cell(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const h1688 = ['keyword', 'offer_id', 'title', 'price_min_cny', 'price_max_cny', 'moq', 'weight_g', 'size_cm', 'seller', 'monthly_sales', 'trade_medal', 'url', 'scraped_at'];
const lines1688 = [h1688.join(',')];
for (const r of rows1688) lines1688.push(h1688.map((k) => r[k]).map(cell).join(','));
fs.writeFileSync(path.join(DIR, 'offers.csv'), lines1688.join('\r\n') + '\r\n');

// ---------- alibaba ----------
const runs = [];
for (const f of ['alibaba-run2.json', 'alibaba-run.json', 'alibaba-retry.json']) { const j = load(f); if (j) runs.push({ file: f, j }); }
const alibabaKw = new Map();
for (const { file, j } of runs) {
  for (const kw of (j.perKw || [])) {
    const prev = alibabaKw.get(kw.keyword_en);
    const offs = kw.offers || [];
    if (!prev || offs.length > prev.offers.length) alibabaKw.set(kw.keyword_en, { ...kw, file });
  }
}
function reparseAli(o) {
  const raw = String(o.cardText || '');
  if (!raw) return { title: o.title || '', priceMin: o.priceMin || '', priceMax: o.priceMax || '', currency: o.currency || '', moq: o.moq || '', moqUnit: o.moqUnit || '', supplier: o.supplier || '' };
  const moqIdx = raw.search(/最低起订量|Min\.?\s*order/i);
  const pre = moqIdx > 0 ? raw.slice(0, moqIdx) : raw;
  const re = /([¥$€￥])\s*([\d,]+(?:\.\d+)?)(?:\s*-\s*[¥$€￥]?\s*([\d,]+(?:\.\d+)?))?/g;
  let pl = null, m; while ((m = re.exec(pre)) !== null) pl = { sym: m[1], min: m[2], max: m[3], index: m.index };
  let title = '';
  if (pl) {
    title = pre.slice(0, pl.index);
    title = title.replace(/(运费优惠|\d+\s*天内底价|已售[\d,.万+]+\s*[件套个只]|\bAd\b|广告|认证|Trade Assurance|供应商|筛选条件)[^。；]*$/g, '').trim();
  }
  if (!title) title = String(o.title || '').trim();
  const moqM = raw.match(/(?:最低起订量|Min\.?\s*order)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]+|套|件|个|只|条|张)/i);
  let sup = '';
  const s1 = raw.match(/([A-Z][A-Za-z0-9&.,'()\- ]{2,70}?Co\.,?\s*Ltd\.?)/);
  const s2 = raw.match(/([A-Z][A-Za-z0-9&.,'()\- ]{2,70}?(?:Inc\.?|Corporation|Company|Ltd\.?|Group|Factory|Industries|Industry|Trading))/);
  sup = s1 ? s1[1].trim() : (s2 ? s2[1].trim() : (o.supplier || ''));
  return { title: title.slice(0, 200), priceMin: pl ? pl.min.replace(/,/g, '') : (o.priceMin || ''), priceMax: pl && pl.max ? pl.max.replace(/,/g, '') : '', currency: pl ? pl.sym : (o.currency || ''), moq: moqM ? moqM[1].replace(/,/g, '') : (o.moq || ''), moqUnit: moqM ? moqM[2] : (o.moqUnit || ''), supplier: sup };
}
const rowsAli = [];
for (const kw of alibabaKw.values()) for (const o of (kw.offers || [])) { const rp = reparseAli(o); rowsAli.push({ ...o, ...rp, keyword_en: kw.keyword_en, keyword_cn: kw.keyword_cn }); }
const hAli = ['keyword_en', 'keyword_cn', 'title', 'price_min', 'price_max', 'currency', 'moq', 'moq_unit', 'supplier', 'url', 'source_site', 'scraped_at'];
const linesAli = [hAli.join(',')];
const nowIso = new Date().toISOString();
for (const r of rowsAli) linesAli.push([r.keyword_en, r.keyword_cn, r.title, r.priceMin, r.priceMax, r.currency, r.moq, r.moqUnit, r.supplier, r.url, 'alibaba.com', nowIso].map(cell).join(','));
fs.writeFileSync(path.join(DIR, 'offers-alibaba.csv'), linesAli.join('\r\n') + '\r\n');

fs.writeFileSync(path.join(DIR, 'consolidated.json'), JSON.stringify({ rows1688: rows1688.length, rowsAli: rowsAli.length, alibabaKw: Array.from(alibabaKw.values()).map((k) => ({ keyword: k.keyword_en, offers: (k.offers || []).length, file: k.file })) }, null, 1));
console.log('rows1688=' + rows1688.length + ' rowsAli=' + rowsAli.length);
console.log(JSON.stringify(Array.from(alibabaKw.values()).map((k) => k.keyword_en + ':' + (k.offers || []).length)));
process.exit(0);