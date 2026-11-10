from pathlib import Path
import os, subprocess
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
FF = os.environ.get("FFMPEG_PATH") or "ffmpeg"
FB = r"C:/Windows/Fonts/segoeuib.ttf"
skus = ["P1", "H1", "W4", "B1"]
rows = []
th = 300
for sku in skus:
    d = os.path.join(ROOT, "assets", "video", sku)
    out = os.path.join(d, "strip.jpg")
    subprocess.run([FF, "-y", "-i", os.path.join(d, "DEMO BRAND-" + sku + "-UGC.mp4"), "-vf", "fps=1/7,scale=300:-1,tile=5x1", "-frames:v", "1", out], check=True, capture_output=True)
    im = Image.open(out).convert("RGB")
    w = round(im.width * th / im.height)
    rows.append((sku, im.resize((w, th), Image.LANCZOS)))
W = 140 + max(i.width for _, i in rows)
Hh = 40 + len(rows) * (th + 20)
canvas = Image.new("RGB", (W, Hh), (240, 242, 246))
dd = ImageDraw.Draw(canvas)
dd.text((12, 8), "DEMO BRAND · UGC video frames (P1 / H1 / W4 / B1)", font=ImageFont.truetype(FB, 22), fill=(30, 34, 40))
y = 40
for sku, im in rows:
    dd.text((12, y + th // 2), sku, font=ImageFont.truetype(FB, 30), fill=(60, 66, 76))
    canvas.paste(im, (120, y)); y += th + 20
canvas.save(os.path.join(ROOT, "assets", "video", "frames-all.jpg"), "JPEG", quality=88)
print(canvas.size)
