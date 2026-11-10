import { createPerformanceClient, hasPerformanceCredentials } from './performance.mjs';

/**
 * 广告数据同步：没有 Performance 凭据时报 NO_CREDENTIALS，不崩、不发请求。
 * 注意：/api/client/campaign 只有计划清单，没有按日指标；这里只统计计划数，
 * 不会为了「有数据」而伪造 ads_daily 行。按日数据请用 `ads import`（后台导出 CSV）。
 */
export async function runAdsSync({ db, env = process.env, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  if (!hasPerformanceCredentials(env)) {
    return {
      ok: false,
      code: 'NO_CREDENTIALS',
      hint: '缺少 OZON_PERF_CLIENT_ID / OZON_PERF_CLIENT_SECRET。在 Ozon Performance 后台创建应用后写入 .secrets/ozon.env。',
    };
  }
  const client = createPerformanceClient({
    clientId: env.OZON_PERF_CLIENT_ID,
    clientSecret: env.OZON_PERF_CLIENT_SECRET,
    fetchImpl,
  });
  const campaigns = await client.get('/api/client/campaign');
  if (!campaigns.ok) {
    return { ok: false, code: 'HTTP_ERROR', status: campaigns.status, message: String(campaigns.text ?? '').slice(0, 200) };
  }
  const items = campaigns.json?.result ?? campaigns.json?.campaigns ?? [];
  let stored = 0;
  for (const campaign of items) {
    const date = campaign.date ?? campaign.statDate ?? campaign.stat_date;
    if (!date) continue;
    db.db
      .prepare(
        'INSERT INTO ads_daily (date, campaign_id, impressions, clicks, spend_rub, orders, revenue_rub, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (date, campaign_id) DO UPDATE SET spend_rub = excluded.spend_rub, impressions = excluded.impressions, clicks = excluded.clicks, captured_at = excluded.captured_at',
      )
      .run(
        String(date).slice(0, 10),
        String(campaign.id ?? campaign.campaignId ?? ''),
        Number(campaign.impressions ?? 0),
        Number(campaign.clicks ?? 0),
        Number(campaign.spend ?? 0),
        Number(campaign.orders ?? 0),
        Number(campaign.revenue ?? 0),
        now(),
      );
    stored += 1;
  }
  return {
    ok: true,
    campaigns: items.length,
    stored,
    ...(stored === 0 ? { note: 'campaign list has no daily stats; use `ozon ads import` or a statistics endpoint' } : {}),
  };
}

export { computeAcosAlerts } from './rules.mjs';

