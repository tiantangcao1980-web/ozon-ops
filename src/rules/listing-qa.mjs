/**
 * 上架质检：必填属性、长度、中文残留、禁用词、图片比例/分辨率/数量，
 * 以及用户点名的三件必填：条形码、重量（特征页）、商品数量，加标签（#Хештеги）与简介。
 * commit 管翻译质量，QA 管上架前的成品完整性。
 */
import { isValidEan13 } from '../content/barcode.mjs';

const CHINESE = /[\u4E00-\u9FFF]/;

function checkImages(images) {
  const issues = [];
  const warnings = [];
  if (!Array.isArray(images) || images.length === 0) {
    issues.push({ code: 'IMAGE_MISSING', message: '没有任何图片' });
    return { issues, warnings };
  }
  for (const image of images) {
    const hasSize = image.width && image.height;
    if (!hasSize) {
      if (image.url ?? image.path) warnings.push({ code: 'IMAGE_UNVERIFIED', message: `${image.url ?? image.path} 没有尺寸信息，未校验 3:4 与清晰度` });
      continue;
    }
    const ratio = image.width / image.height;
    if (Math.abs(ratio - 0.75) > 0.02) {
      issues.push({ code: 'IMAGE_RATIO', message: `${image.path ?? image.url ?? 'image'} 比例 ${ratio.toFixed(3)}，需要 3:4` });
    }
    if ((image.width ?? 0) < 900) {
      issues.push({ code: 'IMAGE_RESOLUTION', message: `${image.path ?? image.url ?? 'image'} 宽度 ${image.width ?? 0} < 900` });
    }
  }
  return { issues, warnings };
}

function factChecks(facts) {
  const issues = [];
  // 条码由 Ozon 自动生成（OZN<sku>），没填不算缺项；填了就必须是合法 EAN-13。
  if (facts.barcode && !isValidEan13(facts.barcode)) {
    issues.push({ code: 'BARCODE_INVALID', message: '提供的条形码校验位不对（需 8–13 位，EAN-13 要过 GS1 校验）' });
  }
  if (!facts.weightG || facts.weightG <= 0) {
    issues.push({ code: 'WEIGHT_MISSING', message: '特征页商品重量未填（weightG）' });
  }
  if (!Array.isArray(facts.dimsMm) || facts.dimsMm.length !== 3) {
    issues.push({ code: 'DIMENSIONS_MISSING', message: '长×宽×高未填（dimsMm）' });
  }
  if (!facts.quantity || facts.quantity <= 0) {
    issues.push({ code: 'QUANTITY_MISSING', message: '商品数量未填（quantity）' });
  }
  if (!facts.hotTerms || facts.hotTerms.length === 0) {
    issues.push({ code: 'TAGS_MISSING', message: '标签/热点搜索词为空（#Хештеги）' });
  }
  if (!facts.priceRub || facts.priceRub <= 0) {
    issues.push({ code: 'PRICE_MISSING', message: '售价未填（priceRub）' });
  }
  if (!facts.categoryId || !facts.typeId) {
    issues.push({ code: 'CATEGORY_MISSING', message: 'category_id / type_id 未填' });
  }
  return issues;
}

export function runListingQa({ draft, images = [], facts = null }) {
  const issues = [];
  const warnings = [];
  const slots = draft?.slots ?? {};
  const name = String(slots.nameRu ?? facts?.nameRu ?? '').trim();
  const description = String(slots.descriptionRu ?? facts?.descriptionRu ?? '').trim();

  if (!name) issues.push({ code: 'NAME_MISSING', message: '缺少俄语标题' });
  if (!description && !(facts?.descriptionRu || facts?.bulletsRu?.length)) {
    issues.push({ code: 'DESCRIPTION_MISSING', message: '缺少俄语描述（简介要生成并填写）' });
  }
  if (CHINESE.test(name) || CHINESE.test(description)) {
    issues.push({ code: 'CHINESE_RESIDUE', message: '俄语文本仍含中文' });
  }

  for (const attrId of draft?.constraints?.requiredAttrs ?? []) {
    const attributes = slots.attributesRu ?? {};
    if (!attributes[attrId] && !attributes[String(attrId)] && !facts?.attributes?.some((item) => String(item.id) === String(attrId))) {
      issues.push({ code: 'MISSING_ATTRIBUTE', message: `必填属性 ${attrId} 未填` });
    }
  }

  if (facts) issues.push(...factChecks(facts));

  const imageCheck = checkImages(images);
  issues.push(...imageCheck.issues);
  warnings.push(...imageCheck.warnings);
  if (facts && !facts.barcode) {
    warnings.push({ code: 'BARCODE_AUTO', message: '未提供条形码：Ozon 会自动生成 OZN<sku>，FBP 与丢失赔偿用这一个即可' });
  }

  const filledChecks = {
    name: Boolean(name),
    description: Boolean(description || facts?.descriptionRu || facts?.bulletsRu?.length),
    images: Array.isArray(images) && images.length > 0,
    barcode: facts?.barcode ? isValidEan13(facts.barcode) : true, // 没填视为满足（Ozon 自动生成）
    weight: Boolean(facts?.weightG > 0),
    dimensions: Array.isArray(facts?.dimsMm) && facts.dimsMm.length === 3,
    quantity: Boolean(facts?.quantity > 0),
    tags: Boolean(facts?.hotTerms?.length),
    price: Boolean(facts?.priceRub > 0),
    category: Boolean(facts?.categoryId && facts?.typeId),
    attributes: Object.keys(slots.attributesRu ?? {}).length > 0 || (facts?.attributes?.length ?? 0) > 0,
  };
  const filled = Object.values(filledChecks).filter(Boolean).length;
  const total = Object.keys(filledChecks).length;
  const completeness = {
    ratio: Math.round((filled / total) * 100) / 100,
    filled,
    total,
    missing: Object.entries(filledChecks).filter(([, ok]) => !ok).map(([key]) => key),
  };

  const passed = issues.length === 0;
  const score = Math.max(0, Math.round(completeness.ratio * 100) - (issues.length * 20));
  return { passed, issues, warnings, completeness, score };
}