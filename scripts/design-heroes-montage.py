from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
HD = os.path.join(ROOT, "assets", "design-system", "heroes")
FB = r"C:/Windows/Fonts/segoeuib.ttf"
files = [("W2", "雪刷 / winter auto"), ("P1", "猫抓板 / pet home"), ("H1", "门缝条 / home industrial"), ("W4", "热水袋 / care"), ("B1", "指甲剪 / pet care")]
th = 1100
ims = []
for sku, label in files:
    im = Image.open(os.path.join(HD, sku + ".jpg")).convert("RGB")
    w = round(im.width * th / im.height)
    ims.append((sku, label, im.resize((w, th), Image.LANCZOS)))
gap = 24
W = 40 + sum(i.width + gap for _, _, i in ims)
canvas = Image.new("RGB", (W, th + 120), (240, 242, 246))
d = ImageDraw.Draw(canvas)
d.text((24, 18), "DEMO BRAND · 5 SKU hero posters — same system, different product style", font=ImageFont.truetype(FB, 34), fill=(32, 36, 44))
x = 24
for sku, label, im in ims:
    canvas.paste(im, (x, 74))
    d.text((x + 6, th + 80), sku + " · " + label, font=ImageFont.truetype(FB, 22), fill=(90, 96, 108))
    x += im.width + gap
out = os.path.join(ROOT, "assets", "design-system", "demo-brand-heroes-overview.jpg")
canvas.save(out, "JPEG", quality=90)
print(out, canvas.size)
