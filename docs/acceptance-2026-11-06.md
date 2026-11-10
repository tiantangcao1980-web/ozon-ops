# 验收记录 · OZON AI 跨境运营系统

日期：2026-11-06 · 项目：`ozon-ops` · 分支：`feat/ozon-ops`（本地仓库）

## 1. 测试

```
$ node --test
# tests 131
# pass 131
# fail 0
```

覆盖：配置/打码、API 重试与审计、SQLite 迁移、status/probe、pull（products/postings/analytics/categories）、fx、reconcile、单位经济六档、选品评分、选品 CLI、翻译准备/提交、上架 QA、竞品视觉拆解与合成、预警规则、日报/周报/看板、写操作护栏、广告 CSV 导入/ACOS/预算建议、ComfyUI 客户端、图片格式嗅探。

## 2. 数据概览（`db/ozon.db`，示例值）

| 表 | 行数 | 说明 |
|---|---|---|
| products | 3 | 全部归档（realFBS），0 在售 |
| postings | 25 | 订单，金额为 CNY（`amount_currency`） |
| analytics_daily | 30 | 含 9 月 RUB GMV |
| fx_rates | 1 | CBR 1 CNY = 12.257 RUB（2026-11-06） |
| prices / stocks | 3 / 3 | 价格指数多 `WITHOUT_INDEX` |
| competitors | 20 | 搜索前两页（₽100–1200，均价 ₽300） |
| competitor_snapshots | 40 | 竞品价格快照 |
| reviews_raw | 18 | 俄语评论原文 |
| social_posts | 6 | Telegram 帖子 |
| pain_points / demand_signals | 8 / 2 | 痛点与需求信号 |
| competitor_images / design_patterns | 4 / 1 | 竞品主图与视觉拆解（配色 #002040 等） |
| listing_drafts | 2 | EXAMPLE-OFFER-1 / EXAMPLE-OFFER-2 翻译稿 |
| ads_daily | 3 | 广告 CSV 导入（2 个计划） |
| actions_log | 2 | 1 proposed / 1 approved（dry-run） |
| api_calls | 57 | 审计日志 |

## 3. 真机命令

| 命令 | 结果 |
|---|---|
| `ozon status` | Demo Store / CNY / Premium 否 / 0 在售 3 归档 / Client-Id `1234***` |
| `ozon probe` | 端点分类写入 `src/endpoints.json`（usable/blocked/drifted） |
| `ozon pull products/postings/analytics` | 3 / 25 / 30 行；订单金额 CNY 校验通过 |
| `ozon fx sync` | CBR 12.257（2026-11-06） |
| `ozon finance reconcile` | 输出 `FACT_RUB` / `CURRENCY_MISMATCH` 判定，不硬算 |
| `ozon select` | 候选出 TRY/HOLD/REJECT，缺参数给 HOLD+gaps |
| `ozon alerts` | 3 条 P1（价格指数 WITHOUT_INDEX） |
| `ozon report` / `report weekly` | `reports/daily-2026-11-06.md`、`dashboard.html`、`weekly-2026-11-06.md` |
| `ozon ads import/report/suggest` | 3 行/2 计划；ACOS 38.5%；2 条预算建议 |
| `ozon action propose/approve` | 提案 #2 出确认码；dry-run 批准不调用 API |
| `ozon image status/generate/comfy` | Lovart 12 credits/张；ComfyUI 本地 10.12s/张；diffusers 本地约 60s |
| `ozon intel design` / `design compose` | 竞品 7 图 + 配色入库；新主图 900×1200（俄语标题自动适配） |
| `ozon translate prepare/commit` / `listing build` | 术语覆盖 100%；`payload.ru.json` + QA passed |

## 4. DSH 集成

- 插件 `@local/ozon-ops` 已安装启用：1 个技能 `ozon-ops` + 1 个工具 `ozon_ops`（19 个 action），工具只走 CLI，写操作只能 proposal。
- 实机调用：`ozon_ops status`、`report`、`ads_report`、`ads_sync`（无凭据返回 `NO_CREDENTIALS`）均正常。
- 定时任务：每日 07:30 取数、每日 08:00 日报+预警、周一 09:50 周报（Asia/Shanghai，首跑 2026-11-09）。

## 5. 安全

| 检查 | 结果 |
|---|---|
| API Key 是否在仓库/历史 | **不在**（`git log -p --all` 搜历史中的密钥模式无命中） |
| Client-Id | 已从文档/测试替换为 `1234567`；输出统一 `1234***` 打码 |
| `.gitignore` | 覆盖 `.secrets/`、`db/`、`outbox/`、`reports/`、`models/`、`comfyui/`、`*.log` |
| 写操作 | 白名单 + 确认码 + 每日限额 + 默认 dry-run；工具面无 approve/execute |
| 工具面 | 无任何直接写 API 能力，全部经 CLI |

## 6. 已知限制

1. **P4 真拉数**：`ads sync` 需 `OZON_PERF_CLIENT_ID/SECRET`；当前走 CSV 导入路径完成 ACOS/预算建议。
2. **评论星级**：Ozon 评论节点 `statusid` 是状态非星级，痛点分析用关键词命中。
3. **VK 社媒**：搜索页无登录态返回 0 字节；社媒覆盖 Telegram + YouTube。
4. **本地生图**：sd-turbo 对俄语提示词几乎不响应，本地生成必须英文 prompt。
5. **分类**：`pull categories` 只统计叶子数（7363），未落表；需要时可加 `categories` 迁移。

## 7. 后续可做

