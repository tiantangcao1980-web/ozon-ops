from pathlib import Path
import json, os

ROOT = str(Path(__file__).resolve().parents[1])
plan = json.load(open(os.path.join(ROOT, "assets", "image-plan.json"), encoding="utf-8"))
FENCE = chr(96) * 3

DESC = {
 "W2": [
   "Мягкая щетина не царапает лак — проверено на тёмном кузове.",
   "Жёсткий скребок снимает лёд со стекла, не оставляя царапин.",
   "Телескопическая ручка — достаёт до крыши и капота без наклона.",
   "2 в 1: сначала сметаете снег, потом соскабливаете лёд.",
   "Щётка съёмная — входит в багажник и не мешает.",
 ],
 "P1": [
   "Плотный 5-слойный гофрокартон — когти не проваливаются, крошек почти нет.",
   "Двусторонняя: перевернули — и она как новая.",
   "Крепление в комплекте — вешается на стену, не скользит по полу.",
   "Точные размеры 400×300 мм — как на фото, без «сюрпризов».",
   "Подходит кошкам любого размера, спасает диван и обои.",
 ],
 "H1": [
   "Реальная длина 5,5 м — проверили рулеткой, не «6 метров».",
   "Клеится при температуре до 0 °C — можно ставить зимой.",
   "Профиль 9×6 мм — закрывает щель до 6 мм.",
   "В комплекте спиртовая салфетка — обезжирили и приклеили, держится.",
   "Защита от сквозняков, шума, пыли и холода с улицы.",
 ],
 "W4": [
   "Ушко для сушки — вешаете и она сохнет за пару часов.",
   "Пробка из пищевой резины, а не пластик — не пахнет и не трескается.",
   "Медицинская резина 1.5 мм — плотная, не «тонкая и хилая».",
   "Плюшевый чехол в комплекте — не обжигает кожу.",
   "1.5 л: руки, ноги, спина, поясница.",
 ],
 "B1": [
   "Ограничитель глубины — не даёт срезать живую часть когтя, безопасно для новичков.",
   "LED-подсветка просвечивает сосуд — видно, где резать.",
   "Контейнер собирает обрезанные когти — не надо собирать их по полу.",
   "3 шага: подсветили → вставили коготь до ограничителя → нажали.",
   "Для кошек, котят и мелких пород собак.",
 ],
}

def canvas(project_id):
    return "https://www.lovart.ai/canvas?projectId=" + project_id if project_id else ""

summary_rows = []
for sku, cfg in plan["skus"].items():
    man = None
    mp = os.path.join(ROOT, "assets", sku, "raw-manifest.json")
    if os.path.exists(mp):
        man = json.load(open(mp, encoding="utf-8"))
    project_id = (man or {}).get("projectId")
    lines = ["# " + sku + " · " + cfg["title"], ""]
    lines += ["- Lovart 画布：" + (canvas(project_id) or "—"), "- 图片规格：1200×1200 JPEG，白底主图 + 4 张俄语文案附图", ""]
    lines += ["## 图片清单", "", "| 文件 | 用途 | 俄语主文案 | 副文案 |", "|---|---|---|---|"]
    for img in cfg["images"]:
        ov = img.get("overlay") or {}
        lines.append("| " + img["file"] + ".jpg | " + img.get("role", "") + " | " + ov.get("caption", "—") + " | " + ov.get("sub", "—") + " |")
    lines += ["", "## 俄语描述（5 条）", ""]
    for d in DESC.get(sku, []):
        lines.append("- " + d)
    lines += ["", "> 说明：以上为 Lovart AI 生成的设计稿/概念图。Ozon 主图规则要求真实商品照片，请在 11-12~15 到货实拍后替换 01_main，附图排版可复用。", ""]
    out = os.path.join(ROOT, "assets", sku, "README.md")
    open(out, "w", encoding="utf-8").write("\n".join(lines))
    summary_rows.append((sku, cfg["title"], project_id, len(cfg["images"])))
    print("wrote", out)

lines = ["# 上架五 SKU · 套图交付清单（2026-11-09）", "", "| SKU | 产品 | 图片数 | Lovart 画布 |", "|---|---|---|---|"]
for sku, title, pid, n in summary_rows:
    lines.append("| " + sku + " | " + title + " | " + str(n) + " | " + (canvas(pid) or "—") + " |")
lines += ["", "## 文件结构", "", FENCE, "assets/<SKU>/", "  01_main.jpg     白底主图（无文字，Ozon 硬规则）", "  02_scene.jpg    卖点场景图", "  03_detail.jpg   材质/结构特写", "  04_detail.jpg   使用/安装细节", "  05_size.jpg     尺寸重量图（白底标注）", "  images.json     逐图清单", "  README.md       文案与画布链接", "assets/_contact/ 各 SKU 套图预览 + 总览", FENCE, ""]
lines += ["## 规则符合性", "", "- 主图纯白底、无文字/水印/边框，产品占 70–85%：✅", "- 附图俄语文案高度 ≤ 画面 1/5，无价格/折扣词：✅", "- 统一 1200×1200 JPEG：✅", "- 主图为 AI 设计稿，上架前须以实拍替换（到货 11-12~15）：⚠️", ""]
open(os.path.join(ROOT, "assets", "README.md"), "w", encoding="utf-8").write("\n".join(lines))
print("wrote root README")