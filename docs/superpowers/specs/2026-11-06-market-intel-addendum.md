# 市场情报层（P1.5）设计补充：竞品 / 评论 / 社媒热点 / 痛点

- 日期：2026-11-06
- 状态：探源完成，待实施（P0+P1 已交付）
- 关联：`2026-11-06-ozon-ai-ops-design.md`（本文件补充「选品的市场证据从哪来」）

## 1. 为什么需要这一层

官方 Seller API 只能看到自己店铺；市场级需求/竞争要 Premium Pro，竞品 SKU 级销量、断货天数、流量结构、买家评论痛点官方 API 一律不给（见 `Ozon-Seller-API-数据映射.md` §6）。选品要判断「值不值得做」，必须补三类证据：

1. **竞品事实**：同关键词下有多少商品、价格带、评分、评论数、卖家、上架时长、库存提示。
2. **买家声音**：评论正文与评分分布 → 质量/尺寸/材质/物流痛点，差评集中在哪。
3. **区域热点与潜在需求**：俄罗斯本地搜索热度、社媒讨论（VK / Telegram / YouTube）、相邻需求与场景词。

## 2. 工具评估结论（2026-11-06 实测）

| 目标源 | 工具 | 实测结果 | 结论 |
|---|---|---|---|
| Ozon 前台搜索 / 商品页 / 评论页 | **Playwright（MCP + 库）** | 首次 403 Antibot Challenge，**约 8 秒后 JS 挑战自动通过**，落地真实搜索页；商品页 200；评论页 200（1,234 条评论、12 问、56 图可见正文） | **主力**：浏览器持久会话可抓竞品与评论 |
| Ozon 前台 | crawlee / scrapy / crawl4ai（纯 HTTP） | 无 JS 执行，会停在挑战页 | 不用于 Ozon；可用于其他站点 |
| VK | 浏览器或 crawlee + 本地代理 `127.0.0.1:7897` | 搜索页经代理 200；`api.vk.com/newsfeed.search` 无 token 报 `Access denied: token required` | 浏览器抓搜索页；或用户提供 VK token 走 API |
| Telegram 公开频道 | HTTP 经代理 | `t.me/s/<channel>` 200（99 KB） | crawlee/HTTP 即可，无需登录 |
| YouTube | HTTP 经代理 | 200（968 KB） | 浏览器抓标题/描述/评论；或后续接 yt-dlp |
| Yandex Wordstat（搜索量） | HTTP 经代理 | 页面 200，但数据需登录 | 需用户 Yandex 登录态；否则用建议词 API |
| Yandex 建议词（需求探针） | HTTP 直连 | `suggest.yandex.ru/suggest-ff.cgi?part=…` 200 | 免费、可批量探关键词变体 |
| Google Trends | HTTP 经代理 | 429 | 暂不作为数据源 |
| 1688 / 淘宝 | 浏览器 | 可达但页面是 JS 壳、需登录 | 浏览器抓（P2 成本核算用） |

工具分工：**浏览器（Playwright）= 反爬/JS 渲染站点；HTTP 爬虫（crawlee/scrapy）= 静态或半静态站点；本地代理 = 出口**。三者组合，不追求单一工具通吃。

## 3. 架构

```
src/intel/
├─ browser.mjs        # Playwright 持久 profile（复用挑战通过的 cookie），限速与挑战检测
├─ ozon-front.mjs     # 搜索页→卡片；商品页→价格/评分/评论数/卖家/属性；评论页→正文分页
├─ vk.mjs             # VK 搜索页/或 token API
├─ telegram.mjs       # t.me/s/ 频道帖子（HTTP，经代理）
├─ youtube.mjs        # 搜索/评论（浏览器）
├─ yandex.mjs         # 建议词批量探需求
├─ proxy.mjs          # 代理开关：直连失败自动切 127.0.0.1:7897（可配）
└─ normalize.mjs      # 统一成 evidence 结构，落库
```

新增表（迁移 v4）：

| 表 | 关键列 |
|---|---|
| `competitors` | sku/product_id, title, price_rub, rating, reviews, seller, url, first_seen, last_seen |
| `competitor_snapshots` | sku, price_rub, rating, reviews, stock_hint, captured_at |
| `reviews_raw` | sku, review_id, rating, text, published_at, has_photo, source_url |
| `social_posts` | source(vk/telegram/youtube), channel, text, published_at, url, engagement_json |
| `demand_signals` | keyword, source(suggest/wordstat/vk), volume, captured_at, raw_json |
| `pain_points` | sku/niche, theme, count, sample_reviews_json, generated_at |

## 4. 选品闭环

1. `ozon intel search --query "<俄语词>"` → 抓前 N 页卡片 → 竞品表 + 价格带/评分/评论分布。
2. `ozon intel reviews --sku <id> --pages 5` → 评论正文 → 频次 + 模型归因（质量/尺寸/材质/物流/包装）。
3. `ozon intel social --query "<词>"` → VK/TG/YouTube 近 90 天帖子 → 场景词、抱怨、替代品。
4. `ozon intel demand --seeds seeds.json` → Yandex 建议词扩展 + （有登录态时）Wordstat 量级。
5. `ozon evidence build --candidate <id>` → 把以上聚合成 `candidates.evidence_json`（需求/竞争/痛点三块），供 `ozon select` 评分。
6. 痛点表反哺 P2：Listing 卖点与主图文案直接回应 Top 痛点。

## 5. 反爬与合规红线

- 只抓公开页面；不登录买家账号、不绕过验证码；遇到挑战页就等或退避，不暴力重试。
- 限速：同一站点 1 请求 / 3–5 秒，随机抖动；单次运行上限（搜索 5 页、评论 10 页）可配。
- 会话：一个持久 profile，挑战通过后复用 cookie；换 IP/代理需重新过挑战。
- 数据只落本地 `db/ozon.db` 与 `raw/intel/`，不对外分发；评论原文保留出处 URL。
- 遵守平台 ToS 与 robots；若平台明示禁止抓取，只保留人工抽样录入路径（`ozon evidence import`）。

## 6. 分期

| 期 | 内容 | 验收 |
|---|---|---|
| P1.5a | 浏览器 driver + 限速/挑战检测 + Ozon 搜索/商品/评论抓取 + competitors/reviews 表 | 抓一个关键词前 2 页 ≥20 个竞品，落库；评论抓 100 条含正文与评分 |
| P1.5b | 评论痛点归因（频次 + 模型总结）+ pain_points 表 | 输出 Top 5 痛点与代表评论 |
| P1.5c | VK/TG/YouTube 社媒帖子 + Yandex 建议词 | 一个关键词 ≥30 条社媒帖子、≥20 个建议词 |
| P1.5d | `evidence build` 聚合进选品证据 | `ozon select` 用聚合证据评分，报告含竞品/痛点摘要 |
