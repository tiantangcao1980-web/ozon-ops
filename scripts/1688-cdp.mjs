import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = process.env.CHROME_PROFILE || '.chrome-1688';
const PORT = Number(process.env.CDP_PORT || 9337);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ensureChrome(log = () => {}) {
  try {
    const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
    if (r.ok) { const v = await r.json(); log('reuse chrome ' + v.Browser); return v; }
  } catch {}
  fs.mkdirSync(PROFILE, { recursive: true });
  const flags = [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1400,900',
    '--window-position=-2400,-2400',
    '--user-agent=' + UA,
    'about:blank',
  ];
  const child = spawn(CHROME, flags, { stdio: 'ignore', detached: true });
  child.unref();
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) { const v = await r.json(); log('launched ' + v.Browser); return v; }
    } catch {}
    await sleep(300);
  }
  throw new Error('devtools not up on ' + PORT);
}

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws err')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) for (const h of (c.handlers.get(m.method) || [])) h(m.params);
    };
    ws.onclose = () => { for (const { rej } of c.pending.values()) rej(new Error('ws closed')); c.pending.clear(); };
    return c;
  }
  on(m, fn) { const a = this.handlers.get(m) || []; a.push(fn); this.handlers.set(m, a); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  close() { try { this.ws.close(); } catch {} }
}

export async function newPage() {
  const tr = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
  const info = await tr.json();
  const cdp = await CDP.connect(info.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, info };
}

export async function closePage(info) {
  try { await fetch('http://127.0.0.1:' + PORT + '/json/close/' + info.id); } catch {}
}
export { sleep };
