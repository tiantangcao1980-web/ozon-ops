#!/usr/bin/env node
/**
 * 从已登录的 Ozon 卖家后台抓真实搜索词需求数据（7 天口径）。
 * 原理：后台「Что продавать → 搜索查询」页用 POST /api/site/searchteam/Stats/queries/search/v2，
 *      带 x-o3-company-id 头即可复用当前登录态，不需要 Premium。
 * 用法: node scripts/ozon-query-stats.mjs [--port 9222] [--company 1234567] [--limit 50] [--seeds a,b,c]
 * 输出: raw/query-stats-<date>.json + reports/query-stats-<date>.md
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const DEFAULT_SEEDS = [
  'органайзер для телефона в машину',
  'карман для телефона в машину',
  'когтерезка для кошек',
  'когтерезка',
  'скребок для льда',
  'скребок для снега',
  'щётка для снега',
  'когтеточка',
  'когтеточка для кошек',
  'наушники зимние',
  'грелка',
  'уплотнитель для двери'
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; out[k] = v && !v.startsWith('--') ? (i++, v) : true; }
  }
  return out;
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 120000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pct(x) { return (x * 100).toFixed(2) + '%'; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = args.port || '9222';
  const company = args.company || '1234567';
  const limit = Number(args.limit || 50);
  const seeds = args.seeds ? String(args.seeds).split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_SEEDS;

  const listUrl = 'http://127.0.0.1:' + port + '/json/list';
  const tabs = await (await fetch(listUrl)).json();
  const tab = tabs.filter(t => t.type === 'page').find(t => /seller\.ozon/i.test(t.url)) || tabs.find(t => t.type === 'page');
  if (!tab) throw new Error('找不到卖家后台标签页，请先登录 seller.ozon.ru');
  console.log('attach:', tab.url.slice(0, 80));

  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.open();
  const results = {};
  try {
    await cdp.send('Runtime.enable');
    for (const seed of seeds) {
      const body = JSON.stringify({ text: seed, limit: String(limit), offset: '0', sort_by: 'count', sort_dir: 'desc', period: 'days_7' });
      const expr = '(async()=>{const r=await fetch("/api/site/searchteam/Stats/queries/search/v2",{method:"POST",headers:{"Content-Type":"application/json","x-o3-company-id":"' + company + '"},body:' + JSON.stringify(body) + '});const t=await r.text();return JSON.stringify({status:r.status,body:t});})()';
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const parcel = JSON.parse(r.result.value);
      let rows = [];
      try { rows = (JSON.parse(parcel.body).data || []); } catch { rows = []; }
      results[seed] = { status: parcel.status, rows: rows };
      console.log(seed + ' -> ' + parcel.status + ' / ' + rows.length + ' rows' + (rows[0] ? (' / top: ' + rows[0].query + ' (' + rows[0].count + ')') : ''));
      await sleep(1200);
    }
  } finally { cdp.close(); }

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync('raw', { recursive: true });
  mkdirSync('reports', { recursive: true });
  const jsonPath = 'raw/query-stats-' + date + '.json';
  writeFileSync(jsonPath, JSON.stringify({ date: date, companyId: company, period: 'days_7', seeds: seeds, results: results }, null, 2), 'utf8');

  const md = [];
  md.push('# Ozon 真实搜索需求（后台「Что продавать」7 天口径）· ' + date);
  md.push('');
  md.push('来源：已登录卖家后台搜索词统计接口（company_id ' + company + '，period=days_7）。');
  md.push('字段：count=搜索次数，avgCaRub=平均成交额(₽)，ca=转化率%，itemsViews=商品卡曝光，uniqSellers=卖家数。');
  md.push('');
  md.push('| 种子词 | 返回行数 | 头部搜索量 | 头部查询 |');
  md.push('|---|---|---|---|');
  for (const seed of seeds) {
    const r = results[seed];
    const top = (r.rows || [])[0];
    md.push('| ' + seed + ' | ' + (r.rows || []).length + ' | ' + (top ? top.count : 0) + ' | ' + (top ? top.query : '—') + ' |');
  }
  md.push('');
  for (const seed of seeds) {
    const rows = (results[seed] || {}).rows || [];
    md.push('## ' + seed);
    md.push('');
    if (!rows.length) { md.push('（无数据）'); md.push(''); continue; }
    md.push('| # | 查询 | 搜索量 | 平均成交额₽ | 转化% | 商品卡曝光 | 卖家数 |');
    md.push('|---|---|---|---|---|---|---|');
    rows.slice(0, 12).forEach((x, i) => {
      md.push('| ' + (i + 1) + ' | ' + x.query + ' | ' + x.count + ' | ' + (x.avgCaRub || 0) + ' | ' + (x.ca || 0) + ' | ' + (x.itemsViews || 0) + ' | ' + (x.uniqSellers || 0) + ' |');
    });
    md.push('');
  }
  const mdPath = 'reports/query-stats-' + date + '.md';
  writeFileSync(mdPath, md.join('\n'), 'utf8');
  console.log('\nwrote ' + jsonPath + ' and ' + mdPath);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });