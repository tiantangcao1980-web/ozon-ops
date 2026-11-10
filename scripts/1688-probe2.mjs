import fs from 'node:fs';
import { ensureChrome, newPage, closePage, sleep } from './1688-cdp.mjs';

const KEYWORD = process.argv[2] || '硅胶锅铲';
const OUT = 'raw\\_1688probe';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
await ensureChrome((m) => log('[chrome]', m));

const EXTRACT = `(() => {
  const anchors = [...document.querySelectorAll('a[href*="detail.1688.com/offer/"]')];
  const seen = new Set(); const out = [];
  for (const a of anchors) {
    const m = (a.href||'').match(/offer\\/(\\d{6,})\\.html/);
    if (!m) continue; const id = m[1];
    if (seen.has(id)) continue; seen.add(id);
    let card = a, node = a;
    for (let i = 0; i < 8 && node; i++) { node = node.parentElement; if (!node) break;
      const t = node.innerText || ''; if (t.length > 15 && /[¥￥]\\s*\\d/.test(t)) { card = node; break; } }
    out.push({ id, title: ((a.getAttribute('title')||'') + '|' + (a.innerText||'') + '|' + ((card.querySelector('img[alt]')||{}).alt||'')).trim().slice(0,200),
      text: (card.innerText||'').replace(/\\s+/g,' ').trim().slice(0,400), href:(a.href||'').split('?')[0] });
  }
  return { href: location.href, title: document.title, bodyLen: document.body?document.body.innerText.length:0, count: out.length, offers: out.slice(0,10) };
})()`;

const report = { keyword: KEYWORD, steps: [] };
const { cdp, info } = await newPage();
async function evalJs(expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.value; }
async function shot(name) { try { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '\\' + name + '.png', Buffer.from(s.data, 'base64')); return OUT + '\\' + name + '.png'; } catch { return null; } }
try {
  await cdp.send('Page.navigate', { url: 'https://www.1688.com/' });
  for (let i = 0; i < 20; i++) { await sleep(1000); const l = await evalJs('document.body?document.body.innerText.length:0'); if (l > 1500) break; }
  const inputs = await evalJs(`JSON.stringify([...document.querySelectorAll('input')].map(i=>({name:i.name,id:i.id,ph:i.placeholder,type:i.type,cls:(i.className||'').slice(0,60)})).slice(0,20))`);
  const searchSel = await evalJs(`(() => {
    const cands = [...document.querySelectorAll('input')].filter(i => /search|keywords|key/i.test((i.name||'')+(i.id||'')+(i.placeholder||'')));
    const el = cands[0] || null;
    return el ? ((el.name||'') + '#' + (el.id||'') + ' ph=' + (el.placeholder||'')) : null;
  })()`);
  report.steps.push({ step: 'A-homepage', url: await evalJs('location.href'), title: await evalJs('document.title'), inputs, searchSel });
  log('[A] inputs:', inputs);
  log('[A] searchSel:', searchSel);

  const typed = await evalJs("(() => { const cands = [...document.querySelectorAll('input')].filter(i => /search|keywords|key/i.test((i.name||'')+(i.id||'')+(i.placeholder||''))); const el = cands[0]; if (!el) return 'no-input'; el.focus(); el.value = " + JSON.stringify(KEYWORD) + "; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'typed:' + el.value; })()");
  log('[A]', typed);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(6000);
  const afterA = await evalJs(EXTRACT);
  const headA = await evalJs("(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,500)");
  report.steps.push({ step: 'A-result', finalUrl: afterA?.href, title: afterA?.title, bodyLen: afterA?.bodyLen, count: afterA?.count, head: headA, offers: afterA?.offers, png: await shot('A-search') });
  log('[A-result]', afterA?.href, 'count=', afterA?.count);

  const homeOffer = await evalJs("(() => { const a = document.querySelector('a[href*=\"detail.1688.com/offer/\"]'); return a ? a.href : null; })()");
  report.steps.push({ step: 'B-target', homeOffer });
  if (homeOffer) {
    await cdp.send('Page.navigate', { url: homeOffer });
    for (let i = 0; i < 20; i++) { await sleep(1000); const l = await evalJs('document.body?document.body.innerText.length:0'); if (l > 1200) break; }
    const b = await evalJs(`(() => ({ href: location.href, title: document.title, len: document.body?document.body.innerText.length:0,
      head: (document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,1200), login: /登录|login/i.test(location.href) }))()`);
    report.steps.push({ step: 'B-detail', ...b, png: await shot('B-detail') });
    log('[B]', b.href, 'len=', b.len);
  }
} catch (e) { report.error = String(e && e.stack || e); log('ERROR', e.message); }
cdp.close(); await closePage(info);
fs.writeFileSync(OUT + '\\probe2.json', JSON.stringify(report, null, 1));
console.log('---REPORT---');
console.log(JSON.stringify(report, null, 1).slice(0, 7000));
process.exit(0);
