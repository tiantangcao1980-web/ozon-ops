import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PYTHON_CANDIDATES = [
  process.env.PYTHON_PATH,
  process.env.OZON_PYTHON,
  'python',
].filter(Boolean);

const FONT_CANDIDATES = [
  process.env.OZON_FONT_PATH,
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/DejaVuSans-Bold.ttf',
].filter(Boolean);

export function resolvePython() {
  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate === 'python' || existsSync(candidate)) return candidate;
  }
  return 'python';
}

export function resolveFont() {
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('找不到支持西里尔字母的字体，请设置 OZON_FONT_PATH');
}

/**
 * 用本机 Pillow 渲染俄语文字层（PNG，透明底）。
 * jimp 的位图字体只有拉丁字母，所以文字走 Pillow。
 */
export function renderTextPng({ text, outputPath, width = 900, height = 220, fontSize = 96, color = '#ffffff', stroke = '#000000', strokeWidth = 0, maxWidth = null } = {}) {
  const font = resolveFont();
  const script = [
    'import sys, json',
    'from PIL import Image, ImageDraw, ImageFont',
    'args = json.loads(sys.argv[1])',
    'img = Image.new("RGBA", (args["width"], args["height"]), (0, 0, 0, 0))',
    'draw = ImageDraw.Draw(img)',
    'size = args["fontSize"]',
    'maxWidth = args.get("maxWidth") or (args["width"] - 80)',
    'while size > 24:',
    '    font = ImageFont.truetype(args["font"], size)',
    '    bbox = draw.textbbox((0, 0), args["text"], font=font)',
    '    if bbox[2] - bbox[0] <= maxWidth:',
    '        break',
    '    size -= 4',
    'font = ImageFont.truetype(args["font"], size)',
    'bbox = draw.textbbox((0, 0), args["text"], font=font)',
    'tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]',
    'x = (args["width"] - tw) // 2 - bbox[0]',
    'y = (args["height"] - th) // 2 - bbox[1]',
    'draw.text((x, y), args["text"], font=font, fill=args["color"], stroke_width=args["strokeWidth"], stroke_fill=args["stroke"])',
    'img.save(args["outputPath"])',
  ].join('\n');
  const payload = JSON.stringify({ text, outputPath, width, height, fontSize, color, stroke, strokeWidth, font, maxWidth });
  execFileSync(resolvePython(), ['-c', script, payload], { stdio: ['ignore', 'pipe', 'pipe'] });
  return outputPath;
}

export function measureTextWidth({ text, fontSize = 88, font = resolveFont() }) {
  const script = [
    'import sys, json',
    'from PIL import ImageFont',
    'args = json.loads(sys.argv[1])',
    'font = ImageFont.truetype(args["font"], args["fontSize"])',
    'bbox = font.getbbox(args["text"])',
    'print(bbox[2] - bbox[0])',
  ].join('\n');
  const output = execFileSync(resolvePython(), ['-c', script, JSON.stringify({ text, fontSize, font })], { encoding: 'utf8' });
  return Number(output.trim());
}
