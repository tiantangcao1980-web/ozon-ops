/**
 * 币种口径对账：analytics.revenue（下单口径，RUB）vs /v1/finance/balance 的结算收入。
 * 线上实测：analytics 是下单 GMV（RUB），finance 是已结算收入；币种必须由证据推出，不能预设。
 */
const ANALYTICS_CURRENCY = 'RUB';

function monthRange(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0));
  const iso = (date) => date.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

export async function reconcileMonth({ api, db, month }) {
  const { from, to } = monthRange(month);
  const analyticsRub = Number(
    db.db
      .prepare("SELECT COALESCE(SUM(revenue_rub), 0) AS total FROM analytics_daily WHERE date >= ? AND date <= ?")
      .get(from, to).total,
  );

  const response = await api.call('/v1/finance/balance', { date_from: from, date_to: to });
  const revenueNode = response.json?.cashflows?.sales?.amount_details?.revenue;
  const financeValue = Number(revenueNode?.value ?? 0);
  const financeCurrency = revenueNode?.currency_code ?? null;

  if (!financeValue) {
    return {
      month,
      from,
      to,
      analyticsRub,
      analyticsCurrency: ANALYTICS_CURRENCY,
      financeRub: financeValue,
      financeCurrency,
      deltaPct: null,
      verdict: 'UNKNOWN',
      note: '财务口径取不到结算收入（可能该月无结算），无法对账。',
    };
  }

  if (financeCurrency !== ANALYTICS_CURRENCY) {
    return {
      month,
      from,
      to,
      analyticsRub,
      analyticsCurrency: ANALYTICS_CURRENCY,
      financeRub: financeValue,
      financeCurrency,
      deltaPct: null,
      verdict: 'CURRENCY_MISMATCH',
      note: `两侧币种不同：analytics 是 ${ANALYTICS_CURRENCY}（下单口径），finance 是 ${financeCurrency}（结算口径）。需先用 fx_rates 折算再比较，不能直接相减。`,
    };
  }

  const deltaPct = Math.round(((analyticsRub - financeValue) / financeValue) * 1000) / 10;
  const verdict = Math.abs(deltaPct) <= 5 ? 'FACT_RUB' : 'RUB_GMV_VS_SETTLED';
  const note =
    verdict === 'FACT_RUB'
      ? `两侧都是 ${ANALYTICS_CURRENCY} 且差异 ≤5%：analytics.revenue 可当作结算口径使用。`
      : `两侧都是 ${ANALYTICS_CURRENCY}，但口径不同：analytics 是下单 GMV（含未结算/未发货/退货前），finance 是已结算收入；差额 ${deltaPct}% 属正常。日报里的「销售额」请标注为下单口径。`;

  return { month, from, to, analyticsRub, analyticsCurrency: ANALYTICS_CURRENCY, financeRub: financeValue, financeCurrency, deltaPct, verdict, note };
}

export function formatReconcile(result) {
  const lines = [
    `对账月份 ${result.month}（${result.from ?? ''}..${result.to ?? ''}）`,
    `analytics 下单口径：${result.analyticsRub.toFixed(2)} ${result.analyticsCurrency}`,
    `finance 结算口径：${result.financeRub.toFixed(2)} ${result.financeCurrency ?? '—'}`,
    `差异：${result.deltaPct == null ? '—' : `${result.deltaPct}%`}`,
    `结论：${result.verdict}`,
    result.note,
  ];
  return lines.join('\n');
}
