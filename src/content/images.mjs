import Jimp from 'jimp';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderTextPng } from './textlayer.mjs';

const WHITE = 0xffffffff;

export function isWebpHeader(buffer) {
  if (!buffer || buffer.length < 12) return false;
  return buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
}

function findPython() {
  const candidates = [
    process.env.PYTHON_PATH,
    process.env.OZON_PYTHON,
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'python' || existsSync(candidate)) return candidate;
  }
  return 'python';
}
/**
 * Ozon CDN 的 .jpg 实际是 webp；jimp 读不了，先用本机 Pillow 转 png。
 */
export function ensureReadableImage(path) {
  if (!path) return path;
  const header = readFileSync(path).subarray(0, 12);
  if (!isWebpHeader(header)) return path;
  const output = `${path.replace(/\.[^.]+$/, '')}.png`;
  // 路径通过 argv 传，避免拼进 Python 源码造成注入
  const script = [
    'import sys',
    'from PIL import Image',
    'Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2])',
  ].join('\n');
  execFileSync(findPython(), ['-c', script, path, output], { stdio: ['ignore', 'pipe', 'pipe'] });
  return output;
}

function rgba(color) {
  if (color == null) return WHITE;
  if (typeof color === 'number') return color;
  const { r = 255, g = 255, b = 255, a = 255 } = color;
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function containFit(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.bitmap.width, maxHeight / image.bitmap.height);
  const width = Math.max(1, Math.round(image.bitmap.width * scale));
  const height = Math.max(1, Math.round(image.bitmap.height * scale));
  return image.resize(width, height, Jimp.RESIZE_BICUBIC);
}

/**
 * 主图规范化：白底 900×1200（3:4），产品等比居中。
 * 不传 sourcePath 时直接生成纯色占位图（方便流水线先跑通）。
 */
export async function normalizeMainImage({
  sourcePath = null,
  outputPath,
  width = 900,
  height = 1200,
  color = WHITE,
  padding = 60,
} = {}) {
  const canvas = new Jimp(width, height, rgba(WHITE));
  const product = sourcePath ? await Jimp.read(sourcePath) : new Jimp(Math.round(width * 0.6), Math.round(width * 0.6), rgba(color));
  const fitted = containFit(product, width - padding * 2, height - padding * 2);
  const x = Math.round((width - fitted.bitmap.width) / 2);
  const y = Math.round((height - fitted.bitmap.height) / 2);
  canvas.composite(fitted, x, y);
  await canvas.writeAsync(outputPath);
  return outputPath;
}

/**
 * 详情页长图：按区块从上到下拼接（banner 色带 / textBlock 文字占位 / image 本地图）。
 */
export async function composeDetailPage({ sections = [], outputPath, width = 900, background = WHITE } = {}) {
  const blocks = sections.map((section) => ({ ...section, height: Math.max(1, Number(section.height) || 120) }));
  const totalHeight = blocks.reduce((sum, block) => sum + block.height, 0);
  const canvas = new Jimp(width, totalHeight, rgba(background));
  let y = 0;
  for (const block of blocks) {
    if (block.type === 'image' && block.path) {
      try {
        const image = await Jimp.read(block.path);
        const fitted = containFit(image, width, block.height);
        canvas.composite(fitted, Math.round((width - fitted.bitmap.width) / 2), y + Math.round((block.height - fitted.bitmap.height) / 2));
      } catch {
        const placeholder = new Jimp(width, block.height, rgba(block.color ?? 0xddddddff));
        canvas.composite(placeholder, 0, y);
      }
    } else {
      const band = new Jimp(width, block.height, rgba(block.color ?? 0xeeeeeeff));
      canvas.composite(band, 0, y);
    }
    y += block.height;
  }
  await canvas.writeAsync(outputPath);
  return { outputPath, width, height: totalHeight };
}

export async function inspectImage(path) {
  const image = await Jimp.read(path);
  const { width, height } = image.bitmap;
  return { width, height, ratio: Math.round((width / height) * 1000) / 1000 };
}

function hexToRgba(hex, fallback = WHITE) {
  const value = String(hex ?? '').replace('#', '');
  if (value.length !== 6) return fallback;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some((item) => Number.isNaN(item))) return fallback;
  return ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

function luminance(hex) {
  const value = String(hex ?? '').replace('#', '');
  if (value.length !== 6) return 1;
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pickPrimaryColor(palette = [], fallback = '#002040') {
  const colors = (palette ?? []).map((item) => (typeof item === 'string' ? item : item?.hex)).filter(Boolean);
  return colors.find((hex) => luminance(hex) < 0.85) ?? fallback;
}

/**
 * 新主图：顶部品牌色带 + 产品实拍（白底 3:4）。
 * 这是「拆竞品布局 → 重组成新图」的主图部分。
 */
export async function composeMainImage({ sourcePath, palette = [], outputPath, width = 900, height = 1200, bannerHeight = 180, headlineRu = null } = {}) {
  const primary = pickPrimaryColor(palette);
  const bannerH = headlineRu ? Math.max(bannerHeight, 220) : bannerHeight;
  const canvas = new Jimp(width, height, rgba(WHITE));
  const banner = new Jimp(width, bannerH, hexToRgba(primary));
  canvas.composite(banner, 0, 0);

  if (headlineRu) {
    const textPng = `${outputPath.replace(/\.png$/i, '')}-headline.png`;
    renderTextPng({ text: headlineRu, outputPath: textPng, width, height: bannerH, fontSize: 88, color: '#ffffff' });
    const layer = await Jimp.read(textPng);
    canvas.composite(layer, 0, 0);
  }

  const areaTop = bannerH + 20;
  const areaHeight = height - areaTop - 60;
  if (sourcePath) {
    const product = await Jimp.read(sourcePath);
    const fitted = containFit(product, width - 160, areaHeight);
    canvas.composite(fitted, Math.round((width - fitted.bitmap.width) / 2), areaTop + Math.round((areaHeight - fitted.bitmap.height) / 2));
  } else {
    const placeholder = new Jimp(Math.round(width * 0.55), Math.round(areaHeight * 0.7), hexToRgba('#333333'));
    canvas.composite(placeholder, Math.round((width - placeholder.bitmap.width) / 2), areaTop + 40);
  }
  await canvas.writeAsync(outputPath);
  return { outputPath, width, height, palette: primary };
}
export function sniffImageFormat(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF') return 'webp';
  return null;
}