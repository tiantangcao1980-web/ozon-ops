import { existsSync, readFileSync } from 'node:fs';

import { isValidEan13 } from './barcode.mjs';

export const DEFAULT_QUANTITY = 20;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDims(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) return [];
  const dims = raw.map((item) => toNumber(item));
  if (dims.some((value) => value == null || value <= 0)) return [];
  return dims;
}

function normalizeAttributes(raw) {
  if (!Array.isArray(raw)) return [];
  const attributes = [];
  for (const item of raw) {
    const id = toNumber(item?.id);
    if (!id) continue;
    const first = item?.values?.[0];
    const value = String(item?.value ?? first?.value ?? '').trim();
    const dictionaryValueId = toNumber(item?.dictionaryValueId ?? first?.dictionary_value_id);
    if (!value) continue;
    attributes.push(dictionaryValueId
      ? { id, value, dictionaryValueId }
      : { id, value });
  }
  return attributes;
}

function normalizeTerms(raw) {
  if (!Array.isArray(raw)) return [];
  const terms = [];
  const seen = new Set();
  for (const item of raw) {
    const term = String(typeof item === 'string' ? item : item?.term ?? '').trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const volume = toNumber(item?.volume);
    terms.push(volume == null ? { term } : { term, volume });
  }
  return terms;
}

/** 事实库条目归一化：补默认数量、派生条码、统一字段名。 */
export function normalizeFacts(raw = {}) {
  const offerId = String(raw.offerId ?? raw.offer_id ?? raw.skuCode ?? raw.sku ?? '').trim();
  const dimsMm = normalizeDims(raw.dimsMm ?? raw.dims?.mm ?? raw.dimsMmList);
  const weightG = toNumber(raw.weightG ?? raw.weight_g ?? raw.weight);
  const quantity = toNumber(raw.quantity ?? raw.stock);
  // 条码不再由本地编造：Ozon 会为商品自动生成 OZN<sku> 条码（FBP/丢失赔偿都用它）。
  // 只有供应商真的给了条码时才带上去，且必须能过 GS1 校验。
  const barcodeRaw = String(raw.barcode ?? '').replace(/\D/g, '');
  const barcode = barcodeRaw && isValidEan13(barcodeRaw) ? barcodeRaw : null;
  return {
    offerId,
    skuCode: raw.skuCode ? String(raw.skuCode) : null,
    categoryId: toNumber(raw.categoryId ?? raw.category_id),
    typeId: toNumber(raw.typeId ?? raw.type_id),
    nameRu: String(raw.nameRu ?? raw.name ?? '').trim() || null,
    descriptionRu: String(raw.descriptionRu ?? raw.description ?? '').trim() || null,
    bulletsRu: Array.isArray(raw.bulletsRu) ? raw.bulletsRu.map((item) => String(item)).filter(Boolean) : [],
    packageRu: String(raw.packageRu ?? raw.komplektaciya ?? '').trim() || null,
    usageRu: String(raw.usageRu ?? '').trim() || null,
    weightG,
    packageWeightG: toNumber(raw.packageWeightG),
    dimsMm,
    quantity: quantity == null || quantity <= 0 ? DEFAULT_QUANTITY : quantity,
    warehouseId: toNumber(raw.warehouseId),
    barcode,
    priceRub: toNumber(raw.priceRub ?? raw.price),
    oldPriceRub: toNumber(raw.oldPriceRub ?? raw.old_price),
    vat: String(raw.vat ?? '0'),
    attributes: normalizeAttributes(raw.attributes),
    hotTerms: normalizeTerms(raw.hotTerms ?? raw.tags ?? raw.keywords),
    images: Array.isArray(raw.images) ? raw.images : [],
  };
}

/** 读取 data/listing-facts.json；offers 可按 offer_id 或 sku 码索引。 */
export function loadListingFacts({ file } = {}) {
  if (!file || !existsSync(file)) return { version: 1, warehouseId: null, offers: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const rawOffers = parsed.offers ?? parsed;
  const offers = {};
  for (const [key, raw] of Object.entries(rawOffers)) {
    if (!raw || typeof raw !== 'object') continue;
    const facts = normalizeFacts({ ...raw, offerId: raw.offerId ?? key });
    if (!facts.offerId) continue;
    offers[facts.offerId] = facts;
  }
  return { version: parsed.version ?? 1, warehouseId: toNumber(parsed.warehouseId), offers };
}

/** 按 offer_id 或 SKU 码查事实，忽略大小写。 */
export function findFacts(store, offerId) {
  if (!store?.offers) return null;
  const needle = String(offerId ?? '').trim().toLowerCase();
  if (!needle) return null;
  for (const facts of Object.values(store.offers)) {
    if (String(facts.offerId).toLowerCase() === needle) return facts;
    if (facts.skuCode && String(facts.skuCode).toLowerCase() === needle) return facts;
  }
  return null;
}

/**
 * 选品/上架前的数据采集缺口：缺哪一项就明确列出来，别到后台才发现填不了。
 * 返回空数组代表这条商品的数据已可完整上架。
 */
export function listingDataGaps(facts) {
  if (!facts) return ['FACTS_MISSING'];
  const gaps = [];
  if (!facts.categoryId || !facts.typeId) gaps.push('CATEGORY_MISSING');
  if (!facts.weightG || facts.weightG <= 0) gaps.push('WEIGHT_MISSING');
  if (!Array.isArray(facts.dimsMm) || facts.dimsMm.length !== 3) gaps.push('DIMENSIONS_MISSING');
  if (!facts.priceRub || facts.priceRub <= 0) gaps.push('PRICE_MISSING');
  if (!facts.hotTerms || facts.hotTerms.length === 0) gaps.push('TAGS_MISSING');
  if (!facts.nameRu) gaps.push('NAME_MISSING');
  if (!facts.descriptionRu && !(facts.bulletsRu?.length > 0)) gaps.push('DESCRIPTION_MISSING');
  return gaps;
}