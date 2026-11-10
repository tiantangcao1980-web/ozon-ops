/**
 * 情报清洗层：把抓来的原始条目规范化、识别噪声、去重、打分。
 *
 * 全部是纯函数（不碰网络/数据库），便于单测；入库见 ingest.mjs。
 * 噪声规则命中后返回原因字符串，未命中返回 null —— 便于统计"去掉了什么"。
 */

const HTML_ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&laquo;': '«', '&raquo;': '»', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&euro;': '€', '&deg;': '°',
};

/** 噪声关键词：广告/促销/订阅/样板文案 */
const PROMO_MARKERS = [
  'промокод', 'скидка', 'распродажа', 'дешево', 'дешёвый', 'акция', 'купить сейчас', 'buy now', 'discount', 'coupon',
  '加微信', '代购', '优惠券', '限时', '秒杀', '包邮', '私聊', '扫码', '领券',
];

/** 样板/导航类文案（页面外壳，不是情报） */
const BOILERPLATE_MARKERS = [
  'политика конфиденциальности', 'условия использования', 'все права защищены', 'подпишитесь на рассылку',
  'войти', 'зарегистрироваться', 'cookie', 'все материалы', 'наши партнеры',
  '隐私政策', '用户协议', '版权所有', '登录', '注册', '订阅', '关注我们', '版权所有 ©',
];

/** 负面/风险信号词：命中越多，威胁等级越高 */
const RISK_MARKERS = [
  'подорожал', 'рост цен', 'подорожание', 'дефицит', 'задержка', 'срыв поставок', 'запрет', 'ограничен',
  'штраф', 'блокировка', 'санкц', 'пошлин', 'таможн', 'девальвац', 'курс рубля',
  '涨价', '缺货', '延误', '禁运', '制裁', '关税', '汇率', '断供', '限流', '封禁',
];

/** 业务信号词：与 OZON 跨境运营相关，命中提升重要度 */
const BIZ_MARKERS = [
  'ozon', 'озон', 'маркетплейс', 'продавец', 'селлер', 'fbs', 'fbo', 'логистик', 'склад', 'доставка', 'поставк',
  'таможн', 'пошлин', 'курс', 'рубл', 'юан', 'спрос', 'категор', 'рейтинг', 'отзыв',
  '跨境电商', '卖家', '物流', '仓储', '清关', '关税', '汇率', '选品', '类目', '流量', '广告',
];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'are', 'was', 'you', 'not', 'but',
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его',
  'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от',
  '的', '了', '和', '是', '在', '有', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说',
]);

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'yclid', 'gclid', 'fbclid', 'from', 'ref', 'spm'];

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? ' ');
}

/** 去 HTML 标签 / 实体 / 多余空白 / 控制字符，并按长度截断。 */
export function normalizeText(text, { maxChars = 280 } = {}) {
  if (text == null) return '';
  let value = String(text);
  value = value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  value = value.replace(/<[^>]+>/g, ' ');
  value = decodeEntities(value);
  value = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (value.length > maxChars) value = value.slice(0, maxChars).replace(/[\s,;:.!?，。；：、]+$/, '') + '…';
  return value;
}

/** 语言判定：西里尔 / 中日韩 / 拉丁；其余返回 other。 */
export function detectLang(text) {
  const value = String(text ?? '');
  const total = value.replace(/\s/g, '').length || 1;
  const cyrillic = (value.match(/[\u0400-\u04ff]/g) ?? []).length;
  const cjk = (value.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (value.match(/[a-z]/gi) ?? []).length;
  const letters = cyrillic + cjk + latin;
  if (!letters) return 'other';
  if (cyrillic / letters >= 0.3) return 'ru';
  if (cjk / letters >= 0.2) return 'zh';
  if (latin / letters >= 0.4) return 'en';
  return 'other';
}

/** 归一化 URL：去跟踪参数、去末尾斜杠、小写主机名，作为去重主键。 */
export function canonicalUrl(rawUrl) {
  if (!rawUrl) return '';
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  url.hash = '';
  const search = url.searchParams.toString();
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.hostname.toLowerCase() + pathname + (search ? '?' + search : '');
}

/** 分词：字母/数字连续的 token，去掉停用词与过短词。 */
export function tokenize(text) {
  const tokens = [];
  const chunks = String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const chunk of chunks) {
    if (/^[\u4e00-\u9fff]+$/.test(chunk)) {
      // 中文按二元组切分，避免整段当一个 token
      if (chunk.length === 1) tokens.push(chunk);
      else for (let index = 0; index < chunk.length - 1; index += 1) tokens.push(chunk.slice(index, index + 2));
      continue;
    }
    if (chunk.length >= 3 && !STOPWORDS.has(chunk)) tokens.push(chunk);
  }
  return tokens;
}

