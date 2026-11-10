import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { isChallenge } from './ozon-front.mjs';

const require = createRequire(import.meta.url);
const FALLBACK_PLAYWRIGHT = process.env.PLAYWRIGHT_RUNTIME_DIR || '';

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    if (FALLBACK_PLAYWRIGHT && existsSync(FALLBACK_PLAYWRIGHT)) return require(FALLBACK_PLAYWRIGHT);
    throw new Error('找不到 playwright：请在项目内 npm i playwright，或设置 PLAYWRIGHT_RUNTIME_DIR');
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  constructor({ minIntervalMs = 4000, jitterMs = 1500 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.jitterMs = jitterMs;
    this.last = 0;
  }

  async wait(now = Date.now(), sleepImpl = sleep) {
    const target = this.last + this.minIntervalMs + Math.floor(Math.random() * this.jitterMs);
    if (this.last && now < target) await sleepImpl(target - now);
    this.last = now + (this.last && now < target ? target - now : 0);
  }
}

/**
 * 打开持久浏览器会话（复用挑战通过的 cookie）。
 * @param {{userDataDir?: string, headless?: boolean, channel?: string}} [options]
 */
export async function openSession({ userDataDir = join(process.cwd(), 'data', 'browser-profile'), headless = true, channel } = {}) {
  const { chromium } = loadPlaywright();
  mkdirSync(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    channel,
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = context.pages()[0] ?? (await context.newPage());

  async function goto(url, { challengeTimeoutMs = 30_000 } = {}) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const started = Date.now();
    while (Date.now() - started < challengeTimeoutMs) {
      const title = await page.title().catch(() => '');
      if (!isChallenge({ title, url: page.url() })) return { title, url: page.url() };
      await sleep(1500);
    }
    throw new Error(`Ozon 反爬挑战未通过：${page.url()}`);
  }

  async function extract(fn) {
    return page.evaluate(fn);
  }

  return {
    page,
    context,
    goto,
    extract,
    close: () => context.close(),
  };
}

export const SEARCH_CARDS_JS = () => {
  const links = Array.from(document.querySelectorAll('a[href*="/product/"]'));
  const seen = new Set();
  const items = [];
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const match = href.match(/\/product\/([^/?#]+-)?(\d+)/) || href.match(/\/product\/(\d+)/);
    const slug = href.split('/product/')[1]?.split('/')[0] ?? '';
    const sku = (slug.match(/(\d{6,})$/) || [])[1];
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const card = a.closest('[data-index]') || a.closest('div');
    const text = (card?.innerText || a.innerText || '').replace(/\s+/g, ' ').trim();
    items.push({ sku, text, url: new URL(href, location.origin).toString().split('?')[0] });
    if (items.length >= 60) break;
  }
  return items;
};

export const REVIEWS_JS = () => {
  const nodes = Array.from(document.querySelectorAll('[data-widget="webListReviews"] [data-review-uuid], [data-widget="webListReviews"] > div > div'));
  const out = [];
  for (const node of nodes) {
    const text = node.innerText?.replace(/\s+/g, ' ').trim() ?? '';
    if (text.length < 10) continue;
    const id = node.getAttribute('data-review-uuid') || '';
    const ratingMatch = text.match(/([0-5](?:[.,]\d)?)\s*(?:из\s*5|Оценка)?/);
    out.push({ id, text: text.slice(0, 1200), raw: text, rating: ratingMatch?.[1] ?? '' });
  }
  return out;
};
