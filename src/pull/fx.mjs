/**
 * CBR 汇率同步：<https://www.cbr.ru/scripts/XML_daily.asp?date_req=DD/MM/YYYY>
 * 返回 CNY 的 rub_per_cny（CBR 的 Value 是 Nominal 个人民币折卢布）。
 *
 * 汇率是全局乘数，必须严格校验：
 * - 正数、有限值；
 * - 落在合理区间（RUB/CNY 1–100），反了（0.08）或离谱（500）都拒绝；
 * - 请求带超时，慢源不让整条链路挂住。
 */
export const FX_MIN = 1;
export const FX_MAX = 100;
const FETCH_TIMEOUT_MS = 10_000;

export class FxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FxError';
    this.code = code;
  }
}

export function isSaneFx(rate) {
  return Number.isFinite(rate) && rate >= FX_MIN && rate <= FX_MAX;
}

export function assertSaneFx(rate, source = 'unknown') {
  if (!isSaneFx(rate)) {
    throw new FxError('FX_OUT_OF_RANGE', `${source} 返回的汇率不合理：${rate}（应在 ${FX_MIN}–${FX_MAX} RUB/CNY）`);
  }
  return Math.round(rate * 10_000) / 10_000;
}

export function parseCbrXml(xml) {
  const block = String(xml).split(/<Valute\b/).find((part) => /<CharCode>\s*CNY\s*<\/CharCode>/.test(part));
  if (!block) throw new Error('CBR 汇率里找不到 CNY 报价');
  const nominal = Number((block.match(/<Nominal>\s*([\d.]+)\s*<\/Nominal>/) ?? [])[1]);
  const value = Number((block.match(/<Value>\s*([\d.,]+)\s*<\/Value>/) ?? [])[1]?.replace(',', '.'));
  if (!Number.isFinite(nominal) || nominal <= 0 || !Number.isFinite(value) || value <= 0) {
    throw new Error('CBR 汇率解析失败：Nominal/Value 非法');
  }
  return assertSaneFx(value / nominal, 'CBR');
}

function cbrDate(date) {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function syncFx({ db, fetchImpl = fetch, today = new Date() }) {
  const date = today.toISOString().slice(0, 10);
  const attempts = [
    {
      source: 'CBR',
      url: `https://www.cbr.ru/scripts/XML_daily.asp?date_req=${cbrDate(today)}`,
      parse: (body) => parseCbrXml(body),
    },
    {
      source: 'open.er-api.com',
      url: 'https://open.er-api.com/v6/latest/CNY',
      parse: (body) => {
        const payload = JSON.parse(body);
        const rate = Number(payload?.rates?.RUB);
        if (!Number.isFinite(rate) || rate <= 0) throw new Error('open.er-api.com 响应里没有 RUB 报价');
        return assertSaneFx(rate, 'open.er-api.com');
      },
    },
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const response = await fetchWithTimeout(fetchImpl, attempt.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      const rubPerCny = attempt.parse(body);
      db.upsert(
        'fx_rates',
        { date, rub_per_cny: rubPerCny, source: attempt.source, captured_at: new Date().toISOString() },
        ['date'],
      );
      return { date, rubPerCny, source: attempt.source };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`汇率同步失败（CBR 与备用源都不可用）：${lastError?.message ?? 'unknown'}`);
}