/** 标题相似度（Jaccard），用于近似重复。 */
export function similarity(left, right) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** 去重键：规范化 URL 优先；无 URL 时用归一化标题哈希。 */
export function dedupeKey(item) {
  const raw = item?.url ? String(item.url) : '';
  const candidates = raw ? [raw, 'https://' + raw.replace(new RegExp('^/+'), '')] : [];
  for (const candidate of candidates) {
    const canonical = canonicalUrl(candidate);
    if (canonical) return 'u:' + canonical;
  }
  const title = normalizeText(item?.title, { maxChars: 160 }).toLowerCase();
  return 't:' + title;
}


/**
 * 业务话题词表（带权重）：把新闻归到 OZON 运营关心的类别，并过滤无关新闻。
 * 权重 >=3 才是强信号；弱词（закон/налог/штраф/ставк）单独出现不足以入选。
 */
const TOPIC_TERMS = {
  platform: { ozon: 4, 'озон': 4, wildberries: 3, 'маркетплейс': 4, 'селлер': 3, 'продавц': 2, 'комисси': 2, 'кабинет': 2, fbs: 3, fbo: 3, 'карточк': 2, 'отзыв': 2, 'продвижен': 2 },
  logistics: { 'логистик': 3, 'склад': 3, 'доставк': 2, 'поставк': 3, 'перевозк': 3, 'контейнер': 3, 'таможн': 4, 'пошлин': 1, 'границ': 2, 'транзит': 3, 'ржд': 3, 'карго': 3, '物流': 3, '清关': 4, '关税': 4, '口岸': 3, '班列': 3, '仓储': 3 },
  regulation: { 'сертифика': 3, 'маркировк': 3, 'лицензи': 2, 'регул': 2, 'закон': 1, 'запрет': 2, 'ограничен': 1, 'налог': 1, 'штраф': 1, 'гост': 3, '认证': 3, '法规': 2, '限制': 1, '合规': 3 },
  finance: { 'курс': 3, 'рубл': 3, 'юан': 3, 'валют': 3, 'инфляц': 3, 'ставк': 2, 'доллар': 2, 'евро': 2, '汇率': 3, '卢布': 3, '人民币': 3, '结算': 3 },
  market: { 'спрос': 3, 'продаж': 2, 'рынок': 2, 'категор': 2, 'сезон': 2, 'импорт': 3, 'экспорт': 3, 'потребител': 2, '价格': 2, '销量': 2, '需求': 3, '类目': 2, '旺季': 2 },
};

/** 商业语境词：弱话题词必须搭配这些词才算与运营相关。 */
const BUSINESS_HINTS = ['торговл', 'товар', 'поставк', 'продав', 'бизнес', 'предпринимател', 'маркетплейс', 'импорт', 'экспорт', '电商', '跨境', '贸易', '商品', '卖家', '供应链'];

/** 明显无关的语境：命中即判无关（政治/体育/刑事等）。 */
const OFFTOPIC_HINTS = ['мвд', 'мигрант', 'нелегал', 'пиратств', 'спартак', 'зенит', 'футбол', 'хоккеи', 'выбора', 'украин', 'армия', 'спецоперац', 'убийств', 'дтп', 'погод', 'арест', 'суд приговор'];

const TOPIC_ORDER = ['platform', 'logistics', 'regulation', 'finance', 'market'];

