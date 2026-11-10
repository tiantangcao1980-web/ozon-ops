from pathlib import Path
import json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = str(Path(__file__).resolve().parents[1])
PLAN = json.load(open(os.path.join(ROOT, "assets", "image-plan.json"), encoding="utf-8"))
W = 1200
FONT_BOLD = r"C:/Windows/Fonts/segoeuib.ttf"
FONT_REG = r"C:/Windows/Fonts/segoeui.ttf"

def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)

def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def wrap(draw, text, fnt, maxw):
    words = text.split(); lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def draw_caption(im, ov, accent, plate=True):
    cap, sub = ov.get("caption", ""), ov.get("sub", "")
    f_cap, f_sub = font(60, True), font(34)
    d = ImageDraw.Draw(im)
    maxw = W - (190 if plate else 160)
    cap_lines = wrap(d, cap, f_cap, maxw)
    sub_lines = wrap(d, sub, f_sub, maxw) if sub else []
    lh_cap, lh_sub = 72, 46
    block_h = len(cap_lines)*lh_cap + (10 if sub_lines else 0) + len(sub_lines)*lh_sub
    top = 34
    if plate:
        pad = 34
        plate_h = block_h + 2*pad
        layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        pd = ImageDraw.Draw(layer)
        pd.rounded_rectangle([36, top, W - 36, top + plate_h], radius=26, fill=(255, 255, 255, 242))
        pd.rectangle([36, top, 48, top + plate_h], fill=hexrgb(accent) + (255,))
        im = Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB")
        d = ImageDraw.Draw(im)
        y = top + pad
    else:
        d.rectangle([64, top + 8, 74, top + block_h - 4], fill=hexrgb(accent))
        y = top
    x = 96 if plate else 100
    for ln in cap_lines:
        d.text((x, y), ln, font=f_cap, fill=hexrgb(accent)); y += lh_cap
    y += 8
    for ln in sub_lines:
        d.text((x, y), ln, font=f_sub, fill=(62, 66, 74)); y += lh_sub
    return im

def cover(im, size):
    w, h = im.size
    s = max(size / w, size / h)
    im2 = im.resize((max(1, round(w*s)), max(1, round(h*s))), Image.LANCZOS)
    return im2.crop(((im2.width-size)//2, (im2.height-size)//2, (im2.width-size)//2+size, (im2.height-size)//2+size))

def compose(raw_path, out_path, role, ov, accent):
    src = Image.open(raw_path).convert("RGB")
    if role == "size":
        canvas = Image.new("RGB", (W, W), (255, 255, 255))
        area = W - 300
        s = min(area / src.width, area / src.height)
        thumb = src.resize((round(src.width*s), round(src.height*s)), Image.LANCZOS)
        canvas.paste(thumb, ((W - thumb.width)//2, W - thumb.height - 40))
        im = draw_caption(canvas, ov, accent, plate=False) if ov else canvas
    elif role == "main":
        im = cover(src, W)
    else:
        im = draw_caption(cover(src, W), ov, accent, plate=True) if ov else cover(src, W)
    im.save(out_path, "JPEG", quality=92)

summary = []
for sku, cfg in PLAN["skus"].items():
    accent = cfg.get("accent", "#1F5FA8")
    outdir = os.path.join(ROOT, "assets", sku)
    manifest, missing = [], []
    for img in cfg["images"]:
        raw = os.path.join(ROOT, "assets", sku, "raw", img["file"] + ".png")
        if not os.path.exists(raw):
            missing.append(img["file"] + ".png"); continue
        out_path = os.path.join(outdir, img["file"] + ".jpg")
        compose(raw, out_path, img.get("role", "gallery"), img.get("overlay"), accent)
        manifest.append({"path": f"assets/{sku}/{img['file']}.jpg", "width": W, "height": W, "role": img.get("role", "gallery"), "index": img["idx"]})
        print("compose", sku, img["file"], os.path.getsize(out_path)//1024, "KB")
    if manifest:
        json.dump(manifest, open(os.path.join(outdir, "images.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if missing: print("MISSING", sku, missing)
