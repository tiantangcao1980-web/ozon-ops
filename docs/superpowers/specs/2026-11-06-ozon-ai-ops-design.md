# OZON AI 跨境运营系统 —— 设计文档

- 日期：2026-11-06
- 项目根：`ozon-ops`（凭据在 `.secrets\ozon.env`，已 gitignore）
- 形态：DSH 原生（方案 A）——命令行内核 + DSH 插件工具 + 定时任务 + 本地报告/看板 + 运营技能包
- 状态：待评审（builder check 之后按意见修订）

## 1. 目标与非目标

### 目标

让「选品 → 上架 → 日常运营 → 投流」这条链路上的重复劳动被系统接手，人只做判断与确认：

1. 数据：官方 API 能拿的全部自动取回、落库、可对比历史。
2. 决策：选品评分、利润测算、补货建议、异常预警，都由规则算出数字，不给「感觉」。
3. 内容：中→俄翻译、Listing 结构化、主图合规与合成。
4. 执行：动作先生成提案（proposal），人工确认后按限额执行，全程审计。
5. 呈现：每天一份日报（Markdown + HTML），DSH 里可追问、可下钻。

### 非目标（本期不做）

- 不做独立多用户 Web 应用（数据层独立，将来要长面板不重写）。
- 不做无人值守的批量写操作（P3/P4 默认「提案 → 确认 → 执行」）。
- 不抓竞品前台页面、不替代 MPstats（API 明确给不了的竞品 SKU 级数据，系统只标注缺口）。
- 不做多平台（先 Ozon 单店；多店/多平台在数据层预留 seller_id 维度）。

## 1.5 评审后锁定的边界（六问六答）

评审子代理读完文档与支撑材料后提出六个会改计划的问题，以下是决定：

**① 上架由系统调用 API 吗 —— 不调用，只产 payload。**
`/v3/product/import` 的图片字段只接受公网可访问的 JPG 链接，本地 jimp 产物没有托管；新商品在拿到 SKU 前也拿不到真实佣金/费率；导入后还有 `task_id → /v1/product/import/info` 审核状态机。因此 P2 交付 `outbox/listing/<offer_id>/`：`payload.zh.json`（人看）、`payload.ru.json`（API 形状，供以后接入）、`backend-fields.md`（后台字段→值粘贴清单）、`images/`（本地成品）。图片对象存储与 API 创建放到 P5，届时风险等级 high。
连带约束：P3 的写操作验收需要至少 1 个**在售** SKU，所以 P3 开始前由人工用 P2 产物完成第一个上架；3 个归档 SKU 不复活（OGL 下结构性亏损）。

**② 数据源到位情况 —— 不抓前台；实测评价/问答也被订阅锁死。**
`www.ozon.ru`、`data.ozon.ru` 在本机网络层不可达，抓前台既违反非目标也不可行。实测：`/v2/review/list`、`/v1/review/count` → 403 `not available with existing subscription`；`/v1/question/list`、`/count` → 403 `only available with a Premium Plus subscription`。因此 P3 的评价/问答模块默认标 `NO_SUBSCRIPTION`：跳过差评与未回预警，唯一的 `low` 免确认动作（回复评价）取消，全部写操作都要确认。P1 增加「人工证据录入」路径（`ozon evidence import <csv>` → `candidates.evidence_json`），把手工样本变成可评分数据。

**③ 金额口径 —— 每笔带币种，双币种展示，P&L 用订单日汇率。**
实测确认 `analytics.revenue` 是 **RUB**：2026-09-01 返回 `ordered_units=1, revenue=100.0000`，2026-09-02 为 `2 / 200.0000`（≈100.0 RUB/件，标价 ¥10.0，比值≈10.0 接近 CBR）；`/v5/product/info/prices` 返回店铺结算币种 **CNY**；`postings.price` 币种待 P0 实测。
落库：所有金额列显式带币种（`revenue_rub`、`price_cny`、`logistics_cny`…），新增 `fx_rates(date, rub_per_cny, source)` 表，每日快照 CBR 汇率；日报同时给 RUB 与 CNY（标注汇率值与取数日）；单件贡献用**订单日汇率**折算，历史可复算。P0 仍要用 `/v1/finance/balance`（单次最长 1 个月）与 `/v1/finance/realization` 对账一次，确认是 GMV 还是结算额。

