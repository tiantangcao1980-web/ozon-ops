/**
 * 投流规则：ACOS 预警 + 预算/出价建议（纯规则，不调 API）。
 * 建议只作为「提案内容」，真正执行仍走 action 链路。
 */
export function computeAcosAlerts(rows, { threshold = 0.3 } = {}) {
  const alerts = [];
  for (const row of rows ?? []) {
    const spend = Number(row.spendRub ?? 0);
    const revenue = Number(row.revenueRub ?? 0);
    if (revenue <= 0) continue;
    const acos = spend / revenue;
    if (acos > threshold) {
      alerts.push({
        type: 'acos_high',
        severity: 'P1',
        campaignId: row.campaignId,
        acos: Math.round(acos * 100) / 100,
        message: `ACOS ${(acos * 100).toFixed(0)}% 超过阈值 ${(threshold * 100).toFixed(0)}%（计划 ${row.campaignId}）`,
      });
    }
  }
  return alerts;
}

export function suggestBudgetChanges(rows, { targetAcos = 0.25, maxIncreasePct = 0.3, maxDecreasePct = 0.3 } = {}) {
  return (rows ?? []).map((row) => {
    const spend = Number(row.spendRub ?? 0);
    const revenue = Number(row.revenueRub ?? 0);
    if (revenue <= 0 && spend <= 0) {
      return { campaignId: row.campaignId, action: 'keep', reason: '无花费无收入，先补数据' };
    }
    const acos = revenue > 0 ? spend / revenue : Number.POSITIVE_INFINITY;
    if (revenue > 0 && acos <= targetAcos) {
      const increase = Math.round(spend * maxIncreasePct);
      return {
        campaignId: row.campaignId,
        action: 'increase',
        acos: Math.round(acos * 100) / 100,
        suggestedBudgetRub: spend + increase,
        reason: `ACOS ${(acos * 100).toFixed(0)}% 低于目标 ${(targetAcos * 100).toFixed(0)}%，可加预算 ${increase} RUB`,
      };
    }
    const decrease = Math.round(spend * maxDecreasePct);
    return {
      campaignId: row.campaignId,
      action: 'decrease',
      acos: Number.isFinite(acos) ? Math.round(acos * 100) / 100 : null,
      suggestedBudgetRub: Math.max(0, spend - decrease),
      reason: Number.isFinite(acos)
        ? `ACOS ${(acos * 100).toFixed(0)}% 高于目标 ${(targetAcos * 100).toFixed(0)}%，建议降预算 ${decrease} RUB 或降出价`
        : '有花费无收入，建议暂停并检查关键词',
    };
  });
}

export function aggregateByCampaign(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = String(row.campaignId ?? '');
    if (!key) continue;
    const bucket = map.get(key) ?? { campaignId: key, spendRub: 0, revenueRub: 0, clicks: 0, impressions: 0, orders: 0 };
    bucket.spendRub += Number(row.spendRub ?? 0);
    bucket.revenueRub += Number(row.revenueRub ?? 0);
    bucket.clicks += Number(row.clicks ?? 0);
    bucket.impressions += Number(row.impressions ?? 0);
    bucket.orders += Number(row.orders ?? 0);
    map.set(key, bucket);
  }
  return [...map.values()];
}