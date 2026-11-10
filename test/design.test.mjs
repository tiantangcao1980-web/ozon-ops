import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyImageRole, parseImageUrls, extractPalette, summarizeBlocks, designBrief } from '../src/intel/design.mjs';
import { saveCompetitorImages, saveDesignPattern } from '../src/intel/store.mjs';
import { normalizeMainImage, composeDetailPage, inspectImage } from '../src/content/images.mjs';
import { openDb } from '../src/db.mjs';

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

test('classifyImageRole distinguishes main, gallery and detail images', () => {
  assert.equal(classifyImageRole({ inDescription: false, index: 0 }), 'main');
  assert.equal(classifyImageRole({ inDescription: false, index: 3 }), 'gallery');
  assert.equal(classifyImageRole({ inDescription: true, index: 7 }), 'detail');
});

test('parseImageUrls dedupes and keeps order', () => {
  const images = parseImageUrls([
    { url: 'https://cdn/a.jpg', index: 0 },
    { url: 'https://cdn/b.jpg', index: 1 },
    { url: 'https://cdn/a.jpg', index: 2 },
    { url: 'https://cdn/c.jpg', index: 3, inDescription: true },
  ]);
  assert.deepEqual(images.map((image) => image.url), ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg']);
  assert.equal(images[0].role, 'main');
  assert.equal(images[2].role, 'detail');
});

test('extractPalette returns dominant hex colors', () => {
  const palette = extractPalette([
    [255, 0, 0],
    [255, 0, 0],
    [250, 4, 4],
    [255, 255, 255],
    [0, 0, 0],
    [0, 0, 0],
  ]);
  assert.equal(palette[0].hex, '#ff0000');
  assert.ok(palette.length >= 2);
  assert.ok(palette.every((item) => /^#[0-9a-f]{6}$/.test(item.hex)));
});

test('summarizeBlocks describes section order and counts', () => {
  const summary = summarizeBlocks([
    { type: 'image', order: 0 },
    { type: 'text', order: 1, text: 'Термостойкая лопатка' },
    { type: 'image', order: 2 },
    { type: 'table', order: 3 },
  ]);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.order, ['image', 'text', 'image', 'table']);
  assert.equal(summary.counts.image, 2);
  assert.equal(summary.counts.text, 1);
});

test('designBrief produces a reusable chinese brief', () => {
  const brief = designBrief({
    sku: '123',
    palette: [{ hex: '#ff0000', share: 0.5 }],
    blocks: summarizeBlocks([{ type: 'image', order: 0 }, { type: 'text', order: 1 }]),
    images: [{ role: 'main', url: 'a' }, { role: 'detail', url: 'b' }],
  });
  assert.match(brief, /主图/);
  assert.match(brief, /#ff0000/);
  assert.match(brief, /image → text/);
});

test('saveCompetitorImages and saveDesignPattern are idempotent', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const images = [{ url: 'https://cdn/a.jpg', role: 'main', index: 0 }];
    saveCompetitorImages(handle, '123', images, { capturedAt: '2026-11-06T00:00:00.000Z' });
    saveCompetitorImages(handle, '123', images, { capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM competitor_images').get().n, 1);
    saveDesignPattern(handle, { sku: '123', palette: [{ hex: '#ff0000' }], blocks: { order: ['image'] }, capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM design_patterns').get().n, 1);
  } finally {
    handle.close();
  }
});

test('normalizeMainImage pads to 900x1200 white and inspectImage reports 3:4', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ozon-img-'));
  try {
    const source = join(dir, 'source.png');
    await normalizeMainImage({ width: 600, height: 600, color: 0xff0000ff, outputPath: source });
    assert.ok(existsSync(source));
    const out = join(dir, 'main.png');
    await normalizeMainImage({ sourcePath: source, outputPath: out });
    const info = await inspectImage(out);
    assert.equal(info.width, 900);
    assert.equal(info.height, 1200);
    assert.ok(Math.abs(info.ratio - 0.75) < 0.01);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('composeDetailPage stacks sections into one long image', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ozon-detail-'));
  try {
    const out = join(dir, 'detail.png');
    await composeDetailPage({
      outputPath: out,
      width: 900,
      sections: [
        { type: 'banner', color: 0x1f6febff, height: 200 },
        { type: 'textBlock', color: 0xf5f5f5ff, height: 160 },
        { type: 'banner', color: 0xffcc00ff, height: 120 },
      ],
    });
    const info = await inspectImage(out);
    assert.equal(info.width, 900);
    assert.equal(info.height, 480);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ingestDesign stores images, palette and brief', async () => {
  const { ingestDesign } = await import('../src/intel/design-commands.mjs');
  const handle = openDb();
  handle.migrate();
  const dir = mkdtempSync(join(tmpdir(), 'ozon-design-'));
  try {
    const result = await ingestDesign({
      db: handle,
      sku: '1234567851',
      outDir: dir,
      raw: {
        images: [
          { url: 'https://cdn/1.jpg', index: 0 },
          { url: 'https://cdn/2.jpg', index: 1 },
          { url: 'https://cdn/3.jpg', index: 2, inDescription: true },
        ],
        palette: [[255, 0, 0], [255, 0, 0], [0, 0, 0]],
        blocks: [{ type: 'image', order: 0 }, { type: 'text', order: 1 }],
      },
      capturedAt: '2026-11-06T00:00:00.000Z',
    });
    assert.equal(result.images, 3);
    assert.equal(result.palette[0].hex, '#ff0000');
    assert.ok(existsSync(join(dir, 'brief.md')));
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM competitor_images').get().n, 3);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM design_patterns').get().n, 1);
  } finally {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('composeDesign writes a new main image and detail page', async () => {
  const { composeDesign } = await import('../src/intel/design-commands.mjs');
  const handle = openDb();
  handle.migrate();
  const dir = mkdtempSync(join(tmpdir(), 'ozon-compose-'));
  try {
    await (await import('../src/intel/store.mjs')).saveDesignPattern(handle, {
      sku: '1234567851',
      palette: [{ hex: '#ff0000' }, { hex: '#111111' }],
      blocks: { order: ['image', 'text', 'image', 'table'], counts: { image: 2, text: 1, table: 1 }, total: 4 },
      capturedAt: '2026-11-06T00:00:00.000Z',
    });
    const result = await composeDesign({ db: handle, sku: '1234567851', outDir: dir });
    assert.ok(existsSync(result.mainPath));
    assert.ok(existsSync(result.detailPath));
    const main = await (await import('../src/content/images.mjs')).inspectImage(result.mainPath);
    const detail = await (await import('../src/content/images.mjs')).inspectImage(result.detailPath);
    assert.equal(main.width, 900);
    assert.equal(main.height, 1200);
    assert.equal(detail.width, 900);
    assert.ok(detail.height >= 400);
  } finally {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('composeMainImage puts a palette banner above the product photo', async () => {
  const { composeMainImage, inspectImage } = await import('../src/content/images.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ozon-main-'));
  try {
    const source = join(dir, 'product.png');
    await (await import('../src/content/images.mjs')).normalizeMainImage({ width: 600, height: 600, color: 0x333333ff, outputPath: source });
    const out = join(dir, 'main.png');
    await composeMainImage({ sourcePath: source, palette: ['#002040', '#ffffff'], outputPath: out });
    const info = await inspectImage(out);
    assert.equal(info.width, 900);
    assert.equal(info.height, 1200);
    const Jimp = (await import('jimp')).default;
    const image = await Jimp.read(out);
    const bannerPixel = Jimp.intToRGBA(image.getPixelColor(10, 10));
    assert.ok(bannerPixel.b < 80, `banner should be navy, got ${JSON.stringify(bannerPixel)}`);
    const productPixel = Jimp.intToRGBA(image.getPixelColor(450, 700));
    assert.ok(productPixel.r < 120 && productPixel.g < 120, `product area should be dark grey, got ${JSON.stringify(productPixel)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isWebpHeader detects the webp container that ozon CDN serves', async () => {
  const { isWebpHeader } = await import('../src/content/images.mjs');
  const riff = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(isWebpHeader(riff), true);
  assert.equal(isWebpHeader(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), false);
});

test('renderTextPng draws cyrillic text and composeMainImage puts it in the banner', { skip: PILLOW_SKIP }, async () => {
  const { renderTextPng } = await import('../src/content/textlayer.mjs');
  const { composeMainImage, inspectImage } = await import('../src/content/images.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ozon-text-'));
  try {
    const textPng = join(dir, 'text.png');
    renderTextPng({ text: 'Лопатка кухонная', outputPath: textPng, width: 900, height: 220, fontSize: 84 });
    const textInfo = await inspectImage(textPng);
    assert.equal(textInfo.width, 900);
    assert.equal(textInfo.height, 220);

    const out = join(dir, 'main.png');
    await composeMainImage({ palette: ['#002040'], outputPath: out, headlineRu: 'Лопатка кухонная' });
    const Jimp = (await import('jimp')).default;
    const image = await Jimp.read(out);
    let whitePixels = 0;
    for (let x = 100; x < 800; x += 10) {
      for (let y = 20; y < 150; y += 10) {
        const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
        if (pixel.r > 200 && pixel.g > 200 && pixel.b > 200) whitePixels += 1;
      }
    }
    assert.ok(whitePixels > 5, `banner should contain white headline pixels, got ${whitePixels}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('composeDesign writes main, gallery and images manifest for listing build', { skip: PILLOW_SKIP }, async () => {
  const { composeDesign } = await import('../src/intel/design-commands.mjs');
  const handle = openDb();
  handle.migrate();
  const dir = mkdtempSync(join(tmpdir(), 'ozon-compose2-'));
  try {
    await (await import('../src/intel/store.mjs')).saveDesignPattern(handle, {
      sku: '1234567851',
      palette: [{ hex: '#002040' }, { hex: '#ffcc00' }],
      blocks: { order: ['image', 'text'], counts: { image: 1, text: 1 }, total: 2 },
      capturedAt: '2026-11-06T00:00:00.000Z',
    });
    const result = await composeDesign({ db: handle, sku: '1234567851', outDir: dir, headlineRu: 'Лопатка кухонная' });
    assert.ok(existsSync(result.imagesManifestPath));
    const manifest = JSON.parse(readFileSync(result.imagesManifestPath, 'utf8'));
    assert.equal(manifest.length, 3);
    assert.ok(manifest.every((item) => item.width === 900 && item.height === 1200));
    assert.ok(existsSync(join(dir, 'gallery-1.png')));
  } finally {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderTextPng shrinks the font until the headline fits the canvas', { skip: PILLOW_SKIP }, async () => {
  const { renderTextPng, measureTextWidth } = await import('../src/content/textlayer.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ozon-fit-'));
  try {
    const text = 'Лопатка кухонная силиконовая термостойкая 28 см';
    const longWidth = measureTextWidth({ text, fontSize: 88, font: undefined });
    assert.ok(longWidth > 900, `expected oversized at 88px, got ${longWidth}`);
    const out = join(dir, 'fit.png');
    renderTextPng({ text, outputPath: out, width: 900, height: 220, fontSize: 88, maxWidth: 820 });
    const fitted = measureTextWidth({ text, fontSize: 88 });
    assert.ok(fitted <= longWidth);
    assert.ok(existsSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveReviews updates rating when the same review is re-ingested with a rating', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const { saveReviews } = await import('../src/intel/store.mjs');
    saveReviews(handle, '999', [{ reviewId: 'r1', rating: null, text: 'ok', date: '2026-11-05' }], { capturedAt: '2026-11-06T00:00:00.000Z' });
    saveReviews(handle, '999', [{ reviewId: 'r1', rating: 4, text: 'ok', date: '2026-11-05' }], { capturedAt: '2026-11-07T00:00:00.000Z' });
    const row = handle.db.prepare("SELECT rating FROM reviews_raw WHERE review_id = 'r1'").get();
    assert.equal(row.rating, 4);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM reviews_raw').get().n, 1);
  } finally {
    handle.close();
  }
});

test('sniffImageFormat detects png and jpeg magic bytes', async () => {
  const { sniffImageFormat } = await import('../src/content/images.mjs');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(sniffImageFormat(png), 'png');
  assert.equal(sniffImageFormat(jpeg), 'jpeg');
  assert.equal(sniffImageFormat(Buffer.from([0, 1, 2])), null);
});