/** 归类：加权命中分数最高的话题；分数 <3 或明显无关返回 other。 */
export function classifyTopic(text) {
  const haystack = String(text ?? '').toLowerCase();
  const offTopic = OFFTOPIC_HINTS.filter((marker) => haystack.includes(marker)).length;
  const business = BUSINESS_HINTS.filter((marker) => haystack.includes(marker)).length;
  const scores = {};
  let best = null;
  let bestScore = 0;
  let maxMarker = 0;
  for (const topic of TOPIC_ORDER) {
    let score = 0;
    for (const [marker, weight] of Object.entries(TOPIC_TERMS[topic])) {
      if (haystack.includes(marker)) {
        score += weight;
        if (weight > maxMarker) maxMarker = weight;
      }
    }
    if (score > 0 && business > 0) score += 2;
    scores[topic] = score;
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  const relevant = bestScore >= 3 || (bestScore >= 2 && maxMarker >= 2);
  if (!relevant) return { category: 'other', hits: scores, total: bestScore, maxMarker };
  if (offTopic > 0 && business === 0) return { category: 'other', hits: scores, total: bestScore, maxMarker };
  // 泛化话题（合规/市场）必须带商业语境，避免公司财报、地缘政治等混入；
  // 汇率类另放宽：明确的外汇词（курс/валют/юан/инфляц/ставк）本身就算运营信号
  const strongCurrency = ['курс', 'валют', 'юан', 'инфляц', 'ставк', 'ключев', '汇率', '卢布', '人民币'].filter((marker) => haystack.includes(marker)).length;
  const strongMarket = ['спрос', 'импорт', 'экспорт', 'потребител', 'сезон', '需求', '旺季', '进口', '出口'].filter((marker) => haystack.includes(marker)).length;
  if (best === 'regulation' && business === 0) return { category: 'other', hits: scores, total: bestScore, maxMarker };
  if (best === 'market' && business === 0 && strongMarket === 0) return { category: 'other', hits: scores, total: bestScore, maxMarker };
  if (best === 'finance' && business === 0 && strongCurrency === 0) return { category: 'other', hits: scores, total: bestScore, maxMarker };
  return { category: best, hits: scores, total: bestScore, maxMarker };
}

function countMarkers(haystack, markers) {
  let count = 0;
  for (const marker of markers) if (haystack.includes(marker)) count += 1;
  return count;
}

/** 噪声判定：返回命中原因，未命中返回 null。 */
export function noiseReason(item) {
  const title = normalizeText(item?.title, { maxChars: 200 });
  const detail = normalizeText(item?.detail, { maxChars: 400 });
  const text = (title + ' ' + detail).trim();
  if (!title) return 'empty';
  if (title.length < 8) return 'too-short';
  const lang = detectLang(text);
  if (lang === 'other') return 'unsupported-lang';
  if (countMarkers(text.toLowerCase(), PROMO_MARKERS) >= 2) return 'promo';
  if (countMarkers(text.toLowerCase(), BOILERPLATE_MARKERS) >= 1 && tokenize(text).length <= 8) return 'boilerplate';
  const tokens = tokenize(text);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  const top = tokens.length ? Math.max(...counts.values()) : 0;
  if (tokens.length >= 4 && top / tokens.length > 0.5) return 'stuffing';
  if (tokens.length <= 2) return 'nav';
  if (!/[\p{L}]/u.test(title)) return 'no-text';
  return null;
}

/** 打分：重要度（0-100）、可信度（0-100）、威胁等级（low/medium/high）。 */
export function scoreItem(item, { now = () => new Date(), sourceWeight = 60 } = {}) {
  const title = normalizeText(item?.title, { maxChars: 200 });
  const detail = normalizeText(item?.detail, { maxChars: 400 });
  const text = (title + ' ' + detail).toLowerCase();
  const riskHits = countMarkers(text, RISK_MARKERS);
  const bizHits = countMarkers(text, BIZ_MARKERS);
  const hasNumbers = /[0-9]/.test(text) ? 1 : 0;
  const money = /₽|руб|юан|¥|\$|%/.test(text) ? 1 : 0;

  const published = item?.publishedAt ?? item?.at;
  let recency = 0.5;
  if (published) {
    const at = new Date(published).getTime();
    if (Number.isFinite(at)) {
      const hours = (now().getTime() - at) / 3_600_000;
      recency = hours <= 2 ? 1 : hours <= 12 ? 0.85 : hours <= 48 ? 0.65 : hours <= 24 * 7 ? 0.45 : 0.25;
    }
  }

  const raw = sourceWeight * 0.35 + riskHits * 9 + bizHits * 5 + recency * 30 + hasNumbers * 4 + money * 4;
  const importance = Math.max(1, Math.min(100, Math.round(raw)));
  const credibility = Math.max(10, Math.min(100, Math.round(sourceWeight * 0.8 + (detail.length > 40 ? 12 : 0) + (hasNumbers ? 5 : 0))));
  const threat = riskHits >= 2 ? 'high' : riskHits === 1 ? 'medium' : 'low';
  return { importance, credibility, threat, recency: Math.round(recency * 100) / 100, riskHits, bizHits };
}

/** 整条清洗：规范字段 + 语言 + 去重键 + 打分，噪声条目返回 { dropped, reason }。 */
export function cleanItem(rawItem, options = {}) {
  const title = normalizeText(rawItem?.title, { maxChars: 200 });
  let detail = normalizeText(rawItem?.detail ?? rawItem?.summary ?? rawItem?.snippet, { maxChars: 400 });
  // 摘要常常原样重复标题（RSS/Telegram 常见），去掉重复部分，避免大屏上一模一样两行
  const detailLower = detail.toLowerCase();
  const titleLower = title.toLowerCase();
  if (detail && title) {
    if (detailLower.startsWith(titleLower)) detail = detail.slice(title.length).trim();
    else if (titleLower.startsWith(detailLower)) detail = '';
  }
  if (detail.length < 16) detail = '';

  const url = canonicalUrl(rawItem?.url ?? rawItem?.link) || null;
  const item = {
    source: normalizeText(rawItem?.source, { maxChars: 60 }) || 'unknown',
    category: rawItem?.category ?? 'market',
    title,
    detail,
    url,
    lang: detectLang(title + ' ' + detail),
    publishedAt: rawItem?.publishedAt ?? rawItem?.at ?? null,
  };
  const reason = noiseReason(item);
  if (reason) return { dropped: true, reason, item };
  const fixedCategory = Boolean(rawItem?.keepCategory);
  if (!fixedCategory) {
    const topic = classifyTopic(title);
    if (topic.category === 'other') return { dropped: true, reason: 'irrelevant', item };
    item.category = topic.category;
  }
  const scores = scoreItem(item, options);
  return {
    dropped: false,
    reason: null,
    item: { ...item, ...scores, dedupeKey: dedupeKey({ url: rawItem?.url ?? rawItem?.link, title }) },
  };
}
