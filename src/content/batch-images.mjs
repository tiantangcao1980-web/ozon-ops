/**
 * 把批量生图台账（ledger.json）接到上架流水线：
 * 挑出已完成的图 → 统一裁成 900×1200（白底 3:4）→ 产出 images.json（main + gallery），
 * 供 `ozon listing build --images` 直接消费。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { normalizeMainImage, inspectImage } from './images.mjs';

const ROLE_ORDER = ['main', 'lifestyle', 'detail', 'scale', 'set'];

export async function renderBatchImages({
  ledgerPath,
  outDir,
  width = 900,
  height = 1200,
  minImages = 3,
  mainShot = 'main',
} = {}) {
  if (!ledgerPath || !existsSync(ledgerPath)) throw new Error(`台账不存在：${ledgerPath}`);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const done = (ledger.tasks ?? []).filter((task) => task.status === 'done' && task.output && existsSync(task.output));
  if (done.length < minImages) {
    throw new Error(`批次只有 ${done.length} 张已完成图片，上架至少需要 ${minImages} 张（先跑 image record 或补拍）`);
  }

  const rank = (task) => {
    const index = ROLE_ORDER.indexOf(task.shot ?? task.id);
    return index === -1 ? ROLE_ORDER.length : index;
  };
  const sorted = [...done].sort((a, b) => rank(a) - rank(b));
  const mainTask = sorted.find((task) => (task.shot ?? task.id) === mainShot) ?? sorted[0];
  const rest = sorted.filter((task) => task !== mainTask);

  mkdirSync(outDir, { recursive: true });
  const images = [];
  const mainPath = join(outDir, 'main.png');
  await normalizeMainImage({ sourcePath: mainTask.output, outputPath: mainPath, width, height });
  images.push({ path: mainPath, width, height, role: 'main', source: basename(mainTask.output) });

  let galleryIndex = 0;
  for (const task of rest) {
    galleryIndex += 1;
    const target = join(outDir, `gallery-${galleryIndex}.png`);
    await normalizeMainImage({ sourcePath: task.output, outputPath: target, width, height });
    images.push({ path: target, width, height, role: 'gallery', source: basename(task.output) });
  }

  const manifestPath = join(outDir, 'images.json');
  writeFileSync(manifestPath, `${JSON.stringify(images, null, 2)}\n`, 'utf8');
  const inspected = await Promise.all(images.map((image) => inspectImage(image.path)));
  return {
    batchId: ledger.batchId,
    images,
    manifestPath,
    inspected,
    skippedPending: (ledger.tasks ?? []).filter((task) => task.status !== 'done').length,
  };
}
