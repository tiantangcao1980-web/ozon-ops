/**
 * 自店日指标拉取。
 * 线上约束：/v1/analytics/data 每客户端每分钟 1 次；时间窗口按天切分（默认 31 天）。
 */
export const METRICS = [
  'ordered_units',
  'revenue',
  'delivered_units',
  'returns',
  'hits_view',
  'hits_view_search',
  'hits_view_pdp',
  'hits_tocart_search',
  'hits_tocart_pdp',
  'session_view_pdp',
  'conv_tocart_pdp',
  'position_category',
];

const DAY_MS = 86_400_000;

export function chunkDateRange(from, to, maxDays = 31) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`非法日期区间: ${from}..${to}`);
  }
  const chunks = [];
  let cursor = start;
  while (cursor <= end) {
    const windowEnd = Math.min(cursor + (maxDays - 1) * DAY_MS, end);
    chunks.push({
      from: new Date(cursor).toISOString().slice(0, 10),
      to: new Date(windowEnd).toISOString().slice(0, 10),
    });
    cursor = windowEnd + DAY_MS;
  }
  return chunks;
}

const COLUMN_BY_METRIC = {
  ordered_units: 'ordered_units',
  revenue: 'revenue_rub',
  delivered_units: 'delivered_units',
  returns: 'returns',
  hits_view: 'hits_view',
  hits_view_search: 'hits_view_search',
  hits_view_pdp: 'hits_view_pdp',
  hits_tocart_search: 'hits_tocart_search',
  hits_tocart_pdp: 'hits_tocart_pdp',
  session_view_pdp: 'session_view_pdp',
  conv_tocart_pdp: 'conv_tocart_pdp',
  position_category: 'position_category',
};

export async function pullAnalytics({
  api,
  db,
  from,
  to,
  maxDays = 31,
  bySku = false,
  rateLimitMs = 60_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const chunks = chunkDateRange(from, to, maxDays);
  const capturedAt = new Date(now()).toISOString();
  let lastCallAt = null;
  let rows = 0;

  for (const chunk of chunks) {
    if (lastCallAt !== null && rateLimitMs > 0) {
      const elapsed = now() - lastCallAt;
      if (elapsed < rateLimitMs) await sleep(rateLimitMs - elapsed);
    }
    const response = await api.call('/v1/analytics/data', {
      date_from: chunk.from,
      date_to: chunk.to,
      metrics: METRICS,
      dimension: bySku ? ['sku', 'day'] : ['day'],
      limit: 1000,
    });
    lastCallAt = now();

    for (const row of response.json?.result?.data ?? []) {
      const dims = row.dimensions ?? [];
      const date = bySku ? dims[1]?.id : dims[0]?.id;
      const sku = bySku ? String(dims[0]?.id ?? '') : '';
      if (!date || (bySku && !sku)) continue;
      const record = { date, sku, captured_at: capturedAt, currency: 'RUB' };
      METRICS.forEach((metric, index) => {
        const value = row.metrics?.[index];
        record[COLUMN_BY_METRIC[metric]] = value == null ? null : value;
      });
      db.upsert('analytics_daily', record, ['date', 'sku']);
      rows += 1;
    }
  }

  return { rows, chunks: chunks.length };
}
