"""Chart images for emails (M15): bar, line and number charts drawn as PNG on the server.

Drawn with Pillow (no browser on the server), light theme, the colours of the app's charts
(frontend/src/viz/palette.ts, light mode). The email carries them as inline images
(multipart/related, "cid:" links, app/automation/channels.py); the preview shows the same
pictures as data: links. Where no image can be drawn - Pillow is not installed, no font
is found, a chart type other than bar / line / number - the email keeps its HTML bars
and tables (app/automation/render.py), which every mail client shows.

Font: Pillow's built-in bitmap font has no Cyrillic, so a TrueType font is needed. Ncode
ships DejaVu Sans (fonts/DejaVuSans.ttf, unmodified; its licence, fonts/LICENSE.txt, allows
redistribution with the notice kept). NCODE_CHART_FONT may name another .ttf; when the
bundled file is missing, a system font with Cyrillic is looked for (Segoe UI / Arial on
Windows, DejaVu / Liberation / Noto on Linux, Arial on macOS); none found = HTML bars.
"""

from __future__ import annotations

import io
import logging
import math
import os
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

try:  # optional: without Pillow the emails keep their HTML bars
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - exercised by monkeypatching Image = None in the tests
    Image = ImageDraw = ImageFont = None  # type: ignore[assignment]

from .render import CardOut, Report, bar_rows, format_value, label, local_number, shape

logger = logging.getLogger("ncode.automation")

BUNDLED_FONT = Path(__file__).resolve().parent / "fonts" / "DejaVuSans.ttf"
SYSTEM_FONTS = (
    # Windows
    "segoeui.ttf", "arial.ttf", "tahoma.ttf",
    # Linux
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/noto/NotoSans-Regular.ttf",
    # macOS
    "/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial Unicode.ttf",
)

# frontend/src/viz/palette.ts, light mode
SURFACE = "#ffffff"
TEXT = "#1b2036"
TEXT_2 = "#5b6280"
MUTED = "#8a91ad"
GRID = "#e9eaf2"
AXIS = "#c9ccdc"
SERIES = "#2a78d6"
GOOD = "#006300"
BAD = "#d03b3b"

# drawn for a phone first: shown at most this wide (and narrower on small screens), so the
# text stays readable when a phone shrinks the picture to its width
WIDTHS = {"bar": 420, "line": 560, "number": 420}
SCALE = 2         # drawn at twice the size: sharp on phones
MAX_IMAGES = 12   # per email
MAX_BARS = 15

ChartKind = Literal["bar", "line", "number"]


@dataclass
class ChartData:
    kind: ChartKind
    labels: list[str] = field(default_factory=list)
    values: list[float | None] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)     # the values, formatted
    number: str = ""                                    # number charts
    note: str = ""                                      # "▲ 18 % vs. previous"
    tone: Literal["good", "bad", "neutral"] = "neutral"
    alt: str = ""


# ---------------------------------------------------------------- fonts

def _font_candidates() -> list[Path]:
    out: list[Path] = []
    own = os.environ.get("NCODE_CHART_FONT", "").strip()
    if own:
        out.append(Path(own))
    out.append(BUNDLED_FONT)
    windir = Path(os.environ.get("WINDIR") or os.environ.get("SystemRoot") or "C:/Windows") / "Fonts"
    for name in SYSTEM_FONTS:
        out.append(windir / name if "/" not in name else Path(name))
    return out


@lru_cache(maxsize=1)
def font_path() -> Path | None:
    """The first TrueType font that loads and draws Cyrillic; None = no images."""
    if ImageFont is None:
        return None
    for path in _font_candidates():
        try:
            if not path.is_file():
                continue
            font = ImageFont.truetype(str(path), 20)
            if font.getlength("Ж") <= 0:
                continue
            return path
        except (OSError, ValueError):
            continue
    logger.info("No font with Cyrillic found for chart images: emails show HTML bars")
    return None


@lru_cache(maxsize=32)
def _font(size: int) -> Any:
    path = font_path()
    assert path is not None and ImageFont is not None
    return ImageFont.truetype(str(path), size * SCALE)


def available() -> bool:
    return Image is not None and font_path() is not None


# ---------------------------------------------------------------- from a card

