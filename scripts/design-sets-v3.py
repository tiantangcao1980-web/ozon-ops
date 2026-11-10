from pathlib import Path
import os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
W, H = 1500, 2000

def hx(h):
    return tuple(int(h.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))

def font(name, size, weight=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if weight is not None:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f
OSW = lambda s, w=600: font("Oswald-var.ttf", s, w)
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

def brand(base, cfg, number=""):
    d = ImageDraw.Draw(base)
    col = cfg["text"]
    tracked(d, (84, 78), "DEMO BRAND", MON(56, 700), col, 6)
    d.rectangle([86, 156, 386, 161], fill=hx(cfg["accent"]))
    tracked(d, (86, 172), cfg["series"], MON(18, 600), cfg["muted"], 2)
    tracked(d, (W - 300, H - 66), "DEMO BRAND · " + number, MON(20, 600), cfg["foot"], 1)
    return d

def bg(kind, cfg):
    if kind == "grid":
        base = Image.new("RGB", (W, H), hx(cfg["bg"])); d = ImageDraw.Draw(base)
        for x in range(0, W, 60):
            d.line([(x, 0), (x, H)], fill=hx(cfg["grid"]))
        for y in range(0, H, 60):
            d.line([(0, y), (W, y)], fill=hx(cfg["grid"]))
        return base
    if kind == "cream":
        base = Image.new("RGBA", (W, H), hx(cfg["bg"]) + (255,))
        return Image.alpha_composite(base, Image.new("RGBA", (W, H), (255, 255, 255, 0))).convert("RGB")
    return Image.new("RGB", (W, H), hx(cfg["bg"]))

def card(base, img_path, box, radius=24, border=None):
    x, y, w, h = box
    im = cover(Image.open(os.path.join(ROOT, img_path)).convert("RGB"), w, h)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    if border:
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, outline=255, width=4)
    base.paste(im, (x, y), mask)
    if border:
        ImageDraw.Draw(base).rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius, outline=hx(border), width=3)

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

def paste_cut(base, path, tw, rot, cx, cy, thr_lo=42, thr_hi=74, erode=7):
    c = cutout(path, thr_lo, thr_hi, erode)
    c = c.resize((tw, round(c.height * tw / c.width)), Image.LANCZOS)
    c = c.rotate(rot, expand=True, resample=Image.BICUBIC)
    sh = Image.new("RGBA", c.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 90), (0, 0), c.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(24))
    base.alpha_composite(sh, (cx + 14, cy + 18)); base.alpha_composite(c, (cx, cy))

def badge(d, cfg, text, size=52, x_right=1420, y=92):
    f = OSW(size, 600) if cfg["font"] == "osw" else MON(size, 700)
    bw = int(d.textlength(text, font=f)) + (44 if cfg["font"] == "mon" else 56)
    d.rounded_rectangle([x_right - bw, y, x_right, y + (84 if cfg["font"] == "mon" else 96)], radius=26, fill=hx(cfg["accent"]))
    d.text((x_right - bw + 24, y + 12), text, font=f, fill=hx(cfg["badge_text"]))

def feature(cfg, kind):
    base = bg(kind, cfg); d = brand(base, cfg, "02/08")
    card(base, cfg["feature_img"], (820, 640, 600, 760), radius=26, border=cfg.get("card_border"))
    d = ImageDraw.Draw(base)
    if cfg["font"] == "osw":
        d.text((80, 300), cfg["f1"], font=OSW(cfg.get("f1_size", 96), 700), fill=hx(cfg["accent"]))
        d.text((80, 410), cfg["f2"], font=OSW(cfg.get("f1_size", 96), 700), fill=hx(cfg["text"]))
    else:
        d.text((80, 300), cfg["f1"], font=MON(72, 700), fill=hx(cfg["text"]))
        d.text((80, 410), cfg["f2"], font=MON(72, 700), fill=hx(cfg["accent"]))
    d.text((84, 570), cfg["f_sub"], font=MON(28, 500), fill=hx(cfg["muted"]))
    d.text((84, 620), cfg["f_sub2"], font=MON(24, 500), fill=hx(cfg["muted"]))
    badge(d, cfg, cfg["f_badge"])
    return base

