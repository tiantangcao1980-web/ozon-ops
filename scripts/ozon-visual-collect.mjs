import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require((process.env.PLAYWRIGHT_RUNTIME_DIR || 'playwright'));
const OUT = 'raw/ozon-visual';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const products = {
  brush: ['1234567899', '1234567880', '1234567881'],
  scraper: ['1234567882', '1234567883', '1234567884'],
  seal: ['1234567885', '1234567886', '1234567887'],
  warmer: ['1234567888', '1234567889'],
  clipper: [],
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const meta = {};

function large(u) {
  return u.replace(/\/(wc\d+|c\d+x\d+)\//, '/wc1600/');
}

// --- clipper: search page top products ---
try {
  await page.goto('https://www.ozon.ru/search/?text=' + encodeURIComponent('когтерезка для кошек с ограничителем') + '&from_global=true', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(6000);
  const cards = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/product/"]')) {
      const m = a.getAttribute('href').match(/\/product\/([^/?]+)/);
      if (!m) continue;
      const sku = m[1];
      if (seen.has(sku)) continue;
      seen.add(sku);
      const txt = (a.innerText || '').trim();
      if (txt.length < 5) continue;
      out.push({ sku, href: a.getAttribute('href'), text: txt.slice(0, 200) });
    }
    return out.slice(0, 30);
  });
  meta.search = cards;
  const top = cards.slice(0, 6).map((c) => String(c.sku).match(/^\d+$/) ? c.sku : null).filter(Boolean);
  products.clipper = top.slice(0, 3);
  await page.screenshot({ path: path.join(OUT, 'search-clipper.png') }).catch(() => {});
  console.log('SEARCH cards=' + cards.length + ' clipper=' + JSON.stringify(products.clipper));
} catch (e) { console.log('SEARCH ERR ' + String(e?.message || e).slice(0, 200)); }

// --- product galleries ---
for (const [niche, skus] of Object.entries(products)) {
  for (const sku of skus) {
    try {
      await page.goto('https://www.ozon.ru/product/' + sku + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(5000);
      const data = await page.evaluate(() => {
        const g = document.querySelector('[data-widget="webGallery"]');
        const urls = [];
        if (g) {
          for (const img of g.querySelectorAll('img')) {
            const u = img.currentSrc || img.src || '';
            if (u) urls.push(u);
          }
        }
        const txt = document.body.innerText;
        const rating = txt.match(/\d\.\d[\s\S]{0,30}отзыв/)?.[0] || null;
        const price = txt.match(/\d[\d\s]{2,}\s?₽/)?.[0] || null;
        return {
          title: document.title,
          h1: document.querySelector('h1')?.innerText || '',
          galleryCount: urls.length,
          thumbs: urls.slice(0, 30),
          rating,
          price,
          rect: g ? g.getBoundingClientRect().toJSON() : null,
          brand: document.querySelector('[data-widget="webBrand"]')?.innerText?.slice(0, 80) || null,
        };
      });
      const ids = [];
      for (const u of data.thumbs) {
        const m = u.match(/\/(\d+)\.(jpe?g|png|webp)/i);
        if (m) ids.push({ id: m[1], base: u.replace(/\/(wc\d+|c\d+x\d+)\/[^/]+$/, ''), ext: m[2] });
      }
      const uniq = [...new Map(ids.map((x) => [x.id, x])).values()];
      data.ids = uniq;
      meta[niche + ':' + sku] = data;
      console.log(niche, sku, 'thumbs=' + data.thumbs.length, 'ids=' + uniq.length, 'h1=' + data.h1.slice(0, 45));
      // screenshot gallery element
      const gEl = await page.$('[data-widget="webGallery"]');
      if (gEl) {
        await gEl.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(800);
        await gEl.screenshot({ path: path.join(OUT, niche + '-' + sku + '-gallery.png'), timeout: 15000 }).catch(() => {});
      }
      await page.screenshot({ path: path.join(OUT, niche + '-' + sku + '-page.png') }).catch(() => {});
    } catch (e) {
      meta[niche + ':' + sku] = { error: String(e?.message || e).slice(0, 300) };
      console.log(niche, sku, 'ERR ' + String(e?.message || e).slice(0, 160));
    }
    await sleep(2000);
  }
}
fs.writeFileSync(path.join(OUT, 'collect.json'), JSON.stringify(meta, null, 2));
await page.close();
await browser.close();
console.log('DONE');
