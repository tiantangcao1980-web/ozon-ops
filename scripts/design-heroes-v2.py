from pathlib import Path
import os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "assets", "design-system", "heroes-v2")
os.makedirs(OUT, exist_ok=True)
W, H = 1500, 2000

def hx(h):
    return tuple(int(h.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))

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

def brand(base, accent, dark=False, series="", number=""):
    d = ImageDraw.Draw(base)
    col = (24, 32, 46) if dark else (255, 255, 255)
    tracked(d, (84, 78), "DEMO BRAND", MON(58, 700), col, 6)
    d.rectangle([86, 160, 386, 165], fill=hx(accent))
    tracked(d, (86, 176), series, MON(19, 600), (110, 120, 140) if dark else (200, 210, 226), 2)
    if number:
        tracked(d, (W - 300, H - 70), "DEMO BRAND · " + number, MON(21, 600), (120, 130, 150) if dark else (200, 210, 226), 1)
    return d

def cutout(path, thr_lo=42, thr_hi=74, erode=7):
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
    mask = mask.filter(ImageFilter.MinFilter(max(3, erode))).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA"); out.putalpha(mask)
    return out.crop(out.getbbox())

def paste_cut(base, path, tw, rot, cx, cy, thr_lo=42, thr_hi=74, erode=7, shadow=140):
    c = cutout(path, thr_lo, thr_hi, erode)
    c = c.resize((tw, round(c.height * tw / c.width)), Image.LANCZOS)
    c = c.rotate(rot, expand=True, resample=Image.BICUBIC)
    if shadow:
        sh = Image.new("RGBA", c.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, shadow), (0, 0), c.split()[3])
        sh = sh.filter(ImageFilter.GaussianBlur(30))
        base.alpha_composite(sh, (cx + 18, cy + 26))
    base.alpha_composite(c, (cx, cy))
    return c.size

# ---------------- W2: action / performance ----------------
def w2():
    bg = cover(Image.open(os.path.join(ROOT, "assets/design-system/plates/W2.png")).convert("RGB"), W, H)
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (8, 18, 40, 185)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(230 * max(0.0, 1 - y / 1150) ** 1.2) if y < 1150 else 0
        gd.line([(0, y), (W, y)], fill=(3, 8, 20, a))
    base = Image.alpha_composite(bg, grad).convert("RGB")
    d = brand(base, "#FFC423", False, "CAR ACCESSORIES · ЗИМНЯЯ СЕРИЯ", "01/08")
    d.text((80, 300), "ЩЁТКА ДЛЯ СНЕГА", font=OSW(128, 700), fill=(255, 196, 35))
    d.text((80, 430), "СО СКРЕБКОМ 2 В 1", font=OSW(128, 700), fill=(255, 255, 255))
    d.text((84, 600), "не царапает кузов · ручка до 91 см", font=MON(32, 500), fill=(210, 220, 235))
    # only 2 callouts, bigger product
    for i, (t, s, y) in enumerate([("ПВХ-ЩЕТИНА", "мягкая · не царапает лак", 660), ("68–91 СМ", "телескопическая ручка", 800)]):
        card = Image.new("RGBA", (560, 118), (0, 0, 0, 0)); cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([0, 0, 559, 117], radius=20, fill=(10, 20, 40, 210))
        cd.rectangle([0, 10, 7, 108], fill=(255, 196, 35))
        cd.text((30, 18), t, font=OSW(50, 600), fill=(255, 196, 35))
        cd.text((32, 76), s, font=MON(23, 500), fill=(205, 215, 230))
        base.paste(card, (890, y), card)
    base = base.convert("RGBA")
    paste_cut(base, os.path.join(ROOT, "assets/W2/raw/01_main.png"), 1240, -20, 170, 900)
    base = base.convert("RGB"); d = ImageDraw.Draw(base)
    d.rounded_rectangle([1206, 88, 1420, 194], radius=30, fill=(255, 196, 35))
    d.text((1236, 100), "2 в 1", font=OSW(60, 700), fill=(12, 20, 40))
    x = 84
    for big, small in [("68–91 СМ", "длина"), ("487 Г", "вес"), ("ПВХ · ABS", "материал")]:
        d.rounded_rectangle([x, 1806, x + 300, 1926], radius=22, fill=(255, 255, 255, 238))
        d.text((x + 22, 1814), big, font=OSW(50, 600), fill=(14, 24, 44))
        d.text((x + 22, 1882), small, font=MON(22, 500), fill=(96, 106, 126))
        x += 318
    return base

