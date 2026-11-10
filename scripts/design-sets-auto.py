from pathlib import Path
import os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
W, H = 1500, 2000
WHITE = (255, 255, 255); DARK = (14, 24, 44); GREY = (210, 220, 235); RED = (232, 69, 47)
YELLOW = (255, 196, 35)

def font(name, size, weight=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if weight is not None:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f
OSW = lambda s, w=700: font("Oswald-var.ttf", s, w)
MON = lambda s, w=600: font("Montserrat-var.ttf", s, w)

def hx(h):
    return tuple(int(h.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))

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

def brand(base, cfg, dark=False, number=""):
    d = ImageDraw.Draw(base)
    col = DARK if dark else WHITE
    tracked(d, (84, 78), "DEMO BRAND", OSW(62, 600), col, 5)
    d.rectangle([86, 158, 386, 162], fill=hx(cfg["accent"]))
    tracked(d, (86, 174), cfg["series"], MON(20, 600), (110, 120, 140) if dark else GREY, 2)
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

def paste_cut(base, cfg, scale_w, rot, cx, cy, shadow=True):
    cut = cutout(os.path.join(ROOT, cfg["product"]), cfg.get("thr_lo", 42), cfg.get("thr_hi", 74), cfg.get("erode", 7))
    c = cut.resize((scale_w, round(cut.height * scale_w / cut.width)), Image.LANCZOS)
    c = c.rotate(rot, expand=True, resample=Image.BICUBIC)
    if shadow:
        sh = Image.new("RGBA", c.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 150), (0, 0), c.split()[3])
        sh = sh.filter(ImageFilter.GaussianBlur(26))
        base.alpha_composite(sh, (cx + 16, cy + 24))
    base.alpha_composite(c, (cx, cy))
    return c.size

def paste_panel(base, cfg, pw, px, py):
    panel = Image.open(os.path.join(ROOT, cfg["product"])).convert("RGB")
    panel = panel.resize((pw, round(panel.height * pw / panel.width)), Image.LANCZOS)
    card = Image.new("RGBA", (panel.width + 24, panel.height + 24), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([0, 0, card.width - 1, card.height - 1], radius=30, fill=(255, 255, 255, 255))
    card.paste(panel, (12, 12))
    sh = Image.new("RGBA", card.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 160), (0, 0), card.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(28))
    base.alpha_composite(sh, (px + 16, py + 24)); base.alpha_composite(card, (px, py))

def product(base, cfg, scale_w, rot, cx, cy):
    if cfg.get("panel"):
        paste_panel(base, cfg, scale_w, cx, cy)
    else:
        paste_cut(base, cfg, scale_w, rot, cx, cy)

