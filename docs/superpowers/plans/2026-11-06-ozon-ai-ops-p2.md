# OZON AI 运营系统 · P2 实施计划（两段式翻译 / 本地生图 / 上架产物）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付上架流水线：中文卖点 → 俄语 Listing 草稿（两段式、含回译校验）→ 本地生图与主图合规 → `outbox/listing/<offer_id>/` 产物（API payload、后台字段粘贴清单、图片），不调用商品创建接口。

**Architecture:** 复用 P0/P1 的 `config/api/db`；新增 `src/content/`（术语表、翻译两段式、图片合成）、`src/rules/listing-qa.mjs`、`src/commands/listing.mjs`；本地生成模型走独立 Python 环境（`imgwork/`，uv + torch cu124 + diffusers，HF 镜像），由 Node 通过 `execFile` 调脚本。

**Tech Stack:** Node 22 CLI、node:sqlite、jimp（项目内安装）；Python 3.12（uv 管理）+ torch cu124 + diffusers + SDXL（8 GB 显存，fp16 + attention slicing）；模型来自 hf-mirror.com。

**Spec:** `ozon-ops\docs\superpowers\specs\2026-11-06-ozon-ai-ops-design.md`（§1.5① 上架只产 payload、§7 内容层、§14 已确认）

## Global Constraints

- 不调用写接口（`/v3/product/import` 不在本期）；产物只落 `outbox/`。
- 凭据仍只从 `.secrets/ozon.env` 读；报告与产物不含 Key。
- 翻译两段式：脚本不自己「翻译」，只做拼装/校验/落库；模型在会话里填俄语；**回译（RU→ZH）为强制项**（团队无人读俄语）。
- 术语表覆盖率 <60% 判不合格；禁用词（医疗/保证/最…）与中文残留必须阻断 commit。
- 图片：本地生成（SDXL）与模板合成都要通过合规检查（比例 3:4、分辨率、白底、无水印、无中文）。
- 模型下载走 `HF_ENDPOINT=https://hf-mirror.com`（huggingface.co 在本机不可达，已实测）。
- Python 环境用 `uv`（本机 0.11.26），依赖固定版本；环境目录 `imgwork/.venv`（gitignore）。
- 所有测试 `node --test`；Python 侧不做网络单测，只做可离线验证的解析/尺寸检查。

## Review Focus

1. 俄语文本的字符/字节上限与属性长度：超限必须在 commit 阶段拦下，而不是等到后台报错 → Task 3。
2. 回译对照缺失或与原文语义漂移：commit 必须报 `BACKTRANSLATION_MISSING`，不能静默通过 → Task 3。
3. 图片比例/分辨率/白底不达标仍被写进 payload：QA 必须阻断并列出原因 → Task 5。
4. 模型/依赖未安装或显存不足：`ozon image generate` 要给出可执行提示（setup 命令），不能抛栈 → Task 6。
5. 术语表未覆盖关键词却仍生成俄语标题：commit 覆盖率闸门要生效 → Task 3。

---

### Task 1: 术语表与翻译草稿骨架

**Files:**
- Create: `src/content/glossary.ru.json`, `src/content/translate.mjs`, `test/translate.test.mjs`

**Interfaces:**
- Produces:
  - `loadGlossary(path?)` → `{terms: [{zh, ru, note?}], forbidden: string[]}`。
  - `prepareDraft({offerId, zh: {name, bullets[], attributes}, categorySchema})` → `{offerId, slots: {name:'', description:'', attributes:{}}, constraints:{nameMaxBytes, descMaxBytes, requiredAttrs[]}, glossaryHints[]}`；写 `outbox/listing/<offerId>/draft.json`。
  - `draftCoverage(draft)` → `{covered, total, ratio}`（术语表命中率）。

- [ ] **Step 1: Write the failing test** —— `prepareDraft` 生成 `slots` 为空的骨架、`constraints.requiredAttrs` 来自 categorySchema、`draftCoverage` 对未命中术语返回 ratio 0；`loadGlossary` 读到 ≥20 条术语。
- [ ] **Step 2: Run test to verify it fails** —— `node --test test/translate.test.mjs`。
- [ ] **Step 3: Implement** —— 术语表先放 30 条常用词（厨房/家居/宠物/汽车/文具/园艺 + 材质与尺寸）；`prepareDraft` 把中文按句切块放进 `slots.description` 的占位数组，俄语留空由模型填。
- [ ] **Step 4: Run test to verify it passes**。
- [ ] **Step 5: Commit** —— `feat: ru glossary and translate draft skeleton`。

### Task 2: 回译与 commit 校验

**Files:**
- Modify: `src/content/translate.mjs`, `test/translate.test.mjs`

**Interfaces:**
- Produces: `commitDraft({db, offerId, filled, backTranslation})` → `{ok, qa, draftPath}`；规则：`slots.name/description/attributes` 非空、字节上限、禁用词、中文残留、术语覆盖率 ≥0.6、`backTranslation` 必填且逐条非空；失败抛 `DraftError`（`code` 为 `MISSING_TRANSLATION` | `FORBIDDEN_WORD` | `CHINESE_RESIDUE` | `LOW_GLOSSARY_COVERAGE` | `BACKTRANSLATION_MISSING`）。

