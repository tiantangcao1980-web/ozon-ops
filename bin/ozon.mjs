#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.mjs';
import { createApi } from '../src/api.mjs';
import { openDb } from '../src/db.mjs';
import { runStatus } from '../src/commands/status.mjs';
import { runProbe, formatProbeReport } from '../src/commands/probe.mjs';
import { CATALOG } from '../src/endpoints-catalog.mjs';
import { pullProducts } from '../src/pull/products.mjs';
import { pullPostings } from '../src/pull/postings.mjs';
import { pullAnalytics } from '../src/pull/analytics.mjs';
import { syncFx } from '../src/pull/fx.mjs';
import { reconcileMonth, formatReconcile } from '../src/commands/reconcile.mjs';
import { pullCategories } from '../src/pull/categories.mjs';
import { openSession } from '../src/intel/browser.mjs';
import { runIntelSearch, runIntelReviews, ingestSearch, ingestReviews, runIntelPains, runDemand, runSocial } from '../src/intel/commands.mjs';
import { addCandidate, importEvidence, runSelect } from '../src/commands/selection-cli.mjs';
import { buildEvidence } from '../src/intel/commands.mjs';
import { prepareDraft, commitDraft, loadGlossary } from '../src/content/translate.mjs';
import { buildListing } from '../src/commands/listing.mjs';
import { loadListingFacts, findFacts, listingDataGaps } from '../src/content/listing-facts.mjs';
import { ingestDesign, composeDesign } from '../src/intel/design-commands.mjs';
import { computeAlerts } from '../src/rules/alerts.mjs';
import { renderDailyReport, renderDashboardHtml, renderWeeklyReport } from '../src/render/report.mjs';
import { proposeAction, approveAction, listActions } from '../src/commands/actions.mjs';
import { runAdsSync } from '../src/ads/sync.mjs';
import { computeAcosAlerts, suggestBudgetChanges, aggregateByCampaign } from '../src/ads/rules.mjs';
import { parseAdsCsv, importAds } from '../src/ads/import.mjs';
import { renderAdsReport } from '../src/ads/report.mjs';
import { createPerformanceClient } from '../src/ads/performance.mjs';
import { parseSearchTermCsv, decideSearchTerms, allocateBudget, renderDecideMarkdown, DEFAULT_THRESHOLDS } from '../src/ads/decide.mjs';
import { buildKeywordPack, renderKeywordPackMarkdown } from '../src/ads/keywords.mjs';
import { buildRestockPlan, renderRestockMarkdown } from '../src/ops/restock.mjs';
import { computeSkuMargins, renderMarginMarkdown } from '../src/ops/margin.mjs';
import { createMonitorServer, writeMonitorSnapshot } from '../src/commands/monitor.mjs';
import { createScreenServer, writeScreenSnapshot } from '../src/commands/screen.mjs';
import { ingestIntel, listIntel, intelStats, saveIngestStats } from '../src/intel/ingest.mjs';
import { itemsFromDb, harvestRss, itemsFromFile, harvestTelegram } from '../src/intel/harvest.mjs';
import { DEFAULT_RSS_FEEDS, DEFAULT_TG_CHANNELS, DEFAULT_PROXY, listSources } from '../src/intel/sources.mjs';
import { setSkuCost, listSkuCosts, renderCostsMarkdown } from '../src/ops/costs.mjs';
import { imageEnvStatus } from '../src/content/image-env.mjs';
import { sniffImageFormat } from '../src/content/images.mjs';
import { generateImage } from '../src/content/image-generate.mjs';
import { comfyEnvStatus, buildComfyWorkflow, createComfyClient } from '../src/content/comfyui.mjs';
import { fetchImageToFile } from '../src/content/fetch-image.mjs';
import { planImageBatch, createBatchLedger, validateBatchImage } from '../src/content/image-batch.mjs';
import { renderBatchImages } from '../src/content/batch-images.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function createContext(config = loadConfig({ root: ROOT })) {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  mkdirSync(config.reportsDir, { recursive: true });
  mkdirSync(config.outboxDir, { recursive: true });
  const handle = openDb({ filePath: config.dbPath });
  handle.migrate();
  const api = createApi({
    clientId: config.clientId,
    apiKey: config.apiKey,
    audit: (row) =>
      handle.db
        .prepare('INSERT INTO api_calls (path, status, ms, bytes, error, called_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.path, row.status ?? 0, row.ms ?? 0, row.bytes ?? 0, row.error ?? null, row.calledAt ?? new Date().toISOString()),
  });
  return { config, api, handle };
}

const USAGE = `用法: node bin/ozon.mjs <命令> [参数]
命令:
  status                     店铺概要（订阅/商品/仓库/密钥角色）
  probe                      端点探活，写入 src/endpoints.json
  pull products              拉取商品/价格/库存
  pull postings              拉取订单（FBS）
  pull analytics             拉取自店日指标
  pull categories            拉取类目树
  fx sync                    同步 CBR 汇率
  finance reconcile          对账 analytics.revenue 币种口径`;

function safeId(value, label) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(text)) {
    console.error(`${label} 含非法字符（只允许字母数字 . _ -）：${text}`);
    process.exit(2);
  }
  return text;
}

function safeOutDir(dir, base) {
  const resolved = resolve(dir);
  const root = resolve(base);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    console.error(`--out 必须位于 ${root} 下：${resolved}`);
    process.exit(2);
  }
  return resolved;
}

