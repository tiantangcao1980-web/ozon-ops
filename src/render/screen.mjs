/**
 * OZON 情报大屏（类 WorldMonitor 作战室）。
 *
 * 与 WorldMonitor 闭源数据面对齐的模块：
 *  - 情报流：18 类 -> OZON 六类（预警/竞品/评论/社媒/痛点/运营），带 threat / importance / credibility
 *  - 风险指数：CII 式五分量（库存/物流/价格/需求/汇率）+ 趋势 + 建议等级
 *  - 物流咽喉：中俄线路节点（替代 chokepoint），带状态色与过境指标
 *  - 行情：CNY/RUB、竞品价格指数、广告 CPC，带 sparkline
 *  - 数据健康：source coverage（对应 feedStatuses / coverage）
 *
 * buildScreenState 只读本地库；renderScreenHtml 输出单文件 1920×1080 暗色大屏，无外部资源。
 */
import { computeAlerts } from '../rules/alerts.mjs';
import { COUNTRIES, MAP_WIDTH, MAP_HEIGHT, project } from '../assets/world-map.mjs';
import { loadIngestStats } from '../intel/ingest.mjs';

const DAY = 86_400_000;

export const SCREEN_VERSION = 'screen-v1';
export const HIGHLIGHT_COUNTRY_IDS = ['156', '643', '398', '112', '804'];

/** 中俄线路节点（lat/lon 用于地图落点）。kind: procurement|gateway|hub|city */
export const CORRIDOR_NODES = [
  { id: 'yiwu', name: '义乌 采购', ru: 'Иу', kind: 'procurement', lat: 29.31, lon: 120.07 },
  { id: 'guangzhou', name: '广州 集货', ru: 'Гуанчжоу', kind: 'procurement', lat: 23.13, lon: 113.26 },
  { id: 'manzhouli', name: '满洲里 口岸', ru: 'Маньчжурия', kind: 'gateway', lat: 49.6, lon: 117.43 },
  { id: 'zabaykalsk', name: '后贝加尔斯克', ru: 'Забайкальск', kind: 'gateway', lat: 49.63, lon: 117.31 },
  { id: 'novosibirsk', name: '新西伯利亚 仓', ru: 'Новосибирск', kind: 'hub', lat: 55.0, lon: 82.9 },
  { id: 'yekaterinburg', name: '叶卡捷琳堡 仓', ru: 'Екатеринбург', kind: 'hub', lat: 56.84, lon: 60.6 },
  { id: 'kazan', name: '喀山 仓', ru: 'Казань', kind: 'hub', lat: 55.79, lon: 49.1 },
  { id: 'moscow', name: '莫斯科 主仓', ru: 'Москва', kind: 'hub', lat: 55.75, lon: 37.62 },
  { id: 'spb', name: '圣彼得堡 仓', ru: 'Санкт-Петербург', kind: 'hub', lat: 59.94, lon: 30.31 },
  { id: 'krasnodar', name: '克拉斯诺达尔', ru: 'Краснодар', kind: 'city', lat: 45.03, lon: 38.98 },
];

export const CORRIDOR_ROUTES = [
  ['yiwu', 'manzhouli'],
  ['guangzhou', 'manzhouli'],
  ['manzhouli', 'zabaykalsk'],
  ['zabaykalsk', 'novosibirsk'],
  ['novosibirsk', 'yekaterinburg'],
  ['yekaterinburg', 'kazan'],
  ['kazan', 'moscow'],
  ['moscow', 'spb'],
  ['moscow', 'krasnodar'],
];

export const INTEL_CATEGORIES = [
  { key: 'alert', label: '预警' },
  { key: 'platform', label: '平台' },
  { key: 'logistics', label: '物流' },
  { key: 'regulation', label: '合规' },
  { key: 'finance', label: '汇率' },
  { key: 'market', label: '市场' },
  { key: 'competition', label: '竞品' },
  { key: 'voice', label: '评论' },
  { key: 'social', label: '社媒' },
  { key: 'pain', label: '痛点' },
];