- [ ] **Step 1: Write the failing test** —— 合法 draft+回译 → `ok:true` 且落 `listing_drafts`；缺回译 → `BACKTRANSLATION_MISSING`；含「гарантия лучшая」类禁用词 → `FORBIDDEN_WORD`；含中文字符 → `CHINESE_RESIDUE`。
- [ ] **Step 2: Run test (RED)**。
- [ ] **Step 3: Implement** —— 校验函数拆成 `validateDraft({draft, backTranslation, glossary})` 返回 `{errors[]}`，commit 只在无错时写库。
- [ ] **Step 4: Run test (GREEN)**。
- [ ] **Step 5: Commit** —— `feat: two-stage translation commit with QA gates`。

### Task 3: Listing QA（属性/长度/合规/图片引用）

**Files:**
- Create: `src/rules/listing-qa.mjs`, `test/listing-qa.test.mjs`

**Interfaces:**
- Produces: `runListingQa({draft, images})` → `{passed, issues:[{code, message}], score}`；覆盖：必填属性缺失、标题/描述超长、中文残留、禁用词、图片缺失/比例错/分辨率不足。

- [ ] **Step 1: Write the failing test** —— 缺必填属性 → `issues` 含 `MISSING_ATTRIBUTE`；图片 800×800 → `IMAGE_RATIO`；无图片 → `IMAGE_MISSING`。
- [ ] **Step 2: RED**。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: GREEN**。
- [ ] **Step 5: Commit** —— `feat: listing qa rules`。

### Task 4: 图像合成（jimp）与合规

**Files:**
- Create: `src/content/images.mjs`, `test/images.test.mjs`、`package.json` 加 `jimp` 依赖

**Interfaces:**
- Produces: `normalizeMainImage({inputPath, outputPath, width=900, height=1200})` → 居中留白到 3:4、白底；`inspectImage({path})` → `{width, height, ratio, whiteRatio, hasAlpha}`。

- [ ] **Step 1: Write the failing test** —— 用 jimp 现场生成一张 600×600 红图，`normalizeMainImage` 后输出 900×1200 且四角为白；`inspectImage` 返回 `ratio≈0.75`。
- [ ] **Step 2: RED**（先 `npm i jimp`）。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: GREEN**。
- [ ] **Step 5: Commit** —— `feat: main image normalization and inspection`。

### Task 5: 本地生成环境（Python/uv/torch/SDXL）

**Files:**
- Create: `imgwork/env.mjs`（Node 侧：检测 python/uv、拼命令）、`imgwork/setup.mjs`、`imgwork/gen.py`、`test/image-env.test.mjs`、`.gitignore` 加 `imgwork/.venv/`、`models/`

**Interfaces:**
- Produces: `imageEnvStatus({root})` → `{python, uv, venv, torch, diffusers, modelPath, ok, hints[]}`；`setupImageEnv({root})` 打印/执行安装命令（uv venv + torch cu124 + diffusers + 模型下载脚本）；`gen.py` 接受 `--prompt --output --width --height --seed --steps`，SDXL fp16 + attention slicing，缺模型时报明确错误码。

- [ ] **Step 1: Write the failing test** —— `imageEnvStatus` 在空目录返回 `ok:false` 且 `hints` 含 `uv venv` 与 `HF_ENDPOINT`；提供假 venv 目录（含 torch 标记文件）时 `ok:true`。
- [ ] **Step 2: RED**。
- [ ] **Step 3: Implement** —— 不做真实下载；`setup` 输出可复制命令；`gen.py` 写好但需模型才能跑。
- [ ] **Step 4: GREEN**；**live**：`node bin/ozon.mjs image status` 打印缺什么。
- [ ] **Step 5: Commit** —— `feat: local image env status and setup hints`。

### Task 6: 上架产物与 CLI

**Files:**
- Create: `src/commands/listing.mjs`, `test/listing.test.mjs`；Modify `bin/ozon.mjs`

**Interfaces:**
- Produces: `buildListing({db, offerId, outDir})` → 写 `payload.ru.json`（`/v3/product/import` 形状：`offer_id`、`name`、`description`、`attributes[]`、`images[]`）、`backend-fields.md`（中文字段名 → 值）、`qa.json`；`listing report` 打印产物路径与 QA 结果。
- CLI：`ozon translate prepare --offer <id> --zh <file>`、`ozon translate commit --offer <id> --filled <file> --backtranslation <file>`、`ozon listing build --offer <id>`、`ozon image status`、`ozon image normalize --input <file> --output <file>`。

- [ ] **Step 1: Write the failing test** —— buildListing 生成三个文件、`payload.ru.json` 含 `offer_id` 且 `images` 为本地路径；QA 未过时 `payload.ru.json` 不写并把 `passed:false` 传给调用方。
- [ ] **Step 2: RED**。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: GREEN**；**live**：用一个中文示例跑 `translate prepare` → 手工填俄语 → `translate commit` → `listing build`，检查 `outbox/listing/<id>/`。
- [ ] **Step 5: Commit** —— `feat: listing payload and backend field mapping`。

## 完成定义（P2）

- `node --test` 全绿；`ozon translate prepare/commit`、`listing build`、`image status/normalize` 真机可跑。
- `outbox/listing/<offer_id>/` 含 `payload.ru.json`、`backend-fields.md`、`images/`、`qa.json`；含回译对照。
- `ozon image status` 能说明缺什么、怎么装；模型没下载时 `image generate` 报可执行提示而不是崩栈。

## 后续

P3（日报/预警/提案执行 + DSH 插件与定时任务）、P4（Performance API 投流建议）各自单独立计划。
