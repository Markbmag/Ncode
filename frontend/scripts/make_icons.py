"""Draws the home-screen icons in public/icons (K2). Run from frontend/: python scripts/make_icons.py

Full-bleed squares (iOS and Android round the corners themselves), the mark inside the middle 60 %
so they also work as Android "maskable" icons. Needs Pillow (in the backend's requirements).
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
SERVICES = {"ncode": ("#818cf8", "#4f46e5"), "kanban": ("#2dd4bf", "#0d9488")}
SIZES = {"180": 180, "192": 192, "512": 512}
S = 1024  # drawn at this size, then scaled down smoothly


def hex_rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def gradient(top: str, bottom: str) -> Image.Image:
    a, b = hex_rgb(top), hex_rgb(bottom)
    img = Image.new("RGB", (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * (S - 1))  # top-left to bottom-right, like the in-app marks
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return img


def kanban(draw: ImageDraw.ImageDraw) -> None:
    # the board outline and three columns of different heights (src/kanban/icons.tsx KanbanIcon)
    w = round(S * 0.045)
    box = (S * 0.25, S * 0.25, S * 0.75, S * 0.75)
    draw.rounded_rectangle(box, radius=S * 0.07, outline="white", width=w)
    for x, h in ((0.40, 0.24), (0.50, 0.13), (0.60, 0.30)):
        cx, top = S * x, S * 0.36
        draw.line((cx, top, cx, top + S * h), fill="white", width=w)
        for y in (top, top + S * h):  # round ends
            draw.ellipse((cx - w / 2, y - w / 2, cx + w / 2, y + w / 2), fill="white")


def ncode(draw: ImageDraw.ImageDraw) -> None:
    # the "N" of public/favicon.svg (a 64 grid), scaled into the middle of the icon
    path = [(20, 46), (20, 18), (25, 18), (39, 38), (39, 18), (44, 18), (44, 46), (39, 46), (25, 26), (25, 46)]
    k, off = S / 64 * 0.95, S * (1 - 0.95) / 2
    draw.polygon([(off + x * k, off + y * k) for x, y in path], fill="white")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (top, bottom) in SERVICES.items():
        img = gradient(top, bottom)
        (kanban if name == "kanban" else ncode)(ImageDraw.Draw(img))
        for label, size in SIZES.items():
            img.resize((size, size), Image.LANCZOS).save(OUT / f"{name}-{label}.png", optimize=True)
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
