/**
 * 情报入库：清洗 → 去噪 → 去重（精确 + 近似）→ 打分 → 落 intel_items。
 *
 * 返回可直接打印的统计：收到多少、留下多少、每类噪声丢了多少。
 */
import { createHash } from 'node:crypto';

import { cleanItem, similarity } from './clean.mjs';

/** 来源权重（进 cleanItem 打分用）。 */
export const SOURCE_WEIGHTS = {
  'OZON 数据巡检': 92,
  '广告巡检': 78,
  '竞品快照': 78,
  '买家评论': 72,
  '评论聚类': 64,
  '社媒': 58,
  'RSS': 66,
  '抓取': 60,
  manual: 50,
};

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS intel_items (' +
    ' id TEXT PRIMARY KEY,' +
    ' dedupe_key TEXT NOT NULL UNIQUE,' +
    ' source TEXT NOT NULL,' +
    ' category TEXT NOT NULL,' +
    ' lang TEXT,' +
    ' title TEXT NOT NULL,' +
    ' detail TEXT,' +
    ' url TEXT,' +
    ' importance INTEGER NOT NULL,' +
    ' credibility INTEGER NOT NULL,' +
    ' threat TEXT NOT NULL,' +
    ' published_at TEXT,' +
    ' captured_at TEXT NOT NULL,' +
    ' payload_json TEXT' +
    ')',
  'CREATE INDEX IF NOT EXISTS idx_intel_captured ON intel_items(captured_at)',
  'CREATE INDEX IF NOT EXISTS idx_intel_category ON intel_items(category)',
];

export function ensureIntelSchema(db) {
  const conn = db.db ?? db;
  for (const statement of SCHEMA) conn.exec(statement);
}

function itemId(dedupeKey) {
  return createHash('sha1').update(dedupeKey).digest('hex').slice(0, 16);
}

function bump(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

/** 批量清洗入库。items 为原始条目（title/detail/url/source/category/publishedAt）。 */
export function ingestIntel({ db, items = [], now = () => new Date(), nearDupThreshold = 0.85 } = {}) {
  const conn = db.db ?? db;
  ensureIntelSchema(db);
  const capturedAt = now().toISOString();
  const stats = {
    received: items.length,
    kept: 0,
    dropped: 0,
    duplicates: 0,
    nearDuplicates: 0,
    byReason: {},
    byCategory: {},
    byLang: {},
    bySource: {},
  };

  const existingKeys = new Set(conn.prepare('SELECT dedupe_key FROM intel_items').all().map((row) => row.dedupe_key));
  const existingTitles = conn
    .prepare('SELECT title FROM intel_items ORDER BY captured_at DESC LIMIT 300')
    .all()
    .map((row) => row.title);
  const batchKeys = new Set();
  const batchTitles = [];

  const insert = conn.prepare(
    'INSERT INTO intel_items (id, dedupe_key, source, category, lang, title, detail, url, importance, credibility, threat, published_at, captured_at, payload_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      stats.dropped += 1;
      bump(stats.byReason, 'invalid');
      continue;
    }
    const sourceWeight = Number(raw.weight ?? SOURCE_WEIGHTS[raw.source] ?? 60);
    const result = cleanItem(raw, { now, sourceWeight });
    if (result.dropped) {
      stats.dropped += 1;
      bump(stats.byReason, result.reason ?? 'unknown');
      continue;
    }
    const item = result.item;

    if (existingKeys.has(item.dedupeKey) || batchKeys.has(item.dedupeKey)) {
      stats.dropped += 1;
      stats.duplicates += 1;
      bump(stats.byReason, 'duplicate');
      continue;
    }
    const near = batchTitles.find((title) => similarity(title, item.title) >= nearDupThreshold) ??
      existingTitles.find((title) => similarity(title, item.title) >= nearDupThreshold);
    if (near) {
      stats.dropped += 1;
      stats.nearDuplicates += 1;
      bump(stats.byReason, 'near-duplicate');
      continue;
    }

    const id = itemId(item.dedupeKey);
    insert.run(
      id,
      item.dedupeKey,
      item.source,
      item.category,
      item.lang,
      item.title,
      item.detail,
      item.url,
      item.importance,
      item.credibility,
      item.threat,
      item.publishedAt,
      capturedAt,
      JSON.stringify({ riskHits: item.riskHits, bizHits: item.bizHits, recency: item.recency }),
    );
    existingKeys.add(item.dedupeKey);
    batchKeys.add(item.dedupeKey);
    batchTitles.push(item.title);
    stats.kept += 1;
    bump(stats.byCategory, item.category);
    bump(stats.byLang, item.lang);
    bump(stats.bySource, item.source);
  }

  return stats;
}

/** 读取情报流（默认按重要度、时间倒序）。 */
export function listIntel({ db, limit = 20, category = null, lang = null, threat = null } = {}) {
  const conn = db.db ?? db;
  ensureIntelSchema(db);
  const clauses = [];
  const params = [];
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }
  if (lang) {
    clauses.push('lang = ?');
    params.push(lang);
  }
  if (threat) {
    clauses.push('threat = ?');
    params.push(threat);
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  return conn
    .prepare('SELECT * FROM intel_items' + where + ' ORDER BY importance DESC, captured_at DESC LIMIT ?')
    .all(...params, Number(limit));
}

/** 情报管道统计：总量、按来源/类别/语言/威胁分布、最近入库时间。 */
export function intelStats({ db, now = () => new Date() } = {}) {
  const conn = db.db ?? db;
  ensureIntelSchema(db);
  const total = conn.prepare('SELECT COUNT(*) AS count FROM intel_items').get().count;
  const group = (column) => conn.prepare('SELECT ' + column + ' AS key, COUNT(*) AS count FROM intel_items GROUP BY ' + column).all();
  const latest = conn.prepare('SELECT MAX(captured_at) AS at FROM intel_items').get()?.at ?? null;
  const latest24h = conn
    .prepare('SELECT COUNT(*) AS count FROM intel_items WHERE captured_at >= ?')
    .get(new Date(now().getTime() - 86_400_000).toISOString()).count;
  return {
    total,
    latest24h,
    latestAt: latest,
    bySource: group('source'),
    byCategory: group('category'),
    byLang: group('lang'),
    byThreat: group('threat'),
  };
}

/** 把一次抓取/入库的统计写入 settings，供大屏显示"收 → 留 → 去噪"。 */
export function saveIngestStats(db, stats, now = () => new Date()) {
  const conn = db.db ?? db;
  try {
    conn.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run('intel_stats_last', JSON.stringify(stats), now().toISOString());
  } catch {
    // settings 表缺失时不影响主流程
  }
}

export function loadIngestStats(db) {
  const conn = db.db ?? db;
  try {
    const row = conn.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get('intel_stats_last');
    if (!row) return null;
    return { ...JSON.parse(row.value), savedAt: row.updated_at };
  } catch {
    return null;
  }
}
