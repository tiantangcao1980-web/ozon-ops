/**
 * 批量生图编排（Lovart 等第三方生图通道的「计划 + 台账 + 校验」）。
 *
 * 设计原因：生图工具只在 Agent 侧（MCP），CLI 不能直接调用；
 * 所以把它拆成三件事，CLI/脚本都能做：
 *   1) plan   —— 按 manifest 生成任务清单，先卡 credits 预算
 *   2) record —— 把生成结果 URL/本地文件登记进台账（含 credits 消耗）
 *   3) status —— 查看进度与已花 credits，校验产物尺寸/比例
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = process.env.OZON_OPS_ROOT || fileURLToPath(new URL('../../', import.meta.url));

const SHOT_TEMPLATES = {
  main: (product) =>
    `Product photo for an e-commerce main image: ${product.nameEn}. ${product.setting ?? ''}. ${product.material ?? ''}. Clean composition with empty space at the top, soft daylight, high detail, sharp focus. No text, no watermark, no logo.`.replace(/\s+/g, ' ').trim(),
  lifestyle: (product) =>
    `Lifestyle photo: ${product.nameEn} in real use in a Russian kitchen, hand holding it naturally, warm daylight, shallow depth of field, believable home environment. No text, no watermark.`.replace(/\s+/g, ' ').trim(),
  detail: (product) =>
    `Macro close-up detail shot of ${product.nameEn}, showing ${product.material ?? 'material'} texture and edge quality, soft studio light, neutral background. No text, no watermark.`.replace(/\s+/g, ' ').trim(),
  scale: (product) =>
    `Product photo of ${product.nameEn} next to a measuring ruler on a light table, showing real size in centimetres, top-down view, clean background. No text, no watermark.`.replace(/\s+/g, ' ').trim(),
  set: (product) =>
    `Flat-lay of ${product.nameEn} with matching kitchen accessories, ${product.colors?.join(' and ') ?? 'neutral'} tones, light wooden surface, top-down, minimal styling. No text, no watermark.`.replace(/\s+/g, ' ').trim(),
};

export const DEFAULT_COST_PER_IMAGE = 12;

export function buildPrompt(product, shotType) {
  const template = SHOT_TEMPLATES[shotType];
  if (!template) throw new Error(`未知的镜头类型：${shotType}（支持 ${Object.keys(SHOT_TEMPLATES).join('/')}）`);
  return template(product);
}

export function planImageBatch({ manifest, costPerImage = DEFAULT_COST_PER_IMAGE, budgetCredits = 60, outRoot = PROJECT_ROOT }) {
  if (!manifest?.batchId) throw new Error('manifest 缺少 batchId');
  const product = manifest.product ?? {};
  if (!product.nameEn) throw new Error('manifest.product.nameEn 必填（生图 prompt 用英文）');
  const shots = Array.isArray(manifest.shots) && manifest.shots.length > 0 ? manifest.shots : ['main', 'lifestyle', 'detail'];
  const maxTasks = Math.floor(Number(budgetCredits) / Number(costPerImage));
  if (maxTasks < 1) throw new Error(`预算 ${budgetCredits} credits 不足一张图（单张 ${costPerImage}）`);

  const tasks = [];
  const skipped = [];
  for (const shot of shots) {
    const id = String(shot);
    const task = {
      id,
      shot,
      prompt: buildPrompt(product, shot),
      aspectRatio: manifest.aspectRatio ?? '3:4',
      output: join(outRoot, 'outbox', 'batches', manifest.batchId, `${id}.png`),
      costPerImage: Number(costPerImage),
      status: 'pending',
    };
    if (tasks.length >= maxTasks) {
      skipped.push({ ...task, reason: 'budget' });
      continue;
    }
    tasks.push(task);
  }
  return {
    batchId: manifest.batchId,
    product,
    costPerImage: Number(costPerImage),
    budgetCredits: Number(budgetCredits),
    estimatedCredits: tasks.length * Number(costPerImage),
    tasks,
    skipped,
    createdAt: new Date().toISOString(),
  };
}

export function createBatchLedger({ filePath }) {
  function read() {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }
  function write(state) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return state;
  }
  return {
    init(plan) {
      const state = {
        batchId: plan.batchId,
        product: plan.product,
        costPerImage: plan.costPerImage,
        budgetCredits: plan.budgetCredits,
        estimatedCredits: plan.estimatedCredits,
        spentCredits: 0,
        createdAt: plan.createdAt,
        updatedAt: new Date().toISOString(),
        tasks: plan.tasks.map((task) => ({ ...task, status: 'pending' })),
        skipped: plan.skipped ?? [],
      };
      return write(state);
    },
    load() {
      return read();
    },
    mark(taskId, { status = 'done', url = null, output = null, credits = null } = {}) {
      const state = read();
      if (!state) throw new Error(`台账不存在：${filePath}`);
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error(`任务不存在：${taskId}`);
      task.status = status;
      if (url) task.url = url;
      if (output) task.output = output;
      if (credits != null) {
        task.credits = Number(credits);
        state.spentCredits = state.tasks.reduce((sum, item) => sum + Number(item.credits ?? 0), 0);
      }
      state.updatedAt = new Date().toISOString();
      write(state);
      return task;
    },
  };
}

export async function validateBatchImage({ path, expectRatio = 0.75, minWidth = 900, tolerance = 0.02 }) {
  const { inspectImage } = await import('./images.mjs');
  const info = await inspectImage(path);
  const issues = [];
  if (Math.abs(info.ratio - expectRatio) > tolerance) {
    issues.push({ code: 'IMAGE_RATIO', message: `比例 ${info.ratio} 与期望 ${expectRatio} 偏差超过 ${tolerance}` });
  }
  if (info.width < minWidth) {
    issues.push({ code: 'IMAGE_RESOLUTION', message: `宽度 ${info.width} < ${minWidth}` });
  }
  return { ok: issues.length === 0, info, issues };
}
