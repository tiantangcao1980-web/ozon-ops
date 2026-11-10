/**
 * 广告报表（Markdown）：合计、ACOS、预警、预算建议。
 */
export function renderAdsReport({ date, rows = [], alerts = [], suggestions = [] }) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.spend += Number(row.spendRub ?? 0);
      acc.revenue += Number(row.revenueRub ?? 0);
      acc.clicks += Number(row.clicks ?? 0);
      acc.impressions += Number(row.impressions ?? 0);
      acc.orders += Number(row.orders ?? 0);
      return acc;
    },
    { spend: 0, revenue: 0, clicks: 0, impressions: 0, orders: 0 },
  );
  const acos = totals.revenue > 0 ? totals.spend / totals.revenue : null;
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : null;

  const lines = [
    `# 广告投放报告 · ${date}`,
    '',
    '| 指标 | 数值 |',
    '|---|---|',
    `| 花费（RUB） | ${Math.round(totals.spend * 100) / 100} |`,
    `| 收入（RUB） | ${Math.round(totals.revenue * 100) / 100} |`,
    `| ACOS | ${acos === null ? '—' : `${(acos * 100).toFixed(1)}%`} |`,
    `| 点击 / 展示 | ${totals.clicks} / ${totals.impressions} |`,
    `| CTR | ${ctr === null ? '—' : `${(ctr * 100).toFixed(2)}%`} |`,
    `| 订单 | ${totals.orders} |`,
    '',
    '## 预警',
    '',
    ...(alerts.length ? alerts.map((alert) => `- [${alert.severity}] ${alert.message}`) : ['- 无']),
    '',
    '## 预算建议（仅建议，执行需提案+确认码）',
    '',
  ];
  if (suggestions.length === 0) {
    lines.push('- 暂无建议');
  } else {
    for (const item of suggestions) {
      lines.push(`- ${item.campaignId}：${item.action} — ${item.reason}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
