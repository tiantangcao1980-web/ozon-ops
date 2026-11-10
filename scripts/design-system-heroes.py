from pathlib import Path
import os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "assets", "design-system", "heroes")
os.makedirs(OUT, exist_ok=True)
W, H = 1500, 2000

def font(name, size, weight=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if weight is not None:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f
OSW = lambda s, w=700: font("Oswald-var.ttf", s, w)
MON = lambda s, w=600: font("Montserrat-var.ttf", s, w)

def hx(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im2 = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im2.crop(((im2.width - w)//2, (im2.height - h)//2, (im2.width - w)//2 + w, (im2.height - h)//2 + h))

def tracked(d, xy, text, fnt, fill, tracking=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + tracking

def wrap(d, text, fnt, maxw):
    words = text.split(); lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=fnt) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

# ---- icons (drawn with lines) ----
def ic_bristle(d, x, y, c, a):
    for off in (0, 12, 24, 36):
        d.line([(x, y + off), (x + 28, y + off + 8)], fill=c, width=4)
    d.line([(x + 30, y - 6), (x + 30, y + 48)], fill=c, width=5)

def ic_thermo(d, x, y, c, a):
    d.rounded_rectangle([x + 9, y - 6, x + 28, y + 32], radius=9, outline=c, width=4)
    d.ellipse([x + 4, y + 26, x + 33, y + 54], outline=c, width=4)
    for i in range(3):
        d.line([(x + 31, y + 2 + i * 10), (x + 39, y + 2 + i * 10)], fill=c, width=4)

def ic_ruler(d, x, y, c, a):
    d.rectangle([x, y + 12, x + 64, y + 34], outline=c, width=4)
    for i in range(4):
        d.line([(x + 12 + i * 14, y + 12), (x + 12 + i * 14, y + 24)], fill=c, width=3)
    d.line([(x + 64, y + 23), (x + 82, y + 23)], fill=a, width=4)
    d.polygon([(x + 82, y + 15), (x + 96, y + 23), (x + 82, y + 31)], fill=a)

def ic_layers(d, x, y, c, a):
    for i in range(3):
        d.polygon([(x, y + 16 + i * 14), (x + 30, y + 2 + i * 14), (x + 60, y + 16 + i * 14), (x + 30, y + 30 + i * 14)], outline=c, width=3)

def ic_paw(d, x, y, c, a):
    d.ellipse([x + 18, y + 22, x + 44, y + 48], outline=c, width=4)
    for (dx, dy, r) in [(6, 6, 7), (22, -2, 7), (38, 0, 7), (52, 8, 7)]:
        d.ellipse([x + dx, y + dy, x + dx + 2 * r, y + dy + 2 * r], outline=c, width=3)

def ic_shield(d, x, y, c, a):
    d.polygon([(x + 30, y - 4), (x + 56, y + 8), (x + 52, y + 36), (x + 30, y + 52), (x + 8, y + 36), (x + 4, y + 8)], outline=c, width=4)
    d.line([(x + 18, y + 24), (x + 27, y + 34), (x + 44, y + 12)], fill=a, width=5)

def ic_drop(d, x, y, c, a):
    d.polygon([(x + 30, y), (x + 52, y + 32), (x + 44, y + 48), (x + 16, y + 48), (x + 8, y + 32)], outline=c, width=4)
    d.line([(x + 22, y + 32), (x + 30, y + 22), (x + 38, y + 32)], fill=a, width=4)

def ic_led(d, x, y, c, a):
    d.ellipse([x + 14, y + 4, x + 46, y + 36], outline=c, width=4)
    for ang in (0, 45, 90, 135, 180, 225, 270, 315):
        import math
        r1, r2 = 26, 36
        cx, cy = x + 30, y + 20
        dx, dy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        d.line([(cx + dx * r1, cy + dy * r1), (cx + dx * r2, cy + dy * r2)], fill=a, width=3)

def ic_box(d, x, y, c, a):
    d.polygon([(x + 30, y + 2), (x + 60, y + 18), (x + 60, y + 44), (x + 30, y + 60), (x, y + 44), (x, y + 18)], outline=c, width=4)
    d.line([(x, y + 18), (x + 30, y + 34), (x + 60, y + 18)], fill=c, width=3)
    d.line([(x + 30, y + 34), (x + 30, y + 60)], fill=c, width=3)

ICONS = {"bristle": ic_bristle, "thermo": ic_thermo, "ruler": ic_ruler, "layers": ic_layers,
         "paw": ic_paw, "shield": ic_shield, "drop": ic_drop, "led": ic_led, "box": ic_box}

def cutout(path, thr_lo=42, thr_hi=74, erode=7, blur=1.0):
    im = Image.open(path).convert("RGB")
    px = im.load()
    mask = Image.new("L", im.size, 0)
    mp = mask.load()
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

def render(theme):
    accent = hx(theme["accent"]); accent2 = hx(theme.get("accent2", "#FFFFFF"))
    bg = cover(Image.open(theme["bg"]).convert("RGB"), W, H).filter(ImageFilter.GaussianBlur(theme.get("blur", 3)))
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), hx(theme["wash"]) + (theme.get("wash_alpha", 200),)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(theme.get("top_alpha", 210) * (1 - y / 1150) ** 1.3) if y < 1150 else 0
        gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    bg = Image.alpha_composite(bg, grad)
    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(dots)
    random.seed(theme.get("seed", 3))
    for _ in range(theme.get("snow", 240)):
        x, y = random.randint(0, W), random.randint(0, H)
        r = random.choice([1, 1, 2, 2, 3])
        dd.ellipse([x, y, x + r, y + r], fill=(255, 255, 255, random.randint(20, 100)))
    bg = Image.alpha_composite(bg, dots.filter(ImageFilter.GaussianBlur(0.5)))
    base = bg.convert("RGB"); d = ImageDraw.Draw(base)

    # brand
    tracked(d, (84, 92), "DEMO BRAND", OSW(84, 600), (255, 255, 255), 7)
    d.rectangle([86, 196, 476, 201], fill=accent)
    tracked(d, (86, 216), theme["series"], MON(24, 600), (215, 222, 235), 2)
    bf = OSW(theme.get("badge_size", 60), 700)
    btxt = theme["badge"]
    bw = int(d.textlength(btxt, font=bf)) + 72
    bx0 = 1420 - bw
    d.rounded_rectangle([bx0, 88, 1420, 194], radius=30, fill=accent)
    d.text((bx0 + 36, 100), btxt, font=bf, fill=(12, 20, 40))

    # headline
    y = 300
    hs = theme.get("hsize", 136)
    for i, line in enumerate(theme["headline"]):
        d.text((80, y), line, font=OSW(hs, 700), fill=accent if i == 0 else (255, 255, 255))
        y += hs + 22
    d.text((84, y + 30), theme["subline"], font=MON(33, 500), fill=(222, 230, 244))

    # features
    fy = theme.get("fy", 645)
    for title, sub, icon in theme["features"]:
        card = Image.new("RGBA", (470, 142), (12, 22, 44, 214))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([0, 0, 469, 141], radius=22, fill=(12, 22, 44, 214))
        cd.rectangle([0, 12, 7, 130], fill=accent)
        ICONS[icon](cd, 34, 44, (255, 255, 255), accent2)
        cd.text((112, 22), title, font=OSW(52, 600), fill=accent2 if theme.get("feature_accent", False) else accent)
        cd.text((114, 84), sub, font=MON(24, 500), fill=(210, 220, 235))
        base.paste(card, (942, fy), card)
        fy += 158

    # product
    mode = theme.get("product_mode", "cutout")
    if mode == "cutout":
        cut = cutout(os.path.join(ROOT, theme["product"]), theme.get("thr_lo", 42), theme.get("thr_hi", 74), theme.get("erode", 7))
        tw = theme.get("tw", 1060)
        cut = cut.resize((tw, round(cut.height * tw / cut.width)), Image.LANCZOS)
        cut = cut.rotate(theme.get("rot", -18), expand=True, resample=Image.BICUBIC)
        shadow = Image.new("RGBA", cut.size, (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 170), (0, 0), cut.split()[3])
        shadow = shadow.filter(ImageFilter.GaussianBlur(28))
        cx = theme.get("px", W // 2 - cut.width // 2 + 90)
        cy = theme["py"] if theme.get("py") is not None else 1980 - cut.height
        base = base.convert("RGBA"); base.alpha_composite(shadow, (cx + 18, cy + 26)); base.alpha_composite(cut, (cx, cy)); base = base.convert("RGB")
    else:
        panel = Image.open(os.path.join(ROOT, theme["product"])).convert("RGB")
        pw = theme.get("pw", 640)
        panel = panel.resize((pw, round(panel.height * pw / panel.width)), Image.LANCZOS)
        card = Image.new("RGBA", (panel.width + 24, panel.height + 24), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([0, 0, card.width - 1, card.height - 1], radius=30, fill=(255, 255, 255, 255))
        card.paste(panel, (12, 12))
        shadow = Image.new("RGBA", card.size, (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 160), (0, 0), card.split()[3])
        shadow = shadow.filter(ImageFilter.GaussianBlur(30))
        px = theme.get("px", 880); py = theme.get("py", 1160)
        base = base.convert("RGBA"); base.alpha_composite(shadow, (px + 16, py + 24)); base.alpha_composite(card, (px, py)); base = base.convert("RGB")
    d = ImageDraw.Draw(base)

    # specs
    x = 84
    for big, small in theme["specs"]:
        wbox = 292 if len(big) <= 9 else 356
        d.rounded_rectangle([x, 1806, x + wbox, 1926], radius=22, fill=(255, 255, 255, 236))
        d.text((x + 24, 1814), big, font=OSW(54, 600), fill=(14, 24, 44))
        d.text((x + 24, 1880), small, font=MON(23, 500), fill=(96, 106, 126))
        x += wbox + 20
    path = os.path.join(OUT, theme["name"] + ".jpg")
    base.save(path, "JPEG", quality=92)
    return path

themes = [
 dict(name="W2", bg="assets/design-system/plates/W2.png", wash="#0A1630", wash_alpha=205, accent="#FFC423", accent2="#FFFFFF",
      series="CAR ACCESSORIES  ·  ЗИМНЯЯ СЕРИЯ", badge="2 в 1",
      headline=["ЩЁТКА ДЛЯ СНЕГА", "СО СКРЕБКОМ"], subline="не царапает кузов  ·  телескопическая ручка",
      features=[("ПВХ-ЩЕТИНА", "мягкая · не царапает лак", "bristle"), ("ДО −40 °C", "морозостойкий пластик", "thermo"), ("68–91 СМ", "телескопическая ручка", "ruler")],
      specs=[("68–91 СМ", "длина"), ("487 Г", "вес"), ("ПВХ · ABS", "материал")],
      product="assets/W2/raw/01_main.png", tw=1060, rot=-18, snow=260),
 dict(name="P1", bg="assets/design-system/plates/P1.png", wash="#2A1C12", wash_alpha=150, accent="#E07A2F", accent2="#FFD9A8",
      series="PET  ·  ДОМ И КОМФОРТ", badge="5 СЛОЁВ",
      headline=["КОГТЕТОЧКА", "ДЛЯ КОШЕК"], subline="гофрокартон  ·  400×300 мм  ·  настенная",
      features=[("5 СЛОЁВ", "плотный гофрокартон", "layers"), ("БЕЗ КРОШЕК", "не оставляет мусора", "shield"), ("НА СТЕНУ", "крепление в комплекте", "box")],
      specs=[("400×300", "мм"), ("400 Г", "вес"), ("2 СТОРОНЫ", "двусторонняя")],
      product="assets/P1/raw/01_main.png", tw=1020, rot=-10, snow=0, top_alpha=170, hsize=140, fy=650),
 dict(name="H1", bg="assets/design-system/plates/H1.png", wash="#14181D", wash_alpha=205, accent="#E8452F", accent2="#FFD23F",
      series="HOME  ·  ТЕПЛО И ТИШИНА", badge="5,5 М",
      headline=["УПЛОТНИТЕЛЬ", "ДЛЯ ДВЕРИ"], subline="самоклеящийся  ·  профиль 9×6 мм  ·  до 0 °C",
      features=[("9×6 ММ", "закрывает щель до 6 мм", "ruler"), ("САМОКЛЕЙКА", "клеится при 0 °C", "drop"), ("EPDM", "не трескается на морозе", "shield")],
      specs=[("5,5 М", "длина"), ("200 Г", "вес"), ("EPDM", "материал")],
      product="assets/H1/raw/01_main.png", tw=900, rot=14, snow=120, top_alpha=225, py=1120),
 dict(name="W4", bg="assets/design-system/plates/W4.png", wash="#3A1820", wash_alpha=150, accent="#F2A0B0", accent2="#FFE6EC",
      series="CARE  ·  ТЕПЛО ДЛЯ ТЕЛА", badge="1,5 Л",
      headline=["ГРЕЛКА ВОДЯНАЯ", "С ЧЕХЛОМ"], subline="медицинская резина  ·  ушко для сушки  ·  без запаха",
      features=[("УШКО", "сохнет за пару часов", "drop"), ("БЕЗ ЗАПАХА", "пищевая резина", "shield"), ("1,5 Л", "руки · ноги · спина", "thermo")],
      specs=[("1,5 Л", "объём"), ("280×160", "мм"), ("+ЧЕХОЛ", "в комплекте")],
      product="assets/W4/raw/01_main.png", tw=980, rot=-8, snow=0, top_alpha=170, hsize=118, fy=650, px=180, thr_lo=8, thr_hi=26, erode=1),
 dict(name="B1", bg="assets/design-system/plates/B1.png", wash="#12212F", wash_alpha=140, accent="#5FB3E8", accent2="#CDEFFF",
      series="PET CARE  ·  ГРУМИНГ", badge="БЕЗОПАСНО", badge_size=46,
      headline=["КОГТЕРЕЗКА", "С ОГРАНИЧИТЕЛЕМ"], subline="подсветка  ·  контейнер для когтей  ·  для котят",
      features=[("LED", "видно сосуд в когте", "led"), ("ОГРАНИЧИТЕЛЬ", "не срезать живую часть", "shield"), ("КОНТЕЙНЕР", "когти не по полу", "box")],
      specs=[("80 Г", "вес"), ("160 ММ", "длина"), ("8 ММ", "отверстие")],
      product="assets/B1/raw/02_features.png", product_mode="panel", pw=520, px=930, py=1150, snow=0, top_alpha=150, hsize=120, fy=640),
]
for th in themes:
    print(render(th))
