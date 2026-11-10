from pathlib import Path
import os
from PIL import Image
d = str(Path(__file__).resolve().parents[1] / "assets" / "video-test")
ims = [Image.open(os.path.join(d, f"frame-0{i}.jpg")).convert("RGB") for i in range(1, 5)]
w = sum(i.width for i in ims)
h = max(i.height for i in ims)
canvas = Image.new("RGB", (w, h), (30, 30, 30))
x = 0
for i in ims:
    canvas.paste(i, (x, 0)); x += i.width
canvas.save(os.path.join(d, "frames-strip.jpg"), "JPEG", quality=88)
print(canvas.size)
