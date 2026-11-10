from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
FB = r"C:/Windows/Fonts/segoeuib.ttf"
names = ["01_hero","02_feature","03_structure","04_size","05_test","06_steps","07_kit","08_white"]
skus = ["W2","P1","H1","W4","B1"]
th = 340
rows = []
for sku in skus:
    d = os.path.join(ROOT, "assets", sku + "-v2")
    ims = []
    for n in names:
        p = os.path.join(d, n + ".jpg")
        if not os.path.exists(p): continue
        im = Image.open(p).convert("RGB")
        w = round(im.width * th / im.height)
        ims.append(im.resize((w, th), Image.LANCZOS))
    rows.append((sku, ims))
    # per sku contact
    t2 = 620
    ims2 = []
    for n in names:
        p = os.path.join(d, n + ".jpg")
        if not os.path.exists(p): continue
        im = Image.open(p).convert("RGB")
        w = round(im.width * t2 / im.height)
        ims2.append((n, im.resize((w, t2), Image.LANCZOS)))
    gap = 14
    Wc = 30 + sum(i.width + gap for _, i in ims2)
    c = Image.new("RGB", (Wc, t2 + 70), (240, 242, 246))
    dd = ImageDraw.Draw(c)
    dd.text((14, 12), sku + " · 8 images (3:4 1500x2000)", font=ImageFont.truetype(FB, 24), fill=(30, 34, 40))
    x = 14
    for n, im in ims2:
        c.paste(im, (x, 50)); x += im.width + gap
    c.save(os.path.join(d, "_contact.jpg"), "JPEG", quality=88)

gap = 10
W = 30 + sum(i.width + gap for _, ims in rows for i in ims[:8]) 
W = 30 + 8 * (round(1500 * th / 2000) + gap)
H = 60 + len(rows) * (th + 46)
canvas = Image.new("RGB", (W, H), (240, 242, 246))
d = ImageDraw.Draw(canvas)
d.text((16, 14), "DEMO BRAND · 5 SKU x 8 images — auto-built set", font=ImageFont.truetype(FB, 28), fill=(28, 32, 38))
y = 60
for sku, ims in rows:
    d.text((16, y), sku, font=ImageFont.truetype(FB, 26), fill=(60, 66, 76))
    x = 70
    for im in ims[:8]:
        canvas.paste(im, (x, y)); x += im.width + gap
    y += th + 46
canvas.save(os.path.join(ROOT, "assets", "design-system", "all-sets-overview.jpg"), "JPEG", quality=86)
print("overview", canvas.size)