**④ `approve` 是否在工具面 —— 不在。**
`ozon_ops` 工具没有 `approve`/`execute`；批准只能走本地 CLI：`node bin/ozon.mjs approve <id> --code <code>`，且要求 `outbox/actions/<id>.approved` 存在。审计写 `executed_by`（`cli` / `tool` / `schedule`）与时间。诚实说明：模型有 shell 权限，这是**流程护栏**，不是密码学防线；因此定时任务只读，写操作永远由人的终端发起。

**⑤ 翻译谁产出 —— 两段式（模型在环），不是确定性脚本。**
`ozon translate prepare` 产出待译 JSON + 术语约束 + 属性 schema → **模型（DSH 内）**填俄语 → `ozon translate commit` 校验（术语覆盖率、字符数、必填属性、禁用词）并落 `listing_drafts`。质量闸门加**回译**（RU→ZH 由模型回译，与原中文对照）与属性字典校验；P2 验收接受「两段式完成一份 draft」，不接受「单命令确定性翻译」。

**⑥ 费率缺口 —— 种子化 E 级费率 + 显式可信度标签。**
`settings` 用 `Ozon-OGL真实费率与选品边界-20261106.md` 的六档 CNY 费率表种子化，每条结论带 `rate_confidence: E`（费率未核对）；rFBS 佣金用本店实测 FACT 12–13%；新类目佣金未知时按 17% 保守估算并标 `commission_assumed: 17`；结论落在 10–20% 灰区时强制 `HOLD（待核实费率/佣金）`，不硬给「试销」。

**评审附带修正**：`leaf_count=0` 先复现再修（现存 walker 对 `raw/pull-20261106103425/tree.json` 重跑得 7,363 叶子，可能不是 bug）；端点修正为 `/v4/posting/fbs/ship`、`/v1/review/comment/create`；`analytics/data` 无 `clicks`，按 12 项真实指标映射（见 §4/§5）。

## 2. 已核实的事实（2026-11-06 实测）

### 账号与店铺

| 项 | 值 |
|---|---|
| 凭据 | `.secrets\ozon.env`：`OZON_CLIENT_ID` + `OZON_API_KEY` |
| 角色 | Admin（`/v1/roles` 200，483 个方法全开放，含写接口） |
| 店铺 | `Demo Store`，主体 Example Entity Co., Ltd，币种 CNY，国家 CHN |
| 订阅 | `subscription.is_premium = false` |
| 商品 | 在售 0，归档 3（全部 realFBS：`EXAMPLE0001a/b/c`） |
| 订单 | 有历史 FBS 订单（`/v4/posting/fbs/list` 返回数据，含 delivered 与未发货），说明店铺运营过、不是纯空店 |
| 仓库 | 1 个（zhongshan，realFBS 自发货） |
| 评分 | `/v1/rating/summary` 200，指标全为 0 / UNKNOWN（无在售数据） |

### 端点可用性（实调）

