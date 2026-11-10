from pathlib import Path
import os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "assets", "W2-v2")
os.makedirs(OUT, exist_ok=True)
W, H = 1500, 2000
NAVY = (10, 22, 48); YELLOW = (255, 196, 35); WHITE = (255, 255, 255)
GREY = (210, 220, 235); DARK = (14, 24, 44); RED = (232, 69, 47)

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

def rrect(d, box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)

def brand(base, dark=False, number=""):
    d = ImageDraw.Draw(base)
    col = DARK if dark else WHITE
    tracked(d, (84, 78), "DEMO BRAND", OSW(62, 600), col, 5)
    d.rectangle([86, 158, 386, 162], fill=YELLOW)
    tracked(d, (86, 174), "CAR ACCESSORIES", MON(20, 600), (110, 120, 140) if dark else GREY, 2)
    if number:
        tracked(d, (W - 300, H - 70), "DEMO BRAND · " + number, MON(22, 600), (120, 130, 150) if dark else (200, 210, 226), 1)
    return d

def cutout(path, thr_lo=42, thr_hi=74, erode=7, blur=1.0):
    im = Image.open(path).convert("RGB")
    px = im.load(); mask = Image.new("L", im.size, 0); mp = mask.load()
    for yy in range(im.height):
        for xx in range(im.width):
            r, g, b = px[xx, yy]
            dist = max(255 - r, 255 - g, 255 - b)
            if dist < thr_lo: a = 0
            elif dist < thr_hi: a = int((dist - thr_lo) / (thr_hi - thr_lo) * 255)
            else: a = 255
            mp[xx, yy] = a
    mask = mask.filter(ImageFilter.MinFilter(max(3, erode))).filter(ImageFilter.GaussianBlur(blur))
    out = im.convert("RGBA"); out.putalpha(mask)
    return out.crop(out.getbbox())

def paste_product(base, cut, scale_w, rot, cx, cy, shadow=True):
    tw = scale_w
    c = cut.resize((tw, round(cut.height * tw / cut.width)), Image.LANCZOS)
    c = c.rotate(rot, expand=True, resample=Image.BICUBIC)
    if shadow:
        sh = Image.new("RGBA", c.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 150), (0, 0), c.split()[3])
        sh = sh.filter(ImageFilter.GaussianBlur(26))
        base.alpha_composite(sh, (cx + 16, cy + 24))
    base.alpha_composite(c, (cx, cy))
    return c.size

# ---------- 02 feature ----------
def make_feature():
    bg = cover(Image.open(os.path.join(ROOT, "assets/W2/raw/03_bristles.png")).convert("RGB"), W, H)
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (8, 18, 40, 120)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(235 * (1 - y / 1250) ** 1.2) if y < 1250 else 0
        gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    bg = Image.alpha_composite(bg, grad).convert("RGB")
    d = brand(bg, False, "02/08")
    d.text((80, 360), "МЯГКАЯ", font=OSW(150, 700), fill=YELLOW)
    d.text((80, 500), "ЩЁТИНА", font=OSW(150, 700), fill=WHITE)
    d.text((84, 690), "ПВХ-ворс не царапает лак", font=MON(40, 500), fill=GREY)
    d.text((84, 780), "не впитывает воду · не дубеет на морозе", font=MON(34, 500), fill=(180, 194, 216))
    rrect(d, [1150, 88, 1420, 190], 30, YELLOW)
    d.text((1180, 102), "ПВХ", font=OSW(62, 700), fill=DARK)
    return bg

