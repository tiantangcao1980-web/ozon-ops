// 合规抓取守则的最小实现：随机间隔 / 指数退避 / 熔断
// 用法: import { jitter, backoff, CircuitBreaker, guarded } from './lib/polite.mjs'
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 随机间隔：base 附近 ±40% 抖动，避免固定节拍 */
export function jitter(base = 2500) {
  const lo = base * 0.6, hi = base * 1.4;
  return sleep(Math.round(lo + Math.random() * (hi - lo)));
}

/** 指数退避：2s, 4s, 8s ... 上限 60s */
export function backoff(attempt, capMs = 60000) {
  const ms = Math.min(capMs, 2000 * Math.pow(2, Math.max(0, attempt)));
  return sleep(ms + Math.random() * 500);
}

/** 熔断器：命中挑战/403/429 连续 failLimit 次即断开，冷却 cooldownMs */
export class CircuitBreaker {
  constructor({ failLimit = 1, cooldownMs = 30 * 60 * 1000, name = 'default' } = {}) {
    this.failLimit = failLimit; this.cooldownMs = cooldownMs; this.name = name;
    this.fails = 0; this.openedAt = 0; this.tripped = false;
  }
  get isOpen() { return this.tripped && Date.now() - this.openedAt < this.cooldownMs; }
  trip(reason) { this.tripped = true; this.openedAt = Date.now(); console.error('[circuit:' + this.name + '] OPEN — ' + reason); }
  ok() { this.fails = 0; }
  fail(reason) { this.fails++; if (this.fails >= this.failLimit) this.trip(reason); }
  assertClosed() { if (this.isOpen) throw new Error('circuit open: ' + this.name + '，冷却 ' + Math.round((this.cooldownMs - (Date.now() - this.openedAt)) / 1000) + 's'); }
}

/** 把一次请求包进守则：熔断检查 → 执行 → 结果分类 → 抖动 */
export async function guarded(cb, fn, { baseDelay = 2500, classify } = {}) {
  cb.assertClosed();
  const t0 = Date.now();
  let res;
  try { res = await fn(); } catch (e) { cb.fail('throw ' + e.message); throw e; }
  const verdict = classify ? classify(res) : 'ok';
  if (verdict !== 'ok') { cb.fail(verdict); throw new Error('guard trip: ' + verdict); }
  const ms = Date.now() - t0;
  if (ms > 10000) console.error('[guard] 单请求 ' + ms + 'ms，疑似限速，建议停手');
  cb.ok();
  await jitter(baseDelay);
  return res;
}
