/**
 * 拉取商品主档、价格/佣金与库存。
 * 分页用 last_id；信息/价格/库存按批次查询（每批 ≤100）。
 */
const BATCH = 100;

function chunks(array, size) {
  const result = [];
  for (let index = 0; index < array.length; index += size) result.push(array.slice(index, index + size));
  return result;
}

async function listAll({ api, pageSize, visibility }) {
  const items = [];
  let lastId = '';
  let pages = 0;
  for (;;) {
    const response = await api.call('/v3/product/list', {
      filter: { visibility },
      last_id: lastId,
      limit: pageSize,
    });
    const result = response.json?.result ?? {};
    const page = result.items ?? [];
    pages += 1;
    items.push(...page);
    if (page.length < pageSize) break;
    const next = result.last_id || page[page.length - 1]?.product_id;
    if (!next || String(next) === String(lastId)) break;
    lastId = String(next);
  }
  return { items, pages };
}

/**
 * @param {{api: {call: Function}, db: ReturnType<typeof import('../db.mjs').openDb>, pageSize?: number, now?: () => string}} options
 */
export async function pullProducts({ api, db, pageSize = 1000, now = () => new Date().toISOString() }) {
  const capturedAt = now();
  const seen = new Map();
  let pages = 0;

  for (const visibility of ['ALL', 'ARCHIVED']) {
    const listed = await listAll({ api, pageSize, visibility });
    pages += listed.pages;
    for (const item of listed.items) {
      if (item?.product_id === undefined || seen.has(item.product_id)) continue;
      seen.set(item.product_id, item);
    }
  }

  const products = [...seen.values()];
  const productIds = products.map((item) => item.product_id);

  for (const batch of chunks(productIds, BATCH)) {
    const response = await api.call('/v3/product/info/list', { product_id: batch });
    for (const detail of response.json?.items ?? []) {
      const existing = [...seen.values()].find((item) => item.product_id === detail.id);
      if (!existing) continue;
      existing.name = detail.name;
      existing.category_id = detail.category_id;
    }
  }

  for (const item of products) {
    db.upsert(
      'products',
      {
        product_id: item.product_id,
        offer_id: item.offer_id ?? null,
        sku: item.sku ?? null,
        name: item.name ?? null,
        category_id: item.category_id ?? null,
        archived: item.archived ? 1 : 0,
        has_fbs_stocks: item.has_fbs_stocks ? 1 : 0,
        has_fbo_stocks: item.has_fbo_stocks ? 1 : 0,
        updated_at: capturedAt,
      },
      ['product_id'],
    );
  }

  const offerIds = products.map((item) => item.offer_id).filter(Boolean);
  let priceCount = 0;
  for (const batch of chunks(offerIds, BATCH)) {
    const response = await api.call('/v5/product/info/prices', { filter: { offer_id: batch, visibility: 'ALL' }, limit: BATCH });
    for (const row of response.json?.items ?? []) {
      const price = row.price ?? {};
      db.upsert(
        'prices',
        {
          sku: row.sku ?? products.find((item) => item.offer_id === row.offer_id)?.sku ?? 0,
          offer_id: row.offer_id ?? null,
          price_cny: price.price ? Number(price.price) : null,
          old_price_cny: price.old_price ? Number(price.old_price) : null,
          marketing_price_cny: price.marketing_seller_price ? Number(price.marketing_seller_price) : null,
          min_price_cny: price.min_price ? Number(price.min_price) : null,
          currency: price.currency_code ?? null,
          commission_rate: row.commissions?.sales_percent_rfbs != null ? Number(row.commissions.sales_percent_rfbs) / 100 : null,
          acquiring_rate: row.acquiring != null ? Number(row.acquiring) : null,
          price_index_color: row.price_indexes?.color_index ?? null,
          volume_weight: row.volume_weight ?? null,
          commissions_json: JSON.stringify(row.commissions ?? {}),
          captured_at: capturedAt,
        },
        ['sku', 'captured_at'],
      );
      priceCount += 1;
    }
  }

  let stockCount = 0;
  for (const batch of chunks(offerIds, BATCH)) {
    const response = await api.call('/v4/product/info/stocks', { filter: { offer_id: batch, visibility: 'ALL' }, limit: BATCH });
    for (const row of response.json?.items ?? []) {
      for (const stock of row.stocks ?? []) {
        db.upsert(
          'stocks',
          {
            sku: products.find((item) => item.offer_id === row.offer_id)?.sku ?? 0,
            warehouse_id: stock.warehouse_id ?? 0,
            warehouse_name: stock.warehouse_name ?? null,
            present: stock.present ?? 0,
            reserved: stock.reserved ?? 0,
            captured_at: capturedAt,
          },
          ['sku', 'warehouse_id', 'captured_at'],
        );
        stockCount += 1;
      }
    }
  }

  return { products: products.length, pages, prices: priceCount, stocks: stockCount };
}
