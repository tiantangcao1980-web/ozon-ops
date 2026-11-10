from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = str(Path(__file__).resolve().parents[1])
FONTS = os.path.join(ROOT, "assets", "fonts")
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
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    f = OSW(56, 600); lines = wrap(d, text, f, 880); lh = 70
    total = len(lines) * lh
    y0 = H - 300 - total
    d.rounded_rectangle([60, y0 - 26, W - 60, y0 - 26 + total + 56], radius=26, fill=(10, 16, 28, 165))
    y = y0
    for line in lines:
        d.text((92, y), line, font=f, fill=(255, 255, 255)); y += lh
    img.save(path, "PNG")

SKUS = {
 "P1": ["5 слоёв — когти не проваливаются", "Кошке нравится", "Почти без крошек", "На стену — и готово"],
 "H1": ["5,5 м на одну дверь", "Клеится при 0 °C", "Щель до 6 мм", "Тише и теплее"],
 "W4": ["1,5 л тепла", "Без запаха резины", "Ушко — сохнет быстро", "Чехол не обжигает"],
 "B1": ["LED — видно сосуд", "Ограничитель глубины", "Когти — в контейнер", "Без стресса"],
}
END = {
 "P1": ("КОГТЕТОЧКА ДЛЯ КОШЕК", "400×300 мм · 5 слоёв · 400 г", "PET · ДОМ И КОМФОРТ"),
 "H1": ("УПЛОТНИТЕЛЬ 5,5 М", "9×6 мм · EPDM · до 0 °C", "HOME · ТЕПЛО И ТИШИНА"),
 "W4": ("ГРЕЛКА 1,5 Л", "медицинская резина · чехол", "CARE · ТЕПЛО ДЛЯ ТЕЛА"),
 "B1": ("КОГТЕРЕЗКА С LED", "160 мм · 80 г · ограничитель", "PET CARE · ГРУМИНГ"),
}
for sku, caps in SKUS.items():
    d = os.path.join(ROOT, "assets", "video", sku); os.makedirs(d, exist_ok=True)
    for i, c in enumerate(caps, 1):
        caption(c, os.path.join(d, f"cap-{i}.png"))
    title, specs, series = END[sku]
    hero = Image.open(os.path.join(ROOT, "assets/design-system/heroes-v2", sku + ".jpg")).convert("RGB")
    bg = hero.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(22))
    bg = Image.alpha_composite(bg.convert("RGBA"), Image.new("RGBA", (W, H), (6, 14, 30, 170)))
    card = hero.resize((760, 1013), Image.LANCZOS)
    mask = Image.new("L", (760, 1013), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 759, 1012], radius=28, fill=255)
    card_rgba = card.convert("RGBA"); card_rgba.putalpha(mask)
    bg.alpha_composite(card_rgba, (160, 300))
    dd = ImageDraw.Draw(bg)
    dd.text((120, 1400), series, font=MON(24, 600), fill=(190, 200, 216))
    dd.text((120, 1450), "DEMO BRAND", font=MON(72, 700), fill=(255, 255, 255))
    dd.text((120, 1560), title, font=OSW(52, 600), fill=(255, 196, 35))
    dd.text((120, 1640), specs, font=MON(28, 500), fill=(210, 220, 235))
    bg.convert("RGB").save(os.path.join(d, "endcard.jpg"), "JPEG", quality=92)
    print("cards ok", sku)
