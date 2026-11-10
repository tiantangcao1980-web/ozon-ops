import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';

const KEYWORD = process.argv[2] || '硅胶锅铲';
const OUT = 'raw\\_1688probe';
fs.mkdirSync(OUT, { recursive: true });

const EXTRACT = `(() => {
  const anchors = [...document.querySelectorAll('a[href*="detail.1688.com/offer/"]')];
  const seen = new Set(); const out = [];
  for (const a of anchors) {
    const m = (a.href||'').match(/offer\\/(\\d{6,})\\.html/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue; seen.add(id);
    let card = a, node = a;
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement; if (!node) break;
      const t = node.innerText || '';
      if (t.length > 15 && /[¥￥]\\s*\\d/.test(t)) { card = node; break; }
    }
    const text = (card.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
    const title = ((a.getAttribute('title') || '') + '|' + (a.innerText || '') + '|' + ((card.querySelector('img[alt]') || {}).alt || '')).trim().slice(0, 200);
    out.push({ id, title, text, href: (a.href||'').split('?')[0] });
  }
  return { href: location.href, title: document.title, bodyLen: (document.body ? document.body.innerText.length : 0), count: out.length, offers: out.slice(0, 12) };
})()`;

const entrants = [
  'https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(KEYWORD),
  'https://www.1688.com/s.html?keywords=' + encodeURIComponent(KEYWORD),
  'https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(KEYWORD) + '&n=y',
];

const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));
const report = { keyword: KEYWORD, tried: [] };

for (let i = 0; i < entrants.length; i++) {
  const url = entrants[i];
  const { cdp, info } = await newPage();
  try {
    const full = [];
    cdp.on('Page.javascriptDialogOpening', () => {});
    await cdp.send('Page.navigate', { url });
    let len = 0;
    for (let k = 0; k < 24; k++) {
      await sleep(1250);
      const t = await cdp.send('Runtime.evaluate', { expression: 'document.body?document.body.innerText.length:0', returnByValue: true });
      len = t.result?.value || 0;
      if (len > 800) break;
    }
    await sleep(1500);
    const r = await cdp.send('Runtime.evaluate', { expression: EXTRACT, returnByValue: true });
    const v = r.result?.value || {};
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    const png = OUT + '\\probe' + (i + 1) + '.png';
    if (shot?.data) fs.writeFileSync(png, Buffer.from(shot.data, 'base64'));
    const bodyHead = await cdp.send('Runtime.evaluate', { expression: "(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,600)", returnByValue: true });
    report.tried.push({
      url, bodyLen: len, finalUrl: v.href, title: v.title, offerCount: v.count,
      head: String(bodyHead.result?.value || ''), png, offers: v.offers,
    });
    log('[entrant ' + (i + 1) + '] len=' + len + ' offers=' + v.count + ' title=' + v.title);
    if (v.count > 0) break;
  } catch (e) {
    report.tried.push({ url, error: String(e && e.message || e) });
    log('[entrant ' + (i + 1) + '] ERROR ' + e.message);
  } finally { cdp.close(); await closePage(info); }
}
fs.writeFileSync(OUT + '\\probe.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1).slice(0, 6000));
process.exit(0);
