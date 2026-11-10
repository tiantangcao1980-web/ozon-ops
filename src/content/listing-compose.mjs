
import { listingDataGaps } from './listing-facts.mjs';

/** 「特征」页的通用属性 ID（五个实测类目都有这些字段）。 */
export const ATTR_HASHTAGS = 23171;
export const ATTR_NAME = 4180;
export const ATTR_WEIGHT = 4383;
export const ATTR_PACKAGE_WEIGHT = 4497;

const HASHTAG_MAX_CHARS = 1000;

/** 常用属性名（后台清单里显示中文/俄文名，照着填不会填错行）。 */
export const ATTR_NAMES = {
  85: 'Бренд（品牌）',
  4389: 'Страна-изготовитель（产地）',
  4383: 'Вес товара, г（商品重量）',
  4497: 'Вес с упаковкой, г（含包装重量）',
  4180: 'Название（名称）',
  23171: '#Хештеги（标签/热搜词）',
  9048: 'Название модели（型号）',
  8229: 'Тип（类型）',
  10096: 'Цвет товара（颜色）',
  7199: 'Материал（材质）',
  8219: 'Материал（材质）',
  4967: 'Материал（材质）',
  4958: 'Предназначено для（适用对象）',
  23507: 'Тип изоляционного материала（隔热材料类型）',
};

function escapeTableCell(text) {
  return String(text).split('|').join('\\|');
}

