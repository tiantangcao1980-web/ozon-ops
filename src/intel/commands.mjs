import { createHash } from 'node:crypto';
import { parseCardText, parseReviewItems, searchUrl, reviewsUrl } from './ozon-front.mjs';
import { analyzePainPoints } from './pains.mjs';
import { fetchSuggestions, fetchTelegramChannel } from './social.mjs';
import { saveDemandSignals, saveSocialPosts } from './store.mjs';
import { saveCompetitors, saveReviews } from './store.mjs';
import { SEARCH_CARDS_JS, REVIEWS_JS, RateLimiter, sleep } from './browser.mjs';

export const DEFAULT_DELAY_MS = 4000;

export async function runIntelSearch({ session, db, query, pages = 2, delayMs = DEFAULT_DELAY_MS, now = () => new Date().toISOString() }) {
  const limiter = new RateLimiter({ minIntervalMs: delayMs });
  const capturedAt = now();
  const collected = [];
  let fetchedPages = 0;

  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) await limiter.wait();
    await session.goto(searchUrl(query, page));
    const raw = await session.extract(SEARCH_CARDS_JS);
    fetchedPages += 1;
    for (const card of raw ?? []) {
      const parsed = parseCardText(card.text ?? '');
      if (!parsed.title) continue;
      collected.push({ sku: card.sku, url: card.url, ...parsed });
    }
    if ((raw ?? []).length === 0) break;
  }

  saveCompetitors(db, collected, { keyword: query, capturedAt });
  return { pages: fetchedPages, items: collected.length, sample: collected.slice(0, 3) };
}

export async function runIntelReviews({ session, db, sku, pages = 5, delayMs = DEFAULT_DELAY_MS, now = () => new Date().toISOString() }) {
  const limiter = new RateLimiter({ minIntervalMs: delayMs });
  const capturedAt = now();
  let fetchedPages = 0;
  let inserted = 0;
  let skipped = 0;

  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) await limiter.wait();
    await session.goto(reviewsUrl(sku, page));
    const raw = await session.extract(REVIEWS_JS);
    fetchedPages += 1;
    const reviews = parseReviewItems((raw ?? []).map((item) => ({ id: item.id, text: item.raw ?? item.text, rating: item.rating })));
    const result = saveReviews(db, sku, reviews, { capturedAt, url: reviewsUrl(sku, page) });
    inserted += result.inserted;
    skipped += result.skipped;
    if (reviews.length === 0) break;
  }

  return { pages: fetchedPages, inserted, skipped };
}

export function ingestSearch({ db, query, raw, capturedAt = new Date().toISOString() }) {
  const items = [];
  for (const card of raw ?? []) {
    if (!card?.sku) continue;
    const parsed = parseCardText(card.text ?? '');
    if (!parsed.title) continue;
    items.push({ sku: String(card.sku), url: card.url ?? null, ...parsed });
  }
  saveCompetitors(db, items, { keyword: query, capturedAt });
  return { items: items.length };
}

export function ingestReviews({ db, sku, raw, capturedAt = new Date().toISOString() }) {
  const reviews = parseReviewItems(
    (raw ?? []).map((item) => {
      const text = item.text ?? item.raw ?? '';
      const hash = createHash('sha1').update(`${sku}|${text}|${item.rating ?? ''}`).digest('hex').slice(0, 16);
      return { id: item.id || `h-${hash}`, text, rating: item.rating };
    }),
  );
  const result = saveReviews(db, String(sku), reviews, { capturedAt });
  return { ...result, total: reviews.length };
}

export function runIntelPains({ db, sku, niche, now = () => new Date().toISOString() }) {
  const reviews = db.db.prepare('SELECT text, rating FROM reviews_raw WHERE sku = ?').all(String(sku));
  const themes = analyzePainPoints(reviews);
  const generatedAt = now();
  db.db.prepare('DELETE FROM pain_points WHERE niche = ?').run(niche);
  for (const item of themes) {
    db.db
      .prepare('INSERT INTO pain_points (niche, theme, count, sample_reviews_json, generated_at) VALUES (?, ?, ?, ?, ?)')
      .run(niche, item.theme, item.count, JSON.stringify({ negative: item.negative, samples: item.samples }), generatedAt);
  }
  return themes;
}
export async function runDemand({ db, seeds, get, capturedAt = new Date().toISOString() }) {
  const seen = new Set();
  for (const seed of seeds ?? []) {
    const suggestions = await fetchSuggestions(seed, { get });
    for (const keyword of suggestions) {
      if (seen.has(keyword)) continue;
      seen.add(keyword);
      saveDemandSignals(db, [{ keyword, raw: { seed } }], { source: 'yandex-suggest', capturedAt });
    }
  }
  return { keywords: seen.size };
}

export async function runSocial({ db, channels, get, proxy = null, capturedAt = new Date().toISOString() }) {
  let total = 0;
  for (const channel of channels ?? []) {
    const posts = await fetchTelegramChannel(channel, { proxy, get });
    const { inserted } = saveSocialPosts(db, posts, { source: 'telegram', capturedAt });
    total += inserted;
  }
  return { posts: total };
}
export function buildEvidence({ db, candidateId, keyword, sku }) {
  const competitors = db.db.prepare('SELECT * FROM competitors WHERE keyword = ?').all(keyword);
  const reviews = db.db.prepare('SELECT text, rating FROM reviews_raw WHERE sku = ?').all(String(sku));
  const painThemes = analyzePainPoints(reviews);

  const cardsTotal = competitors.length;
  const cards100plus = competitors.filter((row) => Number(row.reviews ?? 0) >= 100).length;
  const prices = competitors.map((row) => Number(row.price_rub)).filter((value) => Number.isFinite(value) && value > 0);
  const avgPrice = prices.length ? Math.round((prices.reduce((sum, value) => sum + value, 0) / prices.length) * 100) / 100 : null;
  const sellers = new Set(competitors.map((row) => row.seller).filter(Boolean));
  const totalReviews = competitors.reduce((sum, row) => sum + Number(row.reviews ?? 0), 0);
  const topReviews = Math.max(0, ...competitors.map((row) => Number(row.reviews ?? 0)));
  const topShare = totalReviews > 0 ? Math.round((topReviews / totalReviews) * 100) / 100 : null;

  const evidence = {
    ru_query: keyword,
    cards_total: cardsTotal,
    cards_100plus: cards100plus,
    cards_recent_reviews: null,
    avg_price_rub: avgPrice,
    sellers_count: sellers.size,
    top_share: topShare,
    review_sample_size: reviews.length,
    pains: painThemes.map((item) => ({ theme: item.theme, count: item.count, negative: item.negative })),
  };

  db.db
    .prepare('UPDATE candidates SET evidence_json = ?, verdict = ? WHERE id = ?')
    .run(JSON.stringify([evidence]), 'EVIDENCE_READY', candidateId);
  return { evidence };
}