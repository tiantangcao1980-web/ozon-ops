# OZON AI 运营系统 · P0 + P1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可用的取数内核（P0）与选品决策台（P1）：`bin/ozon.mjs` 能取店铺/商品/订单/分析数据落 SQLite、探活端点、对账币种，并按 OGL 六档费率与选品规则对候选 SKU 给出带可信度标签的结论。

**Architecture:** 单进程 Node CLI（ESM）。`config → api → db → pull/probe → rules → render` 单向依赖；`bin/ozon.mjs` 是唯一入口，后续 DSH 插件与定时任务只调它。API 层注入 `fetchImpl`，单测不联网；真实调用只在验证步骤手动跑。

**Tech Stack:** Node v22.23.1（`node:sqlite` 内置）、ESM、`node:test`、内置 `fetch`；P0/P1 无第三方运行时依赖。

**Spec:** `ozon-ops\docs\superpowers\specs\2026-11-06-ozon-ai-ops-design.md`

## Global Constraints

- Node ≥ 22.23（`node:sqlite` 可用）；`package.json` 设 `"type": "module"`；P0/P1 不加运行时依赖，测试用 `node:test`。
- 凭据只从 `.secrets/ozon.env` 读（`OZON_CLIENT_ID` 纯数字、`OZON_API_KEY` ≥10 位）；任何输出里 Client-Id 打码（前 4 位 + `***`），Key 永不出现（含错误信息、日志、报告、测试快照）。
- P0/P1 只调用读端点（POST 读接口），不新增写端点。
- 金额双币种：`analytics_daily.revenue_rub`（RUB，实测 2026-09-01 单件 100.0000）、`prices.price_cny`、物流/采购/包装皆 CNY；`fx_rates.rub_per_cny` 每日一条，报告同时给两币种并注明汇率日期。
- 费率：`settings` 种子化 02 号文档六档 CNY 表（Extra Small ¥2.90+0.0247/g；Budget ¥22.25+0.0164/g；Small ¥15.48+0.0242/g；Big ¥34.82+0.0164/g 计抛；Premium Small ¥21.28+0.0242/g；Premium Big ¥59.97+0.0222/g 计抛），`rate_confidence: 'E'`。
- 佣金：本店 rFBS 为 12%（17028653）与 13%（89202024），属 FACT；未知类目按 17% 保守估算并标 `commission_assumed: 17`。
- 计费重：Big / Premium Big 用 `max(实重, 长×宽×高(cm)/12)` 克；其余档用实重。电子服务费 `min(200, max(15, 货值RUB × 2%))` 按订单日汇率折 CNY。
- 数据库 `db/ozon.db`（gitignore 已含 `raw/`、`spec/`、`.secrets/`、`.tmpdb/`；把 `db/`、`outbox/`、`reports/` 加进 `.gitignore`）。
- 输出面向用户的中文；代码标识符与文件名为英文。
- 验收命令在项目根跑：`node --test`；单测不发起网络请求。

## Review Focus

1. `/v1/analytics/data` 的时间窗口：一次传 >31 天或跨月必须自动分片，否则 Ozon 返回校验错误 → Task 8 测分片边界（31 天整、32 天、跨月）。
2. `postings` 的 cursor 分页：`has_next=true` 到最后 `has_next=false` 必须终止且按 `posting_number` 去重，防止死循环与重复入库 → Task 7。
3. 501 g 与 ¥135 组合落入 Budget 陷阱档、以及抛货被体积重放大：计费重与档位判定错会让结论反向 → Task 10。
4. 缺费率/缺佣金：必须输出 `HOLD` 并带标签，不得抛异常或静默按 0 计算 → Task 11。
5. 凭据缺失/格式错误与 429 无 `Retry-After`：必须单条明确报错、不泄漏密钥、退避有上限 → Task 1、Task 2。

---

### Task 1: 项目骨架、配置与凭据加载