function cleanHashtag(term) {
  return String(term ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '_')
    .replace(/[^0-9a-zа-яё_-]/gi, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 把热点搜索词转成 Ozon「#Хештеги」：小写、空格转下划线、去重、按长度截断。
 * 用户要求把该品的热搜词尽量列全，超长时把剩下的列在后台清单里。
 */
export function buildHashtags(terms = [], { maxChars = HASHTAG_MAX_CHARS } = {}) {
  const seen = new Set();
  const included = [];
  const dropped = [];
  let value = '';
  for (const item of terms) {
    const term = String(typeof item === 'string' ? item : item?.term ?? '').trim();
    const tag = cleanHashtag(term);
    if (!tag || seen.has(tag)) continue;
    const token = `#${tag}`;
    if (value.length + token.length + (value ? 1 : 0) > maxChars) {
      dropped.push(term);
      continue;
    }
    seen.add(tag);
    value = value ? `${value} ${token}` : token;
    included.push(term);
  }
  return { value, included, dropped };
}

/** 用中文卖点对应的俄语要点拼简介；没有现成俄语简介时兜底生成。 */
export function composeDescriptionRu({ nameRu, bulletsRu = [], specs = [], packageRu = null, usageRu = null } = {}) {
  const lines = [];
  const title = String(nameRu ?? '').trim();
  if (!title) return '';
  lines.push(`${title}.`);
  if (usageRu) lines.push('', usageRu);
  const bullets = bulletsRu.map((item) => String(item).trim()).filter(Boolean);
  if (bullets.length > 0) {
    lines.push('');
    for (const bullet of bullets) lines.push(`— ${bullet}`);
  }
  if (packageRu) lines.push('', `Комплектация: ${packageRu}.`);
  const specLines = specs.map((item) => String(item).trim()).filter(Boolean);
  if (specLines.length > 0) lines.push('', `Характеристики: ${specLines.join('; ')}.`);
  return lines.join('\n');
}

function normalizeAttributeValues(attributes) {
  const byId = new Map();
  for (const attribute of attributes ?? []) {
    const id = Number(attribute.id);
    if (!id) continue;
    const value = String(attribute.value ?? '').trim();
    if (!value) continue;
    const entry = { id, value };
    if (attribute.dictionaryValueId) entry.dictionaryValueId = Number(attribute.dictionaryValueId);
    byId.set(id, entry);
  }
  return byId;
}

function toPayloadAttributes(byId) {
  return [...byId.values()]
    .sort((left, right) => left.id - right.id)
    .map((attribute) => ({
      id: attribute.id,
      values: [
        attribute.dictionaryValueId
          ? { dictionary_value_id: attribute.dictionaryValueId, value: attribute.value }
          : { value: attribute.value },
      ],
    }));
}

function imageUrl(image) {
  return String(image?.url ?? image?.path ?? '').trim();
}

/**
 * 上架装配：把「事实库 + 翻译稿 + 图片 + 关键词」拼成可直接提交的 import 载荷、
 * 库存载荷和后台填写清单。条码缺失时按 offer_id 自动生成 EAN-13。
 */
export function composeListing({ offerId, draft = null, facts, images = [], keywords = null } = {}) {
  if (!facts) throw new Error('composeListing 需要 listing facts（先补 data/listing-facts.json）');
  const slots = draft?.slots ?? {};
  const name = String(facts.nameRu ?? slots.nameRu ?? '').trim();
  if (!name) throw new Error(`${offerId} 缺少俄语标题（facts.nameRu / draft.slots.nameRu）`);

  const hashtags = buildHashtags(facts.hotTerms ?? []);
  const specs = [];
  if (facts.weightG > 0) specs.push(`Вес — ${facts.weightG} г`);
  if (Array.isArray(facts.dimsMm) && facts.dimsMm.length === 3) {
    specs.push(`Габариты — ${facts.dimsMm[0]}×${facts.dimsMm[1]}×${facts.dimsMm[2]} мм`);
  }
  const description = String(
    facts.descriptionRu
      ?? slots.descriptionRu
      ?? composeDescriptionRu({
        nameRu: name,
        bulletsRu: facts.bulletsRu,
        specs,
        packageRu: facts.packageRu,
        usageRu: facts.usageRu,
      })
      ?? '',
  ).trim();

  // 条码交给 Ozon 自动生成（OZN<sku>），本地不再编 EAN-13；只有供应商真实条码才写进 payload。
  const barcode = facts.barcode ? String(facts.barcode).trim() : null;
  const attributes = normalizeAttributeValues(facts.attributes);
  for (const [id, value] of Object.entries(slots.attributesRu ?? {})) {
    const numericId = Number(id);
    if (numericId && value && !attributes.has(numericId)) attributes.set(numericId, { id: numericId, value: String(value) });
  }
  if (facts.weightG > 0) {
    if (!attributes.has(ATTR_WEIGHT)) attributes.set(ATTR_WEIGHT, { id: ATTR_WEIGHT, value: String(facts.weightG) });
    if (!attributes.has(ATTR_PACKAGE_WEIGHT)) {
      attributes.set(ATTR_PACKAGE_WEIGHT, { id: ATTR_PACKAGE_WEIGHT, value: String(facts.packageWeightG ?? facts.weightG) });
    }
  }
  if (hashtags.value) attributes.set(ATTR_HASHTAGS, { id: ATTR_HASHTAGS, value: hashtags.value });
  if (!attributes.has(ATTR_NAME)) attributes.set(ATTR_NAME, { id: ATTR_NAME, value: name });

  const urls = images.map(imageUrl).filter(Boolean);
  const payload = {
    offer_id: offerId,
    name,
    description,
    description_category_id: facts.categoryId ?? null,
    type_id: facts.typeId ?? null,
    price: facts.priceRub != null ? String(facts.priceRub) : null,
    old_price: facts.oldPriceRub != null ? String(facts.oldPriceRub) : null,
    currency_code: 'RUB',
    vat: facts.vat ?? '0',
    weight: facts.weightG ?? null,
    weight_unit: 'g',
    width: facts.dimsMm?.[0] ?? null,
    height: facts.dimsMm?.[1] ?? null,
    depth: facts.dimsMm?.[2] ?? null,
    dimension_unit: 'mm',
    attributes: toPayloadAttributes(attributes),
    images: urls,
    primary_image: urls[0] ?? '',
    ...(barcode ? { barcode } : {}),
  };

  const stockPayload = facts.warehouseId
    ? { stocks: [{ offer_id: offerId, stock: facts.quantity, warehouse_id: facts.warehouseId }] }
    : { stocks: [] };

  const backendMarkdown = renderBackendFields({
    offerId,
    payload,
    facts,
    draft,
    keywords,
    hashtags,
    gaps: listingDataGaps(facts),
  });

  return { payload, stockPayload, backendMarkdown, hashtags, warnings: hashtags.dropped.length > 0 ? ['HASHTAGS_TRUNCATED'] : [] };
}

function formatTermLine(item, index) {
  const term = typeof item === 'string' ? item : item?.term ?? '';
  const volume = typeof item === 'string' ? null : item?.volume;
  return volume == null ? `| ${index} | ${term} | — |` : `| ${index} | ${term} | ${volume.toLocaleString('ru-RU')} |`;
}

/** 后台填写清单：条码/重量/尺寸/数量/标签/简介/属性一次列全，人工照抄即可。 */
export function renderBackendFields({ offerId, payload, facts, draft, keywords = null, hashtags, gaps = [] }) {
  const lines = [];
  lines.push(`# ${offerId} 后台填写清单`, '');
  lines.push('> 由 listing facts 自动生成：条码、重量、尺寸、数量、属性、#Хештеги、简介都已备好，逐项照抄即可。', '');

  lines.push('## 一、基础字段', '', '| 字段 | 值 |', '|---|---|');
  lines.push(`| Штрихкод（条形码） | ${payload.barcode ?? '—（Ozon 自动生成 OZN<sku>）'} |`);
  lines.push(`| Вес（重量） | ${payload.weight ?? '—'} г |`);
  lines.push(`| Габариты, мм | ${[payload.width, payload.height, payload.depth].join(' × ')} |`);
  lines.push(`| Количество（商品数量/库存） | ${facts.quantity} шт |`);
  lines.push(`| Цена, ₽ | ${payload.price ?? '—'} |`);
  if (payload.old_price) lines.push(`| Старая цена, ₽ | ${payload.old_price} |`);
  lines.push(`| Категория / тип | ${payload.description_category_id ?? '—'} / ${payload.type_id ?? '—'} |`, '');

  lines.push('## 二、Название（标题）', '', payload.name, '');

  lines.push('## 三、Аннотация（简介）', '', payload.description || '（缺简介：补 facts.descriptionRu 或 bulletsRu）', '');

  lines.push('## 四、Характеристики（属性，已填 ' + payload.attributes.length + ' 项）', '', '| ID | 属性 | 值 |', '|---|---|---|');
  const attributeNames = new Map(Object.entries(ATTR_NAMES).map(([id, name]) => [Number(id), name]));
  for (const attribute of draft?.constraints?.attributes ?? []) attributeNames.set(Number(attribute.id), attribute.name);
  for (const attribute of payload.attributes) {
    const value = attribute.values?.[0]?.value ?? '';
    lines.push(`| ${attribute.id} | ${attributeNames.get(attribute.id) ?? ''} | ${escapeTableCell(value)} |`);
  }
  lines.push('');

  lines.push(`## 五、标签 / #Хештеги（热点搜索词，共 ${facts.hotTerms.length} 个）`, '');
  lines.push(`| # | 搜索词 | 搜索量/月 |`, '|---|---|---|');
  facts.hotTerms.forEach((item, index) => lines.push(formatTermLine(item, index + 1)));
  lines.push('', '**复制到后台「#Хештеги」**：', '', '```', hashtags.value || '（无）', '```', '');
  if (hashtags.dropped.length > 0) {
    lines.push(`> #Хештеги 已按 ${HASHTAG_MAX_CHARS} 字符截断，以下词未能写进属性，请缩短后手动补：`);
    lines.push(...hashtags.dropped.slice(0, 30).map((term) => `- ${term}`));
    lines.push('');
  }

  if (keywords) {
    lines.push('## 六、关键词包（广告搜索词判定）', '');
    if (keywords.titleCandidates?.length) {
      lines.push('**标题补充**（当前不在标题里、且词在赚钱/属漏词）：', '');
      for (const term of keywords.titleCandidates) lines.push(`- ${term}`);
      lines.push('');
    }
    if (keywords.backendKeywords?.length) {
      lines.push('**后台关键词**：', '', '```', keywords.backendKeywords.join(', '), '```', '');
    }
    if (keywords.avoid?.length) {
      lines.push('**不要用**（词或商品卡不匹配/无说服力）：', '');
      for (const term of keywords.avoid) lines.push(`- ${term}`);
      lines.push('');
    }
  }

  if (gaps.length > 0) {
    lines.push('## 待补数据（补齐后重新生成）', '');
    for (const gap of gaps) lines.push(`- ${gap}`);
    lines.push('');
  }

  return lines.join('\n');
}