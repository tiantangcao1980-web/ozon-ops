import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require((process.env.PLAYWRIGHT_RUNTIME_DIR || 'playwright'));
const OUT = 'raw/ozon-visual';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const meta = {};
const extras = {
  brush: ['1234567870', '1234567871', '1234567872'],
  scraper: ['1234567873', '1234567874'],
  seal: ['1234567875', '1234567876', '1234567877'],
  warmer: [],
  clipper: [],
};

// clipper via search: take all product hrefs, extract trailing digits
try {
  await page.goto('https://www.ozon.ru/search/?text=' + encodeURIComponent('когтерезка для кошек с ограничителем') + '&from_global=true', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(7000);
  const cards = await page.evaluate(() => {
    const out = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/product/"]')) {
      const href = a.getAttribute('href') || '';
      const digits = href.match(/(\d{6,})/g);
      if (!digits) continue;
      const sku = digits[digits.length - 1];
      if (seen.has(sku)) continue;
      const txt = (a.innerText || '').replace(/\s+/g, ' ').trim();
      if (txt.length < 20) continue;
      seen.add(sku);
      out.push({ sku, text: txt.slice(0, 120), href });
    }
    return out.slice(0, 20);
  });
  meta.__search = cards;
  extras.clipper = cards.slice(0, 3).map((c) => c.sku);
  console.log('CLIPPER search cards=' + cards.length + ' -> ' + JSON.stringify(extras.clipper));
} catch (e) { console.log('SEARCH_ERR ' + String(e?.message || e).slice(0, 200)); }

for (const [niche, skus] of Object.entries(extras)) {
  for (const sku of skus) {
    const key = niche + ':' + sku;
    try {
      await page.goto('https://www.ozon.ru/product/' + sku + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(4500);
      const info = await page.evaluate(() => {
        const g = document.querySelector('[data-widget="webGallery"]');
        const urls = g ? [...g.querySelectorAll('img')].map((e) => e.currentSrc || e.src) : [];
        const txt = document.body.innerText;
        return {
          title: document.title,
          h1: document.querySelector('h1')?.innerText || '',
          thumbs: urls.slice(0, 24),
          rating: txt.match(/\d\.\d[\s\S]{0,25}отзыв/)?.[0] || null,
          price: txt.match(/\d[\d\s]{2,}\s?₽/)?.[0] || null,
        };
      });
      const ids = [];
      for (const u of info.thumbs) {
        const m = u.match(/\/(\d+)\.(jpe?g|png|webp)/i);
        if (m) ids.push({ id: m[1], base: u.replace(/\/(wc\d+|c\d+x\d+)\/[^/]+$/, ''), ext: m[2] });
      }
      info.ids = [...new Map(ids.map((x) => [x.id, x])).values()];
      meta[key] = info;
      const gEl = await page.$('[data-widget="webGallery"]');
      if (gEl) { await gEl.screenshot({ path: path.join(OUT, niche + '-' + sku + '-gallery.png'), timeout: 15000 }).catch(() => {}); }
      console.log(niche, sku, 'ids=' + info.ids.length, info.h1.slice(0, 40));
    } catch (e) { console.log(niche, sku, 'ERR ' + String(e?.message || e).slice(0, 140)); }
    await sleep(1800);
  }
}
fs.writeFileSync(path.join(OUT, 'collect2.json'), JSON.stringify(meta, null, 2));
await page.close();
await browser.close();
console.log('DONE');