| 端点 | 结果 | 用途 |
|---|---|---|
| `/v1/seller/info` | 200 | 店铺主体、订阅状态 |
| `/v1/roles` | 200 | 密钥权限自检 |
| `/v1/rating/summary` | 200 | 店铺健康分 |
| `/v2/warehouse/list` | 200（53 KB） | 发货仓与时效 |
| `/v3/product/list` | 200 | 商品清单（ALL/ARCHIVED） |
| `/v5/product/info/prices` | 200（按 offer_id 过滤）；`visibility: ALL` 对归档商品返回空 | 佣金率、价格指数、体积重 |
| `/v3/product/info/list` | 400 `use either offer_id or product_id or sku`（必须给键） | 商品档案 |
| `/v4/product/info/stocks` | 200（按 offer_id/sku 过滤才有数据） | 库存 |
| `/v3/posting/fbs/list` | **404 page not found（spec 有、线上没有）** | 已废弃/漂移，勿用 |
| `/v4/posting/fbs/list` | 200，cursor 分页（`has_next`/`cursor`） | 订单列表（实际可用版本） |
| `/v4/posting/fbs/unfulfilled/list` | 200，cursor 分页 | 待发货清单 |
| `/v3/posting/fbo/list` | 200（当前空） | FBO 订单 |
| `/v2/review/list`、`/v1/review/count` | 403 `not available with existing subscription` | 评价：需评价管理订阅 |
| `/v1/question/list`、`/v1/question/count` | 403 `only available with a Premium Plus subscription` | 问答：需 Premium Plus |
| `/v1/finance/balance` | 400 `maximum period is one month`（参数用法不同） | 财务对账（单次 ≤1 个月） |
| `/v1/analytics/stocks` | 400 需 skus（1–100 个） | 库存速度 |
| `/v1/rating/history` | 400 需 RFC3339 时间戳 | 店铺健康分历史 |
| `/v1/analytics/data` | 200（30 行日数据；revenue 经实测为 RUB） | 自店销量/销售额 |
| `/v1/search-queries/top` | 403 `Method available with Premium Pro subscription` | 市场需求（当前不可用） |
| `/v1/analytics/category/comparison` | 400 校验（需 category_type） | 类目竞争（Premium，未验通） |
| Performance API 主机 | 401（服务存在，需 OAuth） | 广告投流 |

### 环境能力

| 项 | 结论 |
|---|---|
| Node | v22.23.1，`node:sqlite` 可用（实验特性，单机单用户足够） |
| 图形 | `jimp` 装在 DSH 依赖里；项目内自装 `jimp`，不依赖宿主 |
| 包管理 | `C:\Users\<user>\AppData\Local\hermes\node\npm.cmd`（`npm.ps1` 被执行策略拦，必须用 .cmd） |
| DSH | 插件（`dsh.bundle.patch` + `cordis.patch.yml` + `index.js` `inject:['skills','tools']`）、`schedule_create`、`plugin_manager`、个性化页面 `propose_action` |

### 既有资产（会被本系统吸收或替换）

| 文件 | 处置 |
|---|---|
| `Ozon-Seller-API-数据映射.md`（449 行） | 保留为事实参考；系统内以常量/注释引用 |
| `Ozon新店选品执行表.md` | 规则（OGL 重量筛、价重比、进退规则）转成 `src/rules/economics.js` + 台账表 |
| `scripts/ozon-api-pull.mjs` | 重写为 `src/api.js` + `bin/ozon.mjs`；`leaf_count=0` 的 bug 一并修 |
| `spec/ozon-seller-openapi.json` | 保留，用于端点/字段自检 |

## 3. 架构

```
ozon-ops
├─ .secrets/ozon.env          # 唯一凭据来源，绝不进日志/文档/输出
├─ src/
│  ├─ config.mjs              # 路径、阈值、地区、汇率来源
│  ├─ api.mjs                 # Seller 客户端：鉴权/重试/限频/缓存/审计
│  ├─ db.mjs                  # node:sqlite 连接 + 迁移 + 查询封装
│  ├─ pull.mjs                # 各类取数任务（products/postings/stocks/analytics/reviews/rating）
│  ├─ probe.mjs               # 端点探活矩阵：live 与 spec 快照对账，产出 src/endpoints.json
│  ├─ rules/
│  │  ├─ economics.mjs        # OGL 计费、佣金、收单、退货、广告 → 单件贡献
│  │  ├─ selection.mjs        # 五步评分表、硬筛规则、结论等级
│  │  ├─ alerts.mjs           # 断货/差评/超时/价格指数/库存天数阈值
│  │  └─ listing-qa.mjs       # 标题/属性/图片/合规检查
│  ├─ content/
│  │  ├─ glossary.ru.json     # 术语表（西里尔/中文对照、类目词、禁用词）
│  │  ├─ translate.mjs        # 中→俄 Listing 生成（结构化 JSON）
│  │  └─ images.mjs           # jimp：裁剪/白底/合规/文字层/多图导出
│  ├─ actions.mjs             # 写操作：proposal → 确认令牌 → 限额执行 → 审计
│  └─ render/
│     ├─ report.mjs           # 日报/周报（Markdown）
│     └─ dashboard.mjs        # 静态 HTML 看板（内联 SVG，无外部 CDN）
├─ bin/ozon.mjs               # CLI 入口（所有能力的唯一实现）
├─ plugin/                    # DSH 插件 @local/ozon-ops（薄壳，只调 CLI）
├─ db/ozon.db                 # SQLite（gitignore）
├─ reports/                   # 每日/每周报告 + dashboard.html
└─ outbox/                    # 翻译稿、主图、待执行动作 JSON（可审阅）
```

