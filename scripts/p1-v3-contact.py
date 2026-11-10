from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = str(Path(__file__).resolve().parents[1])
FB = r"C:/Windows/Fonts/segoeuib.ttf"
names = ["01_hero","02_feature","03_structure","04_size","05_test","06_steps","07_kit","08_white"]
d = os.path.join(ROOT, "assets", "P1-v3")
th = 620
ims = []
for n in names:
    im = Image.open(os.path.join(d, n + ".jpg")).convert("RGB")
    w = round(im.width * th / im.height)
    ims.append(im.resize((w, th), Image.LANCZOS))
gap = 14
W = 30 + sum(i.width + gap for i in ims)
c = Image.new("RGB", (W, th + 70), (238, 240, 244))
dd = ImageDraw.Draw(c)
dd.text((16, 14), "P1 · lifestyle/editorial set (light) — product in context, one primary subject", font=ImageFont.truetype(FB, 24), fill=(30, 34, 40))
x = 16
for im in ims:
    c.paste(im, (x, 50)); x += im.width + gap
c.save(os.path.join(d, "_contact.jpg"), "JPEG", quality=90)
print(c.size)