# ---------------- P1: lifestyle editorial ----------------
def p1():
    bg = cover(Image.open(os.path.join(ROOT, "assets/P1/raw/02_scene.png")).convert("RGB"), W, H)
    # warm cream scrim from top
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim)
    for y in range(900):
        a = int(232 * max(0.0, 1 - y / 900) ** 1.0)
        sd.line([(0, y), (W, y)], fill=(246, 235, 220, a))
    base = Image.alpha_composite(bg.convert("RGBA"), scrim)
    # soft bottom shade for chips
    scrim2 = Image.new("RGBA", (W, H), (0, 0, 0, 0)); s2 = ImageDraw.Draw(scrim2)
    for y in range(1500, H):
        a = int(120 * ((y - 1500) / 500) ** 1.2)
        s2.line([(0, y), (W, y)], fill=(60, 40, 24, a))
    base = Image.alpha_composite(base, scrim2).convert("RGB")
    d = brand(base, "#E07A2F", True, "PET · ДОМ И КОМФОРТ", "01/08")
    d.text((80, 320), "КОГТЕТОЧКА", font=MON(96, 700), fill=(46, 33, 21))
    d.text((80, 440), "ДЛЯ КОШЕК", font=MON(96, 700), fill=(46, 33, 21))
    d.text((84, 570), "гофрокартон · 400×300 мм · настенная", font=MON(30, 500), fill=(96, 74, 54))
    # soft chips bottom
    chips = [("5 СЛОЁВ", "плотный картон"), ("БЕЗ КРОШЕК", "не оставляет мусора"), ("НА СТЕНУ", "крепление в комплекте")]
    x = 84
    for big, small in chips:
        cw = int(d.textlength(big, font=MON(30, 700))) + 56
        d.rounded_rectangle([x, 1700, x + cw, 1926], radius=28, fill=(255, 252, 246, 235))
        d.text((x + 28, 1720), big, font=MON(30, 700), fill=(46, 33, 21))
        d.text((x + 28, 1772), small, font=MON(21, 500), fill=(120, 96, 74))
        # small dimension note
        x += cw + 18
    # badge
    btxt = "400×300"; bfnt = MON(38, 700)
    bw = int(d.textlength(btxt, font=bfnt)) + 52
    d.rounded_rectangle([1420 - bw, 92, 1420, 186], radius=26, fill=(224, 122, 47))
    d.text((1420 - bw + 26, 104), btxt, font=bfnt, fill=(255, 255, 255))
    return base