**Files:**
- Create: `package.json`, `.gitignore`(modify), `src/config.mjs`, `test/config.test.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**
- Produces: `loadConfig({root = process.cwd(), env = process.env, fsImpl})` → `{root, secretsPath, dbPath, reportsDir, outboxDir, clientId, apiKey, maskedClientId, premiumPro}`；凭据缺失抛 `ConfigError`（`code='MISSING_CREDENTIALS'`），Client-Id 非纯数字抛 `code='MALFORMED_CLIENT_ID'`。

- [ ] **Step 1:** `git init`；写 `package.json`（`{"name":"ozon-ops","private":true,"type":"module","scripts":{"test":"node --test"}}`）；`.gitignore` 追加 `db/`、`outbox/`、`reports/`、`models/`、`node_modules/`。
- [ ] **Step 2: Write the failing test** —— `test/config.test.mjs`：用临时目录写 `ozon.env`（含 `OZON_CLIENT_ID=1234567`、`OZON_API_KEY=0123456789abcdef`、`OZON_PREMIUM_PRO=0`），断言 `loadConfig` 返回 `clientId==='1234567'`、`maskedClientId==='1234***'`、`premiumPro===false`；缺 Key 时抛错且 `err.code==='MISSING_CREDENTIALS'`；`OZON_CLIENT_ID=abc` 抛 `MALFORMED_CLIENT_ID`；错误 message 不包含 Key 字符串。
- [ ] **Step 3: Run test to verify it fails** —— `node --test test/config.test.mjs`，期望 `Cannot find module ../src/config.mjs` 或断言失败。
- [ ] **Step 4: Implement** `src/config.mjs`：解析 `KEY=VALUE`（忽略注释/空行、去引号），路径基于 `root`：`.secrets/ozon.env`、`db/ozon.db`、`reports/`、`outbox/`；`maskedClientId = clientId.slice(0,4)+'***'`；错误只报「缺少 OZON_API_KEY」不回报值。
- [ ] **Step 5: Run test to verify it passes** —— `node --test test/config.test.mjs`，期望 PASS。
- [ ] **Step 6: Commit** —— `git add -A && git commit -m "feat: project scaffold and credential loader"`。

### Task 2: Ozon API 客户端（重试/限频/缓存/审计）

**Files:**
- Create: `src/api.mjs`, `test/api.test.mjs`
- Test: `test/api.test.mjs`

**Interfaces:**
- Produces: `createApi({clientId, apiKey, fetchImpl = fetch, sleep = ms => new Promise(r=>setTimeout(r,ms)), now = () => Date.now(), audit = () => {}})` → `{ call(path, body = {}, opts = {}) }`。
- `opts`: `{ttlMs = 0, maxRetries = 3}`；返回 `{status, ok, json, text, bytes, ms, fromCache}`；失败抛 `ApiError`（`status, code, message`）。缓存键 `${path}:${sha256(JSON.stringify(body))}`，`ttlMs>0` 时命中返回 `fromCache:true`。
- 重试：429 优先 `Retry-After`（秒），否则退避 `1500*attempt`；5xx 与网络错误同退避；耗尽后抛错。审计回调每次实际请求调用一次。

- [ ] **Step 1: Write the failing test** —— `test/api.test.mjs`：假 `fetchImpl` 依次返回 `429(Retry-After:1)`→`200 {ok:true}`，断言调用两次、`sleep` 收到 1000、结果 `fromCache===false`；再调一次相同参数（`ttlMs:60000`）断言不新增 fetch 且 `fromCache===true`；`fake` 返回 `{code:5,message:'PRODUCT_NOT_FOUND'}` 的 404 时抛 `ApiError` 且 `err.status===404`、`err.message` 不含 API Key；`audit` 记录 `path/status/ms/bytes`。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/api.test.mjs`。
- [ ] **Step 3: Implement** `src/api.mjs`：`POST https://api-seller.ozon.ru + path`，头 `Content-Type: application/json`、`Client-Id`、`Api-Key`；`AbortSignal.timeout(60000)`；`Retry-After` 解析为秒；错误信息只带 `code/message`。
- [ ] **Step 4: Run test to verify it passes** —— `node --test test/api.test.mjs`。
- [ ] **Step 5: Commit** —— `feat: ozon api client with retry, cache and audit`。

### Task 3: SQLite 层与迁移

**Files:**
- Create: `src/db.mjs`, `test/db.test.mjs`

**Interfaces:**
- Produces: `openDb({filePath = ':memory:'})` → `{db, migrate(), close(), upsert(table, row, keys)}`；`db` 是 `DatabaseSync` 实例，测试里用 `handle.db.prepare('SELECT count(*) c FROM products').get()` 断言；`migrate()` 幂等，`PRAGMA user_version` 记录版本。
- 表（列见 spec §4）：`products, prices, stocks, postings, analytics_daily, rating_snapshot, candidates, sku_costs, listing_drafts, actions_log, api_calls, settings, fx_rates`。

