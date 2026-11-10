/**
 * 情报源配置：默认 RSS / Telegram 列表与来源权重。
 *
 * 权重进打分（重要度/可信度），「平台政策类」最高，综合新闻最低。
 * 探活结论（2026-11-10）：retail.ru 相关性最高；kommersant 429 条但慢；tass/rbc/lenta 经济可用；
 * Telegram 侧 ozon_marketplace / marketplace_ozon / ecomnews / logirus 可解析，其余多为空频道。
 */

export const DEFAULT_PROXY = 'http://127.0.0.1:7897';

export const DEFAULT_RSS_FEEDS = [
  { url: 'https://www.retail.ru/rss/news/', name: 'Retail.ru', weight: 72 },
  { url: 'https://www.kommersant.ru/RSS/news.xml', name: 'Коммерсантъ', weight: 64 },
  { url: 'https://lenta.ru/rss/news/economics', name: 'Lenta Экономика', weight: 62 },
  { url: 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss', name: 'RBC', weight: 62 },
  { url: 'https://tass.ru/rss/v2.xml', name: 'TASS', weight: 60 },
];

export const DEFAULT_TG_CHANNELS = [
  { channel: 'ozon_marketplace', name: 'OZON Marketplace', weight: 84 },
  { channel: 'marketplace_ozon', name: 'Marketplace OZON', weight: 78 },
  { channel: 'ecomnews', name: 'EcomNews', weight: 74 },
  { channel: 'logirus', name: 'Logirus', weight: 72 },
];

/** CLI 展示用：源清单 + 权重。 */
export function listSources() {
  return {
    rss: DEFAULT_RSS_FEEDS.map((feed) => ({ ...feed })),
    telegram: DEFAULT_TG_CHANNELS.map((item) => ({ ...item })),
    proxy: DEFAULT_PROXY,
  };
}
