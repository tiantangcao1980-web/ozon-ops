from pathlib import Path
import json, os, urllib.request
from PIL import Image, ImageDraw, ImageFont

ROOT = str(Path(__file__).resolve().parents[1] / "raw" / "ozon-visual")
IMG = os.path.join(ROOT, "img")
os.makedirs(IMG, exist_ok=True)
FB = r"C:/Windows/Fonts/segoeuib.ttf"

merged = {}
for fn in ["collect.json", "collect2.json"]:
    p = os.path.join(ROOT, fn)
    if not os.path.exists(p): continue
    data = json.load(open(p, encoding="utf-8"))
    for k, v in data.items():
        if k.startswith("__"): continue
        if "ids" not in v or not v["ids"]: continue
        merged[k] = v

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.ozon.ru/"})
    return urllib.request.urlopen(req, timeout=30).read()

downloaded = {}
for key, info in merged.items():
    niche, sku = key.split(":")
    d = os.path.join(IMG, sku); os.makedirs(d, exist_ok=True)
    files = []
    for i, it in enumerate(info["ids"][:6]):
        p = os.path.join(d, f"{i+1:02d}.jpg")
        if os.path.exists(p) and os.path.getsize(p) > 20000:
            files.append(p); continue
        for u in [it["base"] + "/wc1400/" + it["id"] + "." + it["ext"], it["base"] + "/wc1000/" + it["id"] + ".jpg"]:
            try:
                b = get(u)
                if len(b) < 8000: continue
                open(p, "wb").write(b)
                Image.open(p).load()
                files.append(p); break
            except Exception:
                continue
    if files:
        downloaded[key] = files
        print(niche, sku, len(files))

json.dump(downloaded, open(os.path.join(ROOT, "downloaded-all.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

height = 280
for niche in ["brush", "scraper", "seal", "warmer", "clipper"]:
    keys = sorted([k for k in downloaded if k.startswith(niche + ":") and downloaded[k]])
    if not keys: continue
    rows = []
    for k in keys:
        row_imgs = []
        for p in downloaded[k][:6]:
            im = Image.open(p).convert("RGB")
            w = max(1, round(im.width * height / im.height))
            row_imgs.append(im.resize((w, height), Image.LANCZOS))
        rows.append((k.split(":")[1], row_imgs))
    colw = max(sum(i.width + 8 for i in r[1]) for r in rows) + 20
    H = 56 + sum(height + 30 for r in rows)
    canvas = Image.new("RGB", (colw, H), (245, 246, 248))
    d = ImageDraw.Draw(canvas)
    d.text((10, 10), niche.upper() + " - top sellers image sets (" + str(len(rows)) + " products)", font=ImageFont.truetype(FB, 24), fill=(28, 28, 32))
    y = 56
    for sku, row_imgs in rows:
        d.text((10, y), sku, font=ImageFont.truetype(FB, 16), fill=(95, 95, 105))
        x = 10
        for im in row_imgs:
            canvas.paste(im, (x, y + 20)); x += im.width + 8
        y += height + 30
    out = os.path.join(ROOT, "montage-" + niche + ".jpg")
    canvas.save(out, "JPEG", quality=84)
    print("montage", out, canvas.size, "rows", len(rows))

# stats
stats = {}
for k, files in downloaded.items():
    niche = k.split(":")[0]
    stats.setdefault(niche, []).append(len(files))
print("STATS", {k: (len(v), min(v), max(v)) for k, v in stats.items()})