**分层原则**：`bin/ozon.mjs` 是唯一实现入口；DSH 插件工具、定时任务、人肉终端都只调 CLI。这样以后换 UI 或加平台不用动业务逻辑。

## 4. 数据层（SQLite）

单库 `db/ozon.db`，`src/db.mjs` 内置 `PRAGMA user_version` 迁移。核心表：

| 表 | 关键列 | 说明 |
|---|---|---|
| `products` | product_id, offer_id, sku, name, category_id, archived, created_at | 商品主档，每次取数 upsert |
| `prices` | sku, price, old_price, marketing_price, min_price, currency, commissions_json, price_index_color, captured_at | 价格与佣金快照（历史可对比） |
| `stocks` | sku, warehouse_id, present, reserved, warehouse_name, captured_at | 库存快照 |
| `postings` | posting_number, status, created_at, in_process_at, shipment_date, items_json, price | 订单/包裹 |
| `analytics_daily` | date, sku, ordered_units, revenue_rub, delivered_units, returns, hits_view, hits_view_search, hits_view_pdp, hits_tocart_search, hits_tocart_pdp, session_view_pdp, conv_tocart_pdp, position_category | 日指标（自店，12 项真实指标，无 clicks） |
| `fx_rates` | date, rub_per_cny, source, captured_at | 汇率历史（CBR 每日） |
| `reviews` | review_id, sku, rating, text, published_at, answered | 评价与回复状态 |
| `questions` | question_id, sku, text, published_at, answered | 问答待办 |
| `rating_snapshot` | captured_at, groups_json, score | 店铺健康分历史 |
| `candidates` | id, niche, ru_query, evidence_json, score, verdict, created_at | 选品候选与评分 |
| `sku_costs` | offer_id, purchase_price_cny, domestic_freight_cny, weight_g, dims_cm, packaging_cny, supplier, updated_at | 1688 成本与箱规 |
| `listing_drafts` | offer_id, payload_json, status, qa_json, created_at | 上架草稿（翻译+属性+图片） |
| `actions_log` | id, action, target, payload_json, status(proposed/approved/executed/rejected), approved_by, executed_at, result_json | 写操作审计 |
| `api_calls` | path, status, ms, bytes, called_at, error | 调用审计与限频依据 |
| `settings` | key, value | 汇率、阈值、限额 |

## 5. 取数层

`src/api.mjs`：

- 鉴权：从 `.secrets\ozon.env` 读，绝不出现在日志；错误信息脱敏（`Client-Id` 打码）。
- 重试：429 / 5xx / 网络错误指数退避（1.5s、3s、6s，最多 3 次）；429 优先用 `Retry-After`。
- 限频：进程内令牌桶（默认 10 rps 起步，可调）+ 每方法硬限（`/v1/analytics/data` 1 次/分钟 → 60s 缓存）。
- 缓存：`(path, body)` → 结果，TTL 按方法配置（静态类 24h，动态类 60s）。
- 审计：每次调用写 `api_calls`。
- 分页：`last_id`/`limit`（商品）、`offset`/`limit`（包裹）、`cursor`（价格）分别封装成迭代器。

取数任务（`src/pull.mjs`）：