def hero(cfg):
    bg = cover(Image.open(os.path.join(ROOT, cfg["plate"])).convert("RGB"), W, H).filter(ImageFilter.GaussianBlur(cfg.get("blur", 3)))
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), hx(cfg["wash"]) + (cfg.get("wash_alpha", 190),)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(cfg.get("top_alpha", 210) * max(0.0, 1 - y / 1150) ** 1.3) if y < 1150 else 0
        gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    bg = Image.alpha_composite(bg, grad)
    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(dots)
    random.seed(cfg.get("seed", 3))
    for _ in range(cfg.get("snow", 0)):
        x, y = random.randint(0, W), random.randint(0, H)
        r = random.choice([1, 1, 2, 2, 3])
        dd.ellipse([x, y, x + r, y + r], fill=(255, 255, 255, random.randint(20, 100)))
    bg = Image.alpha_composite(bg, dots.filter(ImageFilter.GaussianBlur(0.5)))
    base = bg.convert("RGB")
    d = brand(base, cfg, False, "01/08")
    accent = hx(cfg["accent"]); accent2 = hx(cfg["accent2"])
    hs = cfg.get("hsize", 130)
    y = 300
    for i, line in enumerate(cfg["headline"]):
        d.text((80, y), line, font=OSW(hs, 700), fill=accent if i == 0 else WHITE)
        y += hs + 22
    d.text((84, y + 30), cfg["subline"], font=MON(32, 500), fill=(222, 230, 244))
    bf = OSW(cfg.get("badge_size", 58), 700); btxt = cfg["badge"]
    bw = int(d.textlength(btxt, font=bf)) + 72
    d.rounded_rectangle([1420 - bw, 88, 1420, 194], radius=30, fill=accent)
    d.text((1420 - bw + 36, 100), btxt, font=bf, fill=(12, 20, 40))
    y = cfg.get("fy", 645)
    for title, sub, icon in cfg["features"]:
        card = Image.new("RGBA", (470, 142), (12, 22, 44, 214))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([0, 0, 469, 141], radius=22, fill=(12, 22, 44, 214))
        cd.rectangle([0, 12, 7, 130], fill=accent)
        cd.text((112, 22), title, font=OSW(52, 600), fill=accent)
        cd.text((114, 84), sub, font=MON(24, 500), fill=GREY)
        base.paste(card, (942, y), card); y += 158
    base = base.convert("RGBA")
    product(base, cfg, cfg.get("hs", 1000), cfg.get("hrot", 0), cfg.get("hpx", 200), cfg.get("hpy", 1000))
    base = base.convert("RGB"); d = ImageDraw.Draw(base)
    x = 84
    for big, small in cfg["specs"]:
        wbox = 292 if len(big) <= 9 else 356
        d.rounded_rectangle([x, 1806, x + wbox, 1926], radius=22, fill=(255, 255, 255, 236))
        d.text((x + 24, 1814), big, font=OSW(54, 600), fill=DARK)
        d.text((x + 24, 1880), small, font=MON(23, 500), fill=(96, 106, 126))
        x += wbox + 20
    return base

def feature(cfg):
    bg = cover(Image.open(os.path.join(ROOT, cfg["feature_bg"])).convert("RGB"), W, H)
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), hx(cfg["wash"]) + (100,)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(235 * max(0.0, 1 - y / 1250) ** 1.2) if y < 1250 else 0
        gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    bg = Image.alpha_composite(bg, grad).convert("RGB")
    d = brand(bg, cfg, False, "02/08")
    accent = hx(cfg["accent"])
    d.text((80, 360), cfg["f1"], font=OSW(cfg.get("f_size", 132), 700), fill=accent)
    d.text((80, 500), cfg["f2"], font=OSW(cfg.get("f_size", 132), 700), fill=WHITE)
    d.text((84, 690), cfg["f_sub"], font=MON(38, 500), fill=GREY)
    d.text((84, 780), cfg["f_sub2"], font=MON(32, 500), fill=(180, 194, 216))
    bf = OSW(58, 700); btxt = cfg["f_badge"]
    bw = int(d.textlength(btxt, font=bf)) + 70
    d.rounded_rectangle([1420 - bw, 88, 1420, 190], radius=30, fill=accent)
    d.text((1420 - bw + 34, 102), btxt, font=bf, fill=DARK)
    return bg

