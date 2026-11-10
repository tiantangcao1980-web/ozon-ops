/**
 * 情报抓取适配器：把各类抓取源转成统一原始条目，交给 ingest.mjs 清洗入库。
 *
 * - itemsFromDb：现有库内信号（预警/竞品/评论/社媒/痛点）——无需联网
 * - harvestRss：RSS/Atom（fetch 注入，便于测试）
 * - itemsFromFile：抓取代理（crawl4ai / crawlee / 本地脚本）产出的 JSON
 */
import { readFileSync } from 'node:fs';

import { computeAlerts } from '../rules/alerts.mjs';
import { fetchTelegramChannel } from './social.mjs';

function textOf(xml, tag) {
  const match = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  if (!match) return '';
  return match[1]
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析 RSS 2.0 / Atom，返回原始条目。 */
export function parseRss(xml, { source = 'RSS', category = 'market' } = {}) {
  const blocks = String(xml ?? '').match(/<(item|entry)[\s\S]*?<\/\1>/gi) ?? [];
  const items = [];
  for (const block of blocks) {
    const title = textOf(block, 'title');
    const link = textOf(block, 'link') || textOf(block, 'guid') || (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '');
    const summary = textOf(block, 'description') || textOf(block, 'summary') || textOf(block, 'content');
    const published = textOf(block, 'pubDate') || textOf(block, 'published') || textOf(block, 'updated') || null;
    if (!title) continue;
    items.push({ title, url: link || null, detail: summary, publishedAt: published, source, category });
  }
  return items;
}

/** 抓 RSS：允许多个 feed，单 feed 失败不影响其它。 */
export async function harvestRss({ feeds = [], fetchImpl = fetch, timeoutMs = 15000, perFeedLimit = 20, category = 'market' } = {}) {
  const items = [];
  const errors = [];
  for (const entry of feeds) {
    const feed = typeof entry === 'string' ? entry : entry.url;
    const name = typeof entry === 'string' ? 'RSS' : (entry.name ?? 'RSS');
    const weight = typeof entry === 'string' ? undefined : entry.weight;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchImpl(feed, {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; ozon-ops-intel/0.1)', accept: 'application/rss+xml, application/xml, text/xml, */*' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        errors.push({ feed, status: response.status });
        continue;
      }
      const xml = await response.text();
      const parsed = parseRss(xml, { source: name, category });
      for (const item of parsed.slice(0, perFeedLimit)) items.push(weight == null ? item : { ...item, weight });
    } catch (error) {
      errors.push({ feed, error: String(error?.message ?? error) });
    }
  }
  return { items, errors };
}

/** 抓 Telegram 公开频道（复用项目已有 social.mjs 解析器）。 */
export async function harvestTelegram({ channels = [], perChannelLimit = 20, category = 'social', proxy = process.env.OZON_PROXY || null } = {}) {
  const items = [];
  const errors = [];
  for (const entry of channels) {
    const channel = typeof entry === 'string' ? entry : entry.channel;
    const name = typeof entry === 'string' ? '社媒' : (entry.name ?? '社媒');
    const weight = typeof entry === 'string' ? undefined : entry.weight;
    try {
      const posts = await fetchTelegramChannel(channel, { proxy });
      for (const post of posts.slice(-perChannelLimit)) {
        items.push({
          title: post.text.slice(0, 160),
          detail: post.text.slice(0, 400),
          url: post.url,
          publishedAt: post.publishedAt,
          source: name,
          category,
          ...(weight == null ? {} : { weight }),
        });
      }
      if (!posts.length) errors.push({ channel, error: 'no posts parsed' });
    } catch (error) {
      errors.push({ channel, error: String(error?.message ?? error) });
    }
  }
  return { items, errors };
}

/** 从本地抓取结果文件读取原始条目（JSON 数组 / { items: [...] } / markdown 首行）。 */
export function itemsFromFile(path) {
  const raw = readFileSync(path, 'utf8');
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.data ?? [];
    return list.map((item) => ({
      title: item.title ?? item.name ?? item.text ?? '',
      url: item.url ?? item.link ?? null,
      detail: item.detail ?? item.summary ?? item.snippet ?? item.description ?? '',
      publishedAt: item.publishedAt ?? item.published_at ?? item.date ?? null,
      source: item.source ?? '抓取',
      category: item.category ?? 'market',
    }));
  }
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  return [{ title: lines[0].replace(/^#+\s*/, ''), detail: lines.slice(1, 4).join(' '), source: '抓取', category: 'market' }];
}

/** 现有库内信号 → 原始条目（走同一套清洗，保证大屏只有一条情报流）。 */
export function itemsFromDb({ db, now = () => new Date() } = {}) {
  const conn = db.db ?? db;
  const nowDate = now();
  const items = [];

  let alerts = [];
  try {
    alerts = computeAlerts({ db, now }) ?? [];
  } catch {
    alerts = [];
  }
  const alertGroups = new Map();
  for (const alert of alerts) {
    const key = String(alert.type ?? alert.code ?? 'alert');
    const group = alertGroups.get(key) ?? { key, list: [], severity: 'P2' };
    group.list.push(alert);
    if (alert.severity === 'P0') group.severity = 'P0';
    else if (alert.severity === 'P1' && group.severity !== 'P0') group.severity = 'P1';
    alertGroups.set(key, group);
  }
  const ALERT_LABELS = { stockout: '断货风险', shipment: '发货延迟', price_index: '价格指数缺失', returns: '退货率异常', stale: '数据陈旧', acos: '广告 ACOS 超阈' };
  for (const group of alertGroups.values()) {
    const first = group.list[0];
    const label = ALERT_LABELS[group.key] ?? group.key;
    const skus = group.list.map((alert) => alert.sku).filter(Boolean);
    const title = group.list.length > 1
      ? label + ' × ' + group.list.length + ' 项' + (skus[0] ? '（' + skus.slice(0, 2).join('、') + (skus.length > 2 ? ' 等' : '') + '）' : '')
      : (first.message ?? label);
    items.push({
      title,
      detail: group.list.length > 1 ? (first.message ?? '') : (first.sku ? 'SKU ' + first.sku : ''),
      source: 'OZON 数据巡检',
      category: 'alert',
      keepCategory: true,
      weight: group.severity === 'P0' ? 95 : 78,
      publishedAt: nowDate.toISOString(),
    });
  }

  const moves = conn
    .prepare(
      'SELECT c.sku, c.keyword, c.price_rub, p.price_rub AS prev_price, c.captured_at FROM competitor_snapshots c ' +
        'LEFT JOIN competitor_snapshots p ON p.sku = c.sku AND p.captured_at < c.captured_at ' +
        'ORDER BY c.captured_at DESC, p.captured_at DESC LIMIT 40',
    )
    .all();
  const seen = new Set();
  for (const row of moves) {
    if (seen.has(row.sku) || row.prev_price == null) continue;
    seen.add(row.sku);
    const prev = Number(row.prev_price);
    const latest = Number(row.price_rub);
    if (!prev || !latest) continue;
    const change = Math.round(((latest - prev) / prev) * 1000) / 10;
    items.push({
      title: '竞品调价 ' + (change > 0 ? '+' : '') + change + '% · ' + (row.keyword ?? ''),
      detail: 'SKU ' + row.sku + ' ' + prev.toFixed(0) + '₽ → ' + latest.toFixed(0) + '₽',
      url: null,
      source: '竞品快照',
      category: 'competition',
      keepCategory: true,
      publishedAt: row.captured_at,
    });
  }

  const reviews = conn.prepare('SELECT sku, rating, text, published_at FROM reviews_raw ORDER BY published_at DESC LIMIT 40').all();
  for (const review of reviews) {
    const rating = Number(review.rating ?? 0);
    if (!(rating > 0) || rating >= 4) continue;
    items.push({
      title: (review.text ?? '').slice(0, 120) || '低分评价 ' + rating.toFixed(0) + '★',
      detail: 'SKU ' + review.sku + ' · ' + rating.toFixed(0) + '★',
      source: '买家评论',
      category: 'voice',
      keepCategory: true,
      publishedAt: review.published_at,
    });
  }

  const social = conn.prepare('SELECT source, channel, text, published_at, url FROM social_posts ORDER BY published_at DESC LIMIT 9').all();
  for (const post of social) {
    items.push({
      title: (post.text ?? '').slice(0, 120) || '社媒提及',
      detail: (post.source ?? '') + (post.channel ? ' · ' + post.channel : ''),
      url: post.url ?? null,
      source: '社媒',
      category: 'social',
      keepCategory: true,
      publishedAt: post.published_at,
    });
  }

  const pains = conn.prepare('SELECT niche, theme, count FROM pain_points ORDER BY count DESC LIMIT 9').all();
  for (const pain of pains) {
    items.push({
      title: '痛点「' + pain.theme + '」命中 ' + pain.count + ' 次',
      detail: pain.niche ?? '',
      source: '评论聚类',
      category: 'pain',
      keepCategory: true,
      publishedAt: nowDate.toISOString(),
    });
  }

  return items;
}