- Performance 凭据到位后：`ads sync` → 真实 ACOS 预警（代码已就绪，仅缺凭据）。
- `categories` 落表 + 类目选择器。
- 评论星级：从商品页聚合分布（5.0/13k 条）而非逐条。

## 8. 代码评审修复（2026-11-06 独立评审）

评审结论：Critical 3 / Important 12 / Minor 5。本轮已修：

| 级别 | 问题 | 修复 |
|---|---|---|
| Critical | `data/` 含 Chrome Cookies 被 git 跟踪（961 文件） | 加 `.gitignore` → `git rm --cached` → filter-branch 清历史 → 删备份 refs → reflog+gc；验证无 data/ 对象 |
| Critical | 限额按「请求次数」而非条目数，一次可改全店价 | `countPayloadItems`：按 prices/stocks 条目计数，超限 `PAYLOAD_TOO_LARGE`；限额按 SUM(items) |
| Critical | 写接口无条件重试，超时后重复执行；失败状态记错 | 写操作 `maxRetries: 0`；无法确认时记 `unknown`，明确 4xx 才记 `failed` |
| Important | 确认码 6 位 Math.random、无 TTL、回传模型 | `crypto.randomInt`；15 分钟 TTL（`CODE_EXPIRED`）；插件 `action_propose` 不再执行、只返回终端指令 |
| Important | 库存预警跨历史快照求和；无库存行误报 P0 | 只取每个 SKU 最新快照，`JOIN` 代替 `LEFT JOIN`；新增 `test/alerts.test.mjs` |
| Important | 价格指数先过滤再 GROUP BY，历史 RED 永久告警 | 先取最新快照再判断颜色 |
| Important | 图片转换把路径拼进 Python 源码（注入） | 改为 argv 传参 |
| Important | `--offer/--sku/--out` 可越界写文件 | `safeId` 白名单校验 + `safeOutDir` 限定 outbox；实测拒绝 `../` |
| Important | 迁移并发（BEGIN deferred + 版本读在事务外） | `BEGIN IMMEDIATE` 内复核版本；duplicate/already exists 视为已应用 |
| Important | ads sync 把计划清单当日指标写库、401 仍 ok | 无按日字段不写库（返回 note）；HTTP 失败返回 `HTTP_ERROR` |
| Minor | 插件 `candidate_list`/`evidence_build` 映射错误（会触发写报告） | 从工具面移除这两个 action（17 个） |

仍未修（已记录，下一次迭代）：

- 汇率/币种口径：`fx` 无范围校验（0/负数/NaN 可流入单位经济）；`analytics` 未落币种、`reconcile` 写死 RUB、报表标 RUB。
- `api` Retry-After 无上限；`status` 并发 5 请求易触发 429。
- `pull/postings` 的 `price_rub` 恒空、pending 统计跨全库、N+1 查询。
- `ads/import` 分隔符只嗅探首行、`1,234.56` 会被吞成 0。


## 9. 备注

- 清历史时用 stash 暂存了两处未提交改动（`scripts/ads-decide.mjs`、`Ozon-广告数据接入与判定引擎-20261106.md` 的修改），filter-branch 重写 stash 后被我误清理，**已丢失**；仓库内其余代码与文档完整（HEAD 树未受影响）。
- 历史提交 SHA 因清历史全部重写；此前 ledger 中记录的旧 SHA 不再可用。
## 10. 第二轮评审修复（round 16）

| 级别 | 问题 | 修复 |
|---|---|---|
| Important | 汇率无校验，0/负数/NaN/反向汇率（0.08）会流入单位经济产生 Infinity/NaN | `assertValidFx`：有限且 1–100；`computeUnitEconomics` 对 fx/price/weight 抛 `EconomicsError`；`evaluateCandidate` 捕获后返回 **HOLD + `fx_invalid`**，不给假数字 |
| Important | 汇率请求无超时、备用源不校验合理性 | `fetchWithTimeout`（10s）+ `assertSaneFx`；反向/离谱汇率视为源失败并自动切换；新增 `test/fx.test.mjs`（2 例） |
| Important | `Retry-After` 无上限（可被要求休眠数小时） | 延迟 `Math.min(retryAfter, 60s)` |
| Important | `1,234.56` 解析成 0 静默吞掉；分隔符只嗅探首行 | `parseAmount` 支持 ru/en 千分位与小数；分隔符按前 3 行计数；无法解析记 `issues`（BAD_AMOUNT/BAD_DATE）不静默归零；新增 2 个测试 |
| Minor | 零术语命中时永远无法 commit | `total===0` 时 coverage=1，允许人工提交；新增测试 |

验证：`node --test` → **146/146**；实机 `ozon fx sync` 仍返回 12.257（CBR）。
## 11. 第三轮评审修复（round 17）

| 问题 | 修复 |
|---|---|
| 币种只存在于列名 | 迁移 v8：`analytics_daily.currency`（默认 RUB）、`prices.currency_code`（默认 CNY）；`pull analytics` 显式写入 currency |
| `postings.price_rub` 恒空 | 用最新 `fx_rates` 把 CNY 金额折 RUB（RUB 直接取值），同时保留原币种 `amount_total/currency`；实测 14 CNY → 171.6 RUB |
| pending 统计跨全库、移出窗口永不清零 | 本次清单外或清单为空时自动清 pending（`pendingUnknown` 时不清，避免误清） |
| 逐单 SELECT（N+1） | 一次读全部 `posting_number` 进 Set |
| `status` 5 个并发请求易触发 429 | 改为串行 |

验证：`node --test` → **148/148**；实机 `ozon pull postings` → 25 更新；DB `user_version=8`，postings 有 `price_rub`，analytics 30 行 RUB、prices 3 行 CNY。