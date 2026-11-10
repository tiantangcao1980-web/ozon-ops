from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "assets", "video", "W2")
os.makedirs(OUT, exist_ok=True)
W, H = 1080, 1920
def font(name, size, weight=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if weight is not None:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f
OSW = lambda s, w=600: font("Oswald-var.ttf", s, w)
MON = lambda s, w=600: font("Montserrat-var.ttf", s, w)

def wrap(d, text, fnt, maxw):
    words = text.split(); lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=fnt) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def caption(text, path):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = OSW(58, 600)
    lines = wrap(d, text, f, 880)
    lh = 72
    total = len(lines) * lh
    y0 = H - 300 - total
    # translucent bar
    bar_h = total + 56
    d.rounded_rectangle([60, y0 - 26, W - 60, y0 - 26 + bar_h], radius=26, fill=(10, 16, 28, 165))
    y = y0
    for line in lines:
        d.text((92, y), line, font=f, fill=(255, 255, 255))
        y += lh
    img.save(path, "PNG")
    print("caption", path)

caps = [
    "2 в 1: щётка + скребок",
    "Сметает снег за минуту",
    "Скалывает лёд со стекла",
    "Мягкая щетина — без царапин",
    "68–91 см, помещается в багажник",
]
for i, c in enumerate(caps, 1):
    caption(c, os.path.join(OUT, f"cap-{i}.png"))

# end card: blurred hero + product card + text
hero = Image.open(os.path.join(ROOT, "assets/design-system/heroes-v2/W2.jpg")).convert("RGB")
bg = hero.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(22))
bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (6, 14, 30, 170)))
card = hero.resize((760, 1013), Image.LANCZOS)
mask = Image.new("L", card.size, 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 759, 1012], radius=28, fill=255)
card_rgba = card.convert("RGBA"); card_rgba.putalpha(mask); bg.alpha_composite(card_rgba, (160, 300))
d = ImageDraw.Draw(bg)
d.text((120, 1420), "DEMO BRAND", font=MON(72, 700), fill=(255, 255, 255))
d.text((120, 1520), "ЩЁТКА ДЛЯ СНЕГА 2 В 1", font=OSW(54, 600), fill=(255, 196, 35))
d.text((120, 1600), "68–91 см · 487 г · ПВХ · ABS", font=MON(30, 500), fill=(210, 220, 235))
bg.convert("RGB").save(os.path.join(OUT, "endcard.jpg"), "JPEG", quality=92)
print("endcard ok")
