/**
 * OZON Monitor：类 WorldMonitor 的「作战室」看板。
 *
 * - `buildMonitorState`：只读本地库，输出一个可 JSON 序列化的快照（KPI、预警流、走势、竞品异动、数据新鲜度）。
 * - `renderMonitorHtml`：单文件暗色看板，前端每 15 秒拉 `/api/state` 局部刷新；无外部资源。
 */
import { computeAlerts } from '../rules/alerts.mjs';

function dayRange(days, now) {
  const list = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    list.push(date);
  }
  return list;
}

function sumBetween(db, from, to) {
  const row = db
    .prepare('SELECT COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(revenue_rub),0) AS revenue FROM analytics_daily WHERE date >= ? AND date <= ?')
    .get(from, to);
  return { units: Number(row.units), revenue: Math.round(Number(row.revenue) * 100) / 100 };
}

export function buildMonitorState({ db, endpoints = null, now = () => new Date() } = {}) {
  const conn = db.db ?? db;
  const nowDate = now();
  const today = nowDate.toISOString().slice(0, 10);
  const alerts = computeAlerts({ db, now });
  const dates = dayRange(14, nowDate);
  const timeline = dates.map((date) => {
    const row = conn
      .prepare('SELECT COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(revenue_rub),0) AS revenue FROM analytics_daily WHERE date = ?')
      .get(date);
    return { date, units: Number(row.units), revenue: Math.round(Number(row.revenue) * 100) / 100 };
  });

  const sumBetween = (from, to) => {
    const row = conn
      .prepare('SELECT COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(revenue_rub),0) AS revenue FROM analytics_daily WHERE date >= ? AND date <= ?')
      .get(from, to);
    return { units: Number(row.units), revenue: Math.round(Number(row.revenue) * 100) / 100 };
  };
  const weekFrom = new Date(nowDate.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const week = sumBetween(weekFrom, today);
  const prevFrom = new Date(nowDate.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const prevTo = new Date(nowDate.getTime() - 8 * 86_400_000).toISOString().slice(0, 10);
  const prevWeek = sumBetween(prevFrom, prevTo);

  const counts = conn
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM postings WHERE pending_shipment = 1) AS pending,
         (SELECT COUNT(*) FROM products WHERE archived = 0) AS active,
         (SELECT COUNT(*) FROM competitors) AS competitors,
         (SELECT COUNT(*) FROM reviews_raw) AS reviews,
         (SELECT COUNT(*) FROM social_posts) AS social`,
    )
    .get();

  const latestFx = conn.prepare('SELECT rub_per_cny, date, source FROM fx_rates ORDER BY date DESC LIMIT 1').get();
  const lastApi = conn.prepare('SELECT status, called_at FROM api_calls ORDER BY called_at DESC LIMIT 1').get();
  const lastPosting = conn.prepare('SELECT MAX(created_at) AS last FROM postings').get();

  const moversRows = conn
    .prepare(
      `WITH ranked AS (
         SELECT sku, keyword, price_rub, captured_at,
                ROW_NUMBER() OVER (PARTITION BY sku ORDER BY captured_at DESC) AS rn
         FROM competitor_snapshots WHERE price_rub IS NOT NULL
       )
       SELECT l.sku, l.keyword, l.price_rub AS latest, p.price_rub AS prev, l.captured_at AS capturedAt
       FROM ranked l JOIN ranked p ON p.sku = l.sku AND p.rn = 2
       WHERE l.rn = 1 AND p.price_rub > 0
       ORDER BY ABS((l.price_rub - p.price_rub) / p.price_rub) DESC
       LIMIT 8`,
    )
    .all();
  const movers = moversRows.map((row) => ({
    sku: row.sku,
    keyword: row.keyword,
    latest: Number(row.latest),
    prev: Number(row.prev),
    change: Math.round(((Number(row.latest) - Number(row.prev)) / Number(row.prev)) * 1000) / 10,
    capturedAt: row.capturedAt,
  }));

  let adsRow = { spend: 0, revenue: 0 };
  try {
    adsRow = conn.prepare('SELECT COALESCE(SUM(spend_rub),0) AS spend, COALESCE(SUM(revenue_rub),0) AS revenue FROM ads_daily').get();
  } catch {
    adsRow = { spend: 0, revenue: 0 };
  }

  let endpointsSummary = null;
  if (endpoints && typeof endpoints === 'object') {
    const count = (key) => (Array.isArray(endpoints[key]) ? endpoints[key].length : Number(endpoints[key] ?? 0));
    endpointsSummary = {
      generatedAt: endpoints.generatedAt ?? null,
      rows: count('rows'),
      usable: count('usable'),
      blocked: count('blocked'),
      drifted: count('drifted'),
      needsParams: count('needsParams'),
      failed: count('failed'),
    };
  }

  return {
    generatedAt: nowDate.toISOString(),
    store: {
      name: 'Demo Store',
      fx: latestFx ? { rubPerCny: Number(latestFx.rub_per_cny), date: latestFx.date, source: latestFx.source } : null,
    },
    kpis: {
      units7: week.units,
      revenue7: week.revenue,
      unitsPrev7: prevWeek.units,
      revenuePrev7: prevWeek.revenue,
      pendingShipments: Number(counts.pending),
      productsActive: Number(counts.active),
      competitors: Number(counts.competitors),
      reviews: Number(counts.reviews),
      social: Number(counts.social),
      adsSpend: Number(adsRow.spend ?? 0),
      adsRevenue: Number(adsRow.revenue ?? 0),
      adsAcos: Number(adsRow.revenue) > 0 ? Math.round((Number(adsRow.spend) / Number(adsRow.revenue)) * 1000) / 10 : null,
    },
    alerts: alerts.map((alert) => ({ ...alert })),
    timeline,
    movers,
    freshness: {
      lastApiCall: lastApi?.called_at ?? null,
      lastApiStatus: lastApi?.status ?? null,
      lastPosting: lastPosting?.last ?? null,
      fxDate: latestFx?.date ?? null,
    },
    endpoints: endpointsSummary,
  };
}

export function renderMonitorHtml(state) {
  const initial = JSON.stringify(state).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OZON Monitor · 作战室</title>
<style>
:root { --bg:#0b0f14; --panel:#111823; --panel2:#0e141d; --line:#1f2a38; --text:#dbe4ef; --muted:#7c8a9c;
  --accent:#38bdf8; --good:#34d399; --warn:#fbbf24; --bad:#f87171; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
header { display:flex; align-items:center; gap:16px; padding:12px 18px; border-bottom:1px solid var(--line); background:linear-gradient(90deg,#0b1420,#0b0f14); position:sticky; top:0; z-index:5; }
header h1 { font-size:16px; margin:0; letter-spacing:2px; }
.badge { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:10px; padding:2px 8px; }
.dot { width:8px; height:8px; border-radius:50%; background:var(--good); box-shadow:0 0 8px var(--good); display:inline-block; margin-right:6px; animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
.grid { display:grid; grid-template-columns: 300px 1fr 320px; gap:12px; padding:12px; }
@media (max-width:1100px){ .grid{grid-template-columns:1fr;} }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.panel h2 { font-size:12px; text-transform:uppercase; letter-spacing:1.5px; color:var(--muted); margin:0; padding:10px 12px; border-bottom:1px solid var(--line); }
.panel .body { padding:10px 12px; }
.kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.kpi { background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
.kpi .v { font-size:20px; font-weight:600; }
.kpi .l { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; }
.alert { border-left:3px solid var(--warn); background:var(--panel2); padding:8px 10px; margin-bottom:6px; border-radius:0 6px 6px 0; font-size:12px; }
.alert.P0 { border-color:var(--bad); } .alert.P2 { border-color:var(--accent); }
.alert .sev { font-weight:700; margin-right:6px; }
.feed { max-height:420px; overflow:auto; }
.feed::-webkit-scrollbar { width:6px; } .feed::-webkit-scrollbar-thumb { background:var(--line); border-radius:3px; }
table { width:100%; border-collapse:collapse; font-size:12px; }
th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
th { color:var(--muted); font-weight:500; font-size:11px; }
.up { color:var(--bad); } .down { color:var(--good); }
.muted { color:var(--muted); }
.ticker { position:sticky; bottom:0; display:flex; gap:24px; padding:8px 18px; border-top:1px solid var(--line); background:#0b1420; font-size:12px; color:var(--muted); overflow:hidden; white-space:nowrap; }
svg { display:block; width:100%; height:150px; }
</style>
</head>
<body>
<header>
  <h1>OZON MONITOR</h1>
  <span class="badge"><span class="dot"></span>LIVE · 15s</span>
  <span class="badge" id="store">Demo Store</span>
  <span class="badge" id="fx">FX —</span>
  <span class="badge" id="updated">—</span>
</header>
<div class="grid">
  <div class="panel">
    <h2>Alerts · 预警流</h2>
    <div class="body feed" id="alerts"></div>
  </div>
  <div class="panel">
    <h2>Pulse · 14 天走势与 KPI</h2>
    <div class="body">
      <div class="kpis" id="kpis"></div>
      <div id="chart" style="margin-top:10px"></div>
      <h2 style="border:none;padding:12px 0 4px">Movers · 竞品异动</h2>
      <table><thead><tr><th>SKU</th><th>搜索词</th><th>现价₽</th><th>前价₽</th><th>变化</th></tr></thead><tbody id="movers"></tbody></table>
    </div>
  </div>
  <div class="panel">
    <h2>Freshness · 数据新鲜度</h2>
    <div class="body"><table><tbody id="freshness"></tbody></table></div>
    <h2>Endpoints · 端点健康</h2>
    <div class="body"><table><tbody id="endpoints"></tbody></table></div>
  </div>
</div>
<div class="ticker" id="ticker"></div>
<script>
const INITIAL = ${initial};
let state = INITIAL;
const fmt = (value) => value == null ? '—' : Number(value).toLocaleString('en-US');
function pct(value) { return value == null ? '—' : (value > 0 ? '+' : '') + value + '%'; }
function render() {
  document.getElementById('store').textContent = state.store?.name ?? '—';
  document.getElementById('fx').textContent = state.store?.fx ? 'FX 1CNY=' + state.store.fx.rubPerCny + ' RUB' : 'FX —';
  document.getElementById('updated').textContent = 'UPDATED ' + new Date(state.generatedAt).toLocaleTimeString();
  const alerts = state.alerts ?? [];
  document.getElementById('alerts').innerHTML = alerts.length
    ? alerts.map((a) => '<div class="alert ' + a.severity + '"><span class="sev">' + a.severity + '</span>' + escapeHtml(a.message) + '</div>').join('')
    : '<div class="muted">无预警 · all clear</div>';
  const k = state.kpis ?? {};
  const kpis = [
    ['7D 件数', fmt(k.units7)], ['7D RUB', fmt(k.revenue7)], ['待发货', fmt(k.pendingShipments)],
    ['在售', fmt(k.productsActive)], ['竞品', fmt(k.competitors)], ['广告 ACOS', k.adsAcos == null ? '—' : k.adsAcos + '%'],
  ];
  document.getElementById('kpis').innerHTML = kpis.map(([label, value]) => '<div class="kpi"><div class="v">' + value + '</div><div class="l">' + label + '</div></div>').join('');
  document.getElementById('chart').innerHTML = sparkline(state.timeline ?? []);
  document.getElementById('movers').innerHTML = (state.movers ?? []).length
    ? state.movers.map((m) => '<tr><td>' + m.sku + '</td><td>' + escapeHtml(m.keyword ?? '') + '</td><td>' + m.latest + '</td><td>' + m.prev + '</td><td class="' + (m.change < 0 ? 'down' : 'up') + '">' + pct(m.change) + '</td></tr>').join('')
    : '<tr><td colspan="5" class="muted">暂无两次以上竞品快照</td></tr>';
  const f = state.freshness ?? {};
  document.getElementById('freshness').innerHTML = [
    ['last api', f.lastApiCall], ['api status', f.lastApiStatus], ['last posting', f.lastPosting], ['fx date', f.fxDate],
  ].map(([label, value]) => '<tr><td class="muted">' + label + '</td><td>' + (value ?? '—') + '</td></tr>').join('');
  const endpoints = state.endpoints ?? {};
  document.getElementById('endpoints').innerHTML = Object.entries(endpoints).length
    ? Object.entries(endpoints).map(([key, value]) => '<tr><td class="muted">' + key + '</td><td>' + value + '</td></tr>').join('')
    : '<tr><td class="muted">暂无 probe 数据</td></tr>';
  document.getElementById('ticker').textContent = [
    'ALERTS ' + alerts.length,
    'PENDING ' + (k.pendingShipments ?? 0),
    'AD SPEND ' + fmt(Math.round(k.adsSpend ?? 0)) + ' RUB',
    'UPDATED ' + new Date(state.generatedAt).toLocaleString(),
    (state.timeline ?? []).slice(-1)[0] ? 'TODAY ' + state.timeline.slice(-1)[0].units + ' units' : '',
    state.store?.fx ? 'FX ' + state.store.fx.rubPerCny : '',
  ].filter(Boolean).join('   ·   ');
}
function sparkline(points) {
  if (!points.length) return '';
  if (points.every((point) => !point.units)) return '<div class="muted" style="padding:40px 0;text-align:center">近 14 天无销量数据</div>';
  const width = 640, height = 150, pad = 8;
  const max = Math.max(1, ...points.map((p) => p.units));
  const step = (width - pad * 2) / Math.max(1, points.length - 1);
  const pts = points.map((p, i) => [pad + i * step, height - pad - (p.units / max) * (height - pad * 2)]);
  const path = pts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  const area = path + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (height - pad) + ' L' + pts[0][0].toFixed(1) + ',' + (height - pad) + ' Z';
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs><path d="' + area + '" fill="url(#g)"/><path d="' + path + '" fill="none" stroke="#38bdf8" stroke-width="2"/></svg>';
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
async function refresh() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (response.ok) { state = await response.json(); render(); }
  } catch (error) { /* 离线时保留上一次快照 */ }
}
render();
// 优先 SSE 推送（/events，5 秒一帧）；不支持或断开时退回 15 秒轮询
let source = null;
if (typeof EventSource !== 'undefined') {
  try {
    source = new EventSource('/events');
    source.addEventListener('state', (event) => {
      try { state = JSON.parse(event.data); render(); } catch (error) { /* 忽略坏帧 */ }
    });
  } catch (error) {
    source = null;
  }
}
setInterval(() => { if (!source || source.readyState === 2) refresh(); }, 15000);
</script>
</body>
</html>
`;
}
