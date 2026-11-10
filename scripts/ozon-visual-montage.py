from pathlib import Path
import json, os, re, urllib.request
from PIL import Image, ImageDraw, ImageFont

ROOT = str(Path(__file__).resolve().parents[1] / "raw" / "ozon-visual")
COL = os.path.join(ROOT, "collect.json")
data = json.load(open(COL, encoding="utf-8"))
IMG = os.path.join(ROOT, "img")
os.makedirs(IMG, exist_ok=True)
FB = r"C:/Windows/Fonts/segoeuib.ttf"
FR = r"C:/Windows/Fonts/segoeui.ttf"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.ozon.ru/"})
    return urllib.request.urlopen(req, timeout=30).read()

downloaded = {}
for key, info in data.items():
    if "ids" not in info or not info["ids"]:
        continue
    niche, sku = key.split(":")
    d = os.path.join(IMG, sku)
    os.makedirs(d, exist_ok=True)
    files = []
    for i, it in enumerate(info["ids"][:8]):
        base = it["base"]
        cand = [base + "/wc1600/" + it["id"] + "." + it["ext"], base + "/wc1000/" + it["id"] + ".jpg"]
        p = os.path.join(d, f"{i+1:02d}.jpg")
        if os.path.exists(p) and os.path.getsize(p) > 20000:
            files.append(p); continue
        for u in cand:
            try:
                b = get(u)
                if len(b) < 8000: continue
                open(p, "wb").write(b)
                im = Image.open(p); im.load()
                files.append(p)
                break
            except Exception as e:
                continue
    downloaded[key] = files
    print(niche, sku, "downloaded", len(files))

json.dump({k: v for k, v in downloaded.items()}, open(os.path.join(ROOT, "downloaded.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# montage per niche: rows = skus, cols = up to 6 images
height = 300
for niche in ["brush", "scraper", "seal", "warmer", "clipper"]:
    keys = [k for k in downloaded if k.startswith(niche + ":") and downloaded[k]]
    if not keys: continue
    rows = []
    for k in keys:
        files = downloaded[k][:6]
        row_imgs = []
        for p in files:
            im = Image.open(p).convert("RGB")
            w = max(1, round(im.width * height / im.height))
            row_imgs.append((os.path.basename(os.path.dirname(p)), im.resize((w, height), Image.LANCZOS)))
        rows.append((k.split(":")[1], row_imgs))
    colw = max(sum(i[1].width + 8 for i in r[1]) for r in rows) + 20
    H = 60 + sum(height + 34 for r in rows)
    canvas = Image.new("RGB", (colw, H), (245, 246, 248))
    d = ImageDraw.Draw(canvas)
    d.text((10, 10), niche.upper() + " — top sellers image sets", font=ImageFont.truetype(FB, 26), fill=(30, 30, 30))
    y = 60
    for sku, row_imgs in rows:
        d.text((10, y), sku, font=ImageFont.truetype(FB, 18), fill=(90, 90, 90))
        x = 10
        for _, im in row_imgs:
            canvas.paste(im, (x, y + 24))
            x += im.width + 8
        y += height + 34
    out = os.path.join(ROOT, f"montage-{niche}.jpg")
    canvas.save(out, "JPEG", quality=85)
    print("montage", out, canvas.size)

# hero row of first images
heroes = []
for k, files in downloaded.items():
    if files:
        heroes.append(files[0])
if heroes:
    th = 420
    ims = []
    for p in heroes:
        im = Image.open(p).convert("RGB")
        w = max(1, round(im.width * th / im.height))
        ims.append(im.resize((w, th), Image.LANCZOS))
    W = 20 + sum(i.width + 10 for i in ims)
    canvas = Image.new("RGB", (W, th + 20), (245, 246, 248))
    x = 10
    for im in ims:
        canvas.paste(im, (x, 10)); x += im.width + 10
    canvas.save(os.path.join(ROOT, "montage-heroes.jpg"), "JPEG", quality=88)
    print("heroes", canvas.size)
