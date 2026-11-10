from pathlib import Path
import os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
OUTDIR = os.path.join(ROOT, "assets", "design-system")
os.makedirs(OUTDIR, exist_ok=True)
W, H = 1500, 2000
YELLOW = (255, 196, 35)
WHITE = (255, 255, 255)
GREY = (210, 220, 235)
ACCENT = (232, 92, 24)

def font(name, size, weight=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if weight is not None:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f

OSW = lambda s, w=700: font("Oswald-var.ttf", s, w)
MON = lambda s, w=600: font("Montserrat-var.ttf", s, w)

def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im2 = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im2.crop(((im2.width - w)//2, (im2.height - h)//2, (im2.width - w)//2 + w, (im2.height - h)//2 + h))

def tracked(d, xy, text, fnt, fill, tracking=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + tracking

# background
bg = Image.open(os.path.join(ROOT, "assets/W2/raw/02_scene.png")).convert("RGB")
bg = cover(bg, W, H).filter(ImageFilter.GaussianBlur(4))
bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (8, 18, 40, 205)))
grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(H):
    a = int(215 * (1 - y / 1100) ** 1.3) if y < 1100 else 0
    gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
bg = Image.alpha_composite(bg, grad)
dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
dd = ImageDraw.Draw(dots)
random.seed(11)
for _ in range(300):
    x, y = random.randint(0, W), random.randint(0, H)
    r = random.choice([1, 1, 2, 2, 3])
    dd.ellipse([x, y, x + r, y + r], fill=(255, 255, 255, random.randint(25, 110)))
bg = Image.alpha_composite(bg, dots.filter(ImageFilter.GaussianBlur(0.5)))
base = bg.convert("RGB")
d = ImageDraw.Draw(base)

# brand
tracked(d, (84, 92), "DEMO BRAND", OSW(84, 600), WHITE, 7)
d.rectangle([86, 196, 476, 201], fill=YELLOW)
tracked(d, (86, 216), "CAR ACCESSORIES  ·  ЗИМНЯЯ СЕРИЯ", MON(25, 600), GREY, 2)
d.rounded_rectangle([1206, 88, 1420, 194], radius=30, fill=YELLOW)
d.text((1238, 100), "2 в 1", font=OSW(64, 700), fill=(12, 20, 40))

# headline
d.text((80, 300), "ЩЁТКА ДЛЯ СНЕГА", font=OSW(136, 700), fill=YELLOW)
d.text((80, 434), "СО СКРЕБКОМ", font=OSW(136, 700), fill=WHITE)
d.text((84, 584), "не царапает кузов  ·  телескопическая ручка", font=MON(34, 500), fill=(226, 233, 245))

# callouts right
def icon_bristle(dr, x, y):
    for off in (0, 13, 26, 39):
        dr.line([(x, y + off), (x + 30, y + off + 9)], fill=WHITE, width=4)
    dr.line([(x + 32, y - 5), (x + 32, y + 52)], fill=WHITE, width=5)

def icon_thermo(dr, x, y):
    dr.rounded_rectangle([x + 10, y - 6, x + 30, y + 36], radius=10, outline=WHITE, width=4)
    dr.ellipse([x + 4, y + 30, x + 36, y + 60], outline=WHITE, width=4)
    for i in range(3):
        dr.line([(x + 34, y + 2 + i * 11), (x + 42, y + 2 + i * 11)], fill=WHITE, width=4)

def icon_telescope(dr, x, y):
    dr.rectangle([x, y + 16, x + 28, y + 30], outline=WHITE, width=4)
    dr.rectangle([x + 32, y + 20, x + 44, y + 26], outline=WHITE, width=3)
    dr.line([(x + 44, y + 23), (x + 60, y + 23)], fill=YELLOW, width=4)
    dr.polygon([(x + 60, y + 16), (x + 72, y + 23), (x + 60, y + 30)], fill=YELLOW)

features = [
    ("ПВХ-ЩЕТИНА", "мягкая · не царапает лак", icon_bristle),
    ("ДО −40 °C", "морозостойкий пластик", icon_thermo),
    ("68–91 СМ", "телескопическая ручка", icon_telescope),
]
y0 = 640
for title, sub, ic in features:
    card = Image.new("RGBA", (470, 142), (12, 22, 44, 216))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([0, 0, 469, 141], radius=22, fill=(12, 22, 44, 216))
    cd.rectangle([0, 12, 7, 130], fill=YELLOW)
    ic(cd, 34, 44)
    cd.text((112, 22), title, font=OSW(56, 600), fill=YELLOW)
    cd.text((114, 86), sub, font=MON(25, 500), fill=GREY)
    base.paste(card, (942, y0), card)
    y0 += 158

# product cutout (hard mask + erode + feather)
prod = Image.open(os.path.join(ROOT, "assets/W2/raw/01_main.png")).convert("RGB")
px = prod.load()
mask = Image.new("L", prod.size, 0)
mp = mask.load()
for yy in range(prod.height):
    for xx in range(prod.width):
        r, g, b = px[xx, yy]
        dist = max(255 - r, 255 - g, 255 - b)
        if dist < 42: a = 0
        elif dist < 74: a = int((dist - 42) / 32 * 255)
        else: a = 255
        mp[xx, yy] = a
mask = mask.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(1.0))
cut = prod.convert("RGBA")
cut.putalpha(mask)
cut = cut.crop(cut.getbbox())
tw = 1060
cut = cut.resize((tw, round(cut.height * tw / cut.width)), Image.LANCZOS)
cut = cut.rotate(-18, expand=True, resample=Image.BICUBIC)
shadow = Image.new("RGBA", cut.size, (0, 0, 0, 0))
shadow.paste((0, 0, 0, 180), (0, 0), cut.split()[3])
shadow = shadow.filter(ImageFilter.GaussianBlur(30))
cx = W // 2 - cut.width // 2 + 90
cy = max(800, 1950 - cut.height)
base = base.convert("RGBA")
base.alpha_composite(shadow, (cx + 20, cy + 30))
base.alpha_composite(cut, (cx, cy))
base = base.convert("RGB")
d = ImageDraw.Draw(base)

# bottom spec badges
specs = [("68–91 СМ", "длина"), ("487 Г", "вес"), ("ПВХ · ABS", "материал")]
x = 84
for big, small in specs:
    wbox = 292 if len(big) <= 9 else 356
    d.rounded_rectangle([x, 1806, x + wbox, 1926], radius=22, fill=(255, 255, 255, 236))
    d.text((x + 24, 1814), big, font=OSW(56, 600), fill=(14, 24, 44))
    d.text((x + 24, 1880), small, font=MON(24, 500), fill=(96, 106, 126))
    x += wbox + 20

out = os.path.join(OUTDIR, "w2-hero-prototype.jpg")
base.save(out, "JPEG", quality=92)
print("prototype", out, base.size)

old = Image.open(os.path.join(ROOT, "assets/W2/01_main.jpg")).convert("RGB").resize((1500, 1500), Image.LANCZOS)
cmp_canvas = Image.new("RGB", (3060, 2010), (240, 242, 246))
cmp_canvas.paste(old, (30, 30))
cmp_canvas.paste(base, (1530, 5))
cd = ImageDraw.Draw(cmp_canvas)
cd.text((40, 1550), "v1  1:1  white-bg + caption bar", font=MON(40, 600), fill=(90, 90, 100))
cd.text((1540, 1958), "v2  3:4  Ozon-style hero poster", font=MON(40, 600), fill=(90, 90, 100))
cmp_canvas.save(os.path.join(OUTDIR, "w2-hero-compare.jpg"), "JPEG", quality=90)
print("compare ok")
