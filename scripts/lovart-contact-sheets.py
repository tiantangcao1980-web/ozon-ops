from pathlib import Path
import json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = str(Path(__file__).resolve().parents[1])
PLAN = json.load(open(os.path.join(ROOT, "assets", "image-plan.json"), encoding="utf-8"))
FB = r"C:/Windows/Fonts/segoeuib.ttf"
FR = r"C:/Windows/Fonts/segoeui.ttf"

def hexrgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def fit_text(draw, text, font_path, max_size, min_size, maxw):
    size = max_size
    while size > min_size:
        f = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=f) <= maxw:
            return f
        size -= 2
    return ImageFont.truetype(font_path, min_size)

def ellipsize(draw, text, fnt, maxw):
    if draw.textlength(text, font=fnt) <= maxw:
        return text
    while len(text) > 4 and draw.textlength(text + "…", font=fnt) > maxw:
        text = text[:-1]
    return text + "…"

def sheet(sku, cfg, out):
    files = [os.path.join(ROOT, "assets", sku, img["file"] + ".jpg") for img in cfg["images"]]
    files = [f for f in files if os.path.exists(f)]
    if not files: return None
    tw, th, gap, lab = 380, 380, 24, 52
    W = gap + len(files) * (tw + gap)
    H = lab + th + 2 * gap + 70
    canvas = Image.new("RGB", (W, H), (245, 246, 248))
    d = ImageDraw.Draw(canvas)
    accent = hexrgb(cfg.get("accent", "#1F5FA8"))
    d.rectangle([0, 0, W, lab], fill=accent)
    title = sku + "  ·  " + cfg.get("title", "")
    f_title = fit_text(d, title, FB, 34, 20, W - 2 * gap)
    title = ellipsize(d, title, f_title, W - 2 * gap)
    tw_title = d.textlength(title, font=f_title)
    d.text((gap, (lab - 34) // 2 + 2), title, font=f_title, fill=(255, 255, 255))
    f_label = ImageFont.truetype(FB, 26)
    for i, p in enumerate(files):
        im = Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS)
        x = gap + i * (tw + gap)
        canvas.paste(im, (x, lab + gap // 2))
        d.rectangle([x, lab + gap // 2, x + tw, lab + gap // 2 + th], outline=(210, 214, 220), width=2)
        label = os.path.basename(p).replace(".jpg", "")
        d.text((x + 6, lab + gap // 2 + th + 8), label, font=f_label, fill=(60, 64, 72))
    canvas.save(out, "JPEG", quality=90)
    return out

outdir = os.path.join(ROOT, "assets", "_contact")
os.makedirs(outdir, exist_ok=True)
for sku, cfg in PLAN["skus"].items():
    out = os.path.join(outdir, sku + "-contact.jpg")
    r = sheet(sku, cfg, out)
    if r: print("sheet", out)

thumbs = []
for sku, cfg in PLAN["skus"].items():
    files = [os.path.join(ROOT, "assets", sku, img["file"] + ".jpg") for img in cfg["images"]]
    files = [f for f in files if os.path.exists(f)]
    if files: thumbs.append((sku, cfg, files))
if thumbs:
    tw, th, gap = 240, 240, 14
    W = gap + 5 * (tw + gap)
    H = gap + len(thumbs) * (th + 54 + gap)
    canvas = Image.new("RGB", (W, H), (245, 246, 248))
    d = ImageDraw.Draw(canvas)
    for row, (sku, cfg, files) in enumerate(thumbs):
        y = gap + row * (th + 54 + gap)
        accent = hexrgb(cfg.get("accent", "#1F5FA8"))
        label = sku + " · " + cfg.get("title", "")
        f = fit_text(d, label, FB, 24, 16, W - 2 * gap)
        label = ellipsize(d, label, f, W - 2 * gap)
        d.text((gap, y - 2), label, font=f, fill=accent)
        for i, p in enumerate(files[:5]):
            im = Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS)
            x = gap + i * (tw + gap)
            canvas.paste(im, (x, y + 34))
            d.rectangle([x, y + 34, x + tw, y + 34 + th], outline=(205, 209, 215), width=1)
    canvas.save(os.path.join(outdir, "all-skus-overview.jpg"), "JPEG", quality=88)
    print("overview ok")