- [ ] **Step 1: Write the failing test** —— 断言 `migrate()` 后 `sqlite_master` 含 13 张表、`user_version===1`；`migrate()` 再跑一次不报错且版本仍 1；`upsert('products', {product_id:1, offer_id:'A', sku:2}, ['product_id'])` 连跑两次只有 1 行且字段被更新。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/db.test.mjs`。
- [ ] **Step 3: Implement** `src/db.mjs`：`new DatabaseSync(filePath)`，`MIGRATIONS = [{version:1, sql:'...'}]`；金额列用 `REAL`，时间列 `TEXT`（ISO8601）；`upsert` 用 `INSERT ... ON CONFLICT(keys) DO UPDATE`。
- [ ] **Step 4: Run test to verify it passes** —— `node --test test/db.test.mjs`。
- [ ] **Step 5: Commit** —— `feat: sqlite schema with versioned migrations`。

### Task 4: `ozon status`（店铺概要）

**Files:**
- Create: `src/commands/status.mjs`, `test/status.test.mjs`, `bin/ozon.mjs`

**Interfaces:**
- Consumes: `createApi`（Task 2）、`loadConfig`（Task 1）。
- Produces: `runStatus({config, api})` → `string`（含店铺名、订阅 `is_premium`、商品数 ALL/ARCHIVED、仓库数、密钥角色名、Client-Id 打码）。

- [ ] **Step 1: Write the failing test** —— 假 api 返回固定 JSON；断言输出含 `Demo Store`、`Premium: 否`、`商品 0 在售 / 3 归档`、`仓库 1`、`角色 Admin`，且**不含**完整 Client-Id、不含 Key。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/status.test.mjs`。
- [ ] **Step 3: Implement** —— 调 `/v1/seller/info`、`/v1/roles`、`/v3/product/list`（visibility ALL 与 ARCHIVED，limit 1 取 `total_items`）、`/v2/warehouse/list`；`bin/ozon.mjs` 用 `process.argv` 分派，`status` 打印。
- [ ] **Step 4: Run test to verify it passes**，然后 **live 验证**：`node bin/ozon.mjs status`（真实凭据），期望打印店铺名且 Client-Id 打码。
- [ ] **Step 5: Commit** —— `feat: ozon status command`。

### Task 5: `ozon probe`（端点探活矩阵）

**Files:**
- Create: `src/endpoints-catalog.mjs`, `src/commands/probe.mjs`, `test/probe.test.mjs`

**Interfaces:**
- Produces: `CATALOG`（数组，元素 `{path, body, note}`，至少含 spec §2 表里全部端点）；`runProbe({api, catalog, writeFile})` → `{generatedAt, rows:[{path,status,ok,code,message}], usable, drifted}`；`drifted` = 目录存在但线上 404/405 的路径；写 `src/endpoints.json`（`{generatedAt, rows, usable, drifted}`）。

- [ ] **Step 1: Write the failing test** —— 假 api 对 `{`/v3/posting/fbs/list`:404, `/v4/posting/fbs/list`:200, `/v2/review/list`:403}` 返回；断言 `drifted` 含 `/v3/posting/fbs/list`、`usable` 含 `/v4/posting/fbs/list`、403 落 `blocked` 列表且不崩。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/probe.test.mjs`。
- [ ] **Step 3: Implement** —— 逐条 `api.call`，捕获 `ApiError` 记 `status/code/message`；`writeFile` 注入以便测试不落盘。
- [ ] **Step 4: Run test → pass**；**live**：`node bin/ozon.mjs probe`（约 15 次调用，注意 `/v1/analytics/data` 限频），检查 `src/endpoints.json` 中 `drifted` 含 `/v3/posting/fbs/list`。
- [ ] **Step 5: Commit** —— `feat: endpoint probe matrix and endpoints.json`。

### Task 6: `ozon pull products`（商品/价格/库存）

**Files:**
- Create: `src/pull/products.mjs`, `test/pull-products.test.mjs`

**Interfaces:**
- Produces: `pullProducts({api, db, pageSize = 1000})` → `{products, pages, prices, stocks}`；按 `last_id` 翻页直到 `items.length < pageSize`；`/v3/product/info/list` 每批 ≤100 个 `product_id`；`/v5/product/info/prices` 与 `/v4/product/info/stocks` 按 `offer_id` 批量（每批 ≤100）。全部带 `captured_at`。

- [ ] **Step 1: Write the failing test** —— 假 api：第一页 2 条 `last_id='p2'`、第二页 1 条；断言 `db.products` 2 行、`pages===2`；价格写入 `price_cny` 与 `commission_rate`（rFBS 12）、库存写 `present/reserved`；重复调用不产生重复行。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/pull-products.test.mjs`。
- [ ] **Step 3: Implement** —— `total` 与 `total_items` 都读（2026-11-23 迁移）；`archived` 布尔入库；空列表短路。
- [ ] **Step 4: Run test → pass**；**live**：`node bin/ozon.mjs pull products`，再 `node -e` 查 `SELECT count(*) FROM products`（期望 ≥3）。
- [ ] **Step 5: Commit** —— `feat: pull products with prices and stocks`。