def structure(cfg):
    left = cover(Image.open(os.path.join(ROOT, cfg["s_left"])).convert("RGB"), W // 2, H)
    right = cover(Image.open(os.path.join(ROOT, cfg["s_right"])).convert("RGB"), W // 2, H)
    canvas = Image.new("RGB", (W, H)); canvas.paste(left, (0, 0)); canvas.paste(right, (W // 2, 0))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), Image.new("RGBA", (W, H), (6, 14, 30, cfg.get("s_wash", 110))))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(235 * max(0.0, 1 - y / 900) ** 1.1) if y < 900 else int(180 * max(0.0, (y - 1100) / 900))
        gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    canvas = Image.alpha_composite(canvas, grad).convert("RGB")
    d = brand(canvas, cfg, False, "03/08")
    accent = hx(cfg["accent"])
    d.polygon([(W // 2 - 16, 0), (W // 2 + 16, 0), (W // 2 + 16, H), (W // 2 - 16, H)], fill=WHITE)
    d.text((84, 300), cfg["s_l1"], font=OSW(88, 700), fill=accent)
    d.text((86, 430), cfg["s_lsub"], font=MON(31, 500), fill=GREY)
    d.text((W // 2 + 56, 300), cfg["s_r1"], font=OSW(88, 700), fill=accent)
    d.text((W // 2 + 60, 430), cfg["s_rsub"], font=MON(31, 500), fill=GREY)
    bf = OSW(118, 700); bw = int(d.textlength(cfg["s_center"], font=bf)) + 100
    d.rounded_rectangle([W // 2 - bw // 2, 1560, W // 2 + bw // 2, 1760], 34, accent)
    d.text((W // 2 - bw // 2 + 50, 1578), cfg["s_center"], font=bf, fill=DARK)
    d.text((84, 1850), cfg["s_foot"], font=MON(32, 500), fill=GREY)
    return canvas

def size_img(cfg):
    canvas = Image.new("RGB", (W, H), (255, 255, 255)); d = ImageDraw.Draw(canvas)
    for y in range(H):
        c = 255 - int(8 * (y / H)); d.line([(0, y), (W, y)], fill=(c, c, c + 2))
    base = canvas.convert("RGBA")
    product(base, cfg, cfg.get("sz_w", 1020), cfg.get("sz_rot", 0), cfg.get("sz_px", 235), cfg.get("sz_py", 780))
    base = base.convert("RGB"); d = brand(base, cfg, True, "04/08")
    accent = hx(cfg["accent"])
    d.text((80, 300), cfg["sz_title"], font=OSW(112, 700), fill=DARK)
    d.text((80, 425), cfg["sz_big"], font=OSW(cfg.get("sz_bigsize", 140), 700), fill=accent)
    d.text((84, 590), cfg["sz_sub"], font=MON(33, 500), fill=(90, 100, 120))
    y1 = cfg.get("arrow_y", 1700)
    d.line([(140, y1), (1360, y1)], fill=(60, 70, 90), width=4)
    for x in (140, 1360):
        d.polygon([(x, y1 - 16), (x + (26 if x == 140 else -26), y1), (x, y1 + 16)], fill=(60, 70, 90))
    d.text((120, y1 + 30), cfg["arrow_l"], font=MON(36, 600), fill=(60, 70, 90))
    d.text((1210, y1 + 30), cfg["arrow_r"], font=MON(36, 600), fill=(60, 70, 90))
    d.rounded_rectangle([84, 1806, 470, 1926], radius=22, fill=(40, 48, 66))
    d.text((108, 1814), cfg["sz_badge"], font=OSW(54, 600), fill=WHITE)
    d.text((108, 1880), cfg["sz_badge_sub"], font=MON(23, 500), fill=(180, 194, 216))
    return base

def test_img(cfg):
    bg = cover(Image.open(os.path.join(ROOT, cfg["test_bg"])).convert("RGB"), W, H)
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (6, 12, 26, 90)))
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grad)
    for y in range(H):
        a = int(230 * max(0.0, 1 - y / 700) ** 1.2) if y < 700 else int(200 * max(0.0, (y - 1300) / 700))
        gd.line([(0, y), (W, y)], fill=(4, 10, 24, a))
    bg = Image.alpha_composite(bg, grad).convert("RGB")
    d = brand(bg, cfg, False, "05/08")
    d.rounded_rectangle([1190, 88, 1420, 190], radius=30, fill=RED)
    d.text((1216, 102), "ТЕСТ", font=OSW(62, 700), fill=WHITE)
    d.text((80, 1450), cfg["t1"], font=OSW(108, 700), fill=YELLOW)
    d.text((80, 1565), cfg["t2"], font=OSW(108, 700), fill=WHITE)
    d.text((84, 1785), cfg["t_sub"], font=MON(33, 500), fill=GREY)
    return bg

def steps_img(cfg):
    canvas = Image.new("RGB", (W, H), (247, 248, 250)); d = ImageDraw.Draw(canvas)
    d.text((80, 250), "3 ШАГА", font=OSW(110, 700), fill=DARK)
    d.text((84, 380), cfg["st_sub"], font=MON(36, 500), fill=(90, 100, 120))
    accent = hx(cfg["accent"])
    y = 500
    for item in cfg["steps"]:
        num, title, sub, img = item
        im = cover(Image.open(os.path.join(ROOT, img)).convert("RGB"), 460, 380)
        canvas.paste(im, (80, y))
        d.rounded_rectangle([80, y, 540, y + 380], radius=20, outline=(210, 214, 222), width=2)
        d.ellipse([60, y - 26, 130, y + 44], fill=accent)
        d.text((82, y - 18), num, font=OSW(56, 700), fill=DARK)
        d.text((590, y + 24), title, font=OSW(64, 700), fill=DARK)
        d.text((592, y + 110), sub, font=MON(31, 500), fill=(90, 100, 120))
        y += 470
    brand(canvas, cfg, True, "06/08")
    return canvas

def kit_img(cfg):
    canvas = Image.new("RGB", (W, H), (244, 245, 248)); d = ImageDraw.Draw(canvas)
    for y in range(H):
        c = 244 - int(10 * (y / H)); d.line([(0, y), (W, y)], fill=(c, c + 1, c + 4))
    base = canvas.convert("RGBA")
    product(base, cfg, cfg.get("kit_w", 900), cfg.get("kit_rot", -16), cfg.get("kit_px", 120), cfg.get("kit_py", 760))
    base = base.convert("RGB"); d = brand(base, cfg, True, "07/08")
    accent = hx(cfg["accent"])
    d.text((80, 300), cfg["kit_l1"], font=OSW(110, 700), fill=DARK)
    d.text((80, 410), cfg["kit_l2"], font=OSW(110, 700), fill=accent)
    y = cfg.get("kit_list_y", 1350)
    for it in cfg["kit_items"]:
        d.ellipse([90, y + 8, 118, y + 36], outline=accent, width=4)
        d.line([(97, y + 23), (104, y + 31), (114, y + 13)], fill=accent, width=4)
        d.text((140, y), it, font=MON(40, 600), fill=DARK)
        y += 84
    return base

def white_img(cfg):
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    base = canvas.convert("RGBA")
    product(base, cfg, cfg.get("w_w", 980), cfg.get("w_rot", -20), cfg.get("w_px", 280), cfg.get("w_py", 540))
    base = base.convert("RGB"); d = brand(base, cfg, True, "08/08")
    d.text((84, 1680), cfg["w_caption"], font=MON(33, 500), fill=(90, 100, 120))
    d.rounded_rectangle([950, 1806, 1420, 1926], radius=24, fill=DARK)
    d.polygon([(986, 1846), (986, 1896), (1022, 1871)], fill=WHITE)
    d.text((1040, 1830), "СМОТРИ ВИДЕО", font=OSW(52, 600), fill=WHITE)
    d.text((1040, 1882), "15 секунд · реальный тест", font=MON(21, 500), fill=(180, 194, 216))
    return base

def build(cfg):
    out = os.path.join(ROOT, "assets", cfg["sku"] + "-v2"); os.makedirs(out, exist_ok=True)
    jobs = [("01_hero", hero), ("02_feature", feature), ("03_structure", structure), ("04_size", size_img),
            ("05_test", test_img), ("06_steps", steps_img), ("07_kit", kit_img), ("08_white", white_img)]
    for name, fn in jobs:
        fn(cfg).save(os.path.join(out, name + ".jpg"), "JPEG", quality=92)
    print("built", cfg["sku"], out)

CFG = [
 dict(sku="P1", series="PET · ДОМ И КОМФОРТ", accent="#E07A2F", accent2="#FFD9A8",
      plate="assets/design-system/plates/P1.png", wash="#2A1C12", wash_alpha=150, top_alpha=175, hsize=132,
      headline=["КОГТЕТОЧКА", "ДЛЯ КОШЕК"], subline="гофрокартон · 400×300 мм · настенная", badge="5 СЛОЁВ",
      features=[("5 СЛОЁВ", "плотный гофрокартон", "layers"), ("БЕЗ КРОШЕК", "не оставляет мусора", "shield"), ("НА СТЕНУ", "крепление в комплекте", "box")],
      specs=[("400×300", "мм"), ("400 Г", "вес"), ("2 СТОРОНЫ", "двусторонняя")],
      product="assets/P1/raw/01_main.png", hs=980, hrot=-8, hpx=250, hpy=980, fy=650,
      feature_bg="assets/P1/raw/03_layers.png", f1="5 СЛОЁВ", f2="ГОФРОКАРТОНА", f_sub="когти не проваливаются", f_sub2="почти без крошек · плотный картон", f_badge="5 СЛОЁВ",
      s_left="assets/P1/raw/03_layers.png", s_right="assets/P1/raw/04_wall.png", s_center="2 СТОРОНЫ",
      s_l1="СЛОИ", s_lsub="плотный гофрокартон", s_r1="НА СТЕНУ", s_rsub="крепление в комплекте", s_foot="400×300 мм · 400 г",
      sz_title="РАЗМЕР", sz_big="400×300 ММ", sz_sub="400 г · двусторонняя", arrow_l="400 ММ", arrow_r="300 ММ", arrow_y=1700, sz_w=1050, sz_rot=0, sz_px=225, sz_py=900, sz_badge="400 Г", sz_badge_sub="вес",
      test_bg="assets/P1/raw/03_layers.png", t1="НЕ ОСТАВЛЯЕТ", t2="КРОШЕК", t_sub="тест на полу · без мусора после царапок",
      steps=[("1","СНИМАЕТЕ ЗАЩИТУ","крепление уже в комплекте","assets/P1/raw/01_main.png"),("2","ВЕШАЕТЕ НА СТЕНУ","или кладёте на пол","assets/P1/raw/04_wall.png"),("3","КОШКА ТОЧИТ КОГТИ","диван и обои целы","assets/P1/raw/02_scene.png")],
      st_sub="от коробки до первого царапания", kit_l1="ЧТО В", kit_l2="КОМПЛЕКТЕ",
      kit_items=["когтеточка 400×300 мм","крепление в комплекте","двусторонняя","вес 400 г"],
      w_caption="когтеточка 400×300 мм · гофрокартон · 400 г"),
 dict(sku="H1", series="HOME · ТЕПЛО И ТИШИНА", accent="#E8452F", accent2="#FFD23F",
      plate="assets/design-system/plates/H1.png", wash="#14181D", wash_alpha=205, top_alpha=225, hsize=120,
      headline=["УПЛОТНИТЕЛЬ", "ДЛЯ ДВЕРИ"], subline="самоклеящийся · профиль 9×6 мм · до 0 °C", badge="5,5 М",
      features=[("9×6 ММ", "закрывает щель до 6 мм", "ruler"), ("САМОКЛЕЙКА", "клеится при 0 °C", "drop"), ("EPDM", "не трескается на морозе", "shield")],
      specs=[("5,5 М", "длина"), ("200 Г", "вес"), ("EPDM", "материал")],
      product="assets/H1/raw/01_main.png", hs=900, hrot=10, hpx=300, hpy=1100, fy=640,
      feature_bg="assets/H1/raw/02_length.png", f1="САМОКЛЕЯЩИЙСЯ", f2="ПРОФИЛЬ 9×6", f_sub="закрывает щель до 6 мм", f_sub2="резина EPDM · до 0 °C", f_badge="EPDM", f_size=104,
      s_left="assets/H1/raw/04_profile.png", s_right="assets/H1/raw/05_kit.png", s_center="САМОКЛЕЙКА",
      s_l1="ПРОФИЛЬ", s_lsub="9×6 мм · EPDM", s_r1="КЛЕЙ", s_rsub="самоклеящийся слой", s_foot="5,5 м · 200 г · до 0 °C",
      sz_title="ДЛИНА", sz_big="5,5 М", sz_sub="профиль 9×6 мм · 200 г", arrow_l="0", arrow_r="5,5 М", arrow_y=1700, sz_w=980, sz_rot=6, sz_px=260, sz_py=900, sz_badge="200 Г", sz_badge_sub="вес", sz_bigsize=150,
      test_bg="assets/H1/raw/02_length.png", t1="ДЕРЖИТСЯ", t2="ПРИ 0 °C", t_sub="тест на морозе · клеится зимой",
      steps=[("1","ОБЕЗЖИРИТЬ ДВЕРЬ","салфетка в комплекте","assets/H1/raw/03_before_after.png"),("2","СНЯТЬ ЗАЩИТУ","и прижать к двери","assets/H1/raw/04_profile.png"),("3","ПРИЖАТЬ ПО ДЛИНЕ","без сквозняков и шума","assets/H1/raw/05_kit.png")],
      st_sub="установка за 10 минут", kit_l1="ЧТО В", kit_l2="КОМПЛЕКТЕ",
      kit_items=["уплотнитель 5,5 м","спиртовая салфетка","профиль 9×6 мм","резина EPDM"],
      w_caption="уплотнитель 5,5 м · профиль 9×6 мм · EPDM"),
 dict(sku="W4", series="CARE · ТЕПЛО ДЛЯ ТЕЛА", accent="#F2A0B0", accent2="#FFE6EC",
      plate="assets/design-system/plates/W4.png", wash="#3A1820", wash_alpha=150, top_alpha=170, hsize=112,
      headline=["ГРЕЛКА ВОДЯНАЯ", "С ЧЕХЛОМ"], subline="медицинская резина · ушко для сушки · без запаха", badge="1,5 Л",
      features=[("УШКО", "сохнет за пару часов", "drop"), ("БЕЗ ЗАПАХА", "медицинская резина", "shield"), ("1,5 Л", "руки · ноги · спина", "thermo")],
      specs=[("1,5 Л", "объём"), ("280×160", "мм"), ("+ЧЕХОЛ", "в комплекте")],
      product="assets/W4/raw/01_main.png", hs=960, hrot=-6, hpx=190, hpy=1000, fy=650, thr_lo=8, thr_hi=26, erode=1,
      feature_bg="assets/W4/raw/02_loop.png", f1="УШКО", f2="ДЛЯ СУШКИ", f_sub="сохнет за пару часов", f_sub2="не остаётся вода внутри", f_badge="СУШКА",
      s_left="assets/W4/raw/03_cap.png", s_right="assets/W4/raw/04_use.png", s_center="БЕЗ ЗАПАХА",
      s_l1="ПРОБКА", s_lsub="медицинская резина", s_r1="ЧЕХОЛ", s_rsub="плюш в комплекте", s_foot="1,5 л · 280×160 мм",
      sz_title="ОБЪЁМ", sz_big="1,5 Л", sz_sub="280×160 мм · медицинская резина", arrow_l="280 ММ", arrow_r="160 ММ", arrow_y=1700, sz_w=960, sz_rot=-6, sz_px=240, sz_py=900, sz_badge="1,5 Л", sz_badge_sub="объём",
      test_bg="assets/W4/raw/02_loop.png", t1="БЕЗ ЗАПАХА", t2="И ПРОТЕЧЕК", t_sub="медицинская резина · проверено",
      steps=[("1","НАЛИВАЕТЕ ВОДУ","до метки, не кипяток","assets/W4/raw/03_cap.png"),("2","ЗАКРУЧИВАЕТЕ ПРОБКУ","медицинская резина","assets/W4/raw/01_main.png"),("3","В ЧЕХОЛ — И НА ТЕЛО","не обжигает кожу","assets/W4/raw/04_use.png")],
      st_sub="3 шага до тепла", kit_l1="ЧТО В", kit_l2="КОМПЛЕКТЕ",
      kit_items=["грелка 1,5 л","плюшевый чехол","пробка из медицинской резины","ушкo для сушки"],
      w_caption="грелка 1,5 л · 280×160 мм · с чехлом"),
 dict(sku="B1", series="PET CARE · ГРУМИНГ", accent="#5FB3E8", accent2="#CDEFFF",
      plate="assets/design-system/plates/B1.png", wash="#12212F", wash_alpha=140, top_alpha=150, hsize=112,
      headline=["КОГТЕРЕЗКА", "С ОГРАНИЧИТЕЛЕМ"], subline="подсветка · контейнер для когтей · для котят", badge="БЕЗОПАСНО", badge_size=46,
      features=[("LED", "видно сосуд в когте", "led"), ("ОГРАНИЧИТЕЛЬ", "не задевать живую часть когтя", "shield"), ("КОНТЕЙНЕР", "когти не по полу", "box")],
      specs=[("80 Г", "вес"), ("160 ММ", "длина"), ("8 ММ", "отверстие")],
      product="assets/B1/raw/02_features.png", panel=True, hs=540, hrot=0, hpx=170, hpy=1120, fy=700,
      feature_bg="assets/B1/raw/03_paw.png", f1="LED-ПОДСВЕТКА", f2="ВИДНО СОСУД", f_sub="не задевать живую часть когтя когтя", f_sub2="безопасно для новичков", f_badge="LED", f_size=96,
      s_left="assets/B1/raw/03_paw.png", s_right="assets/B1/raw/04_container.png", s_center="3 ФУНКЦИИ",
      s_l1="ОГРАНИЧИТЕЛЬ", s_lsub="глубина среза", s_r1="КОНТЕЙНЕР", s_rsub="сбор когтей", s_foot="80 г · 160 мм · отверстие 8 мм",
      sz_title="РАЗМЕР", sz_big="160 ММ", sz_sub="80 г · отверстие 8 мм", arrow_l="0", arrow_r="160 ММ", arrow_y=1700, sz_w=520, sz_rot=0, sz_px=490, sz_py=830, sz_badge="80 Г", sz_badge_sub="вес",
      test_bg="assets/B1/raw/03_paw.png", t1="НЕ ЗАДЕВАЕТ", t2="ЖИВУЮ ЧАСТЬ", t_sub="ограничитель глубины · тест на когте",
      steps=[("1","ПОДСВЕЧИВАЕТЕ","LED показывает сосуд","assets/B1/raw/02_features.png"),("2","ВСТАВЛЯЕТЕ КОГОТЬ","до ограничителя","assets/B1/raw/03_paw.png"),("3","НАЖИМАЕТЕ","когти падают в контейнер","assets/B1/raw/04_container.png")],
      st_sub="3 шага без стресса", kit_l1="ЧТО В", kit_l2="КОМПЛЕКТЕ",
      kit_items=["когтерезка с LED","ограничитель глубины","контейнер для когтей","вес 80 г"],
      kit_w=560, kit_px=800, kit_py=760, kit_list_y=1380,
      w_w=680, w_rot=0, w_px=430, w_py=620,
      w_caption="когтерезка · 160 мм · 80 г · LED"),
]
for cfg in CFG:
    build(cfg)
print("ALL DONE")
