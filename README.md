# ozon-ops · OZON AI 跨境运营系统

开源的 OZON（俄罗斯电商平台）卖家运营内核：取数、单位经济、选品、翻译上架、竞品视觉拆解、广告判定、预警日报、情报大屏，一个 Node.js CLI + SQLite 全搞定。设计文档见 [docs/superpowers/specs/2026-11-06-ozon-ai-ops-design.md](docs/superpowers/specs/2026-11-06-ozon-ai-ops-design.md)。

> **开源范围**：本仓库只包含代码与技术文档。**不含**任何真实店铺凭据、店铺经营数据、供应商名单与采购价、选品调研报告、商品图片/视频资产。仓库内示例数据（`data-*-example.*`）全部为虚构示例；凭据只在你本地 `.secrets/ozon.env`。
>
> 纯 CLI 可用；[DeepSeek Harness](https://github.com/deepseek-ai)（DSH）插件 `plugin/` 可选，装上后 Agent 里能直接调 `ozon_ops` 工具。

## 能力总览

| 阶段 | 能力 | 入口 |
|---|---|---|
| P0 | 配置/打码、SQLite 迁移、API 客户端（429/退避/审计/缓存）、`status`、`probe` | `node bin/ozon.mjs status` / `probe` |
| P1 | `pull products/postings/analytics/categories`、`fx sync`、`finance reconcile`、六档单位经济、选品评分、候选/证据、选品报告 | `pull` / `fx` / `finance` / `select` |
| P2 | 两段式翻译（prepare/commit + 回译 + 术语覆盖）、上架 QA、`listing build`（条码/重量/数量/标签/简介自动填，payload 不自动创建）、`listing check`（事实库缺口）、竞品视觉拆解、主图/详情页合成、Pillow 俄语文字层、AI 生图（Lovart / 本地 ComfyUI） | `translate` / `listing` / `intel design` / `design compose` / `image` |
| P3 | 预警（断货/发货/价格指数/退货率/数据陈旧）、日报/周报/看板、写操作提案-确认码-dry-run-限额、DSH 插件 `@local/ozon-ops`、定时任务 | `alerts` / `report` / `action` / `ozon_ops` 工具 |
| P4 | Performance API 客户端（OAuth + Bearer）、`ads sync`、ACOS 预警 | `ads sync` / `ads acos` |

## 快速开始

```bash
git clone https://github.com/tiantangcao1980-web/ozon-ops.git && cd ozon-ops
npm install

# 凭据：复制示例后填真实值；.secrets/ 已在 .gitignore
mkdir -p .secrets && cp ozon.env.example .secrets/ozon.env

node bin/ozon.mjs status          # 店铺与权限
node bin/ozon.mjs probe           # 端点探活，写 src/endpoints.json
node bin/ozon.mjs pull products   # 全量商品
node bin/ozon.mjs pull postings   # 订单（含金额币种）
node bin/ozon.mjs pull analytics --days 30
node bin/ozon.mjs fx sync         # CBR → 兜底
node bin/ozon.mjs alerts          # P0/P1 预警
node bin/ozon.mjs report          # 日报 + 看板 reports/
node bin/ozon.mjs report weekly   # 周报
```

选品：

```bash
node bin/ozon.mjs candidate add --file data-candidate-example.json
node bin/ozon.mjs select               # TRY / HOLD / REJECT
```

写操作（永远两步）：

```bash
node bin/ozon.mjs action propose --type stock_update --target A --payload p.json   # 出确认码
node bin/ozon.mjs action approve --id 1 --code 123456                              # 默认 dry-run
node bin/ozon.mjs action approve --id 1 --code 123456 --execute                    # 真正调用
```

## 运营决策

```bash
node bin/ozon.mjs stock forecast --lead 14 --safety 14   # 补货：最新库存 + 近30天订单明细 → 覆盖天数/建议补货/P0-P2
node bin/ozon.mjs cost set --offer A --purchase 25 --weight 300 --dims 20x10x5  # 维护成本表
node bin/ozon.mjs cost list
node bin/ozon.mjs report margin                          # SKU 毛利表（单件贡献/贡献率/缺口）
node bin/ozon.mjs ads decide --file raw/ads-sample.csv   # 搜索词判定 + 预算分配
node bin/ozon.mjs ads doctor                             # Performance 凭据自检
```

- 补货：日期窗口内按 `postings.items_json` 汇总销量，覆盖天数低于提前期 → P0，低于提前期+安全库存 → P1。
- 毛利：缺 `sku_costs` 时返回 HOLD + `cost_missing`，不编造成本；贡献率 <0 记 NEGATIVE。
- 搜索词：规则 #1/#2/#4/#5/#8/#10，预算按 §8 权重分配（floor 150 / cap 40%）。

## 边界

- 凭据只在 `.secrets/ozon.env`，输出打码，Key 不入日志/报告/测试。
- 写操作默认 dry-run，需人工确认码；工具面（DSH 插件）不能执行，只能提案。
- 上架只产 `import.json` / `payload.ru.json` / `stocks.json`，不调用商品创建/改库存 API；条码/重量/数量/标签/简介自动填充，见 [docs/listing-autofill.md](docs/listing-autofill.md)。
- 竞品视觉只学结构/配色/区块顺序，成图必须自家实拍或 AI 生成。
- 不抓买家账号、不绕验证码；VK 搜索页无登录态不可用。

## 测试

```bash
npm test          # 等价于 node --test "test/*.test.mjs"
```

- 单元测试不依赖真实凭据，全部跑本地夹具。
- 少量用例依赖本机 Python + Pillow（俄语文字层渲染）；未安装时自动 skip，不影响其余用例。
- 上架事实库（`assets/listing-facts.json`）属于店铺业务数据，不在本仓库，相关用例也一并移除。

## 目录

```
bin/ozon.mjs            唯一 CLI 入口
src/config.mjs          .secrets 解析 + 打码
src/api.mjs             POST + 429/退避 + 审计 + 缓存
src/db.mjs              SQLite 迁移 v1–v6
src/pull/               products / postings / analytics / categories / fx
src/rules/              economics（OGL 六档）、selection、alerts、listing-qa
src/render/report.mjs   日报/周报/看板
src/commands/           status、probe、reconcile、listing、actions
src/content/            translate、glossary、images、textlayer、comfyui、fetch-image
src/intel/              ozon-front、browser、store、pains、social、design、design-commands
src/ads/                performance、sync
plugin/                 DSH 插件 @local/ozon-ops（技能 + 工具），默认从仓库根启动 CLI
scripts/                维护/探活/抓取脚本（开发期工具，按需使用）
docs/                   设计文档、计划、实测笔记
```

## 已知限制

- 本地图片生成：ComfyUI 可离线跑（CPU，1 步 512² 约 10 秒）；sd-turbo 对俄语提示词几乎不响应，本地生成请用英文 prompt；Lovart 中文/俄语均可。
- Performance API 需 `OZON_PERF_CLIENT_ID/SECRET`，未配置时 `ads sync` 报 `NO_CREDENTIALS`。
- 评论星级无可靠 DOM 字段，痛点分析用关键词命中。
- 市场级分析接口需要 Premium Pro；未订阅时相关命令在报告里标 `no_access`。

## OZON Monitor（作战室面板）

```bash
node bin/ozon.mjs monitor                 # 启动 http://127.0.0.1:8288（15 秒自动刷新）
node bin/ozon.mjs monitor --once          # 只导出 reports/monitor.html + monitor-<date>.json
node bin/ozon.mjs monitor --port 9000
```

面板：预警流（P0/P1/P2 色带）、14 天销量走势 + KPI、竞品价格异动、数据新鲜度、端点健康（probe 摘要）。单文件暗色 UI，无外部资源；`/api/state` 可直接给其它看板/监控系统用。

## OZON 情报大屏

在 `monitor` 之上新增的 1920×1080 大屏，把外部商业监控产品的模块形态补齐到本地运营数据：

```bash
node bin/ozon.mjs screen                 # http://127.0.0.1:8289（SSE 5 秒推送，窗口自适应缩放）
node bin/ozon.mjs screen --demo          # 确定性演示数据（不写库，用于对外演示/投屏）
node bin/ozon.mjs screen --once          # 只导出 reports/screen.html + screen-<date>.json
node bin/ozon.mjs screen --port 9000
```

| 模块 | 形态 | 本地数据来源 |
|---|---|---|
| 情报流 | 18 分类 + threat/importance/credibility | 预警、竞品快照、评论、社媒、痛点聚类 |
| 风险指数 | 多分量 CII + trend + advisory | 库存/物流/价格/需求/汇率 五分量加权 |
| 中俄物流节点 | 咽喉点状态色 | 待发货、在途、库存覆盖天数 |
| 行情 | price/change/sparkline | CNY/RUB、竞品价格指数、广告 CPC、日单量 |
| 数据健康 | feedStatuses / coverage | api_calls 与各表 captured_at |

单文件暗色 UI，无外部资源（世界地图为 Natural Earth 110m 生成的本地矢量）；`/api/state` 可直接给其它看板消费。取证与数据契约见 [docs/intel/worldmonitor-closed-surface-2026-11-10.md](docs/intel/worldmonitor-closed-surface-2026-11-10.md)。

## 情报管道（抓取 → 清洗 → 去噪 → 大屏）

把库内信号、RSS、Telegram 公开频道、外部抓取产物统一成一条情报流，噪声在入库前处理掉：

```bash
node bin/ozon.mjs intel harvest --source db                     # 预警/竞品/评论/社媒/痛点（同类预警自动聚合）
node bin/ozon.mjs intel harvest --source rss --feeds "<url,...>" --limit 40   # 俄语经贸/综合新闻
node bin/ozon.mjs intel harvest --source tg --channels "ozon_marketplace" --proxy http://127.0.0.1:7897
node bin/ozon.mjs intel harvest --source file --file raw/crawl-result.json   # crawl4ai/crawlee 产物
node bin/ozon.mjs intel stats                                   # 来源/类别/语言/威胁分布
node bin/ozon.mjs intel list --limit 20 [--category finance] [--lang ru]
```

去噪规则：空/过短、非 ru-zh-en、促销词≥2、样板文案、导航碎片、词频刷屏、规范 URL 精确重复、标题 Jaccard≥0.85 近似重复，以及与 OZON 无关的话题（话题加权分 <3）。分类只跑标题，摘要只参与去噪。详见 [docs/intel/intel-pipeline-2026-11-10.md](docs/intel/intel-pipeline-2026-11-10.md)。

## 按 SKU 的分析取数

```bash
node bin/ozon.mjs pull analytics --by-sku --days 30
```

`analytics_daily.sku` 不再全为空：按 `dimension: ['sku','day']` 落库，供后续 SKU 级流量/转化/选品使用。

## 关键词包（广告判定 → 上架素材）

```bash
node bin/ozon.mjs ads keywords --file raw/ads-sample.csv            # 生成 reports/keywords-<date>.{md,json}
node bin/ozon.mjs listing build --offer <id> --images images.json --keywords reports/keywords-<date>.json
```

输出三块：标题补充（赚钱词/漏词且不在标题里）、后台关键词（可直接粘贴）、不要用（词或商品卡不匹配）。`listing build` 会把它们写进 `backend-fields.md` 的关键词段。

## 批量生图（plan / record / status）

```bash
node bin/ozon.mjs image plan --manifest data-image-batch-example.json --budget 24
# 按手册生成任务清单 + 台账 outbox/batches/<batchId>/ledger.json（先卡 credits 预算）
node bin/ozon.mjs image record --batch <id> --task lifestyle --url <art url> --credits 12
node bin/ozon.mjs image batch-status --batch <id>
```

生图工具在 Agent 侧（Lovart MCP），所以拆成三步：**plan（预算+prompt）→ 生成（Agent 调用 Lovart）→ record（下载+登记+校验比例/分辨率）**。台账记录每个任务的 credits、URL、本地路径与状态，超预算的任务直接跳过。

### 批量生图 → 上架（一条命令）

```bash
node bin/ozon.mjs image batch-to-listing --batch <batchId> --offer <offerId> [--keywords reports/keywords-<date>.json]
```

读 `outbox/batches/<batchId>/ledger.json`，只取 `status=done` 的图，统一裁成 900×1200（白底 3:4），生成 `images.json` 并直接跑 `listing build`。少于 3 张会拒绝（提示先补拍/继续生成）。

## 数据与隐私

- 仓库不含任何真实凭据与经营数据；请勿把 `.secrets/`、`data/`、`db/`、`raw/`、`reports/` 提交上来。
- 提交前可跑 `node scripts/verify-secrets.mjs` 自检：它会扫描工作区与 git 历史，确认本地凭据值没有泄漏。
- 抓取类脚本仅用于公开页面与自有后台数据，请遵守目标站点的 robots/服务条款。

## 许可

[MIT](LICENSE)。Issue / PR 欢迎，商业使用无需授权。