# ---------------- H1: technical blueprint ----------------
def h1():
    base = Image.new("RGB", (W, H), (22, 25, 31)); d = ImageDraw.Draw(base)
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=(34, 38, 46))
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(34, 38, 46))
    d = brand(base, "#E8452F", False, "HOME · ТЕПЛО И ТИШИНА", "01/08")
    d.text((80, 290), "УПЛОТНИТЕЛЬ", font=OSW(116, 700), fill=(255, 255, 255))
    d.text((80, 420), "ДЛЯ ДВЕРИ", font=OSW(116, 700), fill=(232, 69, 47))
    d.text((84, 570), "9×6 мм · 5,5 м · EPDM · до 0 °C", font=MON(30, 500), fill=(180, 190, 205))
    # big number
    d.text((80, 700), "9×6", font=OSW(220, 700), fill=(232, 69, 47))
    d.text((86, 950), "ММ ПРОФИЛЬ", font=MON(28, 600), fill=(180, 190, 205))
    # technical cross-section drawing
    cx, cy = 820, 760
    outer = [cx, cy, cx + 470, cy + 300]
    d.rounded_rectangle(outer, radius=70, outline=(235, 240, 248), width=8)
    # inner chambers
    d.rounded_rectangle([cx + 60, cy + 60, cx + 220, cy + 240], radius=40, outline=(232, 69, 47), width=5)
    d.rounded_rectangle([cx + 250, cy + 60, cx + 410, cy + 240], radius=40, outline=(232, 69, 47), width=5)
    # adhesive layer
    d.line([(cx, cy + 300), (cx + 470, cy + 300)], fill=(232, 69, 47), width=8)
    d.text((cx + 120, cy + 330), "самоклеящийся слой", font=MON(22, 500), fill=(200, 208, 222))
    # dimensions
    d.line([(cx - 60, cy), (cx - 60, cy + 300)], fill=(180, 190, 205), width=3)
    d.text((cx - 118, cy + 130), "6 мм", font=MON(24, 600), fill=(200, 208, 222))
    d.line([(cx, cy + 360), (cx + 470, cy + 360)], fill=(180, 190, 205), width=3)
    d.text((cx + 210, cy + 375), "9 мм", font=MON(24, 600), fill=(200, 208, 222))
    # photo inset bottom left
    photo = Image.open(os.path.join(ROOT, "assets/H1/raw/04_profile.png")).convert("RGB")
    photo = photo.resize((520, 520), Image.LANCZOS)
    mask = Image.new("L", (520, 520), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 519, 519], radius=28, fill=255)
    base.paste(photo, (80, 1240), mask)
    d.rounded_rectangle([80, 1240, 600, 1760], radius=28, outline=(60, 66, 78), width=3)
    # spec strip
    x = 84
    for big, small in [("5,5 М", "длина"), ("200 Г", "вес"), ("EPDM", "материал")]:
        d.rounded_rectangle([x, 1806, x + 300, 1926], radius=20, fill=(255, 255, 255, 240))
        d.text((x + 22, 1814), big, font=OSW(50, 600), fill=(16, 22, 32))
        d.text((x + 22, 1882), small, font=MON(22, 500), fill=(96, 106, 126))
        x += 318
    return base

# ---------------- W4: care editorial (light) ----------------
def w4():
    bg = cover(Image.open(os.path.join(ROOT, "assets/design-system/plates/W4.png")).convert("RGB"), W, H).filter(ImageFilter.GaussianBlur(8))
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (250, 235, 235, 175)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(200 * max(0.0, 1 - y / 900)) if y < 900 else 0
        gd.line([(0, y), (W, y)], fill=(252, 244, 242, a))
    base = Image.alpha_composite(bg, grad).convert("RGB")
    d = brand(base, "#C97F8C", True, "CARE · ТЕПЛО ДЛЯ ТЕЛА", "01/08")
    d.text((80, 320), "ГРЕЛКА", font=MON(112, 600), fill=(94, 38, 48))
    d.text((80, 450), "ВОДЯНАЯ 1,5 Л", font=MON(112, 600), fill=(94, 38, 48))
    d.text((84, 600), "медицинская резина · ушко для сушки · без запаха", font=MON(28, 500), fill=(140, 92, 100))
    # circular badges
    d.ellipse([1210, 470, 1420, 680], fill=(201, 127, 140))
    d.text((1246, 520), "1,5 Л", font=MON(54, 700), fill=(255, 255, 255))
    d.text((1240, 590), "объём", font=MON(20, 500), fill=(255, 240, 242))
    d.ellipse([1210, 710, 1420, 920], outline=(201, 127, 140), width=4)
    d.text((1246, 760), "БЕЗ", font=MON(44, 700), fill=(94, 38, 48))
    d.text((1246, 812), "ЗАПАХА", font=MON(44, 700), fill=(94, 38, 48))
    base = base.convert("RGBA")
    paste_cut(base, os.path.join(ROOT, "assets/W4/raw/01_main.png"), 900, -4, 300, 950, thr_lo=8, thr_hi=24, erode=3, shadow=120)
    base = base.convert("RGB"); d = ImageDraw.Draw(base)
    x = 84
    for big, small in [("1,5 Л", "объём"), ("280×160", "мм"), ("+ЧЕХОЛ", "в комплекте")]:
        d.rounded_rectangle([x, 1806, x + 300, 1926], radius=20, fill=(255, 255, 255, 240))
        d.text((x + 22, 1814), big, font=OSW(48, 600), fill=(94, 38, 48))
        d.text((x + 22, 1882), small, font=MON(22, 500), fill=(150, 110, 116))
        x += 318
    return base