| 任务 | 端点 | 频率 |
|---|---|---|
| `products` | `/v3/product/list` + `/v3/product/info/list` + `/v5/product/info/prices` + `/v4/product/info/stocks` | 每日 |
| `postings` | `/v4/posting/fbs/list`（cursor 分页）+ `/v4/posting/fbs/unfulfilled/list`；`/v3/posting/fbo/list` 备用 | 每日 + 每小时增量（可选） |
| `analytics` | `/v1/analytics/data`（12 项真实指标：ordered_units / revenue / delivered_units / returns / hits_view / hits_view_search / hits_view_pdp / hits_tocart_search / hits_tocart_pdp / session_view_pdp / conv_tocart_pdp / position_category） | 每日 |
| `stocks_speed` | `/v1/analytics/stocks`、`/v1/analytics/turnover/stocks`（按 sku） | 每日 |
| `reviews` | `/v2/review/list`、`/v1/review/count` + `/v1/review/comment/create` 回复 | 每日 |
| `questions` | `/v1/question/list` + `/v1/question/answer/create` | 每日 |
| `rating` | `/v1/rating/summary`、`/v1/rating/history` | 每日 |
| `ads`（P4） | Performance API：活动、日统计、余额 | 每日 |

## 6. 规则层

规则不另发明：ecommerce 技能库里已有 27 个 Ozon 技能，本系统的规则层按这些技能的判定标准实现，系统提供数据与计算，技能正文保留方法论。

| 系统模块 | 对应技能（`sealeap-ecommerce-skills/skills/ozon/`） |
|---|---|
| 选品与评分 | `sealeap-ozon-niche-screening`、`sealeap-ozon-competitor-map`、`sealeap-ozon-keyword-map`、`sealeap-ozon-price-segment`、`sealeap-ozon-seasonality-entry` |
| 单位经济与定价 | `sealeap-ozon-unit-economics`、`sealeap-ozon-pay-per-order-economics`、`sealeap-ozon-promotion-pricing`、`sealeap-ozon-settlement-audit` |
| 上架与内容 | `sealeap-ozon-listing-localization`、`sealeap-ozon-visual-brief`、`sealeap-ozon-seller-api` |
| 履约与库存 | `sealeap-ozon-fulfillment-choice`、`sealeap-ozon-warehouse-allocation`、`sealeap-ozon-replenishment` |
| 评价与售后 | `sealeap-ozon-review-opportunity`、`sealeap-ozon-returns-quality` |
| 流量与诊断 | `sealeap-ozon-search-visibility`、`sealeap-ozon-weekly-diagnostics` |
| 广告投流（P4） | `sealeap-ozon-ad-readiness`、`sealeap-ozon-pay-per-click-test`、`sealeap-ozon-budget-pacing`、`sealeap-ozon-attribution-audit`、`sealeap-ozon-incrementality` |

### 6.0 规则总原则

- 阈值不硬编码在没有依据的地方：能从 API 取到的用 API 事实，取不到的（OGL 费率、类目佣金、汇率）放 `settings`，未填时结论写「缺参数」而不是猜。
- 每条结论都带证据：数据日期、端点、样本量、缺口列表；报告里可回溯。


### 6.1 单位经济（`rules/economics.mjs`）

输入：售价（CNY 与 RUB 双记）、采购价、国内运费、包装、实重/箱规、类目佣金率、收单费、退货率、广告占比。计算：OGL 六档（CNY：fix + var ¥/g × 计费重；Big/Premium Big 计体积重 `长×宽×高(cm) ÷ 12` 得克，与「÷12000 得 kg」等价）、电子服务费 `min(200, max(15, 货值RUB × 2%))` 按订单日汇率折 CNY、平台佣金（rFBS 12–13%）、收单、退货计提、广告。输出：单件贡献、贡献率、价重比（售价¥ ÷ 计费重 g）、是否过 20% 门槛，以及**可信度标签** `rate_confidence: E|FACT`、`commission_assumed`。
费率来源：`settings` 种子化 02 号文档的 E 级六档表（CNY），拿到后台费率页截图后升级为 FACT；未核对时报告必须带标签，不静默当真。

### 6.2 选品评分（`rules/selection.mjs`）

把 `Ozon新店选品执行表.md` 的硬筛与五步变成可执行规则：形态/合规/品牌/重量/箱规硬筛（不过直接淘汰）；需求证据、竞争结构、价重比、贡献率打分（0–100）；输出结论 `试销 / 待补数 / 淘汰`，缺数据时结论为 `HOLD` 并列出缺哪几列。

