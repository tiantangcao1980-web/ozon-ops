/**
 * 拉取 FBS 订单与待发货清单。
 * 线上实测：
 * - /v4/posting/fbs/list 用 cursor 分页（has_next/cursor），limit 上限 100，返回里没有顶层 price/currency_code/created_at；
 *   金额在 products[].price = { amount, currency }（本店是 CNY）。
 * - 待发货清单也走 cursor 分页；其中的订单不一定真是待发货，必须与 status 交叉校验。
 */
const PENDING_STATUSES = new Set(['awaiting_deliver', 'awaiting_registration', 'awaiting_packaging', 'awaiting_approve']);

function postingAmounts(posting) {
  const products = posting.products ?? posting.items ?? [];
  let total = 0;
  let currency = null;
  let missing = false;
  for (const product of products) {
    const amount = product?.price?.amount;
    if (amount == null) {
      missing = true;
      continue;
    }
    total += Number(amount) * Number(product.quantity ?? 1);
    currency ??= product.price.currency ?? null;
  }
  if (products.length === 0) missing = true;
  return { total: Math.round(total * 100) / 100, currency, missing };
}

async function listUnfulfilled({ api, since, to, limit }) {
  const numbers = [];
  let cursor;
  let pages = 0;
  for (;;) {
    pages += 1;
    if (pages > 200) throw new Error('待发货清单超过 200 页，疑似 cursor 分页异常');
    const body = { dir: 'ASC', filter: { cutoff_from: since, cutoff_to: to }, limit, offset: 0 };
    if (cursor) body.cursor = cursor;
    const response = await api.call('/v4/posting/fbs/unfulfilled/list', body);
    const page = response.json ?? {};
    for (const posting of page.postings ?? []) {
      if (posting?.posting_number) numbers.push(posting.posting_number);
    }
    if (!page.has_next) break;
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return { numbers, pages };
}

export async function pullPostings({ api, db, since, to, limit = 100, now = () => new Date().toISOString() }) {
  const updatedAt = now();
  const seen = new Map();
  let pages = 0;
  let cursor;
  let guard = 0;

  for (;;) {
    guard += 1;
    if (guard > 500) throw new Error('拉取订单超过 500 页，疑似 cursor 分页异常');
    const body = { dir: 'ASC', filter: { since, to }, limit, offset: 0 };
    if (cursor) body.cursor = cursor;
    const response = await api.call('/v4/posting/fbs/list', body);
    const page = response.json ?? {};
    pages += 1;
    for (const posting of page.postings ?? []) {
      if (!posting?.posting_number) continue;
      seen.set(posting.posting_number, posting);
    }
    if (!page.has_next) break;
    if (!page.cursor) throw new Error('订单分页异常：has_next=true 但 cursor 为空');
    cursor = page.cursor;
  }

  let pendingNumbers = new Set();
  let pendingUnknown = false;
  try {
    const unfulfilled = await listUnfulfilled({ api, since, to, limit });
    pendingNumbers = new Set(unfulfilled.numbers);
  } catch {
    pendingUnknown = true;
  }

  let inserted = 0;
  let updated = 0;
  let missingAmounts = 0;
  // N+1 修复：一次把所有已存在的 posting_number 读进 Set
  const existing = new Set(db.db.prepare('SELECT posting_number FROM postings').all().map((row) => row.posting_number));
  const fxRow = db.db.prepare('SELECT rub_per_cny FROM fx_rates ORDER BY date DESC LIMIT 1').get();
  const rubPerCny = Number(fxRow?.rub_per_cny) > 0 ? Number(fxRow.rub_per_cny) : null;

  for (const posting of seen.values()) {
    const existed = existing.has(posting.posting_number);
    const amounts = postingAmounts(posting);
    if (amounts.missing) missingAmounts += 1;
    const isPending = pendingNumbers.has(posting.posting_number) && PENDING_STATUSES.has(String(posting.status));
    // 金额可能不是 RUB（该店是 CNY）：同时存原币种金额与按当日汇率折算的 RUB
    const amountTotal = amounts.missing ? null : amounts.total;
    const currency = amounts.missing ? null : amounts.currency;
    const priceRub =
      amountTotal != null && currency === 'RUB'
        ? amountTotal
        : amountTotal != null && currency === 'CNY' && rubPerCny
          ? Math.round(amountTotal * rubPerCny * 100) / 100
          : null;
    db.upsert(
      'postings',
      {
        posting_number: posting.posting_number,
        order_number: posting.order_number ?? null,
        status: posting.status ?? null,
        substatus: posting.substatus ?? null,
        created_at: posting.created_at ?? null,
        in_process_at: posting.in_process_at ?? null,
        shipment_date: posting.shipment_date ?? null,
        price_rub: priceRub,
        currency,
        amount_total: amountTotal,
        amount_currency: currency,
        pending_shipment: isPending ? 1 : 0,
        items_json: JSON.stringify(posting.products ?? posting.items ?? []),
        updated_at: updatedAt,
      },
      ['posting_number'],
    );
    if (existed) updated += 1;
    else inserted += 1;
  }

  // 待发货只是「当前状态」：本次清单里没有了就清掉，避免移出窗口后永远挂在待发货里
  if (!pendingUnknown) {
    if (pendingNumbers.size === 0) {
      db.db.prepare('UPDATE postings SET pending_shipment = 0 WHERE pending_shipment = 1').run();
    } else {
      const placeholders = [...pendingNumbers].map(() => '?').join(', ');
      db.db
        .prepare(`UPDATE postings SET pending_shipment = 0 WHERE pending_shipment = 1 AND posting_number NOT IN (${placeholders})`)
        .run(...pendingNumbers);
    }
  }

  const markedPending = db.db.prepare('SELECT count(*) AS n FROM postings WHERE pending_shipment = 1').get().n;
  return { inserted, updated, pages, pending: markedPending, pendingListed: pendingNumbers.size, pendingUnknown, missingAmounts, rubPerCny };
}
