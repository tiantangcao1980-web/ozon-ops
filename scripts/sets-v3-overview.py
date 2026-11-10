from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
FB = r"C:/Windows/Fonts/segoeuib.ttf"
names = ["01_hero","02_feature","03_structure","04_size","05_test","06_steps","07_kit","08_white"]
skus = ["W2","P1","H1","W4","B1"]
th = 560
rows = []
for sku in skus:
    d = os.path.join(ROOT, "assets", sku + "-v3" if sku != "W2" else "W2-v2")
    ims = []
    for n in names:
        p = os.path.join(d, n + ".jpg")
        if not os.path.exists(p): continue
        im = Image.open(p).convert("RGB")
        w = round(im.width * th / im.height)
        ims.append((n, im.resize((w, th), Image.LANCZOS)))
    rows.append((sku, ims))
    # per sku contact
    Wc = 30 + sum(i.width + 14 for _, i in ims)
    c = Image.new("RGB", (Wc, th + 60), (240, 242, 246))
    dd = ImageDraw.Draw(c)
    dd.text((14, 12), sku + " · 8 images · archetype set", font=ImageFont.truetype(FB, 22), fill=(30, 34, 40))
    x = 14
    for n, im in ims:
        c.paste(im, (x, 44)); x += im.width + 14
    c.save(os.path.join(d, "_contact.jpg"), "JPEG", quality=88)
gap = 10
W = 30 + 8 * (round(1500 * th / 2000) + gap)
Hh = 60 + len(rows) * (th + 46)
canvas = Image.new("RGB", (W, Hh), (240, 242, 246))
dd = ImageDraw.Draw(canvas)
dd.text((16, 14), "DEMO BRAND · 5 SKU x 8 images — product-led archetypes", font=ImageFont.truetype(FB, 26), fill=(28, 32, 38))
y = 60
for sku, ims in rows:
    dd.text((16, y), sku, font=ImageFont.truetype(FB, 24), fill=(60, 66, 76))
    x = 70
    for n, im in ims[:8]:
        canvas.paste(im, (x, y)); x += im.width + gap
    y += th + 46
canvas.save(os.path.join(ROOT, "assets", "design-system", "all-sets-v3-overview.jpg"), "JPEG", quality=86)
print("overview", canvas.size)
