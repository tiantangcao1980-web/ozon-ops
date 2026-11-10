from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "assets", "P1-v3")
os.makedirs(OUT, exist_ok=True)
W, H = 1500, 2000
CREAM = (246, 236, 222); BROWN = (56, 40, 26); ORANGE = (224, 122, 47); MUTED = (128, 104, 80)

def font(name, size, weight=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if weight is not None:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f
MON = lambda s, w=600: font("Montserrat-var.ttf", s, w)
OSW = lambda s, w=700: font("Oswald-var.ttf", s, w)

def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im2 = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im2.crop(((im2.width - w)//2, (im2.height - h)//2, (im2.width - w)//2 + w, (im2.height - h)//2 + h))

def tracked(d, xy, text, fnt, fill, tracking=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + tracking

def brand(base, number=""):
    d = ImageDraw.Draw(base)
    tracked(d, (84, 78), "DEMO BRAND", MON(58, 700), BROWN, 6)
    d.rectangle([86, 160, 386, 165], fill=ORANGE)
    tracked(d, (86, 176), "PET · ДОМ И КОМФОРТ", MON(19, 600), MUTED, 2)
    if number:
        tracked(d, (W - 300, H - 70), "DEMO BRAND · " + number, MON(21, 600), (150, 126, 100), 1)
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
    # fill interior holes: flood from border on zero area, remaining zeros are interior
    holes = mask.copy()
    px2 = holes.load()
    from collections import deque
    q = deque()
    for x in range(0, holes.width):
        q.append((x, 0)); q.append((x, holes.height - 1))
    for y in range(0, holes.height):
        q.append((0, y)); q.append((holes.width - 1, y))
    seen = set()
    while q:
        x, y = q.pop()
        if (x, y) in seen or x < 0 or y < 0 or x >= holes.width or y >= holes.height: continue
        seen.add((x, y))
        if px2[x, y] > 8: continue
        px2[x, y] = 1
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    mask = mask.filter(ImageFilter.MinFilter(max(3, erode))).filter(ImageFilter.GaussianBlur(0.8))
    px3 = mask.load()
    for y in range(mask.height):
        for x in range(mask.width):
            if px2[x, y] != 1:  # not exterior background -> product
                if px3[x, y] < 200: px3[x, y] = 255
    out = im.convert("RGBA"); out.putalpha(mask)
    return out.crop(out.getbbox())

def photo_card(base, path, box, radius=28, shadow=True):
    x, y, w, h = box
    im = cover(Image.open(os.path.join(ROOT, path)).convert("RGB"), w, h)
    mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0)); card.paste(im, (0, 0), mask)
    if shadow:
        sh = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
        sh.paste((70, 50, 30, 90), (20, 20), card.split()[3]); sh = sh.filter(ImageFilter.GaussianBlur(18))
        base.alpha_composite(sh, (x - 20 + 6, y - 20 + 10))
    base.alpha_composite(card, (x, y))

def paste_cut(base, path, tw, rot, cx, cy):
    c = cutout(path).resize((tw, round(cutout(path).height * tw / cutout(path).width)), Image.LANCZOS)
    c = c.rotate(rot, expand=True, resample=Image.BICUBIC)
    sh = Image.new("RGBA", c.size, (0, 0, 0, 0)); sh.paste((80, 60, 40, 90), (0, 0), c.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(22))
    base.alpha_composite(sh, (cx + 12, cy + 20)); base.alpha_composite(c, (cx, cy))

def bg_light(photo=None, blur=0, wash=(250, 243, 232, 200)):
    if photo:
        base = cover(Image.open(os.path.join(ROOT, photo)).convert("RGB"), W, H)
        if blur: base = base.filter(ImageFilter.GaussianBlur(blur))
        base = Image.alpha_composite(base.convert("RGBA"), Image.new("RGBA", (W, H), wash))
    else:
        base = Image.new("RGBA", (W, H), (250, 244, 234, 255))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(900):
        a = int(215 * max(0.0, 1 - y / 900))
        gd.line([(0, y), (W, y)], fill=(250, 243, 232, a))
    return Image.alpha_composite(base, grad).convert("RGB")

def feature():
    base = bg_light("assets/P1/raw/03_layers.png", wash=(250, 243, 232, 120))
    d = brand(base, "02/08")
    d.text((80, 330), "5 СЛОЁВ", font=MON(104, 700), fill=ORANGE)
    d.text((80, 478), "ГОФРОКАРТОНА", font=MON(76, 700), fill=BROWN)
    d.text((84, 610), "когти не проваливаются", font=MON(34, 500), fill=(96, 74, 54))
    d.text((84, 668), "плотный картон почти без крошек", font=MON(28, 500), fill=(140, 116, 92))
    b = "5 СЛОЁВ"; bf = MON(30, 700); bw = int(d.textlength(b, font=bf)) + 50
    d.rounded_rectangle([1420 - bw, 96, 1420, 184], radius=24, fill=ORANGE)
    d.text((1420 - bw + 25, 110), b, font=bf, fill=(255, 255, 255))
    return base

def structure():
    base = Image.new("RGB", (W, H), CREAM)
    half = W // 2
    left = cover(Image.open(os.path.join(ROOT, "assets/P1/raw/03_layers.png")).convert("RGB"), half - 80, 1180)
    right = cover(Image.open(os.path.join(ROOT, "assets/P1/raw/04_wall.png")).convert("RGB"), half - 80, 1180)
    base.paste(left, (40, 400)); base.paste(right, (half + 40, 400))
    d = brand(base, "03/08")
    d.text((40, 270), "СЛОИ", font=MON(56, 700), fill=BROWN)
    d.text((half + 40, 270), "НА СТЕНУ", font=MON(56, 700), fill=BROWN)
    d.text((40, 1600), "плотный гофрокартон", font=MON(26, 500), fill=MUTED)
    d.text((half + 40, 1600), "крепление в комплекте", font=MON(26, 500), fill=MUTED)
    b = "2 СТОРОНЫ"; bf = MON(44, 700); bw = int(d.textlength(b, font=bf)) + 60
    d.rounded_rectangle([W // 2 - bw // 2, 860, W // 2 + bw // 2, 956], radius=26, fill=ORANGE)
    d.text((W // 2 - bw // 2 + 30, 876), b, font=bf, fill=(255, 255, 255))
    return base

def size_img():
    base = Image.new("RGB", (W, H), (253, 249, 242)); d = ImageDraw.Draw(base)
    d = brand(base, "04/08")
    d.text((80, 300), "РАЗМЕР", font=MON(64, 700), fill=BROWN)
    d.text((80, 390), "400×300 ММ", font=MON(84, 700), fill=ORANGE)
    d.text((84, 500), "400 г · двусторонняя", font=MON(30, 500), fill=MUTED)
    b = base.convert("RGBA")
    paste_cut(b, os.path.join(ROOT, "assets/P1/raw/01_main.png"), 1000, -6, 230, 760)
    base = b.convert("RGB"); d = ImageDraw.Draw(base)
    y1 = 1660
    d.line([(160, y1), (1340, y1)], fill=(120, 96, 74), width=4)
    for x in (160, 1340):
        d.polygon([(x, y1 - 14), (x + (24 if x == 160 else -24), y1), (x, y1 + 14)], fill=(120, 96, 74))
    d.text((140, y1 + 26), "400 ММ", font=MON(32, 600), fill=(96, 74, 54))
    d.text((1170, y1 + 26), "300 ММ", font=MON(32, 600), fill=(96, 74, 54))
    d.rounded_rectangle([84, 1800, 400, 1920], radius=20, fill=BROWN)
    d.text((108, 1812), "400 Г", font=MON(40, 700), fill=(255, 255, 255))
    d.text((108, 1868), "вес", font=MON(20, 500), fill=(214, 196, 176))
    return base

def test_img():
    base = bg_light("assets/P1/raw/03_layers.png", wash=(250, 243, 232, 105))
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim)
    for y in range(1350, H):
        a = int(238 * min(1.0, (y - 1350) / 350))
        sd.line([(0, y), (W, y)], fill=(250, 243, 232, a))
    base = Image.alpha_composite(base.convert("RGBA"), scrim).convert("RGB")
    d = brand(base, "05/08")
    b = "ТЕСТ"; bf = MON(34, 700); bw = int(d.textlength(b, font=bf)) + 44
    d.rounded_rectangle([1420 - bw, 96, 1420, 184], radius=24, fill=(200, 68, 48))
    d.text((1420 - bw + 22, 108), b, font=bf, fill=(255, 255, 255))
    d.text((80, 1500), "НЕ ОСТАВЛЯЕТ", font=MON(72, 700), fill=BROWN)
    d.text((80, 1592), "КРОШЕК", font=MON(72, 700), fill=ORANGE)
    d.text((84, 1720), "тест на полу · после царапок чисто", font=MON(28, 500), fill=(110, 86, 62))
    return base

def steps_img():
    base = Image.new("RGB", (W, H), (250, 244, 234)); d = ImageDraw.Draw(base)
    d.text((80, 240), "3 ШАГА", font=MON(64, 700), fill=BROWN)
    d.text((84, 330), "от коробки до первого царапания", font=MON(28, 500), fill=MUTED)
    items = [("1", "СНИМАЕТЕ ЗАЩИТУ", "крепление уже в комплекте", "assets/P1/raw/01_main.png"),
             ("2", "ВЕШАЕТЕ НА СТЕНУ", "или кладёте на пол", "assets/P1/raw/04_wall.png"),
             ("3", "КОШКА ТОЧИТ КОГТИ", "диван и обои целы", "assets/P1/raw/02_scene.png")]
    y = 470
    b = base.convert("RGBA")
    for num, title, sub, img in items:
        photo_card(b, img, (80, y, 480, 380), radius=24)
        d.ellipse([56, y - 24, 124, y + 44], fill=ORANGE)
        d.text((78, y - 14), num, font=MON(38, 700), fill=(255, 255, 255))
        d.text((600, y + 30), title, font=MON(44, 700), fill=BROWN)
        d.text((602, y + 92), sub, font=MON(25, 500), fill=MUTED)
        y += 460
    base = b.convert("RGB"); brand(base, "06/08")
    return base

def kit_img():
    base = Image.new("RGB", (W, H), (250, 244, 234)); d = ImageDraw.Draw(base)
    d.text((80, 300), "ЧТО В", font=MON(64, 700), fill=BROWN)
    d.text((80, 390), "КОМПЛЕКТЕ", font=MON(64, 700), fill=ORANGE)
    b = base.convert("RGBA")
    paste_cut(b, os.path.join(ROOT, "assets/P1/raw/01_main.png"), 900, -8, 360, 640)
    base = b.convert("RGB"); d = ImageDraw.Draw(base)
    y = 1500
    for it in ["когтеточка 400×300 мм", "крепление в комплекте", "двусторонняя", "вес 400 г"]:
        d.ellipse([100, y + 6, 124, y + 30], outline=ORANGE, width=3)
        d.line([(106, y + 18), (111, y + 24), (119, y + 10)], fill=ORANGE, width=3)
        d.text((146, y - 4), it, font=MON(32, 600), fill=BROWN)
        y += 76
    brand(base, "07/08")
    return base

def white_img():
    base = Image.new("RGB", (W, H), (255, 255, 255))
    b = base.convert("RGBA")
    paste_cut(b, os.path.join(ROOT, "assets/P1/raw/01_main.png"), 1000, -8, 250, 560)
    base = b.convert("RGB"); d = brand(base, "08/08")
    d.text((84, 1660), "когтеточка 400×300 мм · гофрокартон · 400 г", font=MON(30, 500), fill=MUTED)
    d.rounded_rectangle([950, 1806, 1420, 1926], radius=22, fill=BROWN)
    d.polygon([(986, 1846), (986, 1896), (1022, 1871)], fill=(255, 255, 255))
    d.text((1040, 1830), "СМОТРИ ВИДЕО", font=OSW(48, 600), fill=(255, 255, 255))
    return base

# hero = copy new hero
import shutil
shutil.copyfile(os.path.join(ROOT, "assets/design-system/heroes-v2/P1.jpg"), os.path.join(OUT, "01_hero.jpg"))
for name, fn in [("02_feature", feature), ("03_structure", structure), ("04_size", size_img),
                 ("05_test", test_img), ("06_steps", steps_img), ("07_kit", kit_img), ("08_white", white_img)]:
    fn().save(os.path.join(OUT, name + ".jpg"), "JPEG", quality=92)
    print("saved", name)
print("DONE")