# ---------- 03 structure ----------
def make_structure():
    left = cover(Image.open(os.path.join(ROOT, "assets/W2/raw/03_bristles.png")).convert("RGB"), W // 2, H)
    right = cover(Image.open(os.path.join(ROOT, "assets/W2/raw/04_scraper.png")).convert("RGB"), W // 2, H)
    canvas = Image.new("RGB", (W, H))
    canvas.paste(left, (0, 0)); canvas.paste(right, (W // 2, 0))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), Image.new("RGBA", (W, H), (6, 14, 30, 110)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(235 * max(0.0, 1 - y / 900) ** 1.1) if y < 900 else int(180 * max(0.0, (y - 1100) / 900))
        gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    canvas = Image.alpha_composite(canvas, grad).convert("RGB")
    d = brand(canvas, False, "03/08")
    d.polygon([(W // 2 - 16, 0), (W // 2 + 16, 0), (W // 2 + 16, H), (W // 2 - 16, H)], fill=WHITE)
    d.text((84, 300), "ЩЁТКА", font=OSW(92, 700), fill=YELLOW)
    d.text((86, 430), "мягкая ПВХ-щетина", font=MON(32, 500), fill=GREY)
    d.text((W // 2 + 56, 300), "СКРЕБОК", font=OSW(92, 700), fill=YELLOW)
    d.text((W // 2 + 60, 430), "жёсткий ABS-ледоруб", font=MON(32, 500), fill=GREY)
    rrect(d, [470, 1560, 1030, 1760], 34, YELLOW)
    d.text((520, 1578), "2 В 1", font=OSW(130, 700), fill=DARK)
    d.text((84, 1850), "съёмная насадка · ручка 68–91 см", font=MON(32, 500), fill=GREY)
    return canvas

# ---------- 04 dimensions ----------
def make_size():
    canvas = Image.new("RGB", (W, H), (255, 255, 255)); d = ImageDraw.Draw(canvas)
    for y in range(H):
        c = 255 - int(8 * (y / H))
        d.line([(0, y), (W, y)], fill=(c, c, c + 2))
    base = canvas.convert("RGBA")
    cut = cutout(os.path.join(ROOT, "assets/W2/raw/01_main.png"))
    paste_product(base, cut, 1020, 0, 235, 780)
    base = base.convert("RGB"); d = brand(base, True, "04/08")
    d.text((80, 300), "РАЗМЕР", font=OSW(112, 700), fill=DARK)
    d.text((80, 425), "68–91 СМ", font=OSW(146, 700), fill=(232, 92, 24))
    d.text((84, 590), "телескопическая ручка · 487 г", font=MON(34, 500), fill=(90, 100, 120))
    y1 = 1700
    d.line([(140, y1), (1360, y1)], fill=(60, 70, 90), width=4)
    for x in (140, 1360):
        d.polygon([(x, y1 - 16), (x + (26 if x == 140 else -26), y1), (x, y1 + 16)], fill=(60, 70, 90))
    d.text((120, y1 + 30), "68 СМ", font=MON(36, 600), fill=(60, 70, 90))
    d.text((1180, y1 + 30), "91 СМ", font=MON(36, 600), fill=(60, 70, 90))
    rrect(d, [84, 1806, 420, 1926], 22, (40, 48, 66))
    d.text((108, 1814), "487 Г", font=OSW(56, 600), fill=WHITE)
    d.text((108, 1880), "вес", font=MON(24, 500), fill=(180, 194, 216))
    return base

# ---------- 05 test ----------
def make_test():
    bg = cover(Image.open(os.path.join(ROOT, "assets/W2/raw/03_bristles.png")).convert("RGB"), W, H)
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (6, 12, 26, 90)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        if y < 700 or y > 1350:
            a = int(220 * max(0.0, 1 - abs(y - 1000) / 700) ** 0.6)
            gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    bg = Image.alpha_composite(bg, grad).convert("RGB")
    d = brand(bg, False, "05/08")
    rrect(d, [1190, 88, 1420, 190], 30, RED)
    d.text((1216, 102), "ТЕСТ", font=OSW(62, 700), fill=WHITE)
    d.text((80, 1450), "НЕ ЦАРАПАЕТ", font=OSW(108, 700), fill=YELLOW)
    d.text((80, 1565), "ЛАК", font=OSW(108, 700), fill=WHITE)
    d.text((84, 1785), "проверено на тёмном кузове · ПВХ-ворс", font=MON(33, 500), fill=GREY)
    return bg

# ---------- 06 steps ----------
def make_steps():
    canvas = Image.new("RGB", (W, H), (247, 248, 250)); d = ImageDraw.Draw(canvas)
    d.text((80, 250), "3 ШАГА", font=OSW(110, 700), fill=DARK)
    d.text((84, 380), "от снега до чистой машины", font=MON(36, 500), fill=(90, 100, 120))
    steps = [
        ("1", "СМЕТАЕТЕ СНЕГ", "мягкой щетиной, без нажима", "assets/W2/raw/02_scene.png"),
        ("2", "СКАЛЫВАЕТЕ ЛЁД", "жёстким скребком по стеклу", "assets/W2/raw/04_scraper.png"),
        ("3", "СНИМАЕТЕ НАСАДКУ", "крепление на замке, входит в багажник", "assets/W2/raw/01_main.png"),
    ]
    y = 500
    for num, title, sub, img in steps:
        im = Image.open(os.path.join(ROOT, img)).convert("RGB")
        im = cover(im, 460, 380)
        canvas.paste(im, (80, y))
        d.rounded_rectangle([80, y, 540, y + 380], radius=20, outline=(210, 214, 222), width=2)
        d.ellipse([60, y - 26, 130, y + 44], fill=YELLOW)
        d.text((82, y - 18), num, font=OSW(56, 700), fill=DARK)
        d.text((590, y + 24), title, font=OSW(66, 700), fill=DARK)
        d.text((592, y + 110), sub, font=MON(32, 500), fill=(90, 100, 120))
        y += 470
    brand(canvas, True, "06/08")
    return canvas

# ---------- 07 kit ----------
def make_kit():
    canvas = Image.new("RGB", (W, H), (244, 245, 248)); d = ImageDraw.Draw(canvas)
    for y in range(H):
        c = 244 - int(10 * (y / H))
        d.line([(0, y), (W, y)], fill=(c, c + 1, c + 4))
    base = canvas.convert("RGBA")
    cut = cutout(os.path.join(ROOT, "assets/W2/raw/01_main.png"))
    paste_product(base, cut, 900, -16, 120, 760)
    base = base.convert("RGB"); d = brand(base, True, "07/08")
    d.text((80, 300), "ЧТО В", font=OSW(110, 700), fill=DARK)
    d.text((80, 410), "КОМПЛЕКТЕ", font=OSW(110, 700), fill=(232, 92, 24))
    items = ["щётка-скребок 2 в 1", "съёмная насадка", "ручка 68–91 см", "вес 487 г"]
    y = 1350
    for it in items:
        d.ellipse([90, y + 8, 118, y + 36], outline=(232, 92, 24), width=4)
        d.line([(97, y + 23), (104, y + 31), (114, y + 13)], fill=(232, 92, 24), width=4)
        d.text((140, y), it, font=MON(42, 600), fill=DARK)
        y += 88
    return base

# ---------- 08 white ----------
def make_white():
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    base = canvas.convert("RGBA")
    cut = cutout(os.path.join(ROOT, "assets/W2/raw/01_main.png"))
    paste_product(base, cut, 980, -20, 280, 540, shadow=False)
    base = base.convert("RGB"); d = brand(base, True, "08/08")
    d.text((84, 1680), "щётка-скребок 2 в 1 · 68–91 см · 487 г", font=MON(34, 500), fill=(90, 100, 120))
    rrect(d, [950, 1806, 1420, 1926], 24, DARK)
    d.polygon([(986, 1846), (986, 1896), (1022, 1871)], fill=WHITE)
    d.text((1040, 1830), "СМОТРИ ВИДЕО", font=OSW(52, 600), fill=WHITE)
    d.text((1040, 1882), "15 секунд · тест на кузове", font=MON(22, 500), fill=(180, 194, 216))
    return base

files = [("02_feature", make_feature), ("03_structure", make_structure), ("04_size", make_size),
         ("05_test", make_test), ("06_steps", make_steps), ("07_kit", make_kit), ("08_white", make_white)]
for name, fn in files:
    img = fn()
    p = os.path.join(OUT, name + ".jpg")
    img.save(p, "JPEG", quality=92)
    print("saved", p)
print("done")
