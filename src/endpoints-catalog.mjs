/**
 * 端点目录：系统实际依赖的 Ozon Seller API 端点。
 * `body` 是该端点合法的探测/调用参数；`note` 说明用途。
 * 探测结果写入 src/endpoints.json，作为「线上真实可用版本」的唯一依据。
 */
export const CATALOG = [
  { path: '/v1/seller/info', body: {}, note: '店铺主体与订阅' },
  { path: '/v1/roles', body: {}, note: '密钥角色与权限' },
  { path: '/v1/rating/summary', body: {}, note: '店铺健康分' },
  { path: '/v2/warehouse/list', body: {}, note: '发货仓列表' },
  { path: '/v3/product/list', body: { filter: { visibility: 'ALL' }, last_id: '', limit: 1 }, note: '商品列表（ALL）' },
  { path: '/v3/product/list', body: { filter: { visibility: 'ARCHIVED' }, last_id: '', limit: 1 }, note: '商品列表（ARCHIVED）' },
  { path: '/v3/product/info/list', body: { sku: [1234567890] }, note: '商品档案（按 sku）' },
  { path: '/v5/product/info/prices', body: { filter: { visibility: 'ALL' }, limit: 1 }, note: '价格与佣金' },
  { path: '/v4/product/info/stocks', body: { filter: { visibility: 'ALL' }, limit: 1 }, note: '库存' },
  { path: '/v4/posting/fbs/list', body: { dir: 'ASC', filter: { since: '2026-10-01T00:00:00Z', to: '2026-11-06T23:59:59Z' }, limit: 1, offset: 0 }, note: '订单列表（实际可用版本）' },
  { path: '/v3/posting/fbs/list', body: { dir: 'ASC', filter: { since: '2026-10-01T00:00:00Z', to: '2026-11-06T23:59:59Z' }, limit: 1, offset: 0 }, note: '旧版订单列表（已知线上 404）' },
  { path: '/v4/posting/fbs/unfulfilled/list', body: { dir: 'ASC', filter: { cutoff_from: '2026-10-01T00:00:00Z', cutoff_to: '2026-11-10T00:00:00Z' }, limit: 1, offset: 0 }, note: '待发货清单' },
  { path: '/v3/posting/fbo/list', body: { dir: 'ASC', filter: { since: '2026-10-01T00:00:00Z', to: '2026-11-06T23:59:59Z' }, limit: 1, offset: 0 }, note: 'FBO 订单' },
  { path: '/v1/analytics/data', body: { date_from: '2026-11-01', date_to: '2026-11-06', metrics: ['ordered_units', 'revenue'], dimension: ['day'], limit: 100 }, note: '自店销量分析（1 次/分钟）' },
  { path: '/v1/analytics/stocks', body: { skus: ['1234567890'] }, note: '库存速度（需 skus）' },
  { path: '/v1/description-category/tree', body: { language: 'ZH_HANS' }, note: '类目树' },
  { path: '/v1/description-category/attribute', body: { description_category_id: 17028922, type_id: 1, language: 'ZH_HANS' }, note: '类目属性' },
  { path: '/v1/finance/balance', body: { date_from: '2026-10-01', date_to: '2026-10-31' }, note: '财务余额（单次≤1 月）' },
  { path: '/v1/search-queries/top', body: { limit: '10', offset: '0' }, note: '市场需求（Premium Pro）' },
  { path: '/v1/analytics/category/comparison', body: { period: 'MONTH', sort: 'DESC', limit: 1, offset: 0, group: 'SELLER', metric: 'GMV' }, note: '类目竞争（Premium）' },
  { path: '/v2/review/list', body: { limit: 20, offset: 0 }, note: '评价（需评价管理订阅）' },
  { path: '/v1/question/list', body: { limit: 20, offset: 0 }, note: '问答（需 Premium Plus）' },
];
