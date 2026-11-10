# 交付清单 · OZON AI 跨境运营系统

交付日期：2026-11-06 · 路径：`ozon-ops` · 分支 `feat/ozon-ops`（本地仓库，无 remote）

## 一句话

一个可托管真钱的 OZON 运营系统：**取数内核 + 选品决策台 + 内容生产（翻译/生图/上架）+ 运营闭环（预警/日报/提案护栏）+ DSH 插件与定时任务**；P4 投流提供离线 CSV 链路与 API 客户端，真拉数待 Performance 凭据。

## 阶段交付

### P0/P1 取数内核 + 选品决策台

| 能力 | 入口 | 验证 |
|---|---|---|
| 配置/打码 | `.secrets/ozon.env` → `1234***` | `ozon status` |
| API 客户端（429/退避/缓存/审计/超时） | `src/api.mjs` | `api.test.mjs` |
| 端点探活 | `ozon probe` → `src/endpoints.json` | 22 端点：usable 15 / blocked 4 / drifted 1 / needsParams 1 / failed 0 |
| 商品/订单/分析/类目 | `ozon pull …` | 3 / 25 / 30 行；类目 7363 叶 |
| 汇率 | `ozon fx sync` | CBR 1 CNY = 12.257 RUB（2026-11-06）；区间校验 1–100 |
| 财务对账 | `ozon finance reconcile --month` | 结算 1234.56 RUB，结论 `RUB_GMV_VS_SETTLED` |
| 六档单位经济 | `src/rules/economics.mjs` | OGL CNY 费率、计抛、电子费；fx/价格/重量非法 → HOLD |
| 选品评分 | `ozon select` | 候选 → HOLD（缺口 rate_check、commission_check） |
| 候选/证据 CLI | `ozon candidate add` / `ozon evidence …` | `data-candidate-example.json` 实测 |

### P2 内容生产

| 能力 | 入口 | 验证 |
|---|---|---|
| 两段式翻译 + 回译 + 术语覆盖 | `ozon translate prepare/commit` | EXAMPLE-OFFER-1 覆盖 100%；零术语场景允许提交 |
| 上架 QA + payload | `ozon listing build` | `payload.ru.json` + `qa.json`（QA passed） |
| 竞品视觉拆解 | `ozon intel design --sku` | 7 图、配色 #002040、区块 heading→image→text→image→table |
| 主图/详情组合成 | `ozon design compose` | 900×1200，俄语标题自动缩字号 |
| 文字层 | `src/content/textlayer.mjs` | Pillow 渲染西里尔文字 |
| AI 生图（第三方） | Lovart MCP | `gpt-image-2` 1536×2048，12 credits/张；代理下载 |
| AI 生图（本地） | `ozon image generate` / `image comfy` | ComfyUI CPU 1 步 512² ≈ 10s；diffusers ≈ 60s；sd-turbo 需英文 prompt |

### P3 运营闭环

| 能力 | 入口 | 验证 |
|---|---|---|
| 预警 | `ozon alerts` | 3 条 P1；库存/价格只取最新快照 |
| 日报/周报/看板 | `ozon report` / `report weekly` | `reports/daily-*.md`、`weekly-*.md`、`dashboard.html` |
| 写操作护栏 | `ozon action propose/approve` | 白名单 + 确认码（crypto、15 分钟 TTL）+ 按条目限额 + 默认 dry-run；写接口不重试；状态 executed/approved/failed/unknown |
| DSH 插件 | `@local/ozon-ops` | 1 技能 + 1 工具（17 action）；工具面不能执行写操作 |
| 定时任务 | 3 个（Asia/Shanghai） | 每日 07:30 取数、08:00 日报、周一 09:50 周报 |

### P4 投流

| 能力 | 入口 | 验证 |
|---|---|---|
| Performance 客户端 | `src/ads/performance.mjs` | OAuth client_credentials → Bearer，token 缓存 |
| 同步 | `ozon ads sync` | 无凭据 → `NO_CREDENTIALS`；不伪造按日数据 |
| CSV 导入（离线可用） | `ozon ads import --file` | 3 行 / 2 计划；支持俄/英表头、千分位/小数逗号 |
| ACOS 与预算建议 | `ozon ads report/suggest` | 花费 1000、收入 2600、ACOS 38.5%；2 条建议 |