def structure(cfg, kind):
    base = bg(kind, cfg)
    half = W // 2
    left = cover(Image.open(os.path.join(ROOT, cfg["s_left"])).convert("RGB"), half - 80, 1180)
    right = cover(Image.open(os.path.join(ROOT, cfg["s_right"])).convert("RGB"), half - 80, 1180)
    base.paste(left, (40, 420)); base.paste(right, (half + 40, 420))
    d = brand(base, cfg, "03/08")
    lcol = hx(cfg["text"]); acol = hx(cfg["accent"])
    d.text((40, 290), cfg["s_l1"], font=OSW(64, 600), fill=lcol)
    d.text((half + 40, 290), cfg["s_r1"], font=OSW(64, 600), fill=lcol)
    d.text((40, 1620), cfg["s_lsub"], font=MON(24, 500), fill=hx(cfg["muted"]))
    d.text((half + 40, 1620), cfg["s_rsub"], font=MON(24, 500), fill=hx(cfg["muted"]))
    b = cfg["s_center"]; bf = OSW(44, 600)
    bw = int(d.textlength(b, font=bf)) + 64
    d.rounded_rectangle([W // 2 - bw // 2, 880, W // 2 + bw // 2, 976], radius=26, fill=acol)
    d.text((W // 2 - bw // 2 + 32, 894), b, font=bf, fill=hx(cfg["badge_text"]))
    return base

def size_page(cfg, kind):
    base = bg(kind, cfg); d = brand(base, cfg, "04/08")
    if kind != "grid":
        pass
    d.text((80, 290), cfg["sz_title"], font=MON(64, 700), fill=hx(cfg["text"]))
    d.text((80, 380), cfg["sz_big"], font=(OSW(cfg.get("sz_bigsize", 120), 700) if cfg["font"] == "osw" else MON(84, 700)), fill=hx(cfg["accent"]))
    d.text((84, cfg.get("sz_sub_y", 520)), cfg["sz_sub"], font=MON(28, 500), fill=hx(cfg["muted"]))
    b = base.convert("RGBA")
    if cfg.get("panel"):
        card(base, cfg["sz_img"], cfg.get("sz_box", (470, 700, 560, 700)), radius=26, border=cfg.get("card_border"))
    else:
        paste_cut(b, os.path.join(ROOT, cfg["sz_img"]), cfg.get("sz_w", 1020), cfg.get("sz_rot", 0), cfg.get("sz_px", 235), cfg.get("sz_py", 760))
        base = b.convert("RGB")
    d = ImageDraw.Draw(base)
    y1 = 1680
    d.line([(160, y1), (1340, y1)], fill=hx(cfg["muted"]), width=4)
    for x in (160, 1340):
        d.polygon([(x, y1 - 14), (x + (24 if x == 160 else -24), y1), (x, y1 + 14)], fill=hx(cfg["muted"]))
    d.text((140, y1 + 26), cfg["arrow_l"], font=MON(32, 600), fill=hx(cfg["muted"]))
    d.text((1160, y1 + 26), cfg["arrow_r"], font=MON(32, 600), fill=hx(cfg["muted"]))
    x = 84
    for big, small in cfg["specs"]:
        d.rounded_rectangle([x, 1806, x + 300, 1926], radius=20, fill=hx(cfg["spec_fill"]))
        d.text((x + 22, 1814), big, font=OSW(48, 600), fill=hx(cfg["spec_text"]))
        d.text((x + 22, 1882), small, font=MON(22, 500), fill=hx(cfg["spec_muted"]))
        x += 318
    return base

def test_page(cfg, kind):
    base = bg(kind, cfg); d = brand(base, cfg, "05/08")
    b = "ТЕСТ"; bf = MON(30, 700); bw = int(d.textlength(b, font=bf)) + 44
    d.rounded_rectangle([1420 - bw, 92, 1420, 176], radius=24, fill=hx(cfg["accent"]))
    d.text((1420 - bw + 22, 104), b, font=bf, fill=hx(cfg["badge_text"]))
    card(base, cfg["test_img"], (80, 640, 1340, 700), radius=28, border=cfg.get("card_border"))
    d = ImageDraw.Draw(base)
    d.text((80, 1480), cfg["t1"], font=(OSW(92, 600) if cfg["font"] == "osw" else MON(64, 700)), fill=hx(cfg["text"]))
    d.text((80, 1580), cfg["t2"], font=(OSW(92, 600) if cfg["font"] == "osw" else MON(64, 700)), fill=hx(cfg["accent"]))
    d.text((84, 1720), cfg["t_sub"], font=MON(26, 500), fill=hx(cfg["muted"]))
    return base

def steps_page(cfg, kind):
    base = bg(kind, cfg); d = ImageDraw.Draw(base)
    d.text((80, 230), "3 ШАГА", font=(OSW(70, 600) if cfg["font"] == "osw" else MON(58, 700)), fill=hx(cfg["text"]))
    d.text((84, 330), cfg["steps_sub"], font=MON(26, 500), fill=hx(cfg["muted"]))
    y = 440
    for num, title, sub, img in cfg["steps"]:
        card(base, img, (80, y, 460, 350), radius=22, border=cfg.get("card_border"))
        d = ImageDraw.Draw(base)
        d.ellipse([58, y - 20, 122, y + 44], fill=hx(cfg["accent"]))
        d.text((78, y - 10), num, font=OSW(36, 600), fill=hx(cfg["badge_text"]))
        d.text((580, y + 26), title, font=(OSW(46, 600) if cfg["font"] == "osw" else MON(38, 700)), fill=hx(cfg["text"]))
        d.text((582, y + 86), sub, font=MON(23, 500), fill=hx(cfg["muted"]))
        y += 430
    brand(base, cfg, "06/08")
    return base

def kit_page(cfg, kind):
    base = bg(kind, cfg)
    d = brand(base, cfg, "07/08")
    d.text((80, 290), cfg["kit_l1"], font=(OSW(64, 600) if cfg["font"] == "osw" else MON(56, 700)), fill=hx(cfg["text"]))
    d.text((80, 380), cfg["kit_l2"], font=(OSW(64, 600) if cfg["font"] == "osw" else MON(56, 700)), fill=hx(cfg["accent"]))
    b = base.convert("RGBA")
    if cfg.get("panel"):
        card(base, cfg["kit_img"], (760, 560, 560, 700), radius=26, border=cfg.get("card_border"))
    else:
        paste_cut(b, os.path.join(ROOT, cfg["kit_img"]), cfg.get("kit_w", 860), cfg.get("kit_rot", -8), cfg.get("kit_px", 150), cfg.get("kit_py", 620))
        base = b.convert("RGB")
    d = ImageDraw.Draw(base)
    y = 1480
    for it in cfg["kit_items"]:
        d.ellipse([96, y + 6, 120, y + 30], outline=hx(cfg["accent"]), width=3)
        d.line([(102, y + 18), (107, y + 24), (115, y + 10)], fill=hx(cfg["accent"]), width=3)
        d.text((140, y - 4), it, font=MON(30, 600), fill=hx(cfg["text"]))
        y += 78
    return base

def white_page(cfg, kind="white"):
    base = Image.new("RGB", (W, H), (255, 255, 255))
    b = base.convert("RGBA")
    if cfg.get("panel"):
        card(base, cfg["w_img"], (420, 480, 660, 800), radius=26, border=cfg.get("card_border"))
    else:
        paste_cut(b, os.path.join(ROOT, cfg["w_img"]), cfg.get("w_w", 980), cfg.get("w_rot", -10), cfg.get("w_px", 260), cfg.get("w_py", 520))
        base = b.convert("RGB")
    d = brand(base, dict(cfg, text="#16202E", muted="#8A94A6", foot="#B7C0CE"), "08/08")
    d.text((84, 1660), cfg["w_caption"], font=MON(28, 500), fill=(96, 106, 122))
    return base

def build(sku, cfg):
    out = os.path.join(ROOT, "assets", sku + "-v3"); os.makedirs(out, exist_ok=True)
    kind = cfg["kind"]
    pages = [("02_feature", lambda: feature(cfg, kind)), ("03_structure", lambda: structure(cfg, kind)),
             ("04_size", lambda: size_page(cfg, kind)), ("05_test", lambda: test_page(cfg, kind)),
             ("06_steps", lambda: steps_page(cfg, kind)), ("07_kit", lambda: kit_page(cfg, kind)),
             ("08_white", lambda: white_page(cfg, "white"))]
    for name, fn in pages:
        fn().save(os.path.join(out, name + ".jpg"), "JPEG", quality=92)
    print("built", sku, out)

CFG = [
 dict(sku="H1", kind="grid", font="osw", bg="#161A21", grid="#1E232C", accent="#E8452F", text="#F2F5FA", muted="#9AA4B4", foot="#6E7887",
      series="HOME · ТЕПЛО И ТИШИНА", badge_text="#FFFFFF",
      feature_img="assets/H1/raw/04_profile.png", card_border="#2A3039",
      f1="САМОКЛЕЯЩИЙСЯ", f2="ПРОФИЛЬ 9×6", f1_size=86, f_sub="закрывает щель до 6 мм", f_sub2="резина EPDM · клеится при 0 °C", f_badge="EPDM",
      s_left="assets/H1/raw/04_profile.png", s_right="assets/H1/raw/05_kit.png", s_center="САМОКЛЕЙКА",
      s_l1="ПРОФИЛЬ", s_lsub="9×6 мм · EPDM", s_r1="КЛЕЙ", s_rsub="самоклеящийся слой",
      sz_sub_y=545, sz_title="ДЛИНА", sz_big="5,5 М", sz_sub="профиль 9×6 мм · 200 г", sz_img="assets/H1/raw/01_main.png", sz_w=900, sz_rot=6, sz_px=300, sz_py=800,
      arrow_l="0", arrow_r="5,5 М",
      specs=[("5,5 М", "длина"), ("200 Г", "вес"), ("EPDM", "материал")], spec_fill="#FFFFFF", spec_text="#161A21", spec_muted="#7E8796",
      test_img="assets/H1/raw/03_before_after.png", t1="ДЕРЖИТСЯ", t2="ПРИ 0 °C", t_sub="тест на морозе · клеится зимой",
      steps=[("1","ОБЕЗЖИРИТЬ ДВЕРЬ","салфетка в комплекте","assets/H1/raw/03_before_after.png"),("2","СНЯТЬ ЗАЩИТУ","прижать к двери","assets/H1/raw/04_profile.png"),("3","ЗАКРЫТЬ ЩЕЛЬ","без сквозняков","assets/H1/raw/05_kit.png")],
      steps_sub="установка за 10 минут",
      kit_l1="ЧТО В", kit_l2="КОМПЛЕКТЕ", kit_img="assets/H1/raw/01_main.png", kit_w=800, kit_rot=6, kit_px=340, kit_py=660,
      kit_items=["уплотнитель 5,5 м","спиртовая салфетка","профиль 9×6 мм","резина EPDM"],
      w_img="assets/H1/raw/01_main.png", w_w=900, w_rot=8, w_px=300, w_py=520,
      w_caption="уплотнитель 5,5 м · профиль 9×6 мм · EPDM"),
 dict(sku="W4", kind="cream", font="mon", bg="#F8EEEA", grid="#F0E2DC", accent="#C97F8C", text="#5E2630", muted="#9A6E74", foot="#C3A7AA",
      series="CARE · ТЕПЛО ДЛЯ ТЕЛА", badge_text="#FFFFFF",
      feature_img="assets/W4/raw/02_loop.png",
      f1="УШКО", f2="ДЛЯ СУШКИ", f_sub="сохнет за пару часов", f_sub2="не остаётся вода внутри", f_badge="СУШКА",
      s_left="assets/W4/raw/03_cap.png", s_right="assets/W4/raw/04_use.png", s_center="БЕЗ ЗАПАХА",
      s_l1="ПРОБКА", s_lsub="медицинская резина", s_r1="ЧЕХОЛ", s_rsub="плюш в комплекте",
      sz_title="ОБЪЁМ", sz_big="1,5 Л", sz_sub="280×160 мм · медицинская резина", sz_img="assets/W4/raw/01_main.png", panel=True, card_border="#EAD8D2",
      arrow_l="280 ММ", arrow_r="160 ММ",
      specs=[("1,5 Л", "объём"), ("280×160", "мм"), ("+ЧЕХОЛ", "в комплекте")], spec_fill="#FFFFFF", spec_text="#5E2630", spec_muted="#B58B90",
      test_img="assets/W4/raw/02_loop.png", t1="БЕЗ ЗАПАХА", t2="И ПРОТЕЧЕК", t_sub="медицинская резина · проверено",
      steps=[("1","НАЛИВАЕТЕ ВОДУ","до метки","assets/W4/raw/03_cap.png"),("2","ЗАКРУЧИВАЕТЕ ПРОБКУ","медицинская резина","assets/W4/raw/01_main.png"),("3","В ЧЕХОЛ — НА ТЕЛО","не обжигает","assets/W4/raw/04_use.png")],
      steps_sub="3 шага до тепла",
      kit_l1="ЧТО В", kit_l2="КОМПЛЕКТЕ", kit_img="assets/W4/raw/01_main.png", kit_w=520,
      kit_items=["грелка 1,5 л","плюшевый чехол","пробка из медицинской резины","ушко для сушки"],
      w_img="assets/W4/raw/01_main.png", w_w=520,
      w_caption="грелка 1,5 л · 280×160 мм · чехол"),
 dict(sku="B1", kind="white", font="mon", bg="#F7FAFC", grid="#E9F0F6", accent="#2E6FA8", text="#16202E", muted="#7E8A9A", foot="#B7C0CE",
      series="PET CARE · ГРУМИНГ", badge_text="#FFFFFF", card_border="#E0E7EF", panel=True,
      feature_img="assets/B1/raw/03_paw.png",
      f1="LED-ПОДСВЕТКА", f2="ВИДНО СОСУД", f_sub="не задевать живую часть когтя", f_sub2="безопасно для новичков", f_badge="LED",
      s_left="assets/B1/raw/03_paw.png", s_right="assets/B1/raw/04_container.png", s_center="3 ФУНКЦИИ",
      s_l1="ОГРАНИЧИТЕЛЬ", s_lsub="глубина среза", s_r1="КОНТЕЙНЕР", s_rsub="сбор когтей",
      sz_title="РАЗМЕР", sz_big="160 ММ", sz_sub="80 г · отверстие 8 мм", sz_img="assets/B1/raw/01_main.png", sz_box=(400,660,700,800),
      arrow_l="0", arrow_r="160 ММ",
      specs=[("80 Г", "вес"), ("160 ММ", "длина"), ("8 ММ", "отверстие")], spec_fill="#FFFFFF", spec_text="#16202E", spec_muted="#8A94A6",
      test_img="assets/B1/raw/03_paw.png", t1="НЕ ЗАДЕВАЕТ", t2="ЖИВУЮ ЧАСТЬ", t_sub="ограничитель глубины · тест на когте",
      steps=[("1","ПОДСВЕЧИВАЕТЕ","LED показывает сосуд","assets/B1/raw/02_features.png"),("2","ВСТАВЛЯЕТЕ КОГОТЬ","до ограничителя","assets/B1/raw/03_paw.png"),("3","НАЖИМАЕТЕ","когти — в контейнер","assets/B1/raw/04_container.png")],
      steps_sub="3 шага без стресса",
      kit_l1="ЧТО В", kit_l2="КОМПЛЕКТЕ", kit_img="assets/B1/raw/01_main.png", kit_w=520,
      kit_items=["когтерезка с LED","ограничитель глубины","контейнер для когтей","вес 80 г"],
      w_img="assets/B1/raw/01_main.png", w_w=520,
      w_caption="когтерезка · 160 мм · 80 г · LED"),
]
for cfg in CFG:
    build(cfg["sku"], cfg)
print("ALL DONE")
