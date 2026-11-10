/**
 * `ozon status`：打印店铺概要（订阅、商品、仓库、密钥角色）。
 * @param {{config: {maskedClientId: string}, api: {call: Function}}} deps
 * @returns {Promise<string>}
 */
export async function runStatus({ config, api }) {
  // 串行调用：5 个并发请求正是触发 429 的常见写法，status 不需要低延迟
  const seller = await api.call('/v1/seller/info', {});
  const roles = await api.call('/v1/roles', {});
  const active = await api.call('/v3/product/list', { filter: { visibility: 'ALL' }, last_id: '', limit: 1 });
  const archived = await api.call('/v3/product/list', { filter: { visibility: 'ARCHIVED' }, last_id: '', limit: 1 });
  const warehouses = await api.call('/v2/warehouse/list', {});

  const company = seller.json?.company ?? {};
  const activeTotal = Number(active.json?.result?.total_items ?? active.json?.result?.total ?? 0);
  const archivedTotal = Number(archived.json?.result?.total_items ?? archived.json?.result?.total ?? 0);
  const roleNames = (roles.json?.roles ?? []).map((role) => role.name).filter(Boolean);
  const warehouseCount = (warehouses.json?.warehouses ?? []).length;
  const premium = seller.json?.subscription?.is_premium === true;

  const lines = [
    `店铺: ${company.name ?? '—'}（${company.currency ?? '—'} / ${company.country ?? '—'}）`,
    `Premium: ${premium ? '是' : '否'}`,
    `商品: ${activeTotal} 在售 / ${archivedTotal} 归档`,
    `仓库: ${warehouseCount}`,
    `角色: ${roleNames.length ? roleNames.join(', ') : '—'}`,
    `Client-Id: ${config.maskedClientId}`,
  ];
  return lines.join('\n');
}