### 6.3 预警（`rules/alerts.mjs`）

| 规则 | 触发 | 级别 |
|---|---|---|
| 断货风险 | 可用库存 ÷ 近 7 日日均销量 < 10 天 | P1 |
| 已断货 | 可用库存 = 0 且在售 | P0 |
| 发货超时 | posting 待发货且距 `shipment_date` < 12h | P0 |
| 差评 | 新评价 ≤3 星，或近 7 日评分下降 | P1 |
| 价格指数 | 掉出绿色区（`price_index_color != GREEN`） | P1 |
| 滞销 | 上架 21 天且 0 单 | P2 |
| 退货率 | 单 SKU 退货率 > 15% | P1 |
| 评价未回 | 待回复评价 > 0 且超过 48h | P2 |

### 6.4 上架质检（`rules/listing-qa.mjs`）

标题长度与关键词、必填属性齐全、图片比例/尺寸/白底/无水印/无中文、俄语语法要点（大小写、格变化抽查清单）、合规词（医疗/保证/最…）、品牌与 IP 风险词。

## 7. 内容层（翻译与生图）

### 7.1 翻译

- 术语表 `content/glossary.ru.json`：类目词、材质、尺寸、动词短语、禁用/敏感词；每条含 zh、ru、备注、来源。
- **两段式**：`ozon translate prepare` 产出待译 JSON（中文卖点 + 类目属性 schema + 术语约束 + 字符数限制）→ 模型在会话里填俄语 → `ozon translate commit` 校验并落 `listing_drafts`。不做「确定性单命令翻译」。
- 质量闸门：术语覆盖率（<60% 判不合格）、字符/字节长度、必填属性非空、禁用词、**回译校验**（RU→ZH 由模型回译，与原中文逐条对照，标出语义漂移）。
- 团队若无人读俄语，回译为强制项，并在 draft 里保留中文对照稿供抽检。

### 7.2 生图

