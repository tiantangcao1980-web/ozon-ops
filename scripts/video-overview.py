from pathlib import Path
import os, subprocess
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
FF = os.environ.get("FFMPEG_PATH") or "ffmpeg"
FB = r"C:/Windows/Fonts/segoeuib.ttf"
skus = ["W2", "P1", "H1", "W4", "B1"]
th = 260
rows = []
for sku in skus:
    d = os.path.join(ROOT, "assets", "video", sku)
    out = os.path.join(d, "strip.jpg")
    subprocess.run([FF, "-y", "-i", os.path.join(d, "DEMO BRAND-" + sku + "-UGC.mp4"), "-vf", "fps=1/7,scale=260:-1,tile=6x1", "-frames:v", "1", out], check=True, capture_output=True)
    im = Image.open(out).convert("RGB")
    w = round(im.width * th / im.height)
    rows.append((sku, im.resize((w, th), Image.LANCZOS)))
W = 150 + max(i.width for _, i in rows)
Hh = 40 + len(rows) * (th + 16)
canvas = Image.new("RGB", (W, Hh), (240, 242, 246))
dd = ImageDraw.Draw(canvas)
dd.text((12, 6), "DEMO BRAND · 5 UGC videos (9:16, 35–44 s) — key frames", font=ImageFont.truetype(FB, 22), fill=(30, 34, 40))
y = 40
for sku, im in rows:
    dd.text((12, y + th // 2 - 12), sku, font=ImageFont.truetype(FB, 28), fill=(60, 66, 76))
    canvas.paste(im, (130, y)); y += th + 16
canvas.save(os.path.join(ROOT, "assets", "video", "videos-overview.jpg"), "JPEG", quality=88)
print(canvas.size)
