from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
FB = r"C:/Windows/Fonts/segoeuib.ttf"
old = Image.open(os.path.join(ROOT, "assets/design-system/heroes/P1.jpg")).convert("RGB")
new = Image.open(os.path.join(ROOT, "assets/design-system/heroes-v2/P1.jpg")).convert("RGB")
th = 1100
ow = round(old.width * th / old.height); nw = round(new.width * th / new.height)
canvas = Image.new("RGB", (ow + nw + 90, th + 90), (238, 240, 244))
canvas.paste(old.resize((ow, th), Image.LANCZOS), (20, 60))
canvas.paste(new.resize((nw, th), Image.LANCZOS), (ow + 60, 60))
d = ImageDraw.Draw(canvas)
d.text((20, 18), "P1 hero · BEFORE (product cutout primary, 2 subjects)", font=ImageFont.truetype(FB, 26), fill=(90, 92, 100))
d.text((ow + 60, 18), "AFTER (lifestyle primary, product in context)", font=ImageFont.truetype(FB, 26), fill=(90, 92, 100))
canvas.save(os.path.join(ROOT, "assets/design-system", "p1-hero-before-after.jpg"), "JPEG", quality=90)
# all new heroes row
names = ["W2","P1","H1","W4","B1"]
ims = []
for n in names:
    im = Image.open(os.path.join(ROOT, "assets/design-system/heroes-v2", n + ".jpg")).convert("RGB")
    w = round(im.width * th / im.height)
    ims.append((n, im.resize((w, th), Image.LANCZOS)))
gap = 20
Wc = 30 + sum(i.width + gap for _, i in ims)
c = Image.new("RGB", (Wc, th + 90), (238, 240, 244))
d = ImageDraw.Draw(c)
d.text((18, 16), "DEMO BRAND · 5 product-led styles (one system, five archetypes)", font=ImageFont.truetype(FB, 28), fill=(30, 34, 40))
x = 18
for n, im in ims:
    c.paste(im, (x, 60)); x += im.width + gap
c.save(os.path.join(ROOT, "assets/design-system", "heroes-v2-overview.jpg"), "JPEG", quality=88)
print("compare+overview ok")