export const RISK_COMPONENTS = [
  { key: 'inventory', label: '库存', weight: 0.28 },
  { key: 'logistics', label: '物流', weight: 0.24 },
  { key: 'pricing', label: '价格', weight: 0.2 },
  { key: 'demand', label: '需求', weight: 0.18 },
  { key: 'fx', label: '汇率', weight: 0.1 },
];

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(now, n) {
  const list = [];
  for (let offset = n - 1; offset >= 0; offset -= 1) list.push(isoDay(new Date(now.getTime() - offset * DAY)));
  return list;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function pctChange(current, previous) {
  if (!previous) return null;
  return round(((current - previous) / previous) * 100, 1);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function threatOf(score) {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function query(conn, sql, ...params) {
  try {
    return conn.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

export function buildScreenState({ db, endpoints = null, now = () => new Date(), demo = false } = {}) {
  const conn = db.db ?? db;
  const nowDate = now();
  const today = isoDay(nowDate);
  const days30 = daysAgo(nowDate, 30);

  const alerts = demo ? demoAlerts(nowDate) : safeAlerts(db, now);
  const timeline = buildTimeline(conn, days30, demo, nowDate);
  const kpis = buildKpis(conn, timeline, alerts, demo, nowDate);
  const risk = buildRiskIndex(conn, timeline, kpis, demo, nowDate);
  const pipeline = demo ? null : readPipeline(conn, nowDate);
  const intel = demo ? demoIntel(nowDate) : buildIntel(conn, alerts, nowDate);
  const corridor = buildCorridor(conn, kpis, demo);
  const quotes = buildQuotes(conn, demo, nowDate);
  const coverage = buildCoverage(conn, endpoints, demo, nowDate);
  const fx = latestFx(conn);
  const store = {
    name: process.env.OZON_SHOP_NAME || 'Demo Store',
    fx: fx ? { rubPerCny: Number(fx.rub_per_cny), date: fx.date, source: fx.source } : null,
  };
  const ticker = buildTicker({ kpis, risk, alerts, timeline, store, corridor });

  return {
    version: SCREEN_VERSION,
    generatedAt: nowDate.toISOString(),
    demo,
    store,
    coverage,
    kpis,
    risk,
    intel,
    pipeline,
    corridor,
    quotes,
    trend: timeline,
    alerts: alerts.map((alert) => ({ ...alert })),
    ticker,
  };
}

function safeAlerts(db, now) {
  try {
    return computeAlerts({ db, now }) ?? [];
  } catch {
    return [];
  }
}

function latestFx(conn) {
  const rows = query(conn, 'SELECT date, rub_per_cny, source FROM fx_rates ORDER BY date DESC LIMIT 1');
  return rows[0] ?? null;
}

function buildTimeline(conn, days, demo, nowDate) {
  if (demo) return demoTimeline(days, nowDate);
  const rows = query(
    conn,
    'SELECT date, COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(revenue_rub),0) AS revenue, COALESCE(SUM(hits_view),0) AS views FROM analytics_daily WHERE date >= ? AND date <= ? GROUP BY date',
    days[0],
    days[days.length - 1],
  );
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return days.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      units: Number(row?.units ?? 0),
      revenue: round(row?.revenue ?? 0),
      views: Number(row?.views ?? 0),
    };
  });
}

function buildKpis(conn, timeline, alerts, demo, nowDate) {
  const last7 = timeline.slice(-7).reduce((acc, point) => ({ units: acc.units + point.units, revenue: acc.revenue + point.revenue, views: acc.views + point.views }), { units: 0, revenue: 0, views: 0 });
  const prev7 = timeline.slice(-14, -7).reduce((acc, point) => ({ units: acc.units + point.units, revenue: acc.revenue + point.revenue, views: acc.views + point.views }), { units: 0, revenue: 0, views: 0 });
  const last30 = timeline.reduce((acc, point) => ({ units: acc.units + point.units, revenue: acc.revenue + point.revenue, views: acc.views + point.views }), { units: 0, revenue: 0, views: 0 });

  if (demo) {
    return {
      ...demoKpisFor(),
      units30: last30.units,
      revenue30: round(last30.revenue),
      views30: last30.views,
      alerts: alerts.length,
      p0: alerts.filter((alert) => alert.severity === 'P0').length,
      updatedAt: nowDate.toISOString(),
    };
  }

  const counts = query(
    conn,
    'SELECT (SELECT COUNT(*) FROM postings WHERE pending_shipment = 1) AS pending, (SELECT COUNT(*) FROM products WHERE archived = 0) AS active, (SELECT COUNT(*) FROM competitors) AS competitors, (SELECT COUNT(*) FROM reviews_raw) AS reviews, (SELECT COUNT(*) FROM social_posts) AS social',
  )[0] ?? {};

  const stockRows = query(conn, 'SELECT s.sku, s.present, s.reserved FROM stocks s WHERE s.captured_at = (SELECT MAX(captured_at) FROM stocks s2 WHERE s2.sku = s.sku)');
  const stockRisk = stockRows.filter((row) => Number(row.present ?? 0) - Number(row.reserved ?? 0) <= 3).length;

  const ads = query(conn, 'SELECT COALESCE(SUM(spend_rub),0) AS spend, COALESCE(SUM(revenue_rub),0) AS revenue FROM ads_daily WHERE date >= ?', timeline[0]?.date ?? nowDate.toISOString().slice(0, 10))[0] ?? {};
  const acos = Number(ads.revenue) > 0 ? round((Number(ads.spend) / Number(ads.revenue)) * 100, 1) : null;

  return {
    units7: last7.units,
    revenue7: round(last7.revenue),
    unitsDelta: pctChange(last7.units, prev7.units),
    revenueDelta: pctChange(last7.revenue, prev7.revenue),
    units30: last30.units,
    revenue30: round(last30.revenue),
    views30: last30.views,
    pending: Number(counts.pending ?? 0),
    activeSkus: Number(counts.active ?? 0),
    competitors: Number(counts.competitors ?? 0),
    reviews: Number(counts.reviews ?? 0),
    social: Number(counts.social ?? 0),
    stockRisk,
    adsSpend: round(ads.spend ?? 0),
    acos,
    alerts: alerts.length,
    p0: alerts.filter((alert) => alert.severity === 'P0').length,
    updatedAt: nowDate.toISOString(),
  };
}

function buildRiskIndex(conn, timeline, kpis, demo, nowDate) {
  if (demo) return demoRisk();
  const recent = timeline.slice(-7);
  const prev = timeline.slice(-14, -7);
  const units = recent.reduce((acc, point) => acc + point.units, 0);
  const unitsPrev = prev.reduce((acc, point) => acc + point.units, 0);
  const views = recent.reduce((acc, point) => acc + point.views, 0);
  const viewsPrev = prev.reduce((acc, point) => acc + point.views, 0);

  const stockRows = query(conn, 'SELECT present, reserved FROM stocks s WHERE s.captured_at = (SELECT MAX(captured_at) FROM stocks s2 WHERE s2.sku = s.sku)');
  const available = stockRows.map((row) => Number(row.present ?? 0) - Number(row.reserved ?? 0));
  const worst = available.length ? Math.min(...available) : 0;
  const inventory = clamp(100 - Math.min(100, Math.max(0, worst) * 2));

  const pendingAge = query(conn, "SELECT CAST(julianday('now') - julianday(COALESCE(shipment_date, created_at)) AS INTEGER) AS age FROM postings WHERE pending_shipment = 1 ORDER BY age DESC LIMIT 1")[0]?.age;
  const logistics = clamp((Number(pendingAge ?? 0) / 14) * 100);

  const moves = query(conn, 'SELECT sku, keyword, price_rub, captured_at FROM competitor_snapshots ORDER BY captured_at DESC LIMIT 200');
  const drops = moves.filter((row) => Number(row.price_rub) > 0).slice(0, 40);
  const priceRisk = clamp((drops.length ? drops.filter((row) => Number(row.price_rub) < 0).length / drops.length : 0) * 100);

  const demandDelta = unitsPrev ? ((units - unitsPrev) / unitsPrev) * 100 : 0;
  const viewDelta = viewsPrev ? ((views - viewsPrev) / viewsPrev) * 100 : 0;
  const demandScore = clamp(clamp(50 - demandDelta, 0, 100) * 0.6 + clamp(50 - viewDelta, 0, 100) * 0.4);

  const fxRows = query(conn, 'SELECT date, rub_per_cny FROM fx_rates ORDER BY date DESC LIMIT 14');
  const values = fxRows.map((row) => Number(row.rub_per_cny)).filter((value) => value > 0);
  let fxRisk = 20;
  if (values.length >= 3) {
    const first = values[values.length - 1];
    const last = values[0];
    fxRisk = clamp(Math.abs(((last - first) / first) * 100) * 12);
  }

  const components = [
    { key: 'inventory', label: '库存', weight: 0.28, value: round(inventory) },
    { key: 'logistics', label: '物流', weight: 0.24, value: round(logistics) },
    { key: 'pricing', label: '价格', weight: 0.2, value: round(priceRisk) },
    { key: 'demand', label: '需求', weight: 0.18, value: round(demandScore) },
    { key: 'fx', label: '汇率', weight: 0.1, value: round(fxRisk) },
  ];
  const score = round(components.reduce((acc, component) => acc + component.value * component.weight, 0));
  const trend = score > 55 ? 'rising' : score < 35 ? 'easing' : 'stable';
  const advisory = score >= 75 ? 'act-now' : score >= 55 ? 'watch' : score >= 35 ? 'monitor' : 'clear';
  return { score, trend, advisory, level: threatOf(score), components, headline: riskHeadline(score, components) };
}

function riskHeadline(score, components) {
  const worst = [...components].sort((a, b) => b.value - a.value)[0];
  if (!worst || score < 35) return '经营面平稳，无高优风险';
  return '最紧的是「' + worst.label + '」，风险 ' + round(worst.value) + '/100';
}


/** 读情报管道状态（入库量 / 24h 增量 / 上次抓取统计）。 */
function readPipeline(conn, nowDate) {
  try {
    const row = conn.prepare('SELECT COUNT(*) AS total, MAX(captured_at) AS latestAt FROM intel_items').get();
    if (!row || !Number(row.total)) return { total: 0, latest24h: 0, latestAt: null, lastStats: null };
    const since = new Date(nowDate.getTime() - DAY).toISOString();
    const fresh = conn.prepare('SELECT COUNT(*) AS count FROM intel_items WHERE captured_at >= ?').get(since);
    return { total: Number(row.total), latest24h: Number(fresh?.count ?? 0), latestAt: row.latestAt, lastStats: loadIngestStats(conn) };
  } catch {
    return { total: 0, latest24h: 0, latestAt: null, lastStats: null };
  }
}

/** 从清洗入库的情报里取流（已去噪/去重/打分）。 */
function readStoredIntel(conn, limit = 60) {
  try {
    return conn.prepare('SELECT * FROM intel_items ORDER BY importance DESC, captured_at DESC LIMIT ?').all(Number(limit));
  } catch {
    return [];
  }
}

function buildIntelFromStored(conn, alerts, nowDate) {
  const rows = readStoredIntel(conn);
  if (!rows.length) return null;
  const items = rows.map((row) => ({
    category: row.category,
    title: row.title,
    detail: row.detail ?? '',
    source: row.source,
    importance: Number(row.importance),
    credibility: Number(row.credibility),
    threat: row.threat,
    at: row.published_at ?? row.captured_at,
    link: row.url ?? null,
  }));

  const titles = new Set(items.map((item) => item.title.toLowerCase()));
  const hasStoredAlerts = items.some((item) => item.category === 'alert');
  for (const alert of alerts) {
    if (hasStoredAlerts) break;
    const title = alert.message ?? String(alert.type ?? '预警');
    if (titles.has(title.toLowerCase())) continue;
    items.push({
      category: 'alert',
      title,
      detail: alert.sku ? 'SKU ' + alert.sku : '',
      source: 'OZON 数据巡检',
      importance: alert.severity === 'P0' ? 95 : alert.severity === 'P1' ? 78 : 55,
      credibility: 100,
      threat: alert.severity === 'P0' ? 'high' : alert.severity === 'P1' ? 'medium' : 'low',
      at: nowDate.toISOString(),
      link: null,
    });
  }

  items.sort((left, right) => (right.importance - left.importance) || String(right.at).localeCompare(String(left.at)));
  const byCategory = {};
  for (const item of items) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  return {
    categories: INTEL_CATEGORIES.map((category) => ({ ...category, count: byCategory[category.key] ?? 0 })),
    items: items.slice(0, 60),
    total: items.length,
    highThreat: items.filter((item) => item.threat === 'high').length,
    source: 'pipeline',
  };
}

function buildIntel(conn, alerts, nowDate) {
  const stored = buildIntelFromStored(conn, alerts, nowDate);
  if (stored) return stored;
  const items = [];
  const push = (item) => items.push({ at: nowDate.toISOString(), ...item });

  for (const alert of alerts) {
    push({
      category: 'alert',
      title: alert.message ?? String(alert.type ?? '预警'),
      detail: alert.sku ? 'SKU ' + alert.sku : '',
      source: 'OZON 数据巡检',
      importance: alert.severity === 'P0' ? 95 : alert.severity === 'P1' ? 78 : 55,
      credibility: 100,
      threat: alert.severity === 'P0' ? 'high' : alert.severity === 'P1' ? 'medium' : 'low',
    });
  }

  const moves = query(
    conn,
    'SELECT c.sku, c.keyword, c.price_rub, p.price_rub AS prev_price, c.captured_at FROM competitor_snapshots c LEFT JOIN competitor_snapshots p ON p.sku = c.sku AND p.captured_at < c.captured_at ORDER BY c.captured_at DESC, p.captured_at DESC LIMIT 40',
  );
  const seen = new Set();
  for (const row of moves) {
    if (seen.has(row.sku) || row.prev_price == null) continue;
    seen.add(row.sku);
    const prev = Number(row.prev_price);
    const latest = Number(row.price_rub);
    if (!prev || !latest) continue;
    const change = round(((latest - prev) / prev) * 100, 1);
    push({
      category: 'competition',
      title: '竞品调价 ' + (change > 0 ? '+' : '') + change + '% · ' + (row.keyword ?? ''),
      detail: 'SKU ' + row.sku + ' ' + prev.toFixed(0) + '₽ → ' + latest.toFixed(0) + '₽',
      source: '竞品快照',
      importance: clamp(50 + Math.abs(change) * 4),
      credibility: 90,
      threat: change <= -8 ? 'high' : change < 0 ? 'medium' : 'low',
      at: row.captured_at ?? nowDate.toISOString(),
    });
  }

  const reviews = query(conn, 'SELECT review_id, sku, rating, text, published_at FROM reviews_raw ORDER BY published_at DESC LIMIT 40');
  for (const review of reviews) {
    const rating = Number(review.rating ?? 0);
    if (!(rating > 0) || rating >= 4) continue;
    push({
      category: 'voice',
      title: (review.text ?? '').slice(0, 90) || '低分评价 ' + rating.toFixed(0) + '★',
      detail: 'SKU ' + review.sku + ' · ' + rating.toFixed(0) + '★',
      source: '买家评论',
      importance: clamp(45 + (5 - rating) * 8, 0, 78),
      credibility: 85,
      threat: rating <= 2 ? 'high' : 'medium',
      at: review.published_at ?? nowDate.toISOString(),
    });
  }

  const social = query(conn, 'SELECT source, channel, text, published_at, url FROM social_posts ORDER BY published_at DESC LIMIT 8');
  for (const post of social) {
    push({
      category: 'social',
      title: (post.text ?? '').slice(0, 90) || '社媒提及',
      detail: (post.source ?? '') + (post.channel ? ' · ' + post.channel : ''),
      source: '社媒',
      importance: 50,
      credibility: 70,
      threat: 'low',
      at: post.published_at ?? nowDate.toISOString(),
      link: post.url ?? null,
    });
  }

  const pains = query(conn, 'SELECT niche, theme, count FROM pain_points ORDER BY count DESC LIMIT 6');
  for (const pain of pains) {
    push({
      category: 'pain',
      title: '痛点「' + pain.theme + '」命中 ' + pain.count + ' 次',
      detail: pain.niche ?? '',
      source: '评论聚类',
      importance: clamp(40 + Number(pain.count ?? 0) * 3),
      credibility: 80,
      threat: 'low',
    });
  }

  items.sort((left, right) => (right.importance - left.importance) || String(right.at).localeCompare(String(left.at)));
  const byCategory = {};
  for (const item of items) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  return {
    categories: INTEL_CATEGORIES.map((category) => ({ ...category, count: byCategory[category.key] ?? 0 })),
    items: items.slice(0, 60),
    total: items.length,
    highThreat: items.filter((item) => item.threat === 'high').length,
  };
}

function buildCorridor(conn, kpis, demo) {
  const pending = Number(kpis.pending ?? 0);
  const coverageDays = demo ? 6 : queryDaysOfStock(conn);
  const load = clamp(pending * 3 + (coverageDays != null && coverageDays < 10 ? 40 : 0));
  const nodes = CORRIDOR_NODES.map((node, index) => {
    const point = project(node.lon, node.lat);
    const share = clamp(
      node.kind === 'gateway'
        ? pending * 8
        : node.kind === 'hub'
          ? (coverageDays == null ? 55 : coverageDays < 7 ? 85 : coverageDays < 14 ? 60 : 35) + Math.min(20, pending)
          : node.kind === 'procurement'
            ? 25
            : 30,
    );
    const status = share >= 70 ? 'red' : share >= 40 ? 'yellow' : 'green';
    const metric = node.kind === 'gateway'
      ? pending + ' 单在途'
      : node.kind === 'hub'
        ? (coverageDays == null ? '—' : coverageDays) + ' 天覆盖'
        : node.kind === 'procurement'
          ? (kpis.activeSkus ?? 0) + ' SKU'
          : '区域';
    return { ...node, x: point.x, y: point.y, score: round(share), status, metric };
  });

  const routes = CORRIDOR_ROUTES.map(([from, to]) => {
    const a = nodes.find((node) => node.id === from);
    const b = nodes.find((node) => node.id === to);
    const status = a.status === 'red' || b.status === 'red' ? 'red' : a.status === 'yellow' || b.status === 'yellow' ? 'yellow' : 'green';
    return { from, to, d: 'M' + a.x + ' ' + a.y + 'L' + b.x + ' ' + b.y, status };
  });

  return {
    nodes,
    routes,
    transit: { pending, gateways: nodes.filter((node) => node.kind === 'gateway').length, coverageDays, load: round(load) },
  };
}

function queryDaysOfStock(conn) {
  const rows = query(conn, 'SELECT present, reserved FROM stocks s WHERE s.captured_at = (SELECT MAX(captured_at) FROM stocks s2 WHERE s2.sku = s.sku)');
  if (!rows.length) return null;
  const available = rows.reduce((acc, row) => acc + Math.max(0, Number(row.present ?? 0) - Number(row.reserved ?? 0)), 0);
  const units7 = query(conn, "SELECT COALESCE(SUM(ordered_units),0) AS units FROM analytics_daily WHERE date >= date('now','-7 day')")[0]?.units ?? 0;
  const perDay = Number(units7) / 7;
  if (!perDay) return null;
  return Math.round(available / perDay);
}

function buildQuotes(conn, demo, nowDate) {
  if (demo) return demoQuotes(nowDate);
  const quotes = [];

  const fxRows = query(conn, 'SELECT date, rub_per_cny FROM fx_rates ORDER BY date DESC LIMIT 30').reverse();
  if (fxRows.length) {
    const values = fxRows.map((row) => Number(row.rub_per_cny));
    const latest = values[values.length - 1];
    const first = values[0] || latest;
    quotes.push({ symbol: 'CNYRUB', name: 'CNY/RUB', display: 'CNY/RUB', price: round(latest), change: round(((latest - first) / first) * 100, 2), unit: '₽', sparkline: values });
  }

  const priceSeries = query(conn, 'SELECT substr(captured_at,1,10) AS day, AVG(price_rub) AS price FROM competitor_snapshots WHERE price_rub > 0 GROUP BY day ORDER BY day DESC LIMIT 30');
  if (priceSeries.length >= 2) {
    const values = priceSeries.reverse().map((row) => Number(row.price));
    const latest = values[values.length - 1];
    const first = values[0] || latest;
    quotes.push({ symbol: 'CPX', name: '竞品价格指数', display: 'CPX', price: round(latest), change: round(((latest - first) / first) * 100, 2), unit: '₽', sparkline: values });
  }

  const adsSeries = query(conn, 'SELECT date, CASE WHEN SUM(clicks) > 0 THEN SUM(spend_rub)/SUM(clicks) ELSE 0 END AS cpc FROM ads_daily GROUP BY date ORDER BY date DESC LIMIT 30');
  if (adsSeries.length) {
    const values = adsSeries.reverse().map((row) => round(row.cpc));
    const latest = values[values.length - 1];
    const first = values[0] || latest;
    quotes.push({ symbol: 'CPC', name: '广告 CPC', display: 'CPC', price: round(latest), change: first ? round(((latest - first) / first) * 100, 2) : 0, unit: '₽', sparkline: values });
  }

  const units = query(conn, 'SELECT date, COALESCE(SUM(ordered_units),0) AS units FROM analytics_daily GROUP BY date ORDER BY date DESC LIMIT 30');
  if (units.length) {
    const values = units.reverse().map((row) => Number(row.units));
    const latest = values[values.length - 1];
    const prev = values[values.length - 2] ?? latest;
    quotes.push({ symbol: 'UNITS', name: '日单量', display: 'UNITS', price: latest, change: pctChange(latest, prev) ?? 0, unit: '件', sparkline: values });
  }

  return quotes;
}

function buildCoverage(conn, endpoints, demo, nowDate) {
  if (demo) return demoCoverage(nowDate);
  const sources = [];
  const add = (key, label, at) => sources.push({ key, label, at: at ?? null, status: at ? 'ok' : 'empty' });

  add('api', 'API 调用', query(conn, 'SELECT called_at FROM api_calls ORDER BY called_at DESC LIMIT 1')[0]?.called_at);
  add('postings', '订单', query(conn, 'SELECT updated_at AS at FROM postings ORDER BY updated_at DESC LIMIT 1')[0]?.at);
  add('analytics', '流量/销售', query(conn, 'SELECT captured_at FROM analytics_daily ORDER BY captured_at DESC LIMIT 1')[0]?.captured_at);
  add('stocks', '库存', query(conn, 'SELECT captured_at FROM stocks ORDER BY captured_at DESC LIMIT 1')[0]?.captured_at);
  add('competitors', '竞品', query(conn, 'SELECT captured_at FROM competitor_snapshots ORDER BY captured_at DESC LIMIT 1')[0]?.captured_at);
  add('reviews', '评论', query(conn, 'SELECT captured_at FROM reviews_raw ORDER BY captured_at DESC LIMIT 1')[0]?.captured_at);
  add('fx', '汇率', query(conn, 'SELECT date AS at FROM fx_rates ORDER BY date DESC LIMIT 1')[0]?.at);
  add('ads', '广告', query(conn, 'SELECT captured_at FROM ads_daily ORDER BY captured_at DESC LIMIT 1')[0]?.captured_at);
  let intelRow = null;
  try {
    intelRow = conn.prepare('SELECT MAX(captured_at) AS at FROM intel_items').get();
  } catch {
    intelRow = null;
  }
  add('intel', '情报管道（清洗）', intelRow?.at ?? null);

  if (endpoints) {
    const rows = Number(endpoints.summary?.rows ?? endpoints.rows ?? 0);
    const usable = Number(endpoints.summary?.usable ?? endpoints.usable ?? 0);
    add('probe', '端点探活', rows ? String(usable) + '/' + String(rows) + ' 可用' : null);
  }

  const empty = sources.filter((source) => source.status === 'empty').length;
  return { state: empty > sources.length / 2 ? 'degraded' : 'ok', sources, missing: empty, total: sources.length };
}

function buildTicker({ kpis, risk, alerts, timeline, store, corridor }) {
  const today = timeline[timeline.length - 1];
  return [
    '风险 ' + risk.score + '/100 · ' + risk.advisory,
    '7D 营收 ' + Number(kpis.revenue7 ?? 0).toLocaleString('en-US') + ' ₽',
    '7D 单量 ' + Number(kpis.units7 ?? 0) + ' 件' + (kpis.unitsDelta == null ? '' : ' (' + (kpis.unitsDelta > 0 ? '+' : '') + kpis.unitsDelta + '%)'),
    '待发货 ' + Number(kpis.pending ?? 0),
    '库存预警 ' + Number(kpis.stockRisk ?? 0) + ' SKU',
    '今日单量 ' + Number(today?.units ?? 0),
    '在途节点 ' + corridor.transit.pending + ' 单',
    '预警 P0 ' + alerts.filter((alert) => alert.severity === 'P0').length + ' / 共 ' + alerts.length,
    store.fx ? 'FX 1CNY=' + store.fx.rubPerCny.toFixed(2) + '₽' : 'FX —',
  ];
}


/* ------------------------------------------------------------------ */
/* 演示数据：确定性合成数据，仅 --demo 展示，不写库、不进报告              */
/* ------------------------------------------------------------------ */

function seeded(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function demoSeed(nowDate) {
  return Number(isoDay(nowDate).replace(/-/g, ''));
}

function demoTimeline(days, nowDate) {
  const random = seeded(demoSeed(nowDate));
  return days.map((date, index) => {
    const wave = Math.sin(index / 2.6) * 6 + Math.sin(index / 7) * 4;
    const units = Math.max(0, Math.round(18 + wave + random() * 10 + index * 0.9));
    return { date, units, revenue: Math.round(units * (1850 + random() * 420)), views: Math.round(units * (85 + random() * 30)) };
  });
}

function demoKpisFor() {
  return {
    units7: 187,
    revenue7: 396420,
    unitsDelta: 12.4,
    revenueDelta: 9.8,
    pending: 23,
    activeSkus: 42,
    competitors: 128,
    reviews: 356,
    social: 48,
    stockRisk: 5,
    adsSpend: 58240,
    acos: 14.7,
  };
}

function demoRisk() {
  const components = [
    { key: 'inventory', label: '库存', weight: 0.28, value: 62 },
    { key: 'logistics', label: '物流', weight: 0.24, value: 48 },
    { key: 'pricing', label: '价格', weight: 0.2, value: 55 },
    { key: 'demand', label: '需求', weight: 0.18, value: 31 },
    { key: 'fx', label: '汇率', weight: 0.1, value: 24 },
  ];
  const score = round(components.reduce((acc, component) => acc + component.value * component.weight, 0));
  return { score, trend: 'stable', advisory: 'watch', level: threatOf(score), components, headline: riskHeadline(score, components) };
}

function demoIntel(nowDate) {
  const random = seeded(demoSeed(nowDate) + 7);
  const templates = [
    ['alert', '库存覆盖 3.2 天低于提前期 · SKU 1234567851', 'P0 · 断货风险', 'OZON 数据巡检', 96, 'high'],
    ['alert', '广告 ACOS 突破 30% · campaign 77120', 'P1 · 投放效率', '广告巡检', 82, 'medium'],
    ['competition', '竞品调价 -12% · силиконовая лопатка', 'SKU 1234567852 283₽ → 249₽', '竞品快照', 88, 'high'],
    ['competition', '新品进入首页 · 硅胶铲类目', '第 2 页出现 3 个新卖家', '竞品快照', 64, 'medium'],
    ['voice', '「手柄太短，翻炒时烫手」', 'SKU 1234567853 · 2★', '买家评论', 77, 'high'],
    ['voice', '「颜色和图片不一致」', 'SKU 1234567854 · 3★', '买家评论', 61, 'medium'],
    ['social', 'VK 家居测评频道提到同款铲子', 'VK · 12.4k 订阅', '社媒', 58, 'low'],
    ['pain', '痛点「易变形」命中 18 次', '家居厨具', '评论聚类', 66, 'medium'],
    ['logistics', '莫斯科仓入库预约排到 3 天后', 'FBS 预约延迟', '物流节点', 71, 'medium'],
    ['platform', 'Ozon 7 月起调整类目放置费用', '官方公告 · 影响佣金结构', '平台公告', 84, 'medium'],
    ['finance', 'CNY/RUB 单周上行 2.4%', '结算成本抬升', '汇率', 63, 'medium'],
  ];
  const items = templates.map((entry, index) => ({
    category: entry[0],
    title: entry[1],
    detail: entry[2],
    source: entry[3],
    importance: entry[4],
    credibility: 85 + Math.round(random() * 15),
    threat: entry[5],
    at: new Date(nowDate.getTime() - index * 7 * 60_000).toISOString(),
  }));
  const byCategory = {};
  for (const item of items) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  return {
    categories: INTEL_CATEGORIES.map((category) => ({ ...category, count: byCategory[category.key] ?? 0 })),
    items,
    total: items.length,
    highThreat: items.filter((item) => item.threat === 'high').length,
  };
}

function demoAlerts(nowDate) {
  return [
    { severity: 'P0', type: 'stockout', message: '库存覆盖 3.2 天 · SKU 1234567851', sku: '1234567851' },
    { severity: 'P1', type: 'acos', message: 'ACOS 31.2% 高于阈值 · campaign 77120' },
    { severity: 'P1', type: 'price_index', message: '竞品价格指数下跌 8% · силиконовая лопатка' },
  ].map((alert) => ({ ...alert, at: nowDate.toISOString() }));
}

function demoQuotes(nowDate) {
  const random = seeded(demoSeed(nowDate) + 11);
  const series = (base, drift, noise, count) => {
    const values = [];
    let value = base;
    for (let index = 0; index < count; index += 1) {
      value = value + drift + (random() - 0.5) * noise;
      values.push(round(value));
    }
    return values;
  };
  const make = (symbol, name, unit, base, drift, noise) => {
    const sparkline = series(base, drift, noise, 24);
    const price = sparkline[sparkline.length - 1];
    const first = sparkline[0];
    return { symbol, name, display: symbol, price, change: round(((price - first) / first) * 100, 2), unit, sparkline };
  };
  return [
    make('CNYRUB', 'CNY/RUB', '₽', 12.55, 0.006, 0.06),
    make('CPX', '竞品价格指数', '₽', 292, -0.35, 6),
    make('CPC', '广告 CPC', '₽', 42.6, 0.15, 2.4),
    make('UNITS', '日单量', '件', 24, 0.28, 5),
  ];
}

function demoCoverage(nowDate) {
  const labels = [['api', 'API 调用'], ['postings', '订单'], ['analytics', '流量/销售'], ['stocks', '库存'], ['competitors', '竞品'], ['reviews', '评论'], ['fx', '汇率'], ['ads', '广告']];
  const sources = labels.map(([key, label], index) => ({
    key,
    label,
    at: new Date(nowDate.getTime() - index * 90_000).toISOString(),
    status: index === 6 ? 'empty' : 'ok',
  }));
  return { state: 'ok', sources, missing: 1, total: sources.length };
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function sparkline(values, options = {}) {
  const width = options.width ?? 132;
  const height = options.height ?? 34;
  const numbers = (values ?? []).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (numbers.length < 2) return '<span class="muted">数据不足</span>';
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min || 1;
  const step = width / (numbers.length - 1);
  const points = numbers.map((value, index) => [index * step, height - ((value - min) / span) * (height - 4) - 2]);
  const path = points.map(([x, y], index) => (index === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)).join('');
  const area = path + 'L' + width + ' ' + height + 'L0 ' + height + 'Z';
  return '<svg class="spark" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
    '<path class="spark-area" d="' + area + '"></path>' +
    '<path class="spark-line" d="' + path + '"></path>' +
    '</svg>';
}

function areaChart(trend) {
  const width = 860;
  const height = 190;
  const pad = { top: 14, right: 10, bottom: 22, left: 10 };
  const points = trend ?? [];
  if (!points.length) return '<div class="empty">暂无走势数据</div>';
  const maxUnits = Math.max(1, ...points.map((point) => point.units));
  const maxRevenue = Math.max(1, ...points.map((point) => point.revenue));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const step = innerW / Math.max(1, points.length - 1);
  const unitPoints = points.map((point, index) => [pad.left + index * step, pad.top + innerH - (point.units / maxUnits) * innerH]);
  const revenuePoints = points.map((point, index) => [pad.left + index * step, pad.top + innerH - (point.revenue / maxRevenue) * innerH]);
  const line = (list) => list.map(([x, y], index) => (index === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)).join('');
  const unitPath = line(unitPoints);
  const revenuePath = line(revenuePoints);
  const areaPath = unitPath + 'L' + unitPoints[unitPoints.length - 1][0].toFixed(1) + ' ' + (pad.top + innerH) + 'L' + unitPoints[0][0].toFixed(1) + ' ' + (pad.top + innerH) + 'Z';
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = pad.top + innerH - ratio * innerH;
    return '<line class="grid" x1="' + pad.left + '" y1="' + y.toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + y.toFixed(1) + '"></line>';
  }).join('');
  const every = Math.max(1, Math.floor(points.length / 6));
  const labels = points.map((point, index) => {
    if (index % every !== 0 && index !== points.length - 1) return '';
    return '<text class="axis" x="' + (pad.left + index * step).toFixed(1) + '" y="' + (height - 6) + '">' + point.date.slice(5) + '</text>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '">' + gridLines +
    '<path class="area" d="' + areaPath + '"></path>' +
    '<path class="line-units" d="' + unitPath + '"></path>' +
    '<path class="line-revenue" d="' + revenuePath + '"></path>' + labels + '</svg>';
}

function riskBars(components) {
  return components.map((component) => {
    const value = Math.round(Number(component.value) || 0);
    const tone = value >= 70 ? 'red' : value >= 45 ? 'yellow' : 'green';
    return '<div class="risk-row"><span class="risk-label">' + escapeHtml(component.label) + '</span>' +
      '<span class="risk-track"><span class="risk-fill ' + tone + '" style="width:' + clamp(value) + '%"></span></span>' +
      '<span class="risk-value">' + value + '</span></div>';
  }).join('');
}

function riskRing(score) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamp(score) / 100) * circumference;
  const tone = score >= 70 ? 'red' : score >= 45 ? 'yellow' : 'green';
  return '<svg class="ring" viewBox="0 0 120 120">' +
    '<circle class="ring-track" cx="60" cy="60" r="' + radius + '"></circle>' +
    '<circle class="ring-value ' + tone + '" cx="60" cy="60" r="' + radius + '" stroke-dasharray="' + dash.toFixed(1) + ' ' + circumference.toFixed(1) + '"></circle>' +
    '<text class="ring-score" x="60" y="64">' + Math.round(score) + '</text>' +
    '<text class="ring-unit" x="60" y="80">/100</text>' +
    '</svg>';
}

function mapSvg(corridor) {
  const highlight = new Set(HIGHLIGHT_COUNTRY_IDS);
  const countries = COUNTRIES.map((country) => '<path class="' + (highlight.has(country.i) ? 'map-country active' : 'map-country') + '" d="' + country.d + '"></path>').join('');
  const routes = corridor.routes.map((route) => '<path class="route ' + route.status + '" d="' + route.d + '"></path>').join('');
  const nodes = corridor.nodes.map((node) => {
    const size = node.kind === 'hub' ? 5 : node.kind === 'gateway' ? 4.5 : 4;
    return '<g class="node ' + node.status + '">' +
      '<circle class="node-halo" cx="' + node.x + '" cy="' + node.y + '" r="' + (size + 7) + '"></circle>' +
      '<circle class="node-dot" cx="' + node.x + '" cy="' + node.y + '" r="' + size + '"></circle>' +
      '<text class="node-label" x="' + (node.x + 9) + '" y="' + (node.y + 4) + '">' + escapeHtml(node.name.split(' ')[0]) + '</text>' +
      '</g>';
  }).join('');
  const xs = corridor.nodes.map((node) => node.x);
  const ys = corridor.nodes.map((node) => node.y);
  const x0 = Math.max(0, Math.round(Math.min(...xs) - 120));
  const x1 = Math.min(MAP_WIDTH, Math.round(Math.max(...xs) + 120));
  const y0 = Math.max(0, Math.round(Math.min(...ys) - 110));
  const y1 = Math.min(MAP_HEIGHT, Math.round(Math.max(...ys) + 110));
  const viewBox = x0 + ' ' + y0 + ' ' + (x1 - x0) + ' ' + (y1 - y0);
  return '<svg class="map" viewBox="' + viewBox + '" preserveAspectRatio="xMidYMid slice">' +
    '<defs><radialGradient id="mapGlow"><stop offset="0%" stop-color="#24d17a" stop-opacity="0.35"></stop><stop offset="100%" stop-color="#24d17a" stop-opacity="0"></stop></radialGradient></defs>' +
    countries + routes + nodes + '</svg>';
}


function pipelineLine(pipeline) {
  if (!pipeline) return '情报管道：DEMO 数据（未读取真实库）';
  if (!pipeline.total) return '情报管道：未入库（node bin/ozon.mjs intel harvest --source db）';
  const stats = pipeline.lastStats;
  const detail = stats && stats.received
    ? ' · 上次抓取 收 ' + stats.received + ' → 留 ' + stats.kept + ' → 去噪 ' + stats.dropped
    : '';
  return '情报管道：累计 ' + pipeline.total + ' · 24h +' + pipeline.latest24h + detail;
}

function compact(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1e6) return (number / 1e6).toFixed(2) + 'M';
  if (Math.abs(number) >= 1e4) return (number / 1e3).toFixed(1) + 'K';
  return number.toLocaleString('en-US');
}

export function renderScreenHtml(state) {
  const initial = JSON.stringify(state).replace(/</g, '\\u003c');
  const kpis = state.kpis ?? {};
  const risk = state.risk ?? { score: 0, components: [], advisory: 'monitor' };
  const coverage = state.coverage ?? { sources: [] };
  const intel = state.intel ?? { items: [], categories: [] };
  const corridor = state.corridor ?? { nodes: [], routes: [], transit: {} };

  const kpiCards = [
    ['30D 营收', compact(kpis.revenue30) + ' ₽', kpis.revenueDelta],
    ['7D 单量', compact(kpis.units7) + ' 件', kpis.unitsDelta],
    ['待发货', Number(kpis.pending ?? 0) + ' 单', null],
    ['在售 SKU', Number(kpis.activeSkus ?? 0), null],
    ['库存预警', Number(kpis.stockRisk ?? 0) + ' SKU', null],
    ['广告 ACOS', kpis.acos == null ? '—' : kpis.acos + '%', null],
    ['竞品', Number(kpis.competitors ?? 0) + ' 家', null],
    ['风险指数', String(risk.score ?? 0), null],
  ].map(([label, value, delta]) => '<div class="kpi"><div class="kpi-label">' + escapeHtml(label) + '</div>' +
    '<div class="kpi-value">' + escapeHtml(value) + '</div>' +
    (delta == null ? '<div class="kpi-sub muted">—</div>' : '<div class="kpi-sub ' + (delta >= 0 ? 'up' : 'down') + '">' + (delta > 0 ? '+' : '') + delta + '%</div>') +
    '</div>').join('');

  const intelTabs = (intel.categories ?? []).map((category, index) =>
    '<button class="tab' + (index >= 99 ? ' active' : '') + '" data-category="' + escapeHtml(category.key) + '">' +
    escapeHtml(category.label) + '<span>' + Number(category.count ?? 0) + '</span></button>').join('');

  const intelItems = (intel.items ?? []).map((item) =>
    '<article class="intel ' + escapeHtml(item.threat ?? 'low') + '" data-category="' + escapeHtml(item.category) + '">' +
    '<div class="intel-head"><span class="intel-cat">' + escapeHtml(categoryLabel(item.category)) + '</span>' +
    '<span class="intel-score">' + Math.round(Number(item.importance) || 0) + '</span></div>' +
    '<div class="intel-title">' + escapeHtml(item.title) + '</div>' +
    (item.detail ? '<div class="intel-detail muted">' + escapeHtml(item.detail) + '</div>' : '') +
    '<div class="intel-meta muted">' + escapeHtml(item.source ?? '') + ' · ' + escapeHtml(shortTime(item.at)) + '</div>' +
    '</article>').join('') || '<div class="empty">情报流为空</div>';

  const quoteCards = (state.quotes ?? []).map((quote) =>
    '<div class="quote"><div class="quote-head"><span class="quote-name">' + escapeHtml(quote.name) + '</span>' +
    '<span class="quote-price">' + Number(quote.price).toLocaleString('en-US') + ' <i>' + escapeHtml(quote.unit ?? '') + '</i></span></div>' +
    '<div class="quote-foot"><span class="' + (Number(quote.change) >= 0 ? 'up' : 'down') + '">' +
    (Number(quote.change) > 0 ? '+' : '') + Number(quote.change).toFixed(2) + '%</span>' + sparkline(quote.sparkline) + '</div></div>').join('') ||
    '<div class="empty">暂无行情</div>';

  const coverageRows = (coverage.sources ?? []).map((source) =>
    '<tr><td>' + escapeHtml(source.label) + '</td><td class="' + (source.status === 'ok' ? 'ok' : 'warn') + '">' +
    escapeHtml(ageText(source.at)) + '</td></tr>').join('');

  const corridorRows = (corridor.nodes ?? []).map((node) =>
    '<tr><td><span class="dot ' + node.status + '"></span>' + escapeHtml(node.name) + '</td><td class="muted">' + escapeHtml(node.metric) + '</td><td class="' + node.status + '">' + node.score + '</td></tr>').join('');

  const ticker = (state.ticker ?? []).map((part) => '<span>' + escapeHtml(part) + '</span>').join('<i>◆</i>');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OZON 情报大屏 · Intelligence Screen</title>
<style>
:root { --bg:#05080a; --panel:#0a1218; --panel-2:#0c1620; --line:#17242e; --text:#dbe7f1; --muted:#6b8299; --green:#24d17a; --green-dim:#12653c; --amber:#f5b942; --red:#ff5f57; --blue:#4aa8ff; }
* { box-sizing:border-box; }
html,body { margin:0; height:100%; background:#000; overflow:hidden; font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
body { display:flex; align-items:center; justify-content:center; }
.stage { position:relative; width:1920px; height:1080px; background:radial-gradient(1200px 700px at 50% -10%,#0a1a14 0%,var(--bg) 60%); color:var(--text); transform-origin:center center; display:grid; grid-template-rows:64px 104px 1fr 40px; gap:10px; padding:12px 16px 10px; overflow:hidden; }
.stage::before { content:""; position:absolute; inset:0; background-image:linear-gradient(rgba(36,209,122,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(36,209,122,.045) 1px,transparent 1px); background-size:48px 48px; pointer-events:none; }
header { display:flex; align-items:center; gap:16px; border-bottom:1px solid var(--line); padding-bottom:8px; }
.brand { display:flex; align-items:baseline; gap:10px; }
.brand b { font-size:22px; letter-spacing:4px; }
.brand span { color:var(--green); font-size:11px; letter-spacing:2px; text-transform:uppercase; }
.chip { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:10px; padding:3px 9px; background:rgba(12,22,32,.7); }
.chip.live { color:var(--green); border-color:var(--green-dim); }
.dotlive { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 10px var(--green); margin-right:6px; animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.spacer { flex:1; }
.clock { font-variant-numeric:tabular-nums; font-size:20px; letter-spacing:2px; }
.kpis { display:grid; grid-template-columns:repeat(8,1fr); gap:10px; }
.kpi { background:linear-gradient(180deg,var(--panel-2),var(--panel)); border:1px solid var(--line); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden; }
.kpi::after { content:""; position:absolute; left:0; top:0; width:2px; height:100%; background:linear-gradient(180deg,var(--green),transparent); opacity:.6; }
.kpi-label { font-size:11px; color:var(--muted); letter-spacing:1px; }
.kpi-value { font-size:24px; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kpi-sub { font-size:11px; }
.main { display:grid; grid-template-columns:340px 1fr 380px; gap:10px; min-height:0; }
.col { display:flex; flex-direction:column; gap:10px; min-height:0; }
.panel { background:linear-gradient(180deg,rgba(12,22,32,.96),rgba(8,14,20,.96)); border:1px solid var(--line); border-radius:10px; display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.panel-head { display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid var(--line); }
.panel-head h2 { margin:0; font-size:12px; letter-spacing:2px; color:var(--muted); text-transform:uppercase; font-weight:600; }
.panel-head .tail { margin-left:auto; font-size:11px; color:var(--muted); }
.panel-body { padding:10px 12px; overflow:auto; min-height:0; }
.panel-body::-webkit-scrollbar { width:5px; }
.panel-body::-webkit-scrollbar-thumb { background:var(--line); border-radius:3px; }
.tabs { display:flex; flex-wrap:wrap; gap:6px; padding:8px 10px; border-bottom:1px solid var(--line); }
.tab { font-size:11px; color:var(--muted); background:transparent; border:1px solid var(--line); border-radius:12px; padding:3px 8px; cursor:pointer; }
.tab span { margin-left:5px; color:var(--green); }
.tab.active { color:var(--text); border-color:var(--green-dim); background:rgba(36,209,122,.09); }
.intel { border-left:2px solid var(--line); padding:7px 9px; margin-bottom:6px; background:rgba(10,18,24,.7); border-radius:0 6px 6px 0; }
.intel.high { border-color:var(--red); } .intel.medium { border-color:var(--amber); } .intel.low { border-color:var(--green-dim); }
.intel-head { display:flex; align-items:center; gap:8px; font-size:10px; }
.intel-cat { color:var(--green); letter-spacing:1px; }
.intel-score { margin-left:auto; color:var(--amber); font-variant-numeric:tabular-nums; }
.intel-title { font-size:12.5px; line-height:1.42; margin-top:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.intel-detail { font-size:11px; margin-top:2px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.intel-meta { font-size:10px; margin-top:3px; }
.map-panel { flex:1 1 auto; }
.map { width:100%; height:100%; display:block; }
.map-country { fill:#0f1d26; stroke:#152833; stroke-width:.35; }
.map-country.active { fill:#123c2c; stroke:#1f7a52; }
.route { fill:none; stroke-width:1; stroke-dasharray:4 5; opacity:.75; }
.route.green { stroke:var(--green); } .route.yellow { stroke:var(--amber); } .route.red { stroke:var(--red); }
.node .node-dot { stroke:#03070a; stroke-width:1; }
.node.green .node-dot { fill:var(--green); } .node.yellow .node-dot { fill:var(--amber); } .node.red .node-dot { fill:var(--red); }
.node-halo { fill:url(#mapGlow); opacity:.35; }
.node-label { fill:#9fb6c8; font-size:7px; }
.grid2 { display:grid; grid-template-columns:1.5fr 1fr; gap:10px; height:260px; }
.chart { width:100%; height:100%; }
.chart .grid { stroke:rgba(23,36,46,.9); stroke-width:.7; }
.chart .area { fill:rgba(36,209,122,.12); }
.chart .line-units { fill:none; stroke:var(--green); stroke-width:1.8; }
.chart .line-revenue { fill:none; stroke:var(--blue); stroke-width:1.2; opacity:.75; }
.chart .axis { fill:var(--muted); font-size:9px; }
table { width:100%; border-collapse:collapse; font-size:11.5px; }
td { padding:4px 4px; border-bottom:1px solid rgba(23,36,46,.7); }
td:last-child { text-align:right; font-variant-numeric:tabular-nums; }
td.ok { color:var(--green); } td.warn { color:var(--amber); }
td.green { color:var(--green); } td.yellow { color:var(--amber); } td.red { color:var(--red); }
.dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:6px; }
.dot.green { background:var(--green); } .dot.yellow { background:var(--amber); } .dot.red { background:var(--red); }
.risk-top { display:flex; align-items:center; gap:12px; }
.ring { width:104px; height:104px; flex:0 0 auto; }
.ring-track { fill:none; stroke:#152430; stroke-width:9; }
.ring-value { fill:none; stroke-width:9; stroke-linecap:round; transform:rotate(-90deg); transform-origin:60px 60px; }
.ring-value.green { stroke:var(--green); } .ring-value.yellow { stroke:var(--amber); } .ring-value.red { stroke:var(--red); }
.ring-score { fill:var(--text); font-size:26px; font-weight:600; text-anchor:middle; }
.ring-unit { fill:var(--muted); font-size:9px; text-anchor:middle; }
.risk-copy .advisory { font-size:12px; color:var(--green); letter-spacing:1px; text-transform:uppercase; }
.risk-copy .headline { font-size:12px; color:var(--text); margin-top:4px; line-height:1.45; }
.risk-copy .trend { font-size:11px; color:var(--muted); margin-top:6px; }
.risk-rows { margin-top:10px; display:flex; flex-direction:column; gap:6px; }
.risk-row { display:grid; grid-template-columns:38px 1fr 26px; align-items:center; gap:8px; font-size:11px; }
.risk-label { color:var(--muted); }
.risk-track { height:5px; background:#0f1c25; border-radius:3px; overflow:hidden; }
.risk-fill { display:block; height:100%; border-radius:3px; }
.risk-fill.green { background:var(--green); } .risk-fill.yellow { background:var(--amber); } .risk-fill.red { background:var(--red); }
.risk-value { text-align:right; font-variant-numeric:tabular-nums; color:var(--text); }
.quote { padding:6px 0; border-bottom:1px solid rgba(23,36,46,.7); }
.quote:last-child { border-bottom:none; }
.quote-head { display:flex; align-items:baseline; gap:8px; }
.quote-name { font-size:11.5px; color:var(--muted); }
.quote-price { margin-left:auto; font-size:15px; font-variant-numeric:tabular-nums; }
.quote-price i { font-style:normal; font-size:10px; color:var(--muted); }
.quote-foot { display:flex; align-items:center; gap:8px; font-size:11px; }
.quote-foot .up { color:var(--red); } .quote-foot .down { color:var(--green); }
.spark { width:132px; height:34px; }
.spark-line { fill:none; stroke:var(--green); stroke-width:1.2; }
.spark-area { fill:rgba(36,209,122,.1); }
.muted { color:var(--muted); }
.up { color:var(--red); } .down { color:var(--green); }
.empty { color:var(--muted); font-size:12px; padding:18px 0; text-align:center; }
.pipeline-line { font-size:10.5px; padding:0 0 6px; line-height:1.4; }
.ticker { display:flex; align-items:center; gap:14px; border-top:1px solid var(--line); overflow:hidden; font-size:12px; color:#b8cbdb; white-space:nowrap; }
.ticker span { flex:0 0 auto; }
.ticker i { font-style:normal; color:var(--green-dim); }
</style>
</head>
<body>
<div class="stage" id="stage">
  <header>
    <div class="brand"><b>OZON</b><span>Intelligence Screen</span></div>
    <span class="chip live"><span class="dotlive"></span>LIVE</span>
    <span class="chip">${escapeHtml(state.store?.name ?? '—')}</span>
    <span class="chip">${state.store?.fx ? 'FX 1CNY=' + state.store.fx.rubPerCny.toFixed(2) + '₽' : 'FX —'}</span>
    <span class="chip">${state.demo ? 'DEMO' : 'REAL'}</span>
    <span class="spacer"></span>
    <span class="chip">风险 ${Math.round(Number(risk.score) || 0)}</span>
    <span class="chip">UPDATED ${escapeHtml(shortTime(state.generatedAt))}</span>
    <span class="clock" id="clock">--:--:--</span>
  </header>

  <section class="kpis">${kpiCards}</section>

  <section class="main">
    <div class="col">
      <div class="panel" style="flex:1 1 auto">
        <div class="panel-head"><h2>Intel Feed · 情报流</h2><span class="tail">${Number(intel.total ?? 0)} 条 · 高危 ${Number(intel.highThreat ?? 0)}</span></div>
        <div class="tabs" id="intel-tabs"><button class="tab active" data-category="all">全部<span>${Number(intel.total ?? 0)}</span></button>${intelTabs}</div>
        <div class="panel-body" id="intel-list">${intelItems}</div>
      </div>
    </div>

    <div class="col">
      <div class="panel map-panel">
        <div class="panel-head"><h2>Corridor · 中俄物流节点</h2><span class="tail">在途 ${Number(corridor.transit?.pending ?? 0)} 单 · 覆盖 ${corridor.transit?.coverageDays ?? '—'} 天</span></div>
        <div class="panel-body" style="padding:0">${mapSvg(corridor)}</div>
      </div>
      <div class="grid2">
        <div class="panel"><div class="panel-head"><h2>30D Trend · 走势</h2><span class="tail">绿=单量 / 蓝=营收</span></div><div class="panel-body">${areaChart(state.trend)}</div></div>
        <div class="panel"><div class="panel-head"><h2>Nodes · 节点状态</h2></div><div class="panel-body"><table><tbody>${corridorRows}</tbody></table></div></div>
      </div>
    </div>

    <div class="col">
      <div class="panel" style="flex:0 0 auto">
        <div class="panel-head"><h2>Risk · 经营风险</h2><span class="tail">${escapeHtml(risk.trend ?? '')}</span></div>
        <div class="panel-body">
          <div class="risk-top">${riskRing(risk.score)}<div class="risk-copy"><div class="advisory">${escapeHtml(risk.advisory ?? '')}</div><div class="headline">${escapeHtml(risk.headline ?? '')}</div><div class="trend">趋势 ${escapeHtml(risk.trend ?? '—')} · P0 ${Number(kpis.p0 ?? 0)}</div></div></div>
          <div class="risk-rows">${riskBars(risk.components ?? [])}</div>
        </div>
      </div>
      <div class="panel" style="flex:1 1 auto">
        <div class="panel-head"><h2>Quotes · 行情</h2></div>
        <div class="panel-body">${quoteCards}</div>
      </div>
      <div class="panel" style="flex:0 0 auto">
        <div class="panel-head"><h2>Coverage · 数据健康</h2><span class="tail">${escapeHtml(coverage.state ?? '')} · 缺 ${Number(coverage.missing ?? 0)}/${Number(coverage.total ?? 0)}</span></div>
        <div class="panel-body"><div class="pipeline-line muted">${pipelineLine(state.pipeline)}</div><table><tbody>${coverageRows}</tbody></table></div>
      </div>
    </div>
  </section>

  <footer class="ticker">${ticker}</footer>
</div>
<script>
const INITIAL = ${initial};
let state = INITIAL;
let activeCategory = 'all';
function fit() {
  const stage = document.getElementById('stage');
  const width = window.innerWidth || document.documentElement.clientWidth || 1920;
  const height = window.innerHeight || document.documentElement.clientHeight || 1080;
  const scale = Math.min(width / 1920, height / 1080);
  stage.style.transform = 'scale(' + scale + ')';
}
setInterval(fit, 1000);
document.addEventListener('visibilitychange', fit);
function pad(value) { return String(value).padStart(2, '0'); }
function tickClock() {
  const now = new Date();
  document.getElementById('clock').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}
function applyFilter() {
  document.querySelectorAll('#intel-list .intel').forEach(function (node) {
    const category = node.getAttribute('data-category');
    node.style.display = activeCategory === 'all' || category === activeCategory ? '' : 'none';
  });
  document.querySelectorAll('#intel-tabs .tab').forEach(function (tab) {
    tab.classList.toggle('active', tab.getAttribute('data-category') === activeCategory);
  });
}
function renderTicker() {
  document.getElementById('ticker').innerHTML = (state.ticker || []).map(function (part) {
    return '<span>' + escapeHtml(part) + '</span>';
  }).join('<i>◆</i>');
}
function renderHeader() {
  const risk = state.risk || {};
  document.querySelectorAll('header .chip')[0].textContent = (state.store && state.store.name) || '—';
  document.getElementById('updated-label');
  renderTicker();
}
document.getElementById('intel-tabs').addEventListener('click', function (event) {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  activeCategory = tab.getAttribute('data-category');
  applyFilter();
});
window.addEventListener('resize', fit);
fit();
tickClock();
setInterval(tickClock, 1000);
const source = new EventSource('/events');
let poll = null;
source.addEventListener('state', function (event) {
  try { state = JSON.parse(event.data); renderTicker(); } catch (error) { void error; }
});
source.onerror = function () {
  source.close();
  if (poll) return;
  poll = setInterval(function () {
    fetch('/api/state').then(function (response) { return response.json(); }).then(function (next) { state = next; renderTicker(); }).catch(function () {});
  }, 5000);
};
</script>
</body>
</html>`;
}

function categoryLabel(key) {
  return INTEL_CATEGORIES.find((category) => category.key === key)?.label ?? key;
}

function shortTime(at) {
  if (!at) return '—';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return String(at);
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function ageText(at) {
  if (!at) return '缺失';
  if (String(at).includes('可用') || String(at).includes('/')) return String(at);
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return String(at);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  if (minutes < 60 * 24) return Math.round(minutes / 60) + ' 小时前';
  return Math.round(minutes / 1440) + ' 天前';
}
