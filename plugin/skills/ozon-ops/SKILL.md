# ozon-ops · OZON 运营系统入口

用于 OZON 店铺取数、日报、预警、选品、翻译、上架产物与写操作提案。所有能力由 `ozon_ops` 工具调用本机 `bin/ozon.mjs` 完成；写操作默认 dry-run，必须在终端用确认码批准。

## 什么时候用

- 拉数据 / 看店铺状态 / 探活端点：`action: "status" | "probe" | "pull" | "fx" | "reconcile"`
- 日报与预警：`action: "report" | "alerts"`
- 选品：`action: "select"`、`action: "candidate_list"`、`action: "evidence_build"`
- 亚马逊之外的「上架内容」：`action: "translate_prepare" | "translate_commit" | "listing_build" | "listing_check"`、`action: "design_compose"`
- 写操作：`action: "action_propose" | "action_list"`（**不要**尝试自行执行；批准只在终端）

## 上架字段自动填充（2026-11-09 第七批）

- 事实库：`assets/listing-facts.json` 按 offer_id / SKU 码记录重量、尺寸、数量、条码、属性、热点搜索词、简介；选品阶段就用 `listing_check` 确认收齐。
- `listing_build` 自动生成：EAN-13 条码（前缀 20，可被 facts.barcode 覆盖）、重量（顶层 + 属性 4383/4497）、尺寸、库存载荷 `stocks.json`（数量）、#Хештеги（属性 23171，热点词全量）、简介（facts → 翻译稿 → 由卖点自动拼）。
- 产物：`outbox/listing/<offer>/` 下 `import.json` / `payload.ru.json` / `stocks.json` / `backend-fields.md` / `qa.json`；QA 缺条码/重量/尺寸/数量/标签/价格/类目会直接报错，并给出 completeness 比例。
- 详见 `docs/listing-autofill.md`。写接口仍不自动执行，import/stocks 只是载荷。

## 关键约束

1. **凭据**只在 仓库根下 `.secrets/ozon.env`，工具输出里 Client-Id 打码，不要把 Key 写进对话。
2. **写操作**（改价/改库存/回复评价/问答）默认 dry-run：工具只能 `action_propose` 生成提案与确认码；真正执行要用户在终端 `node bin/ozon.mjs action approve --id N --code <码> --execute`。
3. **市场情报**（竞品/评论/社媒/视觉）用 `sealeap_ecommerce` 技能库的方法论 + 本机浏览器抽取，再用 `intel ingest` 落库；不要抓登录后页面、不绕验证码。
4. 日报/看板写 `reports/`；选品证据聚合后用 `select` 出结论，`HOLD` 表示缺参数（费率/佣金/市场证据），不要硬给建议。

## 常用命令（与工具 action 对应）

| 工具 action | 等价终端命令 |
|---|---|
| `status` | `node bin/ozon.mjs status` |
| `probe` | `node bin/ozon.mjs probe` |
| `pull`（target=products/postings/analytics/categories） | `node bin/ozon.mjs pull <target>` |
| `fx` | `node bin/ozon.mjs fx sync` |
| `reconcile`（month） | `node bin/ozon.mjs finance reconcile --month <YYYY-MM>` |
| `alerts` | `node bin/ozon.mjs alerts` |
| `report` | `node bin/ozon.mjs report` |
| `select` | `node bin/ozon.mjs select` |
| `action_propose` | `node bin/ozon.mjs action propose --type <type> --payload <json>` |
| `action_list` | `node bin/ozon.mjs action list` |

## 输出解读

- 预警级别：`P0` 立刻处理（断货/发货超时），`P1` 当天处理（价格指数/退货率/数据陈旧）。
- 选品结论：`TRY` 可小批试销，`HOLD` 缺数据，`REJECT` 硬筛淘汰。
- 日报里的金额是 **RUB 下单口径**，与后台「结算金额」不同属正常，换算用 `fx_rates` 当天汇率。