// 用已登录 Chrome 打开任意 URL，返回标题+正文片段/价格
async function newTab(url) {
  const r = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!r.ok) throw new Error('new tab ' + r.status + ' ' + (await r.text()).slice(0,100));
  return await r.json();
}
class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 60000); }); }
  close() { try { this.ws.close(); } catch {} }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const target = await newTab(process.argv[2]);
await sleep(1500);
const c = new CDP(target.webSocketDebuggerUrl);
await c.open();
await c.send('Runtime.enable');
for (let i = 0; i < 12; i++) {
  await sleep(4000);
  const r = await c.send('Runtime.evaluate', { expression: 'JSON.stringify({t:document.title,u:location.href,body:(document.body?document.body.innerText:\"\").slice(0,1200)})', returnByValue: true });
  const v = JSON.parse(r.result.value);
  if (i === 0 || /₽|руб|капч|Captcha/i.test(v.body) || v.t) console.log('[' + (i+1) + '] title=' + v.t + ' | url=' + v.u.slice(0, 80));
  if (/₽/.test(v.body)) { console.log('--- 正文片段 ---\n' + v.body.slice(0, 1100)); break; }
  if (i === 11) console.log('--- 最终正文 ---\n' + v.body.slice(0, 900));
}
c.close();