# ---------------- B1: clinical white ----------------
def b1():
    base = Image.new("RGB", (W, H), (246, 249, 252)); d = ImageDraw.Draw(base)
    for y in range(H):
        c = 246 + int(4 * (y / H)); d.line([(0, y), (W, y)], fill=(c, c + 2, min(255, c + 5)))
    d = brand(base, "#2E6FA8", True, "PET CARE · ГРУМИНГ", "01/08")
    d.text((80, 300), "КОГТЕРЕЗКА", font=MON(96, 700), fill=(22, 32, 46))
    d.text((80, 410), "С ОГРАНИЧИТЕЛЕМ", font=MON(70, 700), fill=(46, 111, 168))
    d.text((84, 520), "LED-подсветка · контейнер · для котят", font=MON(28, 500), fill=(110, 124, 142))
    # thin feature rows
    items = [("LED", "видно сосуд в когте"), ("ОГРАНИЧИТЕЛЬ", "не срезает живую часть"), ("КОНТЕЙНЕР", "когти не по полу")]
    y = 640
    for big, small in items:
        d.line([(84, y + 20), (124, y + 20)], fill=(46, 111, 168), width=4)
        d.text((144, y - 6), big, font=MON(30, 700), fill=(22, 32, 46))
        d.text((144, y + 30), small, font=MON(20, 500), fill=(120, 132, 148))
        y += 110
    # product image card
    prod = Image.open(os.path.join(ROOT, "assets/B1/raw/01_main.png")).convert("RGB")
    prod = cover(prod, 620, 720)
    mask = Image.new("L", (620, 720), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 619, 719], radius=30, fill=255)
    card = Image.new("RGBA", (644, 744), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card); cd.rounded_rectangle([0, 0, 643, 743], radius=34, fill=(255, 255, 255, 255))
    card.paste(prod, (12, 12), mask)
    sh = Image.new("RGBA", card.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 40), (0, 0), card.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(24))
    base = base.convert("RGBA"); base.alpha_composite(sh, (820, 1004)); base.alpha_composite(card, (800, 984)); base = base.convert("RGB")
    d = ImageDraw.Draw(base)
    # safety badge
    btxt = "БЕЗОПАСНО"; bfnt = MON(26, 700)
    bw = int(d.textlength(btxt, font=bfnt)) + 48
    d.rounded_rectangle([1420 - bw, 92, 1420, 186], radius=26, outline=(46, 111, 168), width=4)
    d.text((1420 - bw + 24, 110), btxt, font=bfnt, fill=(46, 111, 168))
    x = 84
    for big, small in [("80 Г", "вес"), ("160 ММ", "длина"), ("8 ММ", "отверстие")]:
        d.rounded_rectangle([x, 1806, x + 300, 1926], radius=20, fill=(255, 255, 255, 245))
        d.text((x + 22, 1814), big, font=OSW(48, 600), fill=(22, 32, 46))
        d.text((x + 22, 1882), small, font=MON(22, 500), fill=(120, 132, 148))
        x += 318
    return base

out = {}
for name, fn in [("W2", w2), ("P1", p1), ("H1", h1), ("W4", w4), ("B1", b1)]:
    p = os.path.join(OUT, name + ".jpg")
    fn().save(p, "JPEG", quality=92)
    out[name] = p
    print("hero", p)
print("DONE")