def chart_of(card: CardOut, rows: int, lang: str = "en") -> ChartData | None:
    """What to draw for a question card (None: a table, an error, or no rows)."""
    result = card.result
    if card.kind != "question" or card.error or result is None or not result.rows:
        return None
    kind, info = shape(card)
    if kind == "kpi":
        col = result.columns[info["index"]]
        value, previous = info["value"], info["previous"]
        number = local_number(format_value(value, col, info["format"]), lang)
        chart = ChartData(kind="number", number=number, alt=f"{card.title}: {number}")
        if isinstance(value, (int, float)) and isinstance(previous, (int, float)) and previous and not isinstance(value, bool):
            pct = (value - previous) / abs(previous) * 100
            word = "к предыдущему" if lang == "ru" else "vs. previous"
            chart.note = local_number(f"{'▲' if pct >= 0 else '▼'} {abs(pct):.1f} % {word}", lang)
            chart.tone = "neutral"
            chart.alt += f" ({chart.note})"
        return chart
    if kind == "bars":
        items = bar_rows(result, info, min(rows, MAX_BARS) if not info["time"] else max(rows, 60))
        ycol = result.columns[info["y"]]
        values = [float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None for _, v in items]
        if not any(v is not None for v in values):
            return None
        texts = [local_number(format_value(v, ycol, info["format"]), lang) for _, v in items]
        alt = f"{card.title} ({label(ycol, lang)}): " + ", ".join(f"{x} {t}" for (x, _), t in list(zip(items, texts))[:10])
        return ChartData(kind="line" if info["time"] else "bar", labels=[x for x, _ in items], values=values, texts=texts,
                         alt=alt[:400])
    return None


# ---------------------------------------------------------------- drawing

def _s(v: float) -> int:
    return int(round(v * SCALE))


def _fit(text: str, font: Any, width: float) -> str:
    """The text, shortened with … to fit the width (in drawn pixels)."""
    if font.getlength(text) <= width:
        return text
    while text and font.getlength(text + "…") > width:
        text = text[:-1]
    return text + "…"


def _png(img: Any) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _bar(chart: ChartData) -> bytes:
    width = WIDTHS["bar"]
    n = len(chart.labels)
    row = 32
    height = 12 + n * row + 8
    img = Image.new("RGB", (_s(width), _s(height)), SURFACE)
    draw = ImageDraw.Draw(img)
    font = _font(15)
    label_w, value_w = width * 0.36, width * 0.18
    bar_x0 = label_w + 8
    bar_w = width - label_w - value_w - 16
    top = max((abs(v) for v in chart.values if v is not None), default=0) or 1
    draw.line([(_s(bar_x0), _s(6)), (_s(bar_x0), _s(height - 6))], fill=AXIS, width=SCALE)
    for i, (name, value, text) in enumerate(zip(chart.labels, chart.values, chart.texts)):
        mid = 12 + i * row + row / 2
        draw.text((_s(label_w), _s(mid)), _fit(name, font, _s(label_w - 4)), font=font, fill=TEXT_2, anchor="rm")
        if value is not None and value != 0:
            w = max(abs(value) / top * bar_w, 2)
            draw.rounded_rectangle([_s(bar_x0), _s(mid - 9), _s(bar_x0 + w), _s(mid + 9)], radius=_s(3),
                                   fill=SERIES if value >= 0 else BAD)
        draw.text((_s(width - 4), _s(mid)), text, font=font, fill=TEXT, anchor="rm")
    return _png(img)


def _ticks(lo: float, hi: float, count: int = 4) -> list[float]:
    if hi == lo:
        hi = lo + 1
    raw = (hi - lo) / count
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    start = math.floor(lo / step) * step
    out, v = [], start
    while v <= hi + step * 0.001:
        out.append(round(v, 10))
        v += step
    if out[-1] < hi:
        out.append(round(out[-1] + step, 10))
    return out