function valueOf(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'status') {
    const { config, api, handle } = createContext();
    try {
      console.log(await runStatus({ config, api }));
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'probe') {
    const { api, handle } = createContext();
    try {
      const result = await runProbe({ api, catalog: CATALOG });
      console.log(formatProbeReport(result));
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'pull') {
    const [what] = rest;
    const { api, handle } = createContext();
    try {
      if (what === 'categories') {
        const result = await pullCategories({ api, db: handle });
        console.log(`类目树：${result.nodes} 个节点，${result.leaves} 个叶子，深度 ${result.depth}，${result.bytes} 字节`);
      } else if (what === 'products') {
        const result = await pullProducts({ api, db: handle });
        console.log(`商品 ${result.products} 个（${result.pages} 页），价格 ${result.prices} 条，库存 ${result.stocks} 条`);
      } else if (what === 'analytics') {
        const explicitFrom = valueOf(rest, '--from', null);
        const explicitTo = valueOf(rest, '--to', null);
        const days = Number(valueOf(rest, '--days', '30'));
        const to = explicitTo ?? new Date().toISOString().slice(0, 10);
        const from = explicitFrom ?? new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
        const bySku = rest.includes('--by-sku');
        const result = await pullAnalytics({ api, db: handle, from, to, bySku });
        console.log(`分析数据：写入 ${result.rows} 行（${result.chunks} 个时间片，${from}..${to}${bySku ? '，按 SKU 维度' : ''}）`);
      } else if (what === 'postings') {
        const since = valueOf(rest, '--since', '2026-09-01T00:00:00Z');
        const to = valueOf(rest, '--to', new Date().toISOString());
        const result = await pullPostings({ api, db: handle, since, to });
        const pendingNote = result.pendingUnknown ? '待发货清单不可用（状态未知）' : `待发货 ${result.pending}`;
        const amountNote = result.missingAmounts > 0 ? `，${result.missingAmounts} 单缺金额` : '';
        console.log(`订单：新增 ${result.inserted}、更新 ${result.updated}（${result.pages} 页），${pendingNote}${amountNote}`);
      } else {
        console.error(`未知的 pull 子命令: ${what}`);
        return 2;
      }
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'fx') {
    const [sub] = rest;
    if (sub !== 'sync') {
      console.error(`未知的 fx 子命令: ${sub}`);
      return 2;
    }
    const { handle } = createContext();
    try {
      const result = await syncFx({ db: handle });
      console.log(`汇率：1 CNY = ${result.rubPerCny} RUB（${result.date}，${result.source}）`);
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'finance') {
    const [sub] = rest;
    if (sub !== 'reconcile') {
      console.error(`未知的 finance 子命令: ${sub}`);
      return 2;
    }
    const month = valueOf(rest, '--month', new Date().toISOString().slice(0, 7));
    const { api, handle } = createContext();
    try {
      const result = await reconcileMonth({ api, db: handle, month });
      console.log(formatReconcile(result));
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'candidate') {
    const [sub] = rest;
    if (sub !== 'add') {
      console.error(`未知的 candidate 子命令: ${sub}`);
      return 2;
    }
    const jsonPath = valueOf(rest, '--json', null);
    if (!jsonPath) {
      console.error('用法: node bin/ozon.mjs candidate add --json <candidate.json>');
      return 2;
    }
    const candidate = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const { handle } = createContext();
    try {
      const id = addCandidate({ db: handle, candidate });
      console.log(`已加入候选 #${id}：${candidate.niche}`);
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'evidence') {
    const [sub] = rest;
    if (sub === 'build') {
      const candidateId = Number(valueOf(rest, '--candidate', '0'));
      const keyword = valueOf(rest, '--keyword', null);
      const sku = safeId(valueOf(rest, '--sku', null), '--sku');
      if (!candidateId || !keyword || !sku) {
        console.error('用法: node bin/ozon.mjs evidence build --candidate <id> --keyword "<俄语词>" --sku <竞品ID>');
        return 2;
      }
      const { handle } = createContext();
      try {
        const result = buildEvidence({ db: handle, candidateId, keyword, sku });
        const e = result.evidence;
        console.log(`证据聚合：${e.cards_total} 个竞品 / 100+评论 ${e.cards_100plus} / 卖家 ${e.sellers_count} / 均价 ₽${e.avg_price_rub ?? '—'} / 样本评论 ${e.review_sample_size}`);
        if (e.pains.length) console.log(`痛点：${e.pains.slice(0, 5).map((item) => `${item.theme}×${item.count}`).join('、')}`);
        return 0;
      } finally {
        handle.close();
      }
    }
    if (sub !== 'import') {
      console.error(`未知的 evidence 子命令: ${sub}`);
      return 2;
    }
    const candidateId = Number(valueOf(rest, '--candidate', '0'));
    const csvPath = valueOf(rest, '--csv', null);
    if (!candidateId || !csvPath) {
      console.error('用法: node bin/ozon.mjs evidence import --candidate <id> --csv <file.csv>');
      return 2;
    }
    const { handle } = createContext();
    try {
      const result = importEvidence({ db: handle, candidateId, csvText: readFileSync(csvPath, 'utf8') });
      console.log(`证据导入：成功 ${result.imported} 条，跳过 ${result.skipped} 条`);
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'select') {
    const { config, handle } = createContext();
    try {
      const fxRow = handle.db.prepare('SELECT rub_per_cny FROM fx_rates ORDER BY date DESC LIMIT 1').get();
      const commissionSetting = handle.setting('commission_rate', null);
      const settings = {
        fxRubPerCny: fxRow?.rub_per_cny ?? 12.0,
        purchaseCny: 0,
        domesticFreightCny: 0,
        packagingCny: 0,
        ...(commissionSetting ? { commissionRate: Number(commissionSetting) } : {}),
      };
      const rows = await runSelect({ db: handle, settings, reportsDir: config.reportsDir });
      for (const row of rows) {
        console.log(`${row.niche} → ${row.verdict}（贡献率 ${(row.economics.contributionRate * 100).toFixed(1)}%，缺口 ${row.gaps.join('、') || '—'}）`);
      }
      console.log(`报告：${rows[0]?.reportPath ?? `${config.reportsDir}\\selection-*.md`}`);
    } finally {
      handle.close();
    }
    return 0;
  }

  if (command === 'intel') {
    const [sub] = rest;
    const { config, handle } = createContext();
    try {
      if (sub === 'harvest') {
        const source = String(valueOf(rest, '--source', 'all'));
        const limit = Number(valueOf(rest, '--limit', '30'));
        const proxy = valueOf(rest, '--proxy', process.env.OZON_PROXY || DEFAULT_PROXY);
        const allowed = ['all', 'db', 'rss', 'tg', 'file'];
        if (!allowed.includes(source)) {
          console.error('未知的 harvest source: ' + source + '（支持 ' + allowed.join(' / ') + '）');
          return 2;
        }
        const runs = [];
        if (source === 'all' || source === 'db') {
          runs.push({ name: 'db', items: itemsFromDb({ db: handle }), errors: [] });
        }
        if (source === 'all' || source === 'rss') {
          const raw = String(valueOf(rest, '--feeds', ''));
          const feeds = raw
            ? raw.split(',').map((url) => url.trim()).filter(Boolean)
            : DEFAULT_RSS_FEEDS;
          const result = await harvestRss({ feeds, perFeedLimit: limit });
          runs.push({ name: 'rss', ...result });
        }
        if (source === 'all' || source === 'tg') {
          const raw = String(valueOf(rest, '--channels', ''));
          const channels = raw
            ? raw.split(',').map((channel) => channel.trim().replace(/^@/, '')).filter(Boolean)
            : DEFAULT_TG_CHANNELS;
          const result = await harvestTelegram({ channels, perChannelLimit: limit, proxy });
          runs.push({ name: 'tg', ...result });
        }
        if (source === 'file') {
          const file = valueOf(rest, '--file', null);
          if (!file) {
            console.error('用法: node bin/ozon.mjs intel harvest --source file --file <抓取结果.json>');
            return 2;
          }
          runs.push({ name: 'file', items: itemsFromFile(file), errors: [] });
        }

        const total = { received: 0, kept: 0, dropped: 0, duplicates: 0, nearDuplicates: 0, byReason: {}, byCategory: {}, bySource: {} };
        for (const run of runs) {
          const stats = ingestIntel({ db: handle, items: run.items });
          total.received += stats.received;
          total.kept += stats.kept;
          total.dropped += stats.dropped;
          total.duplicates += stats.duplicates;
          total.nearDuplicates += stats.nearDuplicates;
          for (const key of ['byReason', 'byCategory', 'bySource']) {
            for (const [name, count] of Object.entries(stats[key])) total[key][name] = (total[key][name] ?? 0) + count;
          }
          const noiseKeys = Object.entries(stats.byReason).filter(([reason]) => reason !== 'duplicate' && reason !== 'near-duplicate');
          console.log('[' + run.name + '] 收到 ' + stats.received + ' → 入库 ' + stats.kept + ' → 去噪 ' + stats.dropped +
            (stats.duplicates ? '（重复 ' + stats.duplicates + ' / 近似 ' + stats.nearDuplicates + '）' : '') +
            (noiseKeys.length ? ' · ' + noiseKeys.map(([reason, count]) => reason + ' ' + count).join(' ') : '') +
            (stats.kept ? ' · ' + Object.entries(stats.byCategory).map(([category, count]) => category + ' ' + count).join(' ') : ''));
          for (const error of run.errors ?? []) {
            console.error('  ' + run.name + ' 失败: ' + (error.feed ?? error.channel ?? '') + ' ' + (error.status ?? error.error ?? ''));
          }
        }
        saveIngestStats(handle, total);
        console.log('合计：收到 ' + total.received + ' → 入库 ' + total.kept + ' → 去噪 ' + total.dropped + '（去噪率 ' + Math.round((total.dropped / Math.max(1, total.received)) * 100) + '%）');
        return 0;
      }

      if (sub === 'sources') {
        const sources = listSources();
        console.log('RSS 源（' + sources.rss.length + '）：');
        for (const feed of sources.rss) console.log('  ' + String(feed.weight).padStart(3) + '  ' + feed.name.padEnd(14) + '  ' + feed.url);
        console.log('Telegram 频道（' + sources.telegram.length + '，代理 ' + sources.proxy + '）：');
        for (const channel of sources.telegram) console.log('  ' + String(channel.weight).padStart(3) + '  ' + channel.name.padEnd(18) + '  @' + channel.channel);
        return 0;
      }

      if (sub === 'list') {
        const rows = listIntel({
          db: handle,
          limit: Number(valueOf(rest, '--limit', '20')),
          category: valueOf(rest, '--category', null),
          lang: valueOf(rest, '--lang', null),
        });
        if (!rows.length) {
          console.log('情报库为空：先跑 node bin/ozon.mjs intel harvest --source db');
          return 0;
        }
        for (const row of rows) {
          const tag = row.threat === 'high' ? 'P0' : row.threat === 'medium' ? 'P1' : 'P2';
          console.log('[' + tag + '] ' + String(row.importance).padStart(3) + ' ' + row.category.padEnd(11) + ' ' + row.lang + '  ' + row.title.slice(0, 80));
        }
        return 0;
      }

      if (sub === 'stats') {
        const stats = intelStats({ db: handle });
        console.log('情报库：' + stats.total + ' 条（24h 新增 ' + stats.latest24h + '，最近入库 ' + (stats.latestAt ?? '—') + '）');
        const line = (label, rows) => console.log('  ' + label + '：' + (rows.length ? rows.map((row) => row.key + ' ' + row.count).join(' · ') : '—'));
        line('来源', stats.bySource);
        line('类别', stats.byCategory);
        line('语言', stats.byLang);
        line('威胁', stats.byThreat);
        return 0;
      }

      if (sub === 'ingest') {
        const kind = valueOf(rest, '--kind', null);
        const jsonPath = valueOf(rest, '--json', null);
        if (!kind || !jsonPath) {
          console.error('用法: node bin/ozon.mjs intel ingest --kind search|reviews --json <file> [--query <词>] [--sku <id>]');
          return 2;
        }
        const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
        if (kind === 'search') {
          const query = valueOf(rest, '--query', null);
          if (!query) {
            console.error('intel ingest --kind search 需要 --query');
            return 2;
          }
          const result = ingestSearch({ db: handle, query, raw });
          console.log(`竞品入库：${result.items} 个（关键词「${query}」）`);
          return 0;
        }
        if (kind === 'reviews') {
          const sku = safeId(valueOf(rest, '--sku', null), '--sku');
          if (!sku) {
            console.error('intel ingest --kind reviews 需要 --sku');
            return 2;
          }
          const result = ingestReviews({ db: handle, sku, raw });
          console.log(`评论入库：新增 ${result.inserted} 条（重复 ${result.skipped} 条）`);
          return 0;
        }
        console.error(`未知的 ingest kind: ${kind}`);
        return 2;
      }

      if (sub === 'design') {
        const sku = safeId(valueOf(rest, '--sku', null), '--sku');
        const jsonPath = valueOf(rest, '--json', null);
        if (!sku || !jsonPath) {
          console.error('用法: node bin/ozon.mjs intel design --sku <id> --json <design.json> [--out <dir>]');
          return 2;
        }
        const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
        const outDir = safeOutDir(valueOf(rest, '--out', join(config.outboxDir, 'design', String(sku))), config.outboxDir);
        const result = await ingestDesign({ db: handle, sku, raw, outDir });
        console.log(`视觉拆解入库：${result.images} 张图，配色 ${result.palette.map((item) => item.hex).join(' ')}`);
        console.log(`详情页区块：${result.blocks.order.join(' → ')}`);
        console.log(`brief：${result.briefPath}`);
        return 0;
      }

      if (sub === 'pains') {
        const sku = safeId(valueOf(rest, '--sku', null), '--sku');
        if (!sku) {
          console.error('用法: node bin/ozon.mjs intel pains --sku <商品ID> [--niche <细分名>]');
          return 2;
        }
        const niche = valueOf(rest, '--niche', `sku-${sku}`);
        const themes = runIntelPains({ db: handle, sku, niche });
        console.log(`痛点归因（${themes.length} 个主题）：`);
        for (const item of themes.slice(0, 8)) {
          console.log(`  ${item.theme}: ${item.count} 条（负向 ${item.negative}）`);
          if (item.samples[0]) console.log(`    «${item.samples[0].slice(0, 120)}»`);
        }
        return 0;
      }

      if (sub === 'demand') {
        const seedsArg = valueOf(rest, '--seeds', null);
        if (!seedsArg) {
          console.error('用法: node bin/ozon.mjs intel demand --seeds "词1,词2"');
          return 2;
        }
        const seeds = seedsArg.split(',').map((item) => item.trim()).filter(Boolean);
        const result = await runDemand({ db: handle, seeds });
        console.log(`需求词扩展：${seeds.length} 个种子 → ${result.keywords} 个关键词入库`);
        return 0;
      }

      if (sub === 'social') {
        const channelsArg = valueOf(rest, '--channels', null);
        if (!channelsArg) {
          console.error('用法: node bin/ozon.mjs intel social --channels ozonru[,chan2] [--proxy http://127.0.0.1:7897]');
          return 2;
        }
        const channels = channelsArg.split(',').map((item) => item.trim()).filter(Boolean);
        const proxy = valueOf(rest, '--proxy', null);
        const result = await runSocial({ db: handle, channels, proxy });
        console.log(`社媒抓取：${channels.length} 个频道，新增 ${result.posts} 条帖子`);
        return 0;
      }

      const headless = valueOf(rest, '--headed', null) === null;
      let session;
      try {
        session = await openSession({ headless });
        if (sub === 'search') {
          const query = valueOf(rest, '--query', null);
          if (!query) {
            console.error('用法: node bin/ozon.mjs intel search --query "<俄语词>" [--pages 2] [--headed]');
            return 2;
          }
          const pages = Number(valueOf(rest, '--pages', '2'));
          const result = await runIntelSearch({ session, db: handle, query, pages });
          console.log(`竞品抓取：${result.pages} 页，${result.items} 个商品（关键词「${query}」）`);
          for (const item of result.sample) console.log(`  ${item.sku} ₽${item.priceRub ?? '—'} ★${item.rating ?? '—'} ${item.reviews ?? 0}评 ${item.title.slice(0, 48)}`);
          return 0;
        }
        if (sub === 'reviews') {
          const sku = safeId(valueOf(rest, '--sku', null), '--sku');
          if (!sku) {
            console.error('用法: node bin/ozon.mjs intel reviews --sku <商品ID> [--pages 5] [--headed]');
            return 2;
          }
          const pages = Number(valueOf(rest, '--pages', '5'));
          const result = await runIntelReviews({ session, db: handle, sku, pages });
          console.log(`评论抓取：${result.pages} 页，新增 ${result.inserted} 条（重复 ${result.skipped} 条）`);
          return 0;
        }
        console.error(`未知的 intel 子命令: ${sub}`);
        return 2;
      } finally {
        if (session) await session.close();
      }
    } finally {
      handle.close();
    }
  }

  if (command === 'translate') {
    const [sub] = rest;
    const { config, handle } = createContext();
    try {
      if (sub === 'prepare') {
        const offerId = safeId(valueOf(rest, '--offer', null), '--offer');
        const zhPath = valueOf(rest, '--zh', null);
        if (!offerId || !zhPath) {
          console.error('用法: node bin/ozon.mjs translate prepare --offer <id> --zh <zh.json>');
          return 2;
        }
        const zh = JSON.parse(readFileSync(zhPath, 'utf8'));
        const categorySchema = JSON.parse(valueOf(rest, '--schema', '{}'));
        const draft = prepareDraft({ offerId, zh, categorySchema });
        const outDir = join(config.outboxDir, 'listing', offerId);
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, 'draft.json'), `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
        console.log(`草稿已生成：${join(outDir, 'draft.json')}`);
        console.log(`术语提示 ${draft.glossaryHints.length} 条，必填属性 ${draft.constraints.requiredAttrs.join(',') || '无'}`);
        return 0;
      }
      if (sub === 'commit') {
        const offerId = safeId(valueOf(rest, '--offer', null), '--offer');
        const filledPath = valueOf(rest, '--filled', null);
        if (!offerId || !filledPath) {
          console.error('用法: node bin/ozon.mjs translate commit --offer <id> --filled <filled.json>');
          return 2;
        }
        const draft = JSON.parse(readFileSync(filledPath, 'utf8'));
        const result = commitDraft({ db: handle, draft: { ...draft, offerId }, glossary: loadGlossary() });
        console.log(`翻译稿已入库：v${result.version}，术语覆盖 ${(result.coverage.ratio * 100).toFixed(0)}%`);
        return 0;
      }
      console.error(`未知的 translate 子命令: ${sub}`);
      return 2;
    } finally {
      handle.close();
    }
  }

  if (command === 'listing') {
    const [sub] = rest;
    if (sub !== 'build' && sub !== 'check') {
      console.error(`未知的 listing 子命令: ${sub}`);
      return 2;
    }
    const rawOffer = valueOf(rest, '--offer', null) ?? valueOf(rest, '--sku', null);
    const offerId = safeId(rawOffer, '--offer');
    if (!offerId) {
      console.error('用法: node bin/ozon.mjs listing build --offer <offer_id|SKU> [--facts assets/listing-facts.json] [--images <json>] [--keywords <json>]');
      console.error('      node bin/ozon.mjs listing check --offer <offer_id|SKU>');
      return 2;
    }
    const { config, handle } = createContext();
    try {
      const factsFile = valueOf(rest, '--facts', join(config.root, 'assets', 'listing-facts.json'));
      const store = loadListingFacts({ file: factsFile });
      const facts = findFacts(store, offerId);
      if (!facts) {
        console.error(`事实库 ${factsFile} 里没有 ${offerId}`);
        console.error(`可用：${Object.keys(store.offers).join(', ') || '（空）'}`);
        return 1;
      }
      if (sub === 'check') {
        const gaps = listingDataGaps(facts);
        console.log(`[${facts.offerId}] ${facts.skuCode ?? ''} 重量 ${facts.weightG ?? '—'} g · 尺寸 ${(facts.dimsMm ?? []).join('×') || '—'} mm · 数量 ${facts.quantity} · 条码 ${facts.barcode}`);
        console.log(`热搜词 ${facts.hotTerms.length} 个，属性 ${facts.attributes.length} 项，简介 ${facts.descriptionRu || facts.bulletsRu.length ? '已备' : '需生成'}`);
        if (gaps.length === 0) {
          console.log('数据齐全，可上架。');
          return 0;
        }
        console.log(`缺 ${gaps.length} 项：${gaps.join(', ')}`);
        return 1;
      }
      const imagesPath = valueOf(rest, '--images', null);
      const images = imagesPath ? JSON.parse(readFileSync(imagesPath, 'utf8')) : (facts.images ?? []);
      const keywordsPath = valueOf(rest, '--keywords', null);
      const keywords = keywordsPath ? JSON.parse(readFileSync(keywordsPath, 'utf8')) : null;
      const outDir = join(config.outboxDir, 'listing', facts.offerId);
      const result = buildListing({ db: handle, offerId: facts.offerId, outDir, images, keywords, facts });
      if (result.ok) {
        console.log(`上架产物已生成：${outDir}`);
        console.log(`  条码 ${result.payload.barcode} · 重量 ${result.payload.weight} g · 尺寸 ${result.payload.width}×${result.payload.height}×${result.payload.depth} mm`);
        console.log(`  库存 ${result.stockPayload.stocks[0]?.stock ?? 0} 件 · 属性 ${result.payload.attributes.length} 项 · 简介 ${result.payload.description.length} 字符`);
        const hashtags = result.payload.attributes.find((attribute) => attribute.id === 23171)?.values?.[0]?.value ?? '';
        console.log(`  #Хештеги（${(hashtags.match(/#/g) ?? []).length} 个）：${hashtags.slice(0, 160)}${hashtags.length > 160 ? '…' : ''}`);
        for (const warning of result.warnings ?? []) console.log(`  警告 ${warning}`);
      } else {
        console.log(`QA 未通过（${result.qa.issues.length} 个问题），仅写出 qa.json 与后台清单`);
      }
      for (const issue of result.qa.issues.slice(0, 8)) console.log(`  ${issue.code}: ${issue.message}`);
      return result.ok ? 0 : 1;
    } finally {
      handle.close();
    }
  }

  if (command === 'design') {
    const [sub] = rest;
    if (sub !== 'compose') {
      console.error(`未知的 design 子命令: ${sub}`);
      return 2;
    }
    const sku = safeId(valueOf(rest, '--sku', null), '--sku');
    if (!sku) {
      console.error('用法: node bin/ozon.mjs design compose --sku <id> [--out <dir>]');
      return 2;
    }
    const { config, handle } = createContext();
    try {
      const outDir = safeOutDir(valueOf(rest, '--out', join(config.outboxDir, 'design', String(sku))), config.outboxDir);
      const sourcePath = valueOf(rest, '--source', null);
      const headlineRu = valueOf(rest, '--headline', null);
      const result = await composeDesign({ db: handle, sku, outDir, sourcePath, headlineRu });
      console.log(`新主图：${result.mainPath}`);
      console.log(`详情页：${result.detailPath}`);
      console.log(`复用配色：${result.palette.map((item) => item.hex).join(' ')}`);
      return 0;
    } finally {
      handle.close();
    }
  }

  if (command === 'alerts') {
    const { handle } = createContext();
    try {
      const alerts = computeAlerts({ db: handle });
      if (alerts.length === 0) console.log('无预警');
      for (const alert of alerts) console.log(`[${alert.severity}] ${alert.message}`);
      return alerts.length > 0 ? 0 : 0;
    } finally {
      handle.close();
    }
  }

  if (command === 'report') {
    const [sub] = rest;
    const { config, handle } = createContext();
    try {
      const date = valueOf(rest, '--date', new Date().toISOString().slice(0, 10));
      const alerts = computeAlerts({ db: handle });
      const fxRow = handle.db.prepare('SELECT rub_per_cny, date FROM fx_rates ORDER BY date DESC LIMIT 1').get();
      const fx = fxRow ? { rubPerCny: fxRow.rub_per_cny, date: fxRow.date } : null;
      if (sub === 'weekly') {
        const weekly = renderWeeklyReport({ db: handle, date, alerts, fx });
        const weeklyPath = join(config.reportsDir, `weekly-${date}.md`);
        writeFileSync(weeklyPath, weekly, 'utf8');
        console.log(`周报：${weeklyPath}`);
        return 0;
      }
      if (sub === 'margin') {
        if (!fx) {
          console.log('没有汇率数据，先跑 ozon fx sync');
          return 1;
        }
        const rows = computeSkuMargins({ db: handle, fxRubPerCny: Number(fx.rubPerCny) });
        const markdown = renderMarginMarkdown({ date, rows, fxRubPerCny: Number(fx.rubPerCny) });
        const marginPath = join(config.reportsDir, `margin-${date}.md`);
        writeFileSync(marginPath, markdown, 'utf8');
        const counts = rows.reduce((acc, row) => {
          acc[row.status] = (acc[row.status] ?? 0) + 1;
          return acc;
        }, {});
        console.log(`SKU 毛利表：${marginPath}`);
        console.log(`状态：${Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(' / ') || '无商品'}`);
        for (const row of rows.slice(0, 10)) {
          const rate = typeof row.contributionRate === 'number' ? `${(row.contributionRate * 100).toFixed(1)}%` : '—';
          console.log(`  ${row.offerId} 贡献率 ${rate}（${row.status}${row.gaps?.length ? ' 缺 ' + row.gaps.join('/') : ''}）`);
        }
        return 0;
      }
      const markdown = renderDailyReport({ db: handle, date, alerts, fx });
      const html = renderDashboardHtml({ db: handle, date, alerts, fx });
      const reportPath = join(config.reportsDir, `daily-${date}.md`);
      const dashboardPath = join(config.reportsDir, 'dashboard.html');
      writeFileSync(reportPath, markdown, 'utf8');
      writeFileSync(dashboardPath, html, 'utf8');
      console.log(`日报：${reportPath}`);
      console.log(`看板：${dashboardPath}`);
      console.log(`预警 ${alerts.length} 条：${alerts.slice(0, 5).map((alert) => `[${alert.severity}]${alert.type}`).join(' ') || '无'}`);
      return 0;
    } finally {
      handle.close();
    }
  }

  if (command === 'stock') {
    const [sub] = rest;
    if (sub !== 'forecast') {
      console.error('用法: node bin/ozon.mjs stock forecast [--lead 14] [--safety 14] [--window 30]');
      return 2;
    }
    const { config, handle } = createContext();
    try {
      const date = new Date().toISOString().slice(0, 10);
      const plans = buildRestockPlan({
        db: handle,
        leadTimeDays: Number(valueOf(rest, '--lead', '14')),
        safetyDays: Number(valueOf(rest, '--safety', '14')),
        windowDays: Number(valueOf(rest, '--window', '30')),
      });
      const markdown = renderRestockMarkdown({ date, plans });
      const reportPath = join(config.reportsDir, `restock-${date}.md`);
      writeFileSync(reportPath, markdown, 'utf8');
      console.log(`补货预测：${reportPath}`);
      if (plans.length === 0) console.log('没有在售商品或库存数据');
      for (const plan of plans) {
        console.log(`  [${plan.urgency}] ${plan.offerId} 可用 ${plan.available}，日均 ${plan.velocity}，覆盖 ${plan.daysOfCover ?? '—'} 天，建议补 ${plan.suggestedQty}`);
      }
      return 0;
    } finally {
      handle.close();
    }
  }

  if (command === 'cost') {
    const [sub] = rest;
    const { config, handle } = createContext();
    try {
      if (sub === 'set') {
        const offerId = safeId(valueOf(rest, '--offer', null), '--offer');
        const purchaseCny = Number(valueOf(rest, '--purchase', 'NaN'));
        const weightG = Number(valueOf(rest, '--weight', 'NaN'));
        if (!offerId || Number.isNaN(purchaseCny) || Number.isNaN(weightG)) {
          console.error('用法: node bin/ozon.mjs cost set --offer <id> --purchase 25 --weight 300 [--freight 5] [--packaging 2] [--dims 20x10x5] [--supplier 1688]');
          return 2;
        }
        const result = setSkuCost({
          db: handle,
          offerId,
          purchaseCny,
          domesticFreightCny: Number(valueOf(rest, '--freight', '0')),
          packagingCny: Number(valueOf(rest, '--packaging', '0')),
          weightG,
          dimsCm: valueOf(rest, '--dims', null),
          supplier: valueOf(rest, '--supplier', null),
        });
        console.log(`成本已保存：${result.offerId} 采购 ¥${result.purchaseCny} / ${result.weightG}g / 尺寸 ${result.dimsCm ?? '未设置'}`);
        return 0;
      }
      if (sub === 'list') {
        const costs = listSkuCosts({ db: handle });
        const markdown = renderCostsMarkdown({ costs });
        const costPath = join(config.reportsDir, 'sku-costs.md');
        writeFileSync(costPath, markdown, 'utf8');
        console.log(`成本表：${costPath}（${costs.length} 条）`);
        for (const cost of costs) console.log(`  ${cost.offer_id} 采购 ¥${cost.purchase_cny} / ${cost.weight_g}g / ${cost.dims_cm ?? '尺寸未设置'}`);
        return 0;
      }
      console.error(`未知的 cost 子命令: ${sub}`);
      return 2;
    } finally {
      handle.close();
    }
  }

  if (command === 'monitor') {
    const { config, handle } = createContext();
    const endpointsPath = join(ROOT, 'src', 'endpoints.json');
    const endpoints = (() => {
      try {
        return JSON.parse(readFileSync(endpointsPath, 'utf8'));
      } catch {
        return null;
      }
    })();
    const once = rest.includes('--once');
    const port = Number(valueOf(rest, '--port', '8288'));
    try {
      if (once) {
        const result = writeMonitorSnapshot({ db: handle, endpoints, reportsDir: config.reportsDir });
        console.log(`看板快照：${result.htmlPath}`);
        console.log(`状态 JSON：${result.statePath}`);
        const state = JSON.parse(readFileSync(result.statePath, 'utf8'));
        console.log(`KPI：7 天 ${state.kpis.units7} 件 / ${state.kpis.revenue7} RUB，预警 ${state.alerts.length} 条，竞品 ${state.kpis.competitors}`);
        return 0;
      }
      const monitor = createMonitorServer({ db: handle, endpoints, port });
      const url = await monitor.listen();
      console.log(`OZON Monitor 已启动：${url}`);
      console.log('按 Ctrl+C 停止（15 秒自动刷新；也可 --once 只导出 HTML 快照）');
      await new Promise((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      await monitor.close();
      return 0;
    } finally {
      handle.close();
    }
  }

  if (command === 'screen') {
    const { config, handle } = createContext();
    const endpointsPath = join(ROOT, 'src', 'endpoints.json');
    const endpoints = (() => {
      try {
        return JSON.parse(readFileSync(endpointsPath, 'utf8'));
      } catch {
        return null;
      }
    })();
    const once = rest.includes('--once');
    const demo = rest.includes('--demo');
    const port = Number(valueOf(rest, '--port', '8289'));
    try {
      if (once) {
        const result = writeScreenSnapshot({ db: handle, endpoints, reportsDir: config.reportsDir, demo });
        const state = result.state;
        console.log('大屏快照：' + result.htmlPath);
        console.log('状态 JSON：' + result.statePath);
        console.log('KPI：风险 ' + state.risk.score + '/100 · 7D 单量 ' + state.kpis.units7 + ' 件 · 情报 ' + state.intel.total + ' 条 · 节点 ' + state.corridor.nodes.length + (demo ? '（DEMO 数据）' : ''));
        return 0;
      }
      const screen = createScreenServer({ db: handle, endpoints, port, demo });
      const url = await screen.listen();
      console.log('OZON 情报大屏已启动：' + url + (demo ? '（DEMO 数据）' : ''));
      console.log('1920×1080 自适应缩放；SSE 5 秒推送；/api/state 可直连；也可 --once 只导出 HTML 快照');
      await new Promise((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      await screen.close();
      return 0;
    } finally {
      handle.close();
    }
  }

  if (command === 'ads') {
    const [sub] = rest;
    const { config, handle } = createContext();
    try {
      if (sub === 'sync') {
        const env = {};
        if (config.perfClientId && config.perfClientSecret) {
          env.OZON_PERF_CLIENT_ID = config.perfClientId;
          env.OZON_PERF_CLIENT_SECRET = config.perfClientSecret;
        }
        const result = await runAdsSync({ db: handle, env });
        if (!result.ok) {
          console.log(`广告同步未执行：${result.code}`);
          console.log(result.hint);
          return 1;
        }
        console.log(`广告同步：${result.stored}/${result.campaigns} 个计划入库`);
        return 0;
      }
      if (sub === 'doctor') {
        const hasId = Boolean(config.perfClientId);
        const hasSecret = Boolean(config.perfClientSecret);
        console.log(`Performance 凭据：OZON_PERF_CLIENT_ID ${hasId ? '已配置' : '缺失'}，OZON_PERF_CLIENT_SECRET ${hasSecret ? '已配置' : '缺失'}`);
        let reachable = '未知';
        try {
          const probe = await fetch('https://api-performance.ozon.ru/api/client/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: 'probe', client_secret: 'probe', grant_type: 'client_credentials' }),
            signal: AbortSignal.timeout(15000),
          });
          reachable = `可达（HTTP ${probe.status}）`;
        } catch (error) {
          reachable = `不可达：${String(error?.message ?? error).slice(0, 120)}`;
        }
        console.log(`Performance 端点：${reachable}`);
        if (!hasId || !hasSecret) {
          console.log('下一步：');
          console.log('  1) 打开 https://performance.ozon.ru 建应用，拿到 client_id / client_secret');
          console.log('  2) 写入 .secrets/ozon.env：OZON_PERF_CLIENT_ID=… / OZON_PERF_CLIENT_SECRET=…（不要加尖括号）');
          console.log('  3) 再跑 node bin/ozon.mjs ads doctor && node bin/ozon.mjs ads sync');
          console.log('在拿到凭据前，可用离线通道：ozon ads decide --file <搜索词.csv> 与 ozon ads import --file <广告.csv>');
          return 1;
        }
        const client = createPerformanceClient({ clientId: config.perfClientId, clientSecret: config.perfClientSecret });
        try {
          await client.ensureToken();
          console.log('认证：成功（token 已获取）');
          return 0;
        } catch (error) {
          console.log(`认证：失败 — ${String(error?.message ?? error).slice(0, 200)}`);
          return 1;
        }
      }
      if (sub === 'keywords') {
        const file = valueOf(rest, '--file', null);
        if (!file) {
          console.error('用法: node bin/ozon.mjs ads keywords --file <search-terms.csv> [--sku X] [--limit 40] [--date YYYY-MM-DD]');
          return 2;
        }
        const date = valueOf(rest, '--date', new Date().toISOString().slice(0, 10));
        const limit = Number(valueOf(rest, '--limit', '40'));
        const { rows } = parseSearchTermCsv(readFileSync(file, 'utf8'), { fx: 12.257 });
        const decided = decideSearchTerms(rows);
        const pack = buildKeywordPack(decided, { limit });
        const markdown = renderKeywordPackMarkdown({ date, pack, sku: valueOf(rest, '--sku', null) });
        const mdPath = join(config.reportsDir, `keywords-${date}.md`);
        const jsonPath = join(config.reportsDir, `keywords-${date}.json`);
        writeFileSync(mdPath, markdown, 'utf8');
        writeFileSync(jsonPath, `${JSON.stringify({ date, ...pack }, null, 2)}\n`, 'utf8');
        console.log(`关键词包：${mdPath}`);
        console.log(`后台关键词 ${pack.backendKeywords.length} 个，标题补充 ${pack.titleCandidates.length} 个，不要用 ${pack.avoid.length} 个`);
        if (pack.backendKeywords.length) console.log(`  后台关键词：${pack.backendKeywords.join(', ')}`);
        if (pack.titleCandidates.length) console.log(`  标题补充：${pack.titleCandidates.join(', ')}`);
        console.log(`要写进上架清单：ozon listing build --offer <id> --keywords ${jsonPath}`);
        return 0;
      }

      if (sub === 'decide') {
        const file = valueOf(rest, '--file', null);
        if (!file) {
          console.error('用法: node bin/ozon.mjs ads decide --file <search-terms.csv> [--fx 12.257] [--budget 5000] [--date YYYY-MM-DD]');
          return 2;
        }
        const fx = Number(valueOf(rest, '--fx', String(config.fxRubPerCnyFallback ?? 12.257)));
        const budget = Number(valueOf(rest, '--budget', '5000'));
        const spendCur = valueOf(rest, '--spend-cur', 'RUB');
        const date = valueOf(rest, '--date', new Date().toISOString().slice(0, 10));
        const csv = readFileSync(file, 'utf8');
        const parsed = parseSearchTermCsv(csv, { fx, spendCurrency: spendCur });
        const decided = decideSearchTerms(parsed.rows);
        const groups = allocateBudget(decided, { budget, floor: 150, cap: 0.4 });
        const markdown = renderDecideMarkdown({ date, rows: decided, groups, unknownColumns: parsed.unknownColumns, fx, spendCur, budget });
        const mdPath = join(config.reportsDir, `ads-decide-${date}.md`);
        const jsonPath = join(config.reportsDir, `ads-decide-${date}.json`);
        writeFileSync(mdPath, markdown, 'utf8');
        writeFileSync(jsonPath, `${JSON.stringify({ date, thresholds: DEFAULT_THRESHOLDS, rows: decided, budgetGroups: groups, unknownColumns: parsed.unknownColumns }, null, 2)}\n`, 'utf8');
        const hitCount = decided.filter((row) => row.primary).length;
        console.log(`搜索词判定：${decided.length} 词，${hitCount} 个有动作；预算分配 ${groups.length} 组`);
        console.log(`报告：${mdPath}`);
        console.log(`数据：${jsonPath}`);
        for (const group of groups) console.log(`  ${group.key}: ${group.alloc.toFixed(0)} 元（ACOS ${(group.acos * 100).toFixed(0)}%）`);
        return 0;
      }
      if (sub === 'import') {
        const file = valueOf(rest, '--file', null);
        if (!file) {
          console.error('用法: node bin/ozon.mjs ads import --file <campaigns.csv>');
          return 2;
        }
        const csv = readFileSync(file, 'utf8');
        const result = importAds({ db: handle, csv });
        console.log(`广告导入：${result.rows} 行 / ${result.campaigns} 个计划`);
        return 0;
      }
      if (sub === 'report' || sub === 'suggest') {
        const rows = handle.db
          .prepare('SELECT campaign_id AS campaignId, date, impressions, clicks, spend_rub AS spendRub, orders, revenue_rub AS revenueRub FROM ads_daily ORDER BY date DESC LIMIT 500')
          .all();
        const aggregated = aggregateByCampaign(rows);
        const alerts = computeAcosAlerts(aggregated);
        const suggestions = suggestBudgetChanges(aggregated);
        if (sub === 'suggest') {
          if (suggestions.length === 0) console.log('暂无建议（先导入广告数据）');
          for (const item of suggestions) console.log(`${item.campaignId}: ${item.action} — ${item.reason}`);
          return 0;
        }
        const date = valueOf(rest, '--date', new Date().toISOString().slice(0, 10));
        const markdown = renderAdsReport({ date, rows, alerts, suggestions });
        const reportPath = join(config.reportsDir, `ads-${date}.md`);
        writeFileSync(reportPath, markdown, 'utf8');
        console.log(`广告报告：${reportPath}`);
        console.log(`预警 ${alerts.length} 条，建议 ${suggestions.length} 条`);
        return 0;
      }
      if (sub === 'acos') {
        const rows = handle.db.prepare('SELECT campaign_id AS campaignId, spend_rub AS spendRub, revenue_rub AS revenueRub FROM ads_daily ORDER BY date DESC LIMIT 100').all();
        const alerts = computeAcosAlerts(rows.map((row) => ({ campaignId: row.campaignId, spendRub: row.spendRub, revenueRub: row.revenueRub })));
        if (alerts.length === 0) console.log('ACOS 正常或暂无广告数据');
        for (const alert of alerts) console.log(`[P1] ${alert.message}`);
        return 0;
      }
      console.error(`未知的 ads 子命令: ${sub}`);
      return 2;
    } finally {
      handle.close();
    }
  }

  if (command === 'action') {
    const [sub] = rest;
    const { handle } = createContext();
    try {
      if (sub === 'propose') {
        const type = valueOf(rest, '--type', null);
        const payloadPath = valueOf(rest, '--payload', null);
        if (!type || !payloadPath) {
          console.error('用法: node bin/ozon.mjs action propose --type stock_update --target A --payload <json>');
          return 2;
        }
        const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
        const proposal = proposeAction({ db: handle, action: type, target: valueOf(rest, '--target', null), payload });
        console.log(`提案 #${proposal.id}：${type} → ${proposal.path}`);
        console.log(`确认码：${proposal.code}（用 action approve --id ${proposal.id} --code <码> 批准；加 --execute 才会真正调用）`);
        return 0;
      }
      if (sub === 'list') {
        const rows = listActions({ db: handle });
        for (const row of rows.slice(0, 20)) console.log(`#${row.id} ${row.action} ${row.status} ${row.target ?? ''} ${row.created_at}`);
        return 0;
      }
      if (sub === 'approve') {
        const id = Number(valueOf(rest, '--id', '0'));
        const code = valueOf(rest, '--code', null);
        const execute = rest.includes('--execute');
        const { api } = createContext();
        const result = await approveAction({ db: handle, id, code, api, execute });
        if (execute) {
          console.log(`已执行：${result.path}`);
        } else {
          console.log(`已批准（dry-run，未调用）：${result.path}`);
          console.log(`将提交 ${result.items ?? 1} 条：${JSON.stringify(result.payload).slice(0, 800)}`);
        }
        return 0;
      }
      console.error(`未知的 action 子命令: ${sub}`);
      return 2;
    } finally {
      handle.close();
    }
  }

  if (command === 'image') {
    const [sub] = rest;
    if (sub === 'plan') {
      const manifestPath = valueOf(rest, '--manifest', null);
      if (!manifestPath) {
        console.error('用法: node bin/ozon.mjs image plan --manifest <batch.json> [--budget 60] [--cost 12]');
        return 2;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const plan = planImageBatch({
        manifest,
        budgetCredits: Number(valueOf(rest, '--budget', '60')),
        costPerImage: Number(valueOf(rest, '--cost', '12')),
      });
      const { config } = createContext();
      const batchDir = join(config.outboxDir, 'batches', plan.batchId);
      const ledger = createBatchLedger({ filePath: join(batchDir, 'ledger.json') });
      ledger.init(plan);
      console.log(`批次 ${plan.batchId}：${plan.tasks.length} 个任务，预计 ${plan.estimatedCredits} credits（预算 ${plan.budgetCredits}）`);
      for (const task of plan.tasks) console.log(`  [${task.id}] ${task.shot} → ${task.output}`);
      for (const skipped of plan.skipped) console.log(`  [跳过 ${skipped.id}] ${skipped.reason}`);
      console.log(`台账：${join(batchDir, 'ledger.json')}`);
      return 0;
    }
    if (sub === 'record') {
      const batch = valueOf(rest, '--batch', null);
      const taskId = valueOf(rest, '--task', null);
      if (!batch || !taskId) {
        console.error('用法: node bin/ozon.mjs image record --batch <batchId> --task <id> [--url <https://...>] [--output <png>] [--credits 12]');
        return 2;
      }
      const { config } = createContext();
      const batchDir = join(config.outboxDir, 'batches', batch);
      const ledger = createBatchLedger({ filePath: join(batchDir, 'ledger.json') });
      const state = ledger.load();
      if (!state) {
        console.log(`没有批次台账：${join(batchDir, 'ledger.json')}`);
        return 1;
      }
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) {
        console.log(`批次 ${batch} 里没有任务 ${taskId}`);
        return 1;
      }
      const url = valueOf(rest, '--url', null);
      const output = valueOf(rest, '--output', task.output);
      if (url) {
        fetchImageToFile({ url, output });
        console.log(`已下载：${output}`);
      }
      const credits = valueOf(rest, '--credits', String(state.costPerImage ?? 12));
      ledger.mark(taskId, { status: 'done', url, output, credits: Number(credits) });
      const validation = await validateBatchImage({ path: output, expectRatio: task.aspectRatio === '1:1' ? 1 : 0.75, minWidth: 512 });
      if (validation.ok) {
        console.log(`已登记：${taskId}（${validation.info.width}×${validation.info.height}，ratio ${validation.info.ratio}）`);
        return 0;
      }
      for (const issue of validation.issues) console.log(`  校验问题 ${issue.code}: ${issue.message}`);
      return 1;
    }
    if (sub === 'batch-to-listing') {
      const batch = valueOf(rest, '--batch', null);
      if (!batch) {
        console.error('用法: node bin/ozon.mjs image batch-to-listing --batch <batchId> [--offer <id>] [--keywords <json>]');
        return 2;
      }
      const { config, handle } = createContext();
      try {
        const ledgerPath = join(config.outboxDir, 'batches', batch, 'ledger.json');
        const outDir = join(config.outboxDir, 'design', `batch-${batch}`);
        const result = await renderBatchImages({ ledgerPath, outDir });
        console.log(`批次 ${result.batchId}：${result.images.length} 张已规范化为 900×1200`);
        console.log(`图片清单：${result.manifestPath}`);
        if (result.skippedPending > 0) console.log(`（还有 ${result.skippedPending} 个任务未完成，未纳入）`);
        const rawOffer = valueOf(rest, '--offer', null);
        if (!rawOffer) return 0;
        const factsFile = valueOf(rest, '--facts', join(config.root, 'assets', 'listing-facts.json'));
        const store = loadListingFacts({ file: factsFile });
        const facts = findFacts(store, rawOffer);
        if (!facts) {
          console.log(`事实库没有 ${rawOffer}，先补 ${factsFile}（重量/尺寸/数量/搜索词）`);
          return 1;
        }
        const keywordsPath = valueOf(rest, '--keywords', null);
        const keywords = keywordsPath ? JSON.parse(readFileSync(keywordsPath, 'utf8')) : null;
        const listing = buildListing({
          db: handle,
          offerId: facts.offerId,
          outDir: join(config.outboxDir, 'listing', facts.offerId),
          images: result.images,
          keywords,
          facts,
        });
        console.log(listing.ok ? `上架产物：${join(config.outboxDir, 'listing', offerId)}` : `QA 未通过（${listing.qa.issues.length} 个问题）`);
        for (const issue of listing.qa.issues.slice(0, 6)) console.log(`  ${issue.code}: ${issue.message}`);
        return listing.ok ? 0 : 1;
      } finally {
        handle.close();
      }
    }
    if (sub === 'batch-status') {
      const batch = valueOf(rest, '--batch', null);
      if (!batch) {
        console.error('用法: node bin/ozon.mjs image batch-status --batch <batchId>');
        return 2;
      }
      const { config } = createContext();
      const ledgerPath = join(config.outboxDir, 'batches', batch, 'ledger.json');
      const ledger = createBatchLedger({ filePath: ledgerPath });
      const state = ledger.load();
      if (!state) {
        console.log(`没有批次台账：${ledgerPath}`);
        return 1;
      }
      const done = state.tasks.filter((task) => task.status === 'done').length;
      console.log(`批次 ${state.batchId}：${done}/${state.tasks.length} 完成，已花 ${state.spentCredits} credits（预算 ${state.budgetCredits}）`);
      for (const task of state.tasks) console.log(`  [${task.status}] ${task.id}${task.credits ? ` (${task.credits} credits)` : ''}${task.url ? ` ${task.url}` : ''}`);
      return 0;
    }
    if (sub === 'fetch') {
      const url = valueOf(rest, '--url', null);
      const output = valueOf(rest, '--output', null);
      if (!url || !output) {
        console.error('用法: node bin/ozon.mjs image fetch --url <https://...> --output <png> [--proxy http://127.0.0.1:7897]');
        return 2;
      }
      const proxy = valueOf(rest, '--proxy', undefined);
      const result = fetchImageToFile({ url, output, proxy });
      console.log(`已下载：${result.output}`);
      return 0;
    }
    if (sub === 'comfy-status') {
      const status = comfyEnvStatus({ fetchStatus: () => null });
      console.log(status.installed ? 'ComfyUI 已安装' : 'ComfyUI 未安装');
      console.log(`checkpoint: ${status.checkpoint ?? '缺失'}`);
      for (const hint of status.hints) console.log(`- ${hint}`);
      return status.installed ? 0 : 1;
    }
    if (sub === 'comfy') {
      const prompt = valueOf(rest, '--prompt', null);
      const output = valueOf(rest, '--output', null);
      if (!prompt || !output) {
        console.error('用法: node bin/ozon.mjs image comfy --prompt "<俄语场景>" --output <png> [--width 512 --height 512 --steps 1]');
        return 2;
      }
      const client = createComfyClient();
      if (!(await client.ready())) {
        console.log('ComfyUI 未运行。启动：imgwork/.venv/Scripts/python.exe comfyui/main.py --cpu --port 8188');
        return 1;
      }
      const workflow = buildComfyWorkflow({
        checkpoint: valueOf(rest, '--checkpoint', 'sd_turbo.safetensors'),
        positive: prompt,
        width: Number(valueOf(rest, '--width', '512')),
        height: Number(valueOf(rest, '--height', '512')),
        steps: Number(valueOf(rest, '--steps', '1')),
        seed: Number(valueOf(rest, '--seed', '42')),
      });
      const promptId = await client.queuePrompt(workflow);
      const image = await client.waitForImage(promptId, { timeoutMs: 600000 });
      const bytes = await client.fetchImage(image);
      const buffer = Buffer.from(bytes);
      const format = sniffImageFormat(buffer);
      let finalPath = output;
      if (format === 'jpeg' && output.toLowerCase().endsWith('.png')) finalPath = output.replace(/\.png$/i, '.jpg');
      if (format === 'webp' && output.toLowerCase().endsWith('.png')) finalPath = output.replace(/\.png$/i, '.webp');
      writeFileSync(finalPath, buffer);
      console.log(`ComfyUI 已生成：${finalPath}（${image.filename}，${format ?? 'unknown'}）`);
      return 0;
    }
    if (sub === 'status') {
      const status = imageEnvStatus();
      console.log(status.ok ? `生图环境就绪：${status.model}` : '生图环境未就绪');
      for (const hint of status.hints) console.log(`- ${hint}`);
      return status.ok ? 0 : 1;
    }
    if (sub === 'generate') {
      const prompt = valueOf(rest, '--prompt', null);
      const output = valueOf(rest, '--output', null);
      if (!prompt || !output) {
        console.error('用法: node bin/ozon.mjs image generate --prompt "<俄语场景描述>" --output <png> [--width 768 --height 768 --steps 4 --seed 42]');
        return 2;
      }
      const result = await generateImage({
        prompt,
        output,
        width: Number(valueOf(rest, '--width', '768')),
        height: Number(valueOf(rest, '--height', '768')),
        steps: Number(valueOf(rest, '--steps', '4')),
        seed: Number(valueOf(rest, '--seed', '42')),
      });
      if (!result.ok) {
        console.log(`生图失败：${result.code}`);
        if (result.hints) for (const hint of result.hints) console.log(`- ${hint}`);
        if (result.message) console.log(result.message);
        return 1;
      }
      console.log(`已生成：${result.output}（${result.size?.join('×') ?? ''} seed ${result.seed}）`);
      return 0;
    }
    console.error(`未知的 image 子命令: ${sub}`);
    return 2;
  }

  console.error(`未知命令: ${command}\n\n${USAGE}`);
  return 2;
}

if (process.argv[1] && /bin[\\/]ozon\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error?.message ?? error);
      process.exitCode = 1;
    });
}
