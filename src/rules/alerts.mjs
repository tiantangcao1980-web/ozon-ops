/**
 * 预警规则：只读本地库，不调 API。
 * 级别：P0（立刻处理）、P1（今天处理）、P2（可以排队）。
 */
export function computeAlerts({
  db,
  now = () => new Date(),
  thresholds = { pendingHours: 12, returnRate: 0.15, lowStockDays: 10 },
} = {}) {
  const alerts = [];
  const nowDate = now();

  // 1) 断货：在售商品「最新快照」可用库存为 0（无库存行不报，避免误报）
  const stockRows = db.db
    .prepare(
      `WITH latest AS (
         SELECT sku, MAX(captured_at) AS captured_at FROM stocks GROUP BY sku
       )
       SELECT p.offer_id, p.name, p.sku, COALESCE(SUM(s.present - s.reserved), 0) AS available
       FROM products p
       JOIN stocks s ON s.sku = p.sku
       JOIN latest l ON l.sku = s.sku AND l.captured_at = s.captured_at
       WHERE p.archived = 0
       GROUP BY p.sku
       HAVING available <= 0`,
    )
    .all();
  for (const row of stockRows) {
    alerts.push({
      type: 'stockout',
      severity: 'P0',
      message: `断货：${row.offer_id} ${row.name ?? ''}（可用 ${row.available}）`,
      target: row.offer_id,
    });
  }

  // 2) 待发货超时
  const pendingRows = db.db
    .prepare("SELECT posting_number, shipment_date FROM postings WHERE status LIKE 'awaiting%' AND shipment_date IS NOT NULL")
    .all();
  for (const row of pendingRows) {
    const ship = new Date(row.shipment_date);
    if (Number.isNaN(ship.getTime())) continue;
    const hours = (ship.getTime() - nowDate.getTime()) / 3_600_000;
    if (hours <= thresholds.pendingHours) {
      alerts.push({
        type: 'pending_shipment',
        severity: 'P0',
        message: `发货时限：${row.posting_number} 距截止 ${hours.toFixed(1)} 小时`,
        target: row.posting_number,
      });
    }
  }

  // 3) 价格指数不在绿色区（只看每个 offer 的最新快照）
  const priceRows = db.db
    .prepare(
      `WITH latest AS (
         SELECT offer_id, MAX(captured_at) AS captured_at FROM prices GROUP BY offer_id
       )
       SELECT p.offer_id, p.price_cny, p.price_index_color
       FROM prices p
       JOIN latest l ON l.offer_id = p.offer_id AND l.captured_at = p.captured_at
       WHERE p.price_index_color IS NOT NULL AND p.price_index_color != 'GREEN'`,
    )
    .all();
  for (const row of priceRows) {
    alerts.push({
      type: 'price_index',
      severity: 'P1',
      message: `价格指数 ${row.price_index_color}：${row.offer_id}（₽/¥ ${row.price_cny ?? '—'}）`,
      target: row.offer_id,
    });
  }

  // 4) 退货率过高（最近 30 天聚合）
  const since = new Date(nowDate.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const totals = db.db
    .prepare('SELECT COALESCE(SUM(ordered_units),0) AS units, COALESCE(SUM(returns),0) AS returns FROM analytics_daily WHERE date >= ?')
    .get(since);
  if (Number(totals.units) > 0) {
    const rate = Number(totals.returns) / Number(totals.units);
    if (rate > thresholds.returnRate) {
      alerts.push({
        type: 'return_rate',
        severity: 'P1',
        message: `退货率 ${(rate * 100).toFixed(1)}% 超过阈值 ${(thresholds.returnRate * 100).toFixed(0)}%（30 天 ${totals.units} 单）`,
      });
    }
  }

  // 5) 竞品价格异动：最近 14 天内最新两次快照比较
  const since14 = new Date(nowDate.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const priceChanges = db.db
    .prepare(
      `WITH ranked AS (
         SELECT sku, keyword, price_rub, captured_at,
                ROW_NUMBER() OVER (PARTITION BY sku ORDER BY captured_at DESC) AS rn
         FROM competitor_snapshots
         WHERE price_rub IS NOT NULL AND captured_at >= ?
       )
       SELECT latest.sku, latest.keyword, latest.price_rub AS latest_price, prev.price_rub AS prev_price
       FROM ranked latest
       JOIN ranked prev ON prev.sku = latest.sku AND prev.rn = 2
       WHERE latest.rn = 1 AND prev.price_rub > 0`,
    )
    .all(since14);
  const dropPct = Number(thresholds.competitorDropPct ?? 0.1);
  for (const row of priceChanges) {
    const change = (Number(row.latest_price) - Number(row.prev_price)) / Number(row.prev_price);
    if (change <= -dropPct) {
      alerts.push({
        type: 'competitor_price_drop',
        severity: 'P1',
        target: row.sku,
        message: `竞品降价：${row.keyword ?? row.sku} 从 ₽${row.prev_price} → ₽${row.latest_price}（${(change * 100).toFixed(0)}%）`,
      });
    } else if (change >= dropPct) {
      alerts.push({
        type: 'competitor_price_rise',
        severity: 'P2',
        target: row.sku,
        message: `竞品涨价：${row.keyword ?? row.sku} 从 ₽${row.prev_price} → ₽${row.latest_price}（+${(change * 100).toFixed(0)}%），可考虑跟价`,
      });
    }
  }

  // 6) 数据陈旧：超过 48 小时没有成功调用
  const lastCall = db.db.prepare("SELECT MAX(called_at) AS last FROM api_calls WHERE status = 200").get();
  if (lastCall?.last) {
    const ageHours = (nowDate.getTime() - new Date(lastCall.last).getTime()) / 3_600_000;
    if (ageHours > 48) {
      alerts.push({
        type: 'stale_data',
        severity: 'P1',
        message: `数据已 ${ageHours.toFixed(0)} 小时未更新，先跑 ozon pull`,
      });
    }
  }

  const order = { P0: 0, P1: 1, P2: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