def _line(chart: ChartData, lang: str) -> bytes:
    width = WIDTHS["line"]
    height, left, right, top_pad, bottom = 260, 64, 20, 18, 34
    img = Image.new("RGB", (_s(width), _s(height)), SURFACE)
    draw = ImageDraw.Draw(img)
    font = _font(14)
    points = [(i, v) for i, v in enumerate(chart.values) if v is not None]
    lo = min(0.0, min(v for _, v in points))
    hi = max(v for _, v in points)
    ticks = _ticks(lo, hi)
    lo, hi = ticks[0], ticks[-1]
    plot_w, plot_h = width - left - right, height - top_pad - bottom
    n = len(chart.values)

    def xy(i: int, v: float) -> tuple[int, int]:
        x = left + (plot_w * (i / (n - 1)) if n > 1 else plot_w / 2)
        y = top_pad + plot_h * (1 - (v - lo) / ((hi - lo) or 1))
        return _s(x), _s(y)

    for t in ticks:
        _, y = xy(0, t)
        draw.line([(_s(left), y), (_s(width - right), y)], fill=GRID if t else AXIS, width=SCALE)
        text = local_number(_tick_text(t, ticks), lang)
        draw.text((_s(left - 8), y), text, font=font, fill=MUTED, anchor="rm")
    shown = sorted({0, n // 2, n - 1}) if n > 2 else list(range(n))
    for i in shown:
        x, _ = xy(i, lo)
        anchor = "la" if i == 0 and n > 1 else "ra" if i == n - 1 and n > 1 else "ma"
        draw.text((x, _s(height - bottom + 10)), _fit(chart.labels[i], font, _s(plot_w / 3)), font=font, fill=MUTED, anchor=anchor)
    coords = [xy(i, v) for i, v in points]
    if len(coords) > 1:
        draw.line(coords, fill=SERIES, width=_s(2.5), joint="curve")
    r = _s(3)
    for x, y in coords[-1:] if len(coords) > 12 else coords:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=SERIES)
    # the latest value, written next to its point
    last_i = points[-1][0]
    x, y = coords[-1]
    draw.text((x - _s(6), y - _s(8)), chart.texts[last_i], font=_font(13), fill=TEXT, anchor="rb")
    return _png(img)


def _tick_text(v: float, ticks: list[float]) -> str:
    step = abs(ticks[1] - ticks[0]) if len(ticks) > 1 else 1
    big = max(abs(t) for t in ticks)
    for size, unit in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if big >= size * 10:
            return f"{v / size:,.{0 if step >= size else 1}f}{unit}"
    decimals = 0 if step >= 1 else min(4, max(1, -math.floor(math.log10(step))))
    return f"{v:,.{decimals}f}"


def _number(chart: ChartData) -> bytes:
    width = WIDTHS["number"]
    height = 96 if chart.note else 70
    img = Image.new("RGB", (_s(width), _s(height)), SURFACE)
    draw = ImageDraw.Draw(img)
    big = _font(40)
    draw.text((_s(2), _s(8)), _fit(chart.number, big, _s(width - 8)), font=big, fill=TEXT, anchor="la",
              stroke_width=1, stroke_fill=TEXT)
    if chart.note:
        tone = {"good": GOOD, "bad": BAD}.get(chart.tone, TEXT_2)
        draw.text((_s(2), _s(66)), _fit(chart.note, _font(15), _s(width - 8)), font=_font(15), fill=tone, anchor="la")
    return _png(img)


def draw(chart: ChartData, lang: str = "en") -> bytes | None:
    """The PNG of a chart, or None when it cannot be drawn here (no Pillow, no font, nothing to draw)."""
    if not available():
        return None
    try:
        if chart.kind == "number":
            return _number(chart)
        if not any(v is not None for v in chart.values):
            return None
        if chart.kind == "bar":
            return _bar(chart)
        if chart.kind == "line":
            return _line(chart, lang)
    except Exception:  # a picture is never worth a failed email
        logger.exception("chart image failed")
    return None


# ---------------------------------------------------------------- for one email

@dataclass
class Picture:
    cid: str          # Content-ID without the angle brackets
    data: bytes
    alt: str
    width: int        # shown at most this wide

    def data_uri(self) -> str:
        import base64

        return "data:image/png;base64," + base64.b64encode(self.data).decode("ascii")


def pictures(report: Report, lang: str = "en") -> dict[int, Picture]:
    """Chart images of a report: card index -> picture (cards without one keep their HTML bars)."""
    if not available():
        return {}
    out: dict[int, Picture] = {}
    token = uuid.uuid4().hex[:12]
    for i, card in enumerate(report.cards):
        if len(out) >= MAX_IMAGES:
            break
        chart = chart_of(card, report.rows_per_card, lang)
        if chart is None:
            continue
        png = draw(chart, lang)
        if png is not None:
            out[i] = Picture(cid=f"chart{i}.{token}@ncode", data=png, alt=chart.alt or card.title, width=WIDTHS[chart.kind])
    return out
