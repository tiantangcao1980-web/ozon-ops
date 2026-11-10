import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';
const OUT = 'raw\\_1688probe';
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));
const report = { steps: [] };
const { cdp, info } = await newPage();
const ev = async (e) => { try { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; } catch (err) { return 'EVALERR:' + err.message; } };
const shot = async (n) => { try { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '\\' + n + '.png', Buffer.from(s.data, 'base64')); return OUT + '\\' + n + '.png'; } catch { return null; } };
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
async function visit(url, ua) {
  if (ua) await cdp.send('Network.setUserAgentOverride', { userAgent: ua, platform: 'iPhone' });
  await cdp.send('Page.navigate', { url });
  let len = 0;
  for (let i = 0; i < 24; i++) { await sleep(1000); len = await ev('document.body?document.body.innerText.length:0'); if (len > 1000) break; }
  await sleep(1500);
  const d = await ev(`(() => {
    const anchors = [...document.querySelectorAll('a[href*="1688.com/offer/"],a[href*="detail.1688.com"],a[href*="//detail."]')].map(a=>a.href);
    return { href: location.href, title: document.title, len: document.body?document.body.innerText.length:0,
      head: (document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,1500),
      anchorCount: anchors.length, anchorSample: anchors.slice(0,8),
      priceMatches: ((document.body?document.body.innerText:'').match(/[¥￥]\\s*[\\d.]+/g)||[]).slice(0,10) };
  })()`);
  return { url, ua: ua ? 'mobile' : 'desktop', ...d };
}
try {
  report.steps.push({ step: 'mobile-search', ...(await visit('https://m.1688.com/offer_search/-B9E8BDBAB9F8B2F9.html', MUA)), png: await shot('m-search') });
  log('[mobile-search]', JSON.stringify(report.steps.at(-1)).slice(0, 1200));
  report.steps.push({ step: 'desktop-m-search', ...(await visit('https://m.1688.com/offer_search/-B9E8BDBAB9F8B2F9.html', null)), png: await shot('d-m-search') });
  log('[desktop-m]', JSON.stringify(report.steps.at(-1)).slice(0, 1200));
  report.steps.push({ step: 'detail', ...(await visit('https://detail.1688.com/offer/1234567831.html', null)), png: await shot('detail') });
  log('[detail]', JSON.stringify(report.steps.at(-1)).slice(0, 1500));
} catch (e) { report.error = String(e && e.stack || e); }
cdp.close(); await closePage(info);
fs.writeFileSync(OUT + '\\probe3.json', JSON.stringify(report, null, 1));
process.exit(0);
