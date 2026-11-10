import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseImageUrls, extractPalette, summarizeBlocks, designBrief } from './design.mjs';
import { saveCompetitorImages, saveDesignPattern } from './store.mjs';
import { composeMainImage, composeDetailPage, pickPrimaryColor, ensureReadableImage } from '../content/images.mjs';

function hexToRgba(hex) {
  const value = String(hex ?? '').replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return { r, g, b, a: 255 };
}

/**
 * 落库竞品视觉：图片角色、配色、详情页区块结构，并生成 brief。
 */
export async function ingestDesign({ db, sku, raw = {}, outDir, capturedAt = new Date().toISOString() }) {
  const images = parseImageUrls(raw.images ?? []);
  const palette = raw.palette && raw.palette.length && typeof raw.palette[0] === 'string'
    ? raw.palette.map((hex) => ({ hex }))
    : extractPalette(raw.palette ?? []);
  const blocks = summarizeBlocks(raw.blocks ?? []);

  saveCompetitorImages(db, String(sku), images, { capturedAt });
  saveDesignPattern(db, { sku: String(sku), palette, blocks, notes: raw.notes ?? null, capturedAt });

  mkdirSync(outDir, { recursive: true });
  const brief = designBrief({ sku: String(sku), palette, blocks, images });
  writeFileSync(join(outDir, 'brief.md'), brief, 'utf8');
  writeFileSync(join(outDir, 'images.json'), `${JSON.stringify(images, null, 2)}\n`, 'utf8');

  return { images: images.length, palette, blocks, briefPath: join(outDir, 'brief.md') };
}

/**
 * 按竞品视觉 brief 重组成新主图与详情页（本地合成，不复制对方图片）。
 */
export async function composeDesign({ db, sku, outDir, sourcePath = null, headlineRu = null }) {
  const pattern = db.db.prepare('SELECT * FROM design_patterns WHERE sku = ? ORDER BY captured_at DESC LIMIT 1').get(String(sku));
  if (!pattern) throw new Error(`没有 ${sku} 的视觉拆解，先跑 intel design ingest`);
  const palette = pattern.palette_json ? JSON.parse(pattern.palette_json) : [];
  const blocks = pattern.blocks_json ? JSON.parse(pattern.blocks_json) : { order: ['image', 'text', 'image'] };

  mkdirSync(outDir, { recursive: true });
  const primaryColor = pickPrimaryColor(palette);
  const secondaryColor =
    (palette ?? []).map((item) => item?.hex ?? item).find((hex) => hex && String(hex).toLowerCase() !== primaryColor.toLowerCase()) ?? '#f5f5f5';

  const mainPath = join(outDir, 'main.png');
  const readableSource = sourcePath ? ensureReadableImage(sourcePath) : null;
  await composeMainImage({ sourcePath: readableSource, palette: [primaryColor, secondaryColor], outputPath: mainPath, headlineRu });

  const galleryPaths = [];
  for (let index = 1; index <= 2; index += 1) {
    const galleryPath = join(outDir, `gallery-${index}.png`);
    await composeMainImage({
      sourcePath: readableSource,
      palette: [index === 1 ? secondaryColor : primaryColor, primaryColor],
      outputPath: galleryPath,
      headlineRu: index === 1 ? headlineRu : null,
    });
    galleryPaths.push(galleryPath);
  }

  const sections = [];
  for (const type of blocks.order ?? []) {
    if (type === 'image') sections.push({ type: 'banner', color: hexToRgba(primaryColor), height: 300 });
    else if (type === 'table') sections.push({ type: 'textBlock', color: hexToRgba(secondaryColor), height: 200 });
    else sections.push({ type: 'textBlock', color: hexToRgba(secondaryColor), height: 140 });
  }
  if (sections.length === 0) sections.push({ type: 'banner', color: hexToRgba(primaryColor), height: 300 });

  const detailPath = join(outDir, 'detail.png');
  await composeDetailPage({ outputPath: detailPath, sections });

  const imagesManifestPath = join(outDir, 'images.json');
  const manifest = [
    { path: mainPath, width: 900, height: 1200, role: 'main' },
    ...galleryPaths.map((path, index) => ({ path, width: 900, height: 1200, role: 'gallery', index: index + 1 })),
  ];
  writeFileSync(imagesManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { mainPath, detailPath, palette, blocks, imagesManifestPath, galleryPaths };
}
