"""Рисует значки «Питомцев» в docs/icons: светлая лапка на зелёном."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
BG, FG = "#2f7d6b", "#f1f7f4"


def draw(size, maskable):
    s = 4
    n = size * s
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, n, n], fill=BG)
        k = 0.6
    else:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * 0.22, fill=BG)
        k = 0.8
    c, u = n / 2, n * k / 2
    # подушечка
    d.ellipse([c - u * 0.5, c - u * 0.05, c + u * 0.5, c + u * 0.7], fill=FG)
    # пальчики
    for x, y, r in ((-0.62, -0.22, 0.2), (-0.25, -0.58, 0.21), (0.25, -0.58, 0.21), (0.62, -0.22, 0.2)):
        cx, cy, rr = c + u * x, c + u * y, u * r
        d.ellipse([cx - rr, cy - rr * 1.2, cx + rr, cy + rr * 1.2], fill=FG)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
draw(192, False).save(OUT / "icon-192.png")
draw(512, False).save(OUT / "icon-512.png")
draw(512, True).save(OUT / "maskable-512.png")
print("ok")