## 质量证据

- **测试：148/148 通过**（`node --test`）
- **独立代码评审**：3 Critical / 12 Important / 5 Minor，Critical 与 Important 全部修复并复验
- **安全**：真实 API Key 从未进入 git（全文历史搜索为空）；`data/`（浏览器 profile，含 Cookies）已从历史彻底清除；`.secrets/`、`db/`、`reports/`、`outbox/`、`data/`、`models/` 均 gitignore
- **示例数据**：`db/ozon.db` 含 3 商品、25 订单、30 天分析、20 竞品、18 评论、6 社媒帖、2 翻译稿、3 广告行、57 次 API 审计

## 目录

```
bin/ozon.mjs          唯一 CLI 入口（status/probe/pull/fx/finance/select/candidate/evidence/
                      intel/translate/listing/design/image/alerts/report/action/ads）
src/{config,api,db}.mjs
src/pull/             products postings analytics categories fx
src/rules/            economics selection alerts listing-qa
src/render/report.mjs 日报/周报/看板
src/content/          translate glossary images textlayer comfyui image-generate image-env fetch-image
src/intel/            ozon-front browser store pains social design design-commands
src/ads/              performance sync import rules report
plugin/               DSH 插件 @local/ozon-ops
scripts/              维护脚本（模型下载、DB 盘点等）
docs/                 设计、计划、验收、经验
```

## 已知限制

1. **P4 真拉数**：需 `OZON_PERF_CLIENT_ID/SECRET`（Ozon Performance 后台建应用）。代码已就绪，配好即用。
2. **评论星级**：Ozon DOM 的 `statusid` 是评论状态不是星级；痛点分析用关键词命中。
3. **VK**：搜索页需登录态，无 token 返回 0 字节；社媒覆盖 Telegram + YouTube。
4. **本地生图**：sd-turbo 对俄语提示词几乎无响应，必须英文 prompt。
5. **类目**：`pull categories` 只统计叶子数，未落表。

## 运维速查

```bash
# 每天
node bin/ozon.mjs pull products && node bin/ozon.mjs pull postings
node bin/ozon.mjs alerts && node bin/ozon.mjs report

# 选品
node bin/ozon.mjs candidate add --file data-candidate-example.json && node bin/ozon.mjs select

# 内容
node bin/ozon.mjs translate prepare --offer <id> --zh zh.json
node bin/ozon.mjs translate commit --offer <id> --filled filled.json
node bin/ozon.mjs listing build --offer <id> --images images.json

# 写操作（永远两步，第二步行才真正执行）
node bin/ozon.mjs action propose --type stock_update --payload p.json
node bin/ozon.mjs action approve --id 1 --code <确认码> [--execute]
```

## 补记（2026-11-09）

- **广告搜索词判定引擎已重建**：`src/ads/decide.mjs` + `ozon ads decide` + `scripts/ads-decide.mjs`；用原始样本 `raw/ads-sample.csv` 对齐归档判定（规则 #1/#2/#4/#5/#8/#10 与 §8 预算分配 P1/W2=4000、H1=300、余 1700），回归测试 5 个。详见 [ads-decide-engine.md](ads-decide-engine.md)。
- **Git 历史重写已文档化**：见 [HISTORY-REWRITE-2026-11-06.md](HISTORY-REWRITE-2026-11-06.md)，并提供 `scripts/verify-secrets.mjs` 自检（当前输出：干净）。
- **P4 接入指引**：[performance-api-setup.md](performance-api-setup.md)；`ozon ads doctor` 实测端点可达（HTTP 401，缺凭据）。
## 新增运营能力（2026-11-09 第二批）

