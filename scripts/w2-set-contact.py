from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
D = os.path.join(ROOT, "assets", "W2-v2")
FB = r"C:/Windows/Fonts/segoeuib.ttf"
names = ["01_hero", "02_feature", "03_structure", "04_size", "05_test", "06_steps", "07_kit", "08_white"]
th = 640
ims = []
for n in names:
    im = Image.open(os.path.join(D, n + ".jpg")).convert("RGB")
    w = round(im.width * th / im.height)
    ims.append((n, im.resize((w, th), Image.LANCZOS)))
gap = 16
W = 32 + sum(i.width + gap for _, i in ims)
canvas = Image.new("RGB", (W, th + 80), (240, 242, 246))
d = ImageDraw.Draw(canvas)
d.text((20, 14), "W2 · 8-image set (3:4 1500x2000) — DEMO BRAND system", font=ImageFont.truetype(FB, 26), fill=(30, 34, 40))
x = 16
for n, im in ims:
    canvas.paste(im, (x, 52)); x += im.width + gap
out = os.path.join(D, "_contact.jpg")
canvas.save(out, "JPEG", quality=90)
print(out, canvas.size)
