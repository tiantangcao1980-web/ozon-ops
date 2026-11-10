from pathlib import Path
import os
from PIL import Image
ROOT = str(Path(__file__).resolve().parents[1])
src = os.path.join(ROOT, "assets/W2/raw/01_main.png")
im = Image.open(src).convert("RGB")
im.thumbnail((1200, 1200), Image.LANCZOS)
out = os.path.join(ROOT, "assets", "design-system", "video-ref-w2.jpg")
im.save(out, "JPEG", quality=88)
print(out, os.path.getsize(out))