### Task 7: `ozon pull postings`（订单，cursor 分页）

**Files:**
- Create: `src/pull/postings.mjs`, `test/pull-postings.test.mjs`

**Interfaces:**
- Produces: `pullPostings({api, db, since, to, limit = 1000})` → `{inserted, updated, pages}`；调 `/v4/posting/fbs/list`（`dir:'ASC'`, `filter:{since,to}`），循环 `cursor` 直到 `has_next===false`；按 `posting_number` 去重；另调 `/v4/posting/fbs/unfulfilled/list` 标记 `pending_shipment`。

- [ ] **Step 1: Write the failing test** —— 假 api 第一页 `has_next:true, cursor:'c1', postings:[A,B]`，第二页 `has_next:false, postings:[B]`；断言 2 行（B 去重）、`pages===2`、`pending_shipment` 按未发货清单置位；`has_next:true` 但 cursor 为空时抛明确错误而非死循环。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/pull-postings.test.mjs`。
- [ ] **Step 3: Implement** —— 写入 `postings.status/in_process_at/shipment_date/price`（币种按响应字段，若为 RUB 写 `price_rub`）。
- [ ] **Step 4: Run test → pass**；**live**：`node bin/ozon.mjs pull postings --since 2026-09-01 --to 2026-11-06`，查 `SELECT count(*) FROM postings`（期望 >0）。
- [ ] **Step 5: Commit** —— `feat: pull postings with cursor pagination`。

### Task 8: `ozon pull analytics` + `ozon fx sync`

**Files:**
- Create: `src/pull/analytics.mjs`, `src/pull/fx.mjs`, `test/pull-analytics.test.mjs`, `test/fx.test.mjs`

**Interfaces:**
- Produces:
  - `chunkDateRange(from, to, maxDays = 31)` → `[{from,to}]`（按天切，含边界）。
  - `pullAnalytics({api, db, from, to, now})` → `{rows, chunks}`；每次 `POST /v1/analytics/data`，`metrics` 固定 12 项，`dimension:['day']`，`limit:1000`；写 `analytics_daily`（`revenue_rub` 数值）。
  - `syncFx({db, fetchImpl = fetch, today = new Date()})` → `{date, rubPerCny, source}`；解析 CBR `XML_daily.asp` 的 `Valute[CharCode=CNY]`，`rub_per_cny = Value / Nominal`，写 `fx_rates`。

- [ ] **Step 1: Write the failing test** —— `chunkDateRange('2026-09-01','2026-10-31')` 每片 ≤31 天且首尾相接覆盖全区间；`pullAnalytics` 假 api 对每片返回 2 行，断言写库 4 行且 `revenue_rub` 为数字；`syncFx` 用 fixture XML 断言 `rubPerCny` 精度 4 位、重复调用同日只 1 行。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/pull-analytics.test.mjs test/fx.test.mjs`。
- [ ] **Step 3: Implement** —— 限频：同进程内 `/v1/analytics/data` 两次调用间隔 ≥60s（用注入 `sleep/now`，测试传 0 间隔实现）；`from/to` 用 `YYYY-MM-DD`。
- [ ] **Step 4: Run test → pass**；**live**：`node bin/ozon.mjs pull analytics --days 30` 与 `node bin/ozon.mjs fx sync`；查 `SELECT sum(revenue_rub) FROM analytics_daily` >0。
- [ ] **Step 5: Commit** —— `feat: analytics pull with date chunking and fx sync`。

