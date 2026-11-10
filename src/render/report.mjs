/**
 * 日报与看板：只读本地库。
 * - 日报：Markdown，给会话/文件看。
 * - 看板：单文件 HTML（内联 CSS/SVG，无外部资源）。
 */

function dayBefore(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function metricsFor(db, date) {
  const row = db.db
    .prepare(
      `SELECT COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(revenue_rub),0) AS revenue,
              COALESCE(SUM(returns),0) AS returns, COALESCE(SUM(session_view_pdp),0) AS sessions,
              COALESCE(AVG(position_category),0) AS position
       FROM analytics_daily WHERE date = ?`,
    )
    .get(date);
  return {
    units: Number(row?.units ?? 0),
    revenueRub: Math.round(Number(row?.revenue ?? 0) * 100) / 100,
    returns: Number(row?.returns ?? 0),
    sessions: Number(row?.sessions ?? 0),
    position: Number(row?.position ?? 0),
  };
}

function last7(db, date) {
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const rows = db.db
    .prepare(
      `SELECT date, COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(revenue_rub),0) AS revenue
       FROM analytics_daily WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`,
    )
    .all(start.toISOString().slice(0, 10), date);
  return rows.map((row) => ({ date: row.date, units: Number(row.units), revenue: Number(row.revenue) }));
}

function stockSummary(db) {
  const row = db.db
    .prepare(
      `SELECT COUNT(*) AS skus, COALESCE(SUM(s.present - s.reserved),0) AS available
       FROM products p LEFT JOIN stocks s ON s.sku = p.sku WHERE p.archived = 0`,
    )
    .get();
  return { skus: Number(row?.skus ?? 0), available: Number(row?.available ?? 0) };
}

function todoFromAlerts(alerts) {
  if (!alerts || alerts.length === 0) return ['无 P0/P1 事项'];
  return alerts.slice(0, 8).map((alert) => `[${alert.severity}] ${alert.message}`);
}

export function renderDailyReport({ db, date, alerts = [], fx = null }) {
  const yesterday = dayBefore(date);
  const metrics = metricsFor(db, yesterday);
  const stock = stockSummary(db);
  const series = last7(db, date);

  const lines = [
    `# 运营日报 · ${date}`,
    '',
    `## 昨日（${yesterday}）`,
    '',
    '| 指标 | 数值 |',
    '|---|---|',
    `| 下单件数 | ${metrics.units} |`,
    `| 下单金额（RUB） | ${metrics.revenueRub} |`,
    fx ? `| 汇率 | 1 CNY = ${fx.rubPerCny} RUB（${fx.date}） |` : '| 汇率 | 未同步 |',
    `| 退款件数 | ${metrics.returns} |`,
    `| 商品会话 | ${metrics.sessions} |`,
    `| 类目排名均值 | ${metrics.position ? metrics.position.toFixed(1) : '—'} |`,
    '',
    '## 库存',
    '',
    `- 在售 SKU：${stock.skus}，可用库存合计：${stock.available}`,
    '',
    '## 近 7 天下单',
    '',
    '| 日期 | 件数 | RUB |',
    '|---|---|---|',
    ...series.map((row) => `| ${row.date} | ${row.units} | ${row.revenue} |`),
    '',
    '## 待办（按级别）',
    '',
    ...todoFromAlerts(alerts).map((item) => `- ${item}`),
    '',
  ];
  return lines.join('\n');
}

function svgBars(series) {
  const width = 640;
  const height = 220;
  const max = Math.max(1, ...series.map((row) => row.revenue));
  const barWidth = series.length ? Math.floor((width - 40) / series.length) - 8 : 40;
  const bars = series
    .map((row, index) => {
      const barHeight = Math.round((row.revenue / max) * (height - 60));
      const x = 30 + index * (barWidth + 8);
      const y = height - 30 - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#1f6feb" rx="4"></rect>
      <text x="${x + barWidth / 2}" y="${height - 10}" font-size="11" text-anchor="middle" fill="#666">${row.date.slice(5)}</text>`;
    })
    .join('\n');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

export function renderDashboardHtml({ db, date, alerts = [], fx = null }) {
  const metrics = metricsFor(db, dayBefore(date));
  const stock = stockSummary(db);
  const series = last7(db, date);
  const alertRows = (alerts ?? [])
    .map(
      (alert) =>
        `<tr class="sev-${alert.severity}"><td>${alert.severity}</td><td>${escapeHtml(alert.message)}</td></tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>运营看板 · ${date}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 24px; color: #1d2129; background: #f7f8fa; }
  h1 { font-size: 20px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; }
  .card { background: #fff; border-radius: 8px; padding: 14px 18px; box-shadow: 0 1px 2px rgba(0,0,0,.06); min-width: 130px; }
  .card .value { font-size: 24px; font-weight: 600; }
  .card .label { color: #86909c; font-size: 12px; }
  table { border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; margin-top: 12px; }
  td, th { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; text-align: left; }
  .sev-P0 td { color: #d4380d; font-weight: 600; }
  .sev-P1 td { color: #d48806; }
  .muted { color: #86909c; font-size: 12px; }
</style>
</head>
<body>
<h1>运营看板 · ${date}</h1>
<p class="muted">昨日（${dayBefore(date)}）${fx ? ` · 1 CNY = ${fx.rubPerCny} RUB（${fx.date}）` : ''}</p>
<div class="cards">
  <div class="card"><div class="value">${metrics.units}</div><div class="label">下单件数</div></div>
  <div class="card"><div class="value">${metrics.revenueRub}</div><div class="label">下单金额 RUB</div></div>
  <div class="card"><div class="value">${metrics.returns}</div><div class="label">退款件数</div></div>
  <div class="card"><div class="value">${stock.available}</div><div class="label">可用库存</div></div>
  <div class="card"><div class="value">${alerts.length}</div><div class="label">预警</div></div>
</div>
<h2 style="font-size:15px;margin-top:22px">近 7 天下单金额</h2>
${svgBars(series)}
<h2 style="font-size:15px;margin-top:22px">预警</h2>
<table><thead><tr><th>级别</th><th>内容</th></tr></thead><tbody>
${alertRows || '<tr><td colspan="2" class="muted">无预警</td></tr>'}
</tbody></table>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function weekTotals(db, from, to) {
  const row = db.db
    .prepare(
      `SELECT COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(revenue_rub),0) AS revenue,
              COALESCE(SUM(returns),0) AS returns
       FROM analytics_daily WHERE date >= ? AND date <= ?`,
    )
    .get(from, to);
  return { units: Number(row.units), revenue: Math.round(Number(row.revenue) * 100) / 100, returns: Number(row.returns) };
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function renderWeeklyReport({ db, date, alerts = [], fx = null }) {
  const thisWeekFrom = shiftDate(date, -6);
  const lastWeekTo = shiftDate(date, -7);
  const lastWeekFrom = shiftDate(date, -13);
  const thisWeek = weekTotals(db, thisWeekFrom, date);
  const lastWeek = weekTotals(db, lastWeekFrom, lastWeekTo);
  const delta = (current, previous) => (previous > 0 ? `${Math.round(((current - previous) / previous) * 1000) / 10}%` : '—');

  const verdicts = db.db.prepare('SELECT verdict, count(*) AS n FROM candidates GROUP BY verdict').all();
  const verdictLine = verdicts.map((row) => `${row.verdict} ${row.n}`).join(' / ') || '暂无候选';

  const alertTypes = {};
  for (const alert of alerts) alertTypes[alert.type] = (alertTypes[alert.type] ?? 0) + 1;

  const lines = [
    `# 运营周报 · ${date}`,
    '',
    `## 本周（${thisWeekFrom}..${date}）vs 上周（${lastWeekFrom}..${lastWeekTo}）`,
    '',
    '| 指标 | 本周 | 上周 | 变化 |',
    '|---|---|---|---|',
    `| 下单件数 | ${thisWeek.units} | ${lastWeek.units} | ${delta(thisWeek.units, lastWeek.units)} |`,
    `| 下单金额（RUB） | ${thisWeek.revenue.toLocaleString('en-US')} | ${lastWeek.revenue.toLocaleString('en-US')} | ${delta(thisWeek.revenue, lastWeek.revenue)} |`,
    `| 退款件数 | ${thisWeek.returns} | ${lastWeek.returns} | ${delta(thisWeek.returns, lastWeek.returns)} |`,
    fx ? `| 汇率 | 1 CNY = ${fx.rubPerCny} RUB（${fx.date}） | — | — |` : '| 汇率 | 未同步 | — | — |',
    '',
    '## 预警分布',
    '',
    Object.keys(alertTypes).length
      ? Object.entries(alertTypes).map(([type, count]) => `- ${type}: ${count}`).join('\n')
      : '- 无预警',
    '',
    '## 选品结论',
    '',
    `- ${verdictLine}`,
    '',
    '## 下周建议',
    '',
    '- 检查 HOLD 候选缺的参数（费率/佣金/市场证据），补齐后重跑 select。',
    '- P0 预警连续出现时，先处理断货与发货时限。',
    '- 汇率波动 >3% 时重算单件贡献，再决定是否调价。',
    '',
  ];
  return lines.join('\n');
}