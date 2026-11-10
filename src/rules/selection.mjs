import { computeUnitEconomics } from './economics.mjs';

/**
 * 选品硬筛（来自 Ozon-OGL真实费率与选品边界 与 新店选品执行表）：
 * - 形态：非带电/液体/膏体/粉末/易碎玻璃/超大件
 * - 通道：A 实重 ≤500g 且售价 ¥40–135；B 实重 300–2000g 且售价 ¥135–635
 * - 禁入：售价 <¥40；501–2000g 且售价 ≤¥135（Budget 陷阱）；实重 >2000g；抛货（体积重 > 实重×1.2）
 * - 价重比 ≥0.30 才可做，<0.30 淘汰
 */
const FORBIDDEN_FORMS = new Map([
  ['battery', '带电'],
  ['liquid', '液体/膏体/粉末'],
  ['cosmetic', '化妆品'],
  ['food', '食品接触/医疗'],
  ['glass', '易碎玻璃'],
  ['ip', 'IP/品牌仿品'],
]);

const MIN_PRICE_CNY = 40;
const MAX_PRICE_CNY = 635;
const MAX_WEIGHT_G = 2000;
const MAX_VOLUMETRIC_RATIO = 1.2;

function checkHardFilters(candidate, economics) {
  const blockers = [];
  const forbidden = FORBIDDEN_FORMS.get(candidate.form);
  if (forbidden) blockers.push(`禁入形态：${forbidden}`);
  if (candidate.priceCny < MIN_PRICE_CNY) blockers.push(`售价 ¥${candidate.priceCny} < ¥${MIN_PRICE_CNY}`);
  if (candidate.priceCny > MAX_PRICE_CNY) blockers.push(`售价 ¥${candidate.priceCny} 超出首轮价格带上限 ¥${MAX_PRICE_CNY}`);
  if (candidate.actualWeightG > MAX_WEIGHT_G) blockers.push(`实重 ${candidate.actualWeightG} g 超过首轮上限 ${MAX_WEIGHT_G} g`);
  if (candidate.actualWeightG > 500 && candidate.actualWeightG <= 2000 && candidate.priceCny <= 135) {
    blockers.push('Budget 陷阱区：501–2000 g 且售价 ≤¥135，固定费跳档');
  }
  const volumeRatio = economics ? economics.volumeG / candidate.actualWeightG : 0;
  if (volumeRatio > MAX_VOLUMETRIC_RATIO) blockers.push(`抛货：体积重 ${economics.volumeG} g 超过实重 ${candidate.actualWeightG} g 的 ${MAX_VOLUMETRIC_RATIO} 倍`);
  if (economics && economics.priceWeightRatio < 0.3) blockers.push(`价重比 ${economics.priceWeightRatio} < 0.30`);
  return blockers;
}

function scoreCandidate(economics, evidence) {
  let score = 0;
  score += Math.min(40, Math.max(0, economics.contributionRate * 100 * 1.6));
  score += Math.min(25, Math.max(0, (economics.priceWeightRatio - 0.3) * 125));
  if (evidence) {
    const demand = Math.min(20, (Number(evidence.cards_100plus ?? 0) / 10) * 20);
    const competition = Math.min(15, Math.max(0, (1 - Number(evidence.top_share ?? 1)) * 15));
    score += demand + competition;
  }
  return Math.round(Math.min(100, score));
}

/**
 * @param {object} candidate {niche, ruQuery, priceCny, actualWeightG, dimsCm, form, purchaseCny, evidence?}
 * @param {object} settings {fxRubPerCny, purchaseCny, domesticFreightCny, packagingCny, commissionRate}
 */
export function evaluateCandidate(candidate, settings) {
  let economics;
  try {
    economics = computeUnitEconomics({
      priceCny: candidate.priceCny,
      actualWeightG: candidate.actualWeightG,
      dimsCm: candidate.dimsCm,
      fxRubPerCny: settings.fxRubPerCny,
      purchaseCny: candidate.purchaseCny ?? settings.purchaseCny ?? 0,
      domesticFreightCny: candidate.domesticFreightCny ?? settings.domesticFreightCny ?? 0,
      packagingCny: candidate.packagingCny ?? settings.packagingCny ?? 0,
      commissionRate: settings.commissionRate,
    });
  } catch (error) {
    // 汇率/价格/重量不合法时不给数字，直接 HOLD 并说明缺什么
    return {
      verdict: 'HOLD',
      score: null,
      blockers: [],
      gaps: [error?.code === 'INVALID_FX' ? 'fx_invalid' : 'invalid_input'],
      economics: null,
      error: { code: error?.code ?? 'INVALID_INPUT', message: String(error?.message ?? error) },
    };
  }

  const blockers = checkHardFilters(candidate, economics);
  const gaps = [];
  if (!candidate.evidence) gaps.push('market_evidence');
  if (economics.labels.rate_confidence === 'E') gaps.push('rate_check');
  if (economics.labels.commission_assumed) gaps.push('commission_check');

  const contribution = economics.contributionRate;
  if (contribution < 0.1) blockers.push(`单件贡献 ${(contribution * 100).toFixed(1)}% < 10%`);

  let verdict;
  if (blockers.length > 0) verdict = 'REJECT';
  else if (economics.labels.commission_assumed) verdict = 'HOLD';
  else if (contribution < 0.2) {
    verdict = 'HOLD';
    if (!gaps.includes('contribution_grey')) gaps.push('contribution_grey');
  } else if (!candidate.evidence) {
    verdict = 'HOLD';
  } else verdict = 'TRY';

  return {
    verdict,
    score: scoreCandidate(economics, candidate.evidence),
    blockers,
    gaps,
    economics,
  };
}