### Task 9: `ozon finance reconcile`（币种对账）

**Files:**
- Create: `src/commands/reconcile.mjs`, `test/reconcile.test.mjs`

**Interfaces:**
- Produces: `reconcileMonth({api, db, month:'YYYY-MM'})` → `{analyticsRub, financeRub, deltaPct, verdict}`；`verdict='FACT_RUB'` 当 `|deltaPct| ≤ 5`，否则 `'UNKNOWN'` 并给出下一步建议；`/v1/finance/balance` 单次区间 ≤1 个月。

- [ ] **Step 1: Write the failing test** —— 假 api 返回 analytics 合计 300.00、balance 合计 294.30，断言 `verdict==='FACT_RUB'` 且 `deltaPct` 约 1.9；再给 100 vs 900 断言 `verdict==='UNKNOWN'`。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/reconcile.test.mjs`。
- [ ] **Step 3: Implement** —— 对比 `analytics_daily` 月度合计（RUB）与 `/v1/finance/balance` 的 `date_from/date_to` 合计；输出中文结论与建议。
- [ ] **Step 4: Run test → pass**；**live**：`node bin/ozon.mjs finance reconcile --month 2026-09`。
- [ ] **Step 5: Commit** —— `feat: finance reconcile for currency口径`。

### Task 10: 单位经济规则（六档费率）

**Files:**
- Create: `src/rules/economics.mjs`, `test/economics.test.mjs`

**Interfaces:**
- Produces: `computeUnitEconomics(input)` → `{tier, chargeableG, logisticsCny, electronicFeeCny, commissionCny, acquiringCny, returnCny, adCny, totalCostCny, contributionCny, contributionRate, priceWeightRatio, labels:{rate_confidence, commission_assumed}}`。
- `input`: `{priceCny, fxRubPerCny, purchaseCny, domesticFreightCny, packagingCny, actualWeightG, dimsCm:{l,w,h}, commissionRate, acquiringRate=0.0015, returnRate=0.08, adRate=0.12}`。

- [ ] **Step 1: Write the failing test** —— 六档表按货值/实重选档：`¥120/400g` → Extra Small 固定 ¥2.90 + 0.0247×400 = ¥12.78 运输；`¥120/600g` → Small ¥15.48+0.0242×600=¥30.00；`¥120/600g 箱规 20×15×8` → Big 档（体积重 2400 g）固定 ¥34.82+0.0164×2400=¥74.18；`¥120/600g 且货值 ¥135` 边界测试：货值 135.01 进 Small；电子费下限：货值 ¥67 以下恒为 ¥15 RUB 折 CNY；贡献率 <20% 时 `contributionRate` 正确；缺 `commissionRate` 时 `labels.commission_assumed===17` 且不抛错。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/economics.test.mjs`。
- [ ] **Step 3: Implement** —— 档位判定顺序：先按货值分区间，再按实重；Big/Premium Big 计抛；电子费按 RUB 算后折 CNY；所有金额四舍五入到 0.01。
- [ ] **Step 4: Run test → pass** —— `node --test test/economics.test.mjs`。
- [ ] **Step 5: Commit** —— `feat: six-tier OGL unit economics`。

### Task 11: 选品评分与结论

**Files:**
- Create: `src/rules/selection.mjs`, `test/selection.test.mjs`

**Interfaces:**
- Produces: `evaluateCandidate(candidate, settings)` → `{verdict:'TRY'|'HOLD'|'REJECT', score, blockers[], gaps[], economics}`；硬筛（形态/合规/品牌/重量/箱规/禁入区）命中 → `REJECT`；缺市场证据或费率 → `HOLD`；`score` 0–100 由需求/竞争/价重比/贡献率加权。

