/**
 * 单位经济：OGL 六档费率（CNY）+ 平台佣金 + 收单 + 退货计提 + 广告。
 *
 * 费率来源：Ozon-OGL真实费率与选品边界-20261106.md（E 级：公开资料二次引用），
 * 拿到后台费率页后应替换 FEE_TABLE 并升级 rate_confidence。
 * 计费重：Big / Premium Big 取 max(实重, 长×宽×高(cm)/12) 克；其余档用实重。
 * 电子服务费：min(200, max(15, 货值RUB × 2%))，按汇率折 CNY。
 */
export const FEE_TABLE = {
  extra_small: { label: 'Extra Small', fix: 2.9, perGram: 0.0247, volumetric: false },
  budget: { label: 'Budget', fix: 22.25, perGram: 0.0164, volumetric: false },
  small: { label: 'Small', fix: 15.48, perGram: 0.0242, volumetric: false },
  big: { label: 'Big', fix: 34.82, perGram: 0.0164, volumetric: true },
  premium_small: { label: 'Premium Small', fix: 21.28, perGram: 0.0242, volumetric: false },
  premium_big: { label: 'Premium Big', fix: 59.97, perGram: 0.0222, volumetric: true },
};

export const RATE_CONFIDENCE = 'E';

/** 汇率/价格/重量不合法时抛这个，让选品层转成 HOLD，而不是算出 NaN/Infinity。 */
export class EconomicsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EconomicsError';
    this.code = code;
  }
}

export const FX_MIN = 1;
export const FX_MAX = 100;

export function assertValidFx(fx) {
  if (!Number.isFinite(fx) || fx <= 0) throw new EconomicsError('INVALID_FX', `汇率必须是正数，收到 ${fx}`);
  if (fx < FX_MIN || fx > FX_MAX) throw new EconomicsError('INVALID_FX', `汇率 ${fx} 超出合理区间 ${FX_MIN}–${FX_MAX}（RUB/CNY）`);
  return fx;
}
const MAX_PRICE_CNY = 22_525;
const MAX_WEIGHT_G = 35_000;

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * @param {{priceCny: number, actualWeightG: number}} input
 * @returns {{tier: keyof typeof FEE_TABLE}}
 */
export function selectTier({ priceCny, actualWeightG }) {
  if (!(priceCny > 0)) throw new RangeError('货值必须大于 0');
  if (!(actualWeightG > 0)) throw new RangeError('实重必须大于 0');
  if (priceCny > MAX_PRICE_CNY) throw new RangeError(`货值 ${priceCny} 超过 OGL 上限 ¥${MAX_PRICE_CNY}`);
  if (actualWeightG > MAX_WEIGHT_G) throw new RangeError(`实重 ${actualWeightG} g 超过 OGL 上限 ${MAX_WEIGHT_G} g`);

  if (priceCny <= 135) return { tier: actualWeightG <= 500 ? 'extra_small' : 'budget' };
  if (priceCny <= 635) return { tier: actualWeightG <= 2000 ? 'small' : 'big' };
  return { tier: actualWeightG <= 5000 ? 'premium_small' : 'premium_big' };
}

export function volumetricWeightG({ l, w, h }) {
  if (!(l > 0 && w > 0 && h > 0)) throw new RangeError('箱规三边必须大于 0');
  return (l * w * h) / 12;
}

/**
 * @param {{
 *   priceCny: number, fxRubPerCny: number,
 *   purchaseCny: number, domesticFreightCny: number, packagingCny: number,
 *   actualWeightG: number, dimsCm: {l: number, w: number, h: number},
 *   commissionRate?: number, acquiringRate?: number, returnRate?: number, adRate?: number,
 * }} input
 */
export function computeUnitEconomics(input) {
  const {
    priceCny,
    fxRubPerCny,
    purchaseCny = 0,
    domesticFreightCny = 0,
    packagingCny = 0,
    actualWeightG,
    dimsCm,
    acquiringRate = 0.0015,
    returnRate = 0.08,
    adRate = 0.12,
  } = input;

  assertValidFx(fxRubPerCny);
  if (!Number.isFinite(priceCny) || priceCny <= 0) throw new EconomicsError('INVALID_PRICE', `售价必须是正数，收到 ${priceCny}`);
  if (!Number.isFinite(actualWeightG) || actualWeightG <= 0) {
    throw new EconomicsError('INVALID_WEIGHT', `实重必须是正数（克），收到 ${actualWeightG}`);
  }

  const { tier } = selectTier({ priceCny, actualWeightG });
  const table = FEE_TABLE[tier];
  const volumeG = volumetricWeightG(dimsCm);
  const chargeableG = table.volumetric ? Math.max(actualWeightG, volumeG) : actualWeightG;

  const logisticsCny = round2(table.fix + table.perGram * chargeableG);
  const electronicFeeRub = Math.min(200, Math.max(15, priceCny * fxRubPerCny * 0.02));
  const electronicFeeCny = round2(electronicFeeRub / fxRubPerCny);

  const commissionAssumed = input.commissionRate == null;
  const commissionRate = commissionAssumed ? 0.17 : input.commissionRate;
  const commissionCny = round2(priceCny * commissionRate);
  const acquiringCny = round2(priceCny * acquiringRate);
  const returnCny = round2(priceCny * returnRate);
  const adCny = round2(priceCny * adRate);

  const totalCostCny = round2(
    purchaseCny + domesticFreightCny + packagingCny + logisticsCny + electronicFeeCny + commissionCny + acquiringCny + returnCny + adCny,
  );
  const contributionCny = round2(priceCny - totalCostCny);
  const contributionRate = round2((contributionCny / priceCny) * 100) / 100;

  return {
    tier,
    tierLabel: table.label,
    chargeableG,
    volumeG: round2(volumeG),
    logisticsCny,
    electronicFeeCny,
    commissionCny,
    commissionRate,
    acquiringCny,
    returnCny,
    adCny,
    totalCostCny,
    contributionCny,
    contributionRate,
    priceWeightRatio: round2(priceCny / chargeableG),
    labels: {
      rate_confidence: RATE_CONFIDENCE,
      ...(commissionAssumed ? { commission_assumed: 17 } : {}),
    },
  };
}