- **本地生成工作流（已定，不依赖外部 API）**：本机 RTX 4070 Laptop 8 GB、驱动 555.x、本地磁盘余量充足、`uv` 可用。
  - 环境：`uv venv` + `uv pip install torch --index-url https://download.pytorch.org/whl/cu124` + `diffusers/transformers/accelerate`；模型用 SDXL base（fp16 + attention slicing + CPU offload，8 GB 可跑 1024²）或 `sd-turbo` 加速；模型文件放 `ozon-ops\models\`（下载约 7 GB，可校验 sha）。
  - 调用：`bin/ozon.mjs image generate --prompt ... --size 1024x1024` → 调 `imgwork/gen.py`，产出 PNG 到 `outbox/listing/<offer_id>/images/`；参数（seed、步数、negative）落 `listing_drafts.qa_json`，可复现。
  - 与实拍结合：实拍图做主体（可选 rembg 抠图）→ 本地生成背景/场景 → 合成主图与附图；模板层（白底、比例、俄语文案）仍用 Node + jimp。
- 本地合成的合规检查（分辨率、比例、纯白背景、水印、中文残留）对所有图片统一执行，AI 生成图额外记录 `generated: true` 与模型/参数。

## 8. 执行层（写操作）

`src/actions.mjs` 统一模型：

```
propose(动作) → outbox/actions/<id>.json（含目标、payload、风险等级、预估影响、一次性确认码）
node bin/ozon.mjs approve <id> --code <码>   # 仅本地 CLI，模型工具面没有这个动作
→ 校验限额与白名单 → execute → 写 actions_log（executed_by: cli）
```

- 默认 dry-run：只打印将发送的请求体与预期影响。
- 白名单：改价 `/v1/product/import/prices`、改库存 `/v2/products/stocks`、发货 `/v4/posting/fbs/ship`、回复评价 `/v1/review/comment/create`、问答 `/v1/question/answer/create`、广告预算（P4）。**商品创建不在白名单**（见 §1.5①）。
- 限额（`settings` 可改）：单日改价 ≤ 20 个 SKU、单次价格变动 ≤ ±15%、单日广告预算变动 ≤ ±30%、库存写入仅限自身仓库。
- 风险等级：`mid`（库存/价格/发货）需确认；`high`（批量/广告预算）需确认 + 二次校验；`low` 免确认仅在订阅到位、能回复评价时启用（当前没有，故全部需确认）。
- `approve` 不在 DSH 工具 schema 中：只能本地 CLI 批准，`approved_by` 记录来源终端；定时任务只读（见 §1.5④）。

## 9. 呈现层

- `reports/YYYY-MM-DD-daily.md`：昨日销量/销售额/转化、库存与断货、订单待处理、评价与问答、价格指数、异常清单、今日待办。
- `reports/YYYY-MM-DD-weekly.md`：周对比、SKU 贡献排名、广告 ACOS、补货建议。
- `reports/dashboard.html`：单文件静态看板（内联 CSS/SVG，无外部资源），双击即看。
- DSH：插件的 `ozon_ops` 工具返回同样的结构化数据；日报可在会话里追问下钻。个性化页面作为可选项（P3 之后评估），不作为依赖。

## 10. DSH 集成

### 插件 `@local/ozon-ops`（`ozon-ops\plugin`）

- `index.js`：`inject: ['skills','tools']`，注册
  - 技能 `ozon-ops`：运营 SOP（何时跑什么、阈值怎么调、写操作纪律）。
  - 工具 `ozon_ops`：`action` 枚举 `status | pull | report | alerts | translate | image | propose | propose-list | approve | dashboard`，参数按 action 分支；所有实现调用 `bin/ozon.mjs`（`execFile`，超时与输出上限受控）。
- 安装：`plugin_manager install_bundle`（绝对路径 `link:`），与两个 sealeap 插件并存。

### 定时任务（`schedule_create`，Asia/Shanghai）

| 时间 | 任务 |
|---|---|
| 每日 07:30 | 取数（products/postings/analytics/stocks/reviews/rating）+ 重算预警 |
| 每日 08:00 | 生成日报与 dashboard.html；有 P0 预警时在会话里点名 |
| 周一 09:50 | 周报（周对比、补货建议、广告复盘） |
| 每日 08:30（P4） | 广告数据同步与 ACOS 巡检 |

## 11. 分期与验收

| 期 | 内容 | 验收标准 |
|---|---|---|
| **P0** 内核（1–2 天） | config/db/api/pull/probe/CLI 骨架；复现并定位 `leaf_count=0`；`ozon status` 打印店铺概要；`revenue` 币种对账 | `ozon status` 输出店铺/订阅/商品/仓/密钥角色；`ozon probe` 端点探活写 `src/endpoints.json`（记录 `v3/posting/fbs/list` 线上 404 这类漂移）；`ozon pull products` 落库且 `SELECT count(*) FROM products` > 0；`ozon finance reconcile` 用 `/v1/finance/*` 确认 `analytics.revenue` 是 RUB 还是 CNY；API 调用有审计；429 重试有单测 |
| **P1** 选品决策台（2–3 天） | `economics`、`selection`、`candidates`、`evidence import` 命令 | 给定候选（1688 成本+箱规）输出贡献率/价重比/结论，并带 `rate_confidence` 标签；缺市场数据时 `HOLD` 且列出缺口；CSV 证据可导入并参与评分；单测覆盖六档跳档（501 g/Budget 陷阱）与利润公式 |
| **P2** 上架流水线（2–3 天） | `translate prepare/commit`、`listing-qa`、`images`、`listing_drafts`、payload 产物 | 两段式完成一份俄语 draft（术语覆盖 ≥60%、属性齐全、无禁用词、含回译对照）；主图合成与合规检查通过；产出 `outbox/listing/<offer_id>/`（payload.ru.json、backend-fields.md、images/）；**不调用商品创建 API** |
| **P3** 日常运营（3–4 天） | 日报/周报/dashboard、`alerts`、`propose`、定时任务、插件工具 | 前置：至少 1 个在售 SKU（人工用 P2 产物上架）；连续 3 天日报数字与后台一致（含 RUB/CNY 双口径）；P0 预警出现在日报与会话；改库存走完 propose→（本地 CLI）approve→execute 并留审计；评价订阅缺失时相关段落标 `NO_SUBSCRIPTION` |
| **P4** 投流（2–3 天） | Performance API 客户端、广告日表、ACOS 规则、预算提案 | 有凭据时拉到活动与日统计；无凭据时报 `NO_CREDENTIALS`；ACOS 超阈值生成提案 |
| **P5** 面板/上架 API（按需） | 本地 HTTP 面板；商品创建 API + 图片对象存储 + 审核状态机 | 只在 P3 日报不够用或需要真自动上架时做 |

## 12. 依赖与降级

| 依赖 | 现状 | 降级方案 |
|---|---|---|
| Premium Pro（市场需求/类目竞争） | 未订阅（403 实测） | 选品用类目树 + 必填属性 + 人工证据 CSV + 利润测算，结论标 `HOLD` 并列缺口 |
| 评价管理订阅（`/v2/review/list` 等） | 未验证（403 预期） | 评价/问答段落标 `NO_SUBSCRIPTION`，跳过差评预警；回复动作停用 |
| MPstats | 未购买（可达但需登录） | 手工导出 CSV → `ozon evidence import` 参与评分 |
| Performance API 凭据 | 无 | 投流只出建议与阈值提醒，不执行 |
| 图像模型 API | 未确认 | 本地合成主图 + 标注「未使用 AI 生成」 |
| OGL 费率表 | 02 号文档 E 级六档（CNY），待后台复核 | `settings` 种子化 + `rate_confidence: E` 标签；未填时输出「缺费率」 |
| 类目佣金 | 本店两类的 rFBS 12–13%（FACT）；新类目未知 | 新类目按 17% 保守估算并标 `commission_assumed`，灰区强制 HOLD |
| 汇率 | CBR 每日；当前用示例 11.2174 | 手工录入兜底，报告写明来源与日期；P&L 用订单日汇率 |

## 13. 风险与护栏

- **spec 与线上漂移**：本机 spec 快照是 2026-10-18 的镜像，实测已出现 `/v3/posting/fbs/list` 线上 404、价格/库存接口的 `visibility` 过滤与 spec 语义不完全一致。因此代码不盲信 spec：`probe` 探活矩阵为准，端点常量集中在 `src/endpoints.json`，每次取数前校验可用性。
- 写操作：默认 dry-run + 确认令牌 + 单日限额 + 审计日志；密钥是 Admin 角色，误操作影响真实资金，所以「默认不写」是硬约束。
- 限流：`/v1/analytics/data` 1 次/分钟、整体 50 rps；所有取数有缓存与退避。
- 数据一致性：`/v3/product/list` 的 `total` → `total_items` 迁移（2026-11-23）已在代码中按新字段处理。
- 翻译质量：术语表 + 人工审阅稿；不直接写线上，先落 `listing_drafts`。
- 密钥：只在 `.secrets`，日志脱敏；`outbox/` 与报告不得包含 API Key。

## 14. 待确认 → 已确认（2026-11-06）

| 问题 | 答复 | 对设计的影响 |
|---|---|---|
| Premium Pro | 先查免费试用，能开就开 | P1 先按「可能无 Premium」实现，`probe` 会打印订阅与端点可用性；开启后自动走实时数据分支 |
| 评价管理订阅 | 当前 403（实测），暂不订 | P3 评价/问答段落标 `NO_SUBSCRIPTION`；订阅到位后直接启用，不改表结构 |
| 俄语审校 | 没人能读俄语 | 回译（RU→ZH）为强制项，draft 保留中文对照稿；上架前抽检最小样本 |
| 图像模型 | 无外部 API；本机 4070 8 GB，搭本地工作流 | P2 用本地 SDXL/diffusers 生成 + jmix/模板合成（见 §7.2）；不自建云服务 |
| Performance API 凭据 | 暂无可得凭据（默认） | P4 先做客户端与 `NO_CREDENTIALS` 分支；拿到 client_id/secret 再接 |
| OGL 费率复核 | 暂时只能以 02 号文档 E 级为准 | `rate_confidence: E` 标签进结论；拿到后台截图后改 FACT |