| 能力 | 入口 | 说明 |
|---|---|---|
| 补货预测 | ozon stock forecast | 最新库存快照 + 近 30 天订单明细销量 → 日均、覆盖天数、建议补货量（按 pack 取整）、P0/P1/P2 |
| 成本表 | ozon cost set/list | 采购价/国内运费/包装/重量/尺寸/供应商，upsert 到 sku_costs；缺省字段保留旧值 |
| SKU 毛利表 | ozon report margin | 售价 + 成本 + 六档单位经济 → 单件贡献/贡献率；缺成本 HOLD，亏损 NEGATIVE |
| 广告搜索词判定 | ozon ads decide | 规则 #1/#2/#4/#5/#8/#10 + §8 预算分配；重建并与归档产物对齐 |
| Performance 自检 | ozon ads doctor | 凭据检查 + 端点探活（实测 HTTP 401 可达）+ 接入步骤 |

测试：158/158；插件 action 增至 22 个。

## 新增：Monitor 与按 SKU 分析（2026-11-09 第三批）

- `ozon monitor`：本地 HTTP 作战室（预警流 / KPI / 14 天走势 / 竞品异动 / 数据新鲜度 / 端点健康），15 秒轮询 `/api/state`；`--once` 导出单文件 HTML。
- `ozon pull analytics --by-sku`：按 SKU 维度拉分析数据，实测写入 2 行（sku 1234567890，2026-11-07/08）。
- 测试：monitor 2 个 + analytics bySku 1 个；全量 162/162。

## 新增：关键词包（2026-11-09 第四批）

- `ozon ads keywords --file <csv>`：从搜索词判定结果生成标题补充 / 后台关键词 / 不要用三块，输出 `reports/keywords-<date>.{md,json}`。
- `ozon listing build --keywords <json>`：关键词写进 `backend-fields.md` 的关键词段，人工粘贴后台即可。
- 实测：`ads keywords --file raw/ads-sample.csv` → 后台关键词 2 个、标题补充 1 个；`listing build` 后 backend-fields 含关键词段。
- 测试：keywords 4 个（含 listing 集成）；全量 166/166。

## 新增：批量生图编排（2026-11-09 第五批）

- `ozon image plan --manifest … --budget …`：生成任务清单与台账，预算不足直接拒绝，超预算任务标记 skipped。
- `ozon image record --batch … --task … --url … --credits …`：代理下载 + 登记 + 校验（比例 3:4、最小宽度）。
- `ozon image batch-status --batch …`：完成数 / 已花 credits / 每任务状态。
- 实测：demo-lovart-2026-11 批次 2/2 完成（lifestyle、detail，均 1536×2048），台账 24 credits；Lovart 账户当前 5000 credits（member，concurrency 8）。
- 测试：image-batch 5 个；全量 174/174。

## 新增：批量生图 → 上架一条命令（2026-11-09 第六批）

- `ozon image batch-to-listing --batch <id> --offer <id> [--keywords …]`：台账取 done 图 → `normalizeMainImage` 统一 900×1200 → `images.json` → `listing build`（可带关键词包）。
- 少于 3 张直接拒绝；未完成任务数会提示。
- 实测：demo-assembled-2026-11（main/lifestyle/detail 三张）→ 3 张 900×1200 → EXAMPLE-OFFER-2 payload + QA 100 分通过。
- 测试：batch-images 2 个；全量 176/176；插件 action 27 个。
## 新增：上架字段自动填充（2026-11-09 第七批）

用户明确要求：条形码自动生成、特征页重量必填、商品数量必填、标签列全热点搜索词、简介生成并填写、能填尽量填（填得越全权重越高）。实现与实测见 [listing-autofill.md](listing-autofill.md)。

- 新增模块：`src/content/barcode.mjs`（EAN-13 内部码 + GS1 校验）、`src/content/listing-facts.mjs`（事实库/缺口校验）、`src/content/listing-compose.mjs`（import 载荷 + 库存载荷 + 后台清单）。
- `assets/listing-facts.json`：5 个在售 SKU 的示例重量/尺寸/数量/属性/热搜词/简介，已生成 `outbox/listing/DEMO-*` 全套产物（QA completeness 1.0）。
- CLI：`listing build --offer <id|SKU> [--facts …]`、`listing check --offer <id|SKU>`；`image batch-to-listing` 现在同样要求 facts。
- QA 新增必填：条码/重量/尺寸/数量/标签/价格/类目；返回 `completeness.ratio`。
- 选品：`spec.listingFacts` 会算出上架数据缺口；未提供 fact 的非淘汰候选标 `listing_facts`。