import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderBatchImages } from '../src/content/batch-images.mjs';

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

async function makePng(dir, name, { width = 768, height = 1024 } = {}) {
  const { renderTextPng } = await import('../src/content/textlayer.mjs');
  const path = join(dir, name);
  renderTextPng({ text: name, outputPath: path, width, height, fontSize: 60 });
  return path;
}

test('renderBatchImages normalizes done tasks and writes a 3-image manifest', { skip: PILLOW_SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-to-listing-'));
  try {
    const src = join(dir, 'src');
    mkdirSync(src, { recursive: true });
    const main = await makePng(src, 'main.png');
    const lifestyle = await makePng(src, 'lifestyle.png');
    const detail = await makePng(src, 'detail.png');
    const ledgerPath = join(dir, 'ledger.json');
    writeFileSync(
      ledgerPath,
      JSON.stringify({
        batchId: 'demo-batch',
        costPerImage: 12,
        budgetCredits: 36,
        spentCredits: 24,
        tasks: [
          { id: 'lifestyle', shot: 'lifestyle', status: 'done', output: lifestyle },
          { id: 'detail', shot: 'detail', status: 'done', output: detail },
          { id: 'main', shot: 'main', status: 'done', output: main },
          { id: 'set', shot: 'set', status: 'pending' },
        ],
      }),
      'utf8',
    );
    const outDir = join(dir, 'design');
    const result = await renderBatchImages({ ledgerPath, outDir });
    assert.equal(result.images.length, 3);
    assert.equal(result.images[0].role, 'main');
    assert.equal(result.images[0].width, 900);
    assert.equal(result.images[0].height, 1200);
    assert.ok(result.manifestPath.endsWith('images.json'));
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
    assert.equal(manifest.length, 3);
    assert.ok(manifest.every((item) => item.width === 900 && item.height === 1200));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderBatchImages refuses when fewer than 3 done images', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-to-listing-'));
  try {
    const ledgerPath = join(dir, 'ledger.json');
    writeFileSync(ledgerPath, JSON.stringify({ batchId: 'few', tasks: [{ id: 'main', shot: 'main', status: 'done', output: join(dir, 'missing.png') }] }), 'utf8');
    await assert.rejects(() => renderBatchImages({ ledgerPath, outDir: join(dir, 'design') }), /至少 3 张|3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
