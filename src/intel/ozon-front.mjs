/**
 * Ozon 前台解析器：把抓到的卡片文本 / 评论 DOM 片段转成结构化记录。
 * 纯函数，不碰网络与浏览器，便于单测；浏览器驱动见 browser.mjs。
 */

export function parsePriceRub(text) {
  if (!text) return null;
  const match = String(text).match(/(\d[\d\s]*)(?:[,.](\d{1,2}))?\s*₽/);
  if (!match) return null;
  const whole = Number(match[1].replace(/\s/g, ''));
  if (!Number.isFinite(whole)) return null;
  const cents = match[2] ? Number(`0.${match[2]}`) : 0;
  return Math.round((whole + cents) * 100) / 100;
}

export function parseRating(text) {
  const value = String(text ?? '');
  const match = value.match(/([0-5][.,]\d)\s*([\d\s]*)\s*отзыв/i) ?? value.match(/([0-5][.,]\d)\s+([\d\s]+)$/);
  if (!match) return { rating: null, reviews: null };
  const rating = Number(match[1].replace(',', '.'));
  const reviews = match[2] ? Number(match[2].replace(/\s/g, '')) : null;
  return { rating, reviews: Number.isFinite(reviews) ? reviews : null };
}

/**
 * @param {string} text 卡片 innerText（已压平空白）
 * @returns {{priceRub: number|null, oldPriceRub: number|null, discountPct: number|null, rating: number|null, reviews: number|null, title: string}}
 */
export function parseCardText(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const prices = [...flat.matchAll(/(\d[\d\s]*)(?:[,.](\d{1,2}))?\s*₽/g)].map((match) => {
    const whole = Number(match[1].replace(/\s/g, ''));
    const cents = match[2] ? Number(`0.${match[2]}`) : 0;
    return Math.round((whole + cents) * 100) / 100;
  });
  const discount = flat.match(/−\s*(\d{1,3})\s*%/);
  const { rating, reviews } = parseRating(flat);

  let title = flat;
  if (discount) title = title.slice(title.indexOf(discount[0]) + discount[0].length);
  if (/Стало дешевле|Вау-цены|Распродажа/.test(title)) {
    title = title.replace(/^(Стало дешевле|Вау-цены|Распродажа)\s*/u, '');
  }
  if (rating != null) {
    const ratingIndex = title.search(/([0-5][.,]\d)\s*[\d\s]*\s*отзыв/);
    if (ratingIndex > 0) title = title.slice(0, ratingIndex);
  }
  title = title.replace(/^\d[\d\s₽,.]*/, '').trim();
  title = title.replace(/\s+(За|Послезавтра|Завтра|Сегодня)\b.*$/u, '').trim();

  return {
    priceRub: prices[0] ?? null,
    oldPriceRub: prices[1] ?? null,
    discountPct: discount ? Number(discount[1]) : null,
    rating,
    reviews,
    title: title.slice(0, 200),
  };
}

export function isChallenge({ title = '', url = '' } = {}) {
  const text = `${title} ${url}`;
  return /Antibot Challenge|Доступ ограничен|Проверка на робота/i.test(text);
}

export function parseReviewItems(items = []) {
  return (items ?? [])
    .map((item, index) => ({
      reviewId: String(item?.id || `anon-${index}-${(item?.text ?? '').length}`),
      author: String(item?.author ?? '').trim(),
      date: String(item?.date ?? '').trim(),
      rating: Number(item?.rating) || null,
      text: String(item?.text ?? '').trim(),
      hasPhoto: Number(item?.photos) > 0,
    }))
    .filter((review) => review.text.length > 0);
}

export function searchUrl(query, page = 1) {
  const base = `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`;
  return page > 1 ? `${base}&page=${page}` : base;
}

export function reviewsUrl(sku, page = 1) {
  const base = `https://www.ozon.ru/product/${sku}/reviews/`;
  return page > 1 ? `${base}?page=${page}` : base;
}