- [ ] **Step 1: Write the failing test** —— 用例 1：`¥10.0/200g` → `REJECT`（价重比 0.05 <0.30，且 Budget/禁入）；用例 2：`¥60/80g`、贡献率 22% 但无市场证据 → `HOLD` 且 `gaps` 含 `market_evidence`；用例 3：`¥160/600g`、证据齐全、贡献 25% → `TRY`；用例 4：标的 12% 贡献（灰区）→ `HOLD` 且 `gaps` 含 `rate_check`。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/selection.test.mjs`。
- [ ] **Step 3: Implement** —— 硬筛表与权重从 spec §6.2 取；`settings.rate_confidence==='E'` 时结论总是带 `rate_check` gap。
- [ ] **Step 4: Run test → pass**。
- [ ] **Step 5: Commit** —— `feat: candidate scoring with HOLD gaps`。

### Task 12: 候选与证据 CLI + 选品报告

**Files:**
- Create: `src/commands/selection-cli.mjs`, `src/render/selection.mjs`, `test/selection-cli.test.mjs`

**Interfaces:**
- Produces:
  - `addCandidate({db, candidate})`（写 `candidates`，返回 id）。
  - `importEvidence({db, csvText, candidateId})` → `{imported, skipped}`；CSV 列：`ru_query,cards_total,cards_100plus,cards_recent_reviews,avg_price_rub,sellers_count,top_share`。
  - `renderSelectionReport(rows)` → Markdown 表格（细分/俄语词/需求证据/卖家数/价重比/贡献率/结论/缺口）。
  - CLI：`ozon candidate add --json <file>`、`ozon evidence import --candidate <id> --csv <file>`、`ozon select`。

- [ ] **Step 1: Write the failing test** —— `importEvidence` 喂 3 行 CSV（含 1 行缺列）→ `{imported:2, skipped:1}`；`renderSelectionReport` 输出含表头与 `HOLD`；`select` 对无证据候选打 `HOLD`、对齐全候选打 `TRY`。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/selection-cli.test.mjs`。
- [ ] **Step 3: Implement** —— CSV 解析手写（逗号+引号转义）；报告写到 `reports/selection-<date>.md` 并打印路径。
- [ ] **Step 4: Run test → pass**，然后 `node --test` 全量，期望全部 PASS。
- [ ] **Step 5: Commit** —— `feat: candidate and evidence CLI with selection report`。

### Task 13: `ozon pull categories`（类目树 + 复现 leaf_count）

**Files:**
- Create: `src/pull/categories.mjs`, `test/pull-categories.test.mjs`

**Interfaces:**
- Produces: `pullCategories({api, db})` → `{nodes, leaves, depth, bytes}`；调 `/v1/description-category/tree`（参数 `language:'ZH_HANS'`），递归统计叶子；整棵树 JSON 存 `settings['category_tree']`（`key/value`，value 为 JSON 字符串），并写 `settings['category_tree_fetched_at']`。
- 复现：`countLeaves(tree)` 导出给测试与一次性脚本用。

- [ ] **Step 1: Write the failing test** —— fixture 树（1 个根 → 2 个子类，其中 1 个有 2 个叶子），断言 `countLeaves(tree)===2`、`pullCategories` 写 `settings['category_tree']` 且 `leaves===2`；再对 `raw/pull-20261106103425/tree.json` 跑 `countLeaves`，断言 **7363**（若文件缺失则 skip）。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/pull-categories.test.mjs`。
- [ ] **Step 3: Implement** —— 叶子判定：节点无 `children` 或 `children.length===0`；`nodes` 统计所有节点；把树压缩存（原样 JSON）。
- [ ] **Step 4: Run test → pass**；**live**：`node bin/ozon.mjs pull categories`，期望打印叶子数（对照 baseline 的 7,363；若一致说明 `leaf_count=0` 是旧脚本输出问题，不是数据问题）。
- [ ] **Step 5: Commit** —— `feat: pull category tree and reproduce leaf count`。

---

## 完成定义（P0+P1）

- `node --test` 全绿（≥13 个测试文件）。
- 真机跑通：`ozon status`、`ozon probe`、`ozon pull products`、`ozon pull postings --since 2026-09-01 --to 2026-11-06`、`ozon pull analytics --days 30`、`ozon pull categories`、`ozon fx sync`、`ozon finance reconcile --month 2026-09`、`ozon select`。
- `db/ozon.db` 里 `products ≥3`、`postings ≥1`、`analytics_daily` 有 RUB 数值、`fx_rates` 有当天汇率、`settings['category_tree']` 存在且叶子数 7,363。
- 输出与报告里没有明文 Client-Id / API Key。

## 后续计划（单独立计划，不在本文件展开）

- P2（翻译/图片/上架 payload）：两段式翻译 + 本地 SDXL 工作流 + `outbox/listing/` 产物。
- P3（日报/预警/提案执行 + DSH 插件与定时任务）。
- P4（Performance API 投流建议）。
