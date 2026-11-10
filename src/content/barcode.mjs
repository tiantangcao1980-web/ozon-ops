/**
 * 条形码生成与校验：Ozon 商品卡「Штрихкод」字段需要 8–13 位条码。
 * 没有 GS1 注册码时用 EAN-13 内部码段（前缀 20–29）自己生成，校验位按 GS1 规则计算，
 * 同一 offer 永远得到同一个码，避免重复上架时条码漂移。
 */
const INTERNAL_PREFIX = '20';

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** GS1 校验位：前 12 位 → 第 13 位。 */
export function ean13CheckDigit(first12) {
  const digits = String(first12);
  if (!/^\d{12}$/.test(digits)) throw new Error('EAN-13 校验位需要 12 位数字');
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number(digits[index]);
    sum += index % 2 === 0 ? digit : digit * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code) {
  const digits = String(code ?? '');
  if (!/^\d{13}$/.test(digits)) return false;
  return ean13CheckDigit(digits.slice(0, 12)) === digits[12];
}

/**
 * 由 offer_id 派生稳定的 EAN-13 内部条码。
 * 10 位随机体来自两轮 FNV（含旋转），碰撞概率对单品级数量可忽略。
 */
export function generateEan13(seed, { prefix = INTERNAL_PREFIX } = {}) {
  const text = String(seed ?? '').trim() || 'ozon';
  const first = fnv1a(text);
  const second = fnv1a(rotateLeft(first, 13) ^ 0x9e3779b9 ^ text.length);
  const body10 = String(((BigInt(first) << 32n) | BigInt(second)) % 10000000000n).padStart(10, '0');
  const head = String(prefix).replace(/\D/g, '').padStart(2, '0').slice(0, 2);
  const body = (head + body10).slice(0, 12).padEnd(12, '0');
  return body + ean13CheckDigit(body);
}