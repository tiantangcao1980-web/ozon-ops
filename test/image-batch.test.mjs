import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPrompt, planImageBatch, createBatchLedger, validateBatchImage } from '../src/content/image-batch.mjs';

import { spawnSync } from 'node:child_process';

// 文字渲染依赖本机 Python + Pillow；缺少时跳过相关用例（与仓库里 raw 快照缺失即 skip 的约定一致）。
function hasPillow() {
  const candidates = [process.env.OZON_PYTHON, process.env.PYTHON_PATH, 'python', 'python3'].filter(Boolean);
  for (const exe of candidates) {
    try {
      const result = spawnSync(exe, ['-c', 'import PIL'], { stdio: 'ignore', timeout: 20000 });
      if (result.status === 0) return true;
    } catch { /* try next */ }
  }
  return false;
}
const PILLOW = hasPillow();
const PILLOW_SKIP = PILLOW ? false : 'Pillow not available (set PYTHON_PATH 或 OZON_PYTHON)';

const MANIFEST = {
  batchId: 'spatula-2026-11',
  product: {
    nameRu: 'Лопатка силиконовая',
    nameEn: 'grey silicone kitchen spatula',
    material: 'food-grade silicone',
    colors: ['grey'],
    setting: 'light wooden countertop, minimal kitchen',
  },
  shots: ['main', 'lifestyle', 'detail'],
};

test('buildPrompt produces english prompts per shot type', () => {
  const main = buildPrompt(MANIFEST.product, 'main');
  assert.match(main, /grey silicone kitchen spatula/);
  assert.match(main, /no text/i);
  const lifestyle = buildPrompt(MANIFEST.product, 'lifestyle');
  assert.match(lifestyle, /in use|hand|kitchen/i);
  const detail = buildPrompt(MANIFEST.product, 'detail');
  assert.match(detail, /close-up|macro|detail/i);
});

test('planImageBatch trims to credit budget and assigns outputs', () => {
  const plan = planImageBatch({ manifest: MANIFEST, costPerImage: 12, budgetCredits: 24 });
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.estimatedCredits, 24);
  assert.equal(plan.tasks[0].id, 'main');
  assert.match(plan.tasks[0].output, /spatula-2026-11/);
  assert.ok(plan.tasks[0].output.endsWith('main.png'));
  assert.equal(plan.tasks[0].aspectRatio, '3:4');
});

test('planImageBatch rejects a budget smaller than one image', () => {
  assert.throws(() => planImageBatch({ manifest: MANIFEST, costPerImage: 12, budgetCredits: 5 }), /预算|budget/i);
});

test('batch ledger round-trips and marks tasks done', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-ledger-'));
  try {
    const ledger = createBatchLedger({ filePath: join(dir, 'ledger.json') });
    ledger.init(planImageBatch({ manifest: MANIFEST, costPerImage: 12, budgetCredits: 24 }));
    ledger.mark('main', { status: 'done', url: 'https://a.lovart.ai/x.png', output: join(dir, 'main.png'), credits: 12 });
    const reloaded = createBatchLedger({ filePath: join(dir, 'ledger.json') });
    const state = reloaded.load();
    assert.equal(state.batchId, 'spatula-2026-11');
    assert.equal(state.tasks.find((task) => task.id === 'main').status, 'done');
    assert.equal(state.spentCredits, 12);
    assert.equal(state.tasks.find((task) => task.id === 'lifestyle').status, 'pending');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateBatchImage checks ratio and minimum size', { skip: PILLOW_SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-img-'));
  try {
    const { renderTextPng } = await import('../src/content/textlayer.mjs');
    const path = join(dir, 'main.png');
    renderTextPng({ text: 'x', outputPath: path, width: 900, height: 1200, fontSize: 60 });
    const ok = await validateBatchImage({ path, expectRatio: 0.75, minWidth: 900 });
    assert.equal(ok.ok, true);
    const bad = await validateBatchImage({ path, expectRatio: 1, minWidth: 2000 });
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some((issue) => issue.code === 'IMAGE_RATIO' || issue.code === 'IMAGE_RESOLUTION'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
