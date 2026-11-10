/**
 * 广告数据导入：支持从 Performance 后台导出的 CSV（分号/逗号、俄/英表头）。
 * 有 API 凭据时走 ads sync；没有凭据时这条 CSV 通道保证 P4 仍能产出建议。
 */
const ALIASES = {
  campaignid: 'campaignId',
  campaign_id: 'campaignId',
  кампания: 'campaignId',
  кампанияid: 'campaignId',
  date: 'date',
  дата: 'date',
  impressions: 'impressions',
  показы: 'impressions',
  clicks: 'clicks',
  клики: 'clicks',
  spend_rub: 'spendRub',
  spend: 'spendRub',
  расход: 'spendRub',
  orders: 'orders',
  заказы: 'orders',
  revenue_rub: 'revenueRub',
  revenue: 'revenueRub',
  выручка: 'revenueRub',
};

function normalizeHeader(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[«»"]/g, '');
  return ALIASES[key] ?? null;
}

/**
 * 数字解析：兼容 "1 234,56"（ru）、"1,234.56"（en）、"1234.56"。
 * 无法解析时返回 NaN，由调用方决定报错还是跳过，绝不静默归零。
 */
export function parseAmount(raw) {
  const text = String(raw ?? '').trim().replace(/[\s\u00A0\u202F]/g, '');
  if (text === '') return NaN;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let normalized = text;
  if (lastComma >= 0 && lastDot >= 0) {
    // 两种都有：最后出现的那个是小数点，另一个是千分位
    normalized = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // 只有逗号：3 位且后面还有数字 → 千分位；否则当小数点
    const decimals = text.length - lastComma - 1;
    normalized = decimals === 3 && !/^0|^\d{1,2}$/.test(text.slice(0, lastComma)) ? text.replace(/,/g, '') : text.replace(',', '.');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

export function parseAdsCsv(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  // 分隔符按前几行里出现次数判断：分号优先（俄语导出常用分号 + 逗号小数）
  const sample = lines.slice(0, 3).join('\n');
  const separator = (sample.match(/;/g)?.length ?? 0) >= (sample.match(/,/g)?.length ?? 0) ? ';' : ',';
  const headers = lines[0].split(separator).map(normalizeHeader);
  const rows = [];
  const issues = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(separator).map((cell) => cell.trim());
    const row = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const raw = cells[index] ?? '';
      if (header === 'campaignId' || header === 'date') row[header] = raw;
      else row[header] = parseAmount(raw);
    });
    if (!row.campaignId || !row.date) {
      issues.push({ line, reason: 'MISSING_KEY' });
      continue;
    }
    const parsed = {
      campaignId: row.campaignId,
      date: row.date,
      impressions: Number.isFinite(row.impressions) ? row.impressions : 0,
      clicks: Number.isFinite(row.clicks) ? row.clicks : 0,
      spendRub: Number.isFinite(row.spendRub) ? row.spendRub : 0,
      orders: Number.isFinite(row.orders) ? row.orders : 0,
      revenueRub: Number.isFinite(row.revenueRub) ? row.revenueRub : 0,
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) issues.push({ line, reason: 'BAD_DATE' });
    if (!Number.isFinite(row.spendRub) || !Number.isFinite(row.revenueRub)) issues.push({ line, reason: 'BAD_AMOUNT' });
    rows.push(parsed);
  }
  return { rows, issues };
}

export function importAds({ db, csv, capturedAt = new Date().toISOString() }) {
  const { rows, issues } = parseAdsCsv(csv);
  const statement = db.db.prepare(
    `INSERT INTO ads_daily (date, campaign_id, impressions, clicks, spend_rub, orders, revenue_rub, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (date, campaign_id) DO UPDATE SET impressions = excluded.impressions, clicks = excluded.clicks,
       spend_rub = excluded.spend_rub, orders = excluded.orders, revenue_rub = excluded.revenue_rub, captured_at = excluded.captured_at`,
  );
  for (const row of rows) {
    statement.run(row.date, row.campaignId, row.impressions, row.clicks, row.spendRub, row.orders, row.revenueRub, capturedAt);
  }
  return { rows: rows.length, campaigns: new Set(rows.map((row) => row.campaignId)).size, issues };
}
