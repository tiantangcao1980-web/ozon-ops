/**
 * OZON 运营系统 · DSH 插件入口
 *
 * 一个入口技能 + 一个工具。工具只做一件事：把白名单里的 action 转成
 * `node bin/ozon.mjs ...` 子进程调用，返回受控输出。
 * 写操作永远不在这里执行（只能 propose），批准要走终端。
 *
 * @module ozon-ops
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'ozon-ops';
export const inject = ['skills', 'tools'];

// 仓库根 = plugin/ 的上一级；可用 OZON_OPS_ROOT 覆盖。
const PROJECT_ROOT = process.env.OZON_OPS_ROOT || fileURLToPath(new URL('../', import.meta.url));
const CLI = join(PROJECT_ROOT, 'bin', 'ozon.mjs');
const SKILL_DIR = fileURLToPath(new URL('./skills/ozon-ops/', import.meta.url));
const MAX_OUTPUT = 20000;

const ACTIONS = [
  'status',
  'probe',
  'pull',
  'fx',
  'reconcile',
  'alerts',
  'report',
  'select',
  'action_propose',
  'action_list',
  'translate_prepare',
  'translate_commit',
  'listing_build',
  'listing_check',
  'design_compose',
  'ads_sync',
  'weekly_report',
  'ads_report',
  'ads_decide',
  'ads_doctor',
  'stock_forecast',
  'margin_report',
  'cost_list',
  'monitor_snapshot',
  'ads_keywords',
  'image_plan',
  'image_batch_status',
  'image_batch_to_listing',
];

function runCli(args, timeoutMs = 240000) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: PROJECT_ROOT, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: String(stdout ?? '').slice(0, MAX_OUTPUT),
          stderr: String(stderr ?? '').slice(0, 4000),
        });
      },
    );
  });
}

function buildArgs(args) {
  const action = String(args.action ?? '').trim();
  if (!ACTIONS.includes(action)) throw new Error(`不支持的 action：${action}`);

  switch (action) {
    case 'status':
      return ['status'];
    case 'probe':
      return ['probe'];
    case 'fx':
      return ['fx', 'sync'];
    case 'alerts':
      return ['alerts'];
    case 'report':
      return ['report', ...(args.date ? ['--date', String(args.date)] : [])];
    case 'select':
      return ['select'];
    case 'action_list':
      return ['action', 'list'];
    case 'pull': {
      const target = String(args.target ?? 'products');
      const allowed = ['products', 'postings', 'analytics', 'categories'];
      if (!allowed.includes(target)) throw new Error(`未知的 pull target：${target}`);
      const extra = [];
      if (target === 'analytics') {
        if (args.from) extra.push('--from', String(args.from));
        if (args.to) extra.push('--to', String(args.to));
        if (args.days) extra.push('--days', String(args.days));
        if (args.bySku) extra.push('--by-sku');
      }
      return ['pull', target, ...extra];
    }
    case 'reconcile':
      return ['finance', 'reconcile', '--month', String(args.month ?? new Date().toISOString().slice(0, 7))];
    case 'action_propose': {
      const type = String(args.type ?? '');
      const payload = args.payload;
      if (!payload) throw new Error('action_propose 需要 payload（JSON 字符串）');
      const payloadPath = join(PROJECT_ROOT, 'outbox', `proposal-${Date.now()}.json`);
      return { args: ['action', 'propose', '--type', type, '--payload', payloadPath], payloadPath, payload };
    }
    case 'translate_prepare':
      return ['translate', 'prepare', '--offer', String(args.offer ?? ''), '--zh', String(args.zhFile ?? '')];
    case 'translate_commit':
      return ['translate', 'commit', '--offer', String(args.offer ?? ''), '--filled', String(args.filledFile ?? '')];
    case 'listing_build':
      return [
        'listing',
        'build',
        '--offer',
        String(args.offer ?? ''),
        ...(args.factsFile ? ['--facts', String(args.factsFile)] : []),
        ...(args.imagesFile ? ['--images', String(args.imagesFile)] : []),
        ...(args.keywordsFile ? ['--keywords', String(args.keywordsFile)] : []),
      ];
    case 'listing_check':
      return ['listing', 'check', '--offer', String(args.offer ?? ''), ...(args.factsFile ? ['--facts', String(args.factsFile)] : [])];
    case 'ads_decide':
      return ['ads', 'decide', '--file', String(args.file ?? '')];
    case 'ads_doctor':
      return ['ads', 'doctor'];
    case 'stock_forecast':
      return ['stock', 'forecast'];
    case 'margin_report':
      return ['report', 'margin'];
    case 'cost_list':
      return ['cost', 'list'];
    case 'monitor_snapshot':
      return ['monitor', '--once'];
    case 'ads_keywords':
      return ['ads', 'keywords', '--file', String(args.file ?? '')];
    case 'image_plan':
      return ['image', 'plan', '--manifest', String(args.file ?? ''), ...(args.budget ? ['--budget', String(args.budget)] : [])];
    case 'image_batch_status':
      return ['image', 'batch-status', '--batch', String(args.batch ?? '')];
    case 'image_batch_to_listing':
      return ['image', 'batch-to-listing', '--batch', String(args.batch ?? ''), ...(args.offer ? ['--offer', String(args.offer)] : [])];
    case 'ads_report':
      return ['ads', 'report', ...(args.date ? ['--date', String(args.date)] : [])];
    case 'weekly_report':
      return ['report', 'weekly', ...(args.date ? ['--date', String(args.date)] : [])];
    case 'ads_sync':
      return ['ads', 'sync'];
    case 'design_compose':
      return ['design', 'compose', '--sku', String(args.sku ?? ''), ...(args.source ? ['--source', String(args.source)] : [])];
    default:
      throw new Error(`action ${action} 没有实现`);
  }
}

const tool = {
  name: 'ozon_ops',
  description:
    'OZON 运营系统工具：店铺状态、端点探活、取数（商品/订单/分析/类目）、汇率、财务对账、预警、日报看板、选品评估、翻译与上架产物、视觉合成、写操作提案。写操作只生成提案（dry-run），执行必须由用户在终端用确认码批准。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ACTIONS, description: '要执行的动作' },
      target: { type: 'string', description: 'pull 的目标：products / postings / analytics / categories' },
      month: { type: 'string', description: '对账月份 YYYY-MM' },
      date: { type: 'string', description: '日报日期 YYYY-MM-DD' },
      from: { type: 'string', description: 'analytics 起始日 YYYY-MM-DD' },
      to: { type: 'string', description: 'analytics 结束日 YYYY-MM-DD' },
      days: { type: 'number', description: 'analytics 最近天数' },
      bySku: { type: 'boolean', description: 'analytics 是否按 SKU 维度拉取' },
      offer: { type: 'string', description: '商品 offer_id' },
      sku: { type: 'string', description: '竞品/商品数字 ID' },
      type: { type: 'string', description: '写操作类型：price_update / stock_update / review_reply / question_answer' },
      payload: { type: 'string', description: '写操作请求体（JSON 字符串）' },
      zhFile: { type: 'string', description: 'translate_prepare 的中文卖点 JSON 路径' },
      filledFile: { type: 'string', description: 'translate_commit 的俄语填充 JSON 路径' },
      imagesFile: { type: 'string', description: 'listing_build 的图片清单 JSON 路径' },
      factsFile: { type: 'string', description: 'listing_build / listing_check 的事实库 JSON 路径（默认 data/listing-facts.json）' },
      keywordsFile: { type: 'string', description: 'listing_build 的关键词包 JSON 路径（ads_keywords 的产物）' },
      source: { type: 'string', description: 'design_compose 的产品图路径' },
      file: { type: 'string', description: 'ads_decide / 导入类 action 的文件路径' },
      batch: { type: 'string', description: '生图批次 id（image_batch_status 用）' },
      budget: { type: 'number', description: 'image_plan 的 credits 预算' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'exitCode', 'stdout'],
      properties: {
        action: { type: 'string' },
        exitCode: { type: 'number' },
        stdout: { type: 'string' },
        stderr: { type: 'string' },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text: `[${value.action}] exit=${value.exitCode}\n${value.stdout}${value.stderr ? `\n--- stderr ---\n${value.stderr}` : ''}`,
      },
    ],
  },
  isConcurrencySafe: () => false,
  async execute(args) {
    if (args?.action === 'action_propose') {
      return {
        action: 'action_propose',
        exitCode: 0,
        stdout: [
          '写操作提案不在工具里执行（避免确认码回传模型）。请让用户在终端运行：',
          'node bin/ozon.mjs action propose --type <type> --payload <payload.json>',
          '确认码只在终端显示；批准同样只能在终端执行。',
        ].join('\n'),
        stderr: '',
      };
    }
    const built = buildArgs(args ?? {});
    const normalized = Array.isArray(built) ? { args: built } : built;
    if (normalized.payloadPath) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(join(PROJECT_ROOT, 'outbox'), { recursive: true });
      await writeFile(normalized.payloadPath, JSON.stringify(normalized.payload), 'utf8');
    }
    const result = await runCli(normalized.args);
    return { action: String(args.action), ...result };
  },
};

export async function apply(ctx) {
  const skill = await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  ctx.skills?.register?.({
    name: 'ozon-ops',
    description:
      'OZON 运营系统入口：取数、日报/预警、选品、翻译、上架产物、竞品视觉拆解与写操作提案。写操作默认 dry-run，需终端确认码批准。',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'ozon-ops',
    source: 'bundled',
    rank: 600,
    resourceBase: { kind: 'directory', path: SKILL_DIR },
    locator: join(SKILL_DIR, 'SKILL.md'),
    body: skill,
  });
  ctx.tools?.register?.(tool);
}