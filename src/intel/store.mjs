/**
 * 市场情报落库：竞品、竞品快照、评论、社媒帖子、需求信号、痛点。
 * 只做 upsert / insert-or-ignore，幂等；供 intel 命令调用。
 */

export function saveCompetitors(db, items, { keyword, capturedAt = new Date().toISOString() }) {
  for (const item of items ?? []) {
    if (!item?.sku) continue;
    db.upsert(
      'competitors',
      {
        sku: item.sku,
        title: item.title ?? null,
        seller: item.seller ?? null,
        url: item.url ?? null,
        price_rub: item.priceRub ?? null,
        old_price_rub: item.oldPriceRub ?? null,
        discount_pct: item.discountPct ?? null,
        rating: item.rating ?? null,
        reviews: item.reviews ?? null,
        keyword,
        first_seen: capturedAt,
        last_seen: capturedAt,
      },
      ['sku'],
    );
    db.upsert(
      'competitor_snapshots',
      {
        sku: item.sku,
        keyword,
        price_rub: item.priceRub ?? null,
        rating: item.rating ?? null,
        reviews: item.reviews ?? null,
        stock_hint: item.stockHint ?? null,
        captured_at: capturedAt,
      },
      ['sku', 'captured_at'],
    );
  }
  return { competitors: items?.length ?? 0 };
}

export function saveReviews(db, sku, reviews, { capturedAt = new Date().toISOString(), url = null } = {}) {
  let inserted = 0;
  let updated = 0;
  for (const review of reviews ?? []) {
    if (!review?.reviewId) continue;
    const exists = db.db.prepare('SELECT rating FROM reviews_raw WHERE review_id = ?').get(review.reviewId);
    if (exists) {
      if (review.rating != null && exists.rating == null) {
        db.db.prepare('UPDATE reviews_raw SET rating = ? WHERE review_id = ?').run(review.rating, review.reviewId);
        updated += 1;
      }
      continue;
    }
    db.db
      .prepare(
        'INSERT INTO reviews_raw (review_id, sku, rating, text, published_at, has_photo, source_url, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        review.reviewId,
        sku,
        review.rating ?? null,
        review.text ?? null,
        review.date ?? null,
        review.hasPhoto ? 1 : 0,
        review.sourceUrl ?? url,
        capturedAt,
      );
    inserted += 1;
  }
  return { inserted, updated, skipped: (reviews?.length ?? 0) - inserted - updated };
}

export function saveSocialPosts(db, posts, { source, capturedAt = new Date().toISOString() }) {
  let inserted = 0;
  for (const post of posts ?? []) {
    if (!post?.url) continue;
    const exists = db.db.prepare('SELECT 1 AS hit FROM social_posts WHERE url = ?').get(post.url);
    if (exists) continue;
    db.db
      .prepare(
        'INSERT INTO social_posts (source, channel, text, published_at, url, engagement_json, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        source,
        post.channel ?? null,
        post.text ?? null,
        post.publishedAt ?? null,
        post.url,
        JSON.stringify(post.engagement ?? {}),
        capturedAt,
      );
    inserted += 1;
  }
  return { inserted };
}

export function saveDemandSignals(db, signals, { source, capturedAt = new Date().toISOString() }) {
  for (const signal of signals ?? []) {
    if (!signal?.keyword) continue;
    db.db
      .prepare(
        'INSERT INTO demand_signals (keyword, source, volume, captured_at, raw_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT (keyword, source, captured_at) DO NOTHING',
      )
      .run(signal.keyword, source, signal.volume ?? null, capturedAt, JSON.stringify(signal.raw ?? {}));
  }
}

export function saveCompetitorImages(db, sku, images, { capturedAt = new Date().toISOString() } = {}) {
  let inserted = 0;
  for (const image of images ?? []) {
    if (!image?.url) continue;
    const info = db.db
      .prepare('INSERT OR IGNORE INTO competitor_images (sku, url, role, position, width, height, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(String(sku), image.url, image.role ?? null, image.index ?? null, image.width ?? null, image.height ?? null, capturedAt);
    inserted += Number(info.changes ?? 0);
  }
  return { inserted };
}

export function saveDesignPattern(db, { sku, palette = [], blocks = null, notes = null, capturedAt = new Date().toISOString() } = {}) {
  db.db
    .prepare('INSERT OR IGNORE INTO design_patterns (sku, palette_json, blocks_json, notes, captured_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(sku), JSON.stringify(palette), JSON.stringify(blocks), notes, capturedAt);
  return { sku };
}