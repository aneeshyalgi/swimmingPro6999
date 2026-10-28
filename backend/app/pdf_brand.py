"""SwimGPT's brand for the PDF exports: the app's typeface (Geist), its colours, its logo and its icons (Lucide), all drawn
as vectors with ReportLab, so they print sharp at any size.

Geist (SIL Open Font License, app/fonts) is registered once. Without its files (an image built without app/fonts, say)
every export falls back to Helvetica rather than failing. Text from an athlete's data goes through `printable` first: an
accent the font lacks is dropped from its letter, and a script it doesn't cover is left out rather than printed as boxes.
"""
from __future__ import annotations

import logging
import math
import os
import re
import unicodedata
from functools import lru_cache
from typing import Any

from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

logger = logging.getLogger(__name__)

FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
# Each face: the name it's registered under, its file, and the built-in font used when Geist can't be loaded.
_FACES = {
    "regular": ("Geist", "Geist-Regular.ttf", "Helvetica"),
    "medium": ("Geist-Medium", "Geist-Medium.ttf", "Helvetica"),
    "semibold": ("Geist-SemiBold", "Geist-SemiBold.ttf", "Helvetica-Bold"),
    "bold": ("Geist-Bold", "Geist-Bold.ttf", "Helvetica-Bold"),
    "mono": ("GeistMono-Medium", "GeistMono-Medium.ttf", "Courier"),
    "mono_bold": ("GeistMono-SemiBold", "GeistMono-SemiBold.ttf", "Courier-Bold"),
}


def _register() -> dict[str, str]:
    try:
        for name, file, _ in _FACES.values():
            pdfmetrics.registerFont(TTFont(name, os.path.join(FONT_DIR, file)))
        # Paragraph markup's <b> picks the family's bold.
        pdfmetrics.registerFontFamily("Geist", normal="Geist", bold="Geist-Bold", italic="Geist", boldItalic="Geist-Bold")
        return {key: name for key, (name, _, _) in _FACES.items()}
    except Exception:
        logger.warning("Geist couldn't be loaded from %s, so PDFs use Helvetica", FONT_DIR, exc_info=True)
        return {key: fallback for key, (_, _, fallback) in _FACES.items()}


FONTS = _register()
REGULAR, MEDIUM, SEMIBOLD, BOLD, MONO, MONO_BOLD = (FONTS[key] for key in ("regular", "medium", "semibold", "bold", "mono", "mono_bold"))
# Whether the exports are in Geist (False: the Helvetica fallback).
BRANDED = REGULAR == "Geist"


@lru_cache(maxsize=1)
def _coverage() -> frozenset[int] | None:
    """The characters Geist can draw; None with the Helvetica fallback (WinAnsi, see _drawable)."""
    return frozenset(pdfmetrics.getFont(REGULAR).face.charToGlyph) if BRANDED else None


def _drawable(char: str) -> bool:
    coverage = _coverage()
    if coverage is not None:
        return ord(char) in coverage
    try:
        char.encode("cp1252")
        return True
    except UnicodeEncodeError:
        return False


_WORD = re.compile(r"\w+|\W")


def _plain(char: str) -> str:
    """`char`, or its letter without the accent the font lacks; "" when the font can't draw it at all."""
    if _drawable(char):
        return char
    parts = [part for part in unicodedata.normalize("NFKD", char) if not unicodedata.combining(part)]
    return "".join(parts) if parts and all(_drawable(part) for part in parts) else ""


def printable(text: Any) -> str:
    """`text` as the exports' font can draw it: a letter whose accent it lacks loses the accent (NFKD), and a word in a
    script it doesn't cover is left out whole (never printed in part, or as boxes), as is any symbol it can't draw."""
    text = str(text)
    if all(_drawable(char) or char in "\n\t" for char in text):
        return text
    kept: list[str] = []
    for token in _WORD.findall(text):
        if token[0].isalnum() or token[0] == "_":
            plain = [_plain(char) for char in token]
            token = "".join(plain) if all(plain) else ""
        elif token not in "\n\t":
            token = _plain(token)
        if token or not kept or kept[-1] != " ":
            kept.append(token)
    # A word left out doesn't leave two spaces in its place.
    return re.sub(r" {2,}", " ", "".join(kept)).strip()


def whole(text: str | None) -> str | None:
    """`text` when the font can draw every letter of it: a name is left out rather than printed in part."""
    if not text or not text.strip():
        return None
    cleaned = printable(text.strip())
    return cleaned if cleaned == text.strip() else None


# ---------------------------------------------------------------- colours
def _oklab(lightness: float, chroma: float, hue: float) -> tuple[float, float, float]:
    angle = math.radians(hue)
    return lightness, chroma * math.cos(angle), chroma * math.sin(angle)


def _srgb(lab: tuple[float, float, float]) -> colors.Color:
    """An OKLab colour in sRGB, each channel clipped to the gamut (as browsers draw an oklch() outside it)."""
    lightness, a, b = lab
    l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    linear = (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
              -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
              -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
    return colors.Color(*(12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055 for v in (min(1.0, max(0.0, v)) for v in linear)))


def oklch(lightness: float, chroma: float, hue: float) -> colors.Color:
    """A CSS oklch() colour."""
    return _srgb(_oklab(lightness, chroma, hue))


def mix(base, over, amount: float):
    """`over` laid on `base` at `amount` opacity, as one solid colour (ReportLab gradients can't fade through alpha)."""
    return colors.Color(*(a + (b - a) * amount for a, b in zip((base.red, base.green, base.blue), (over.red, over.green, over.blue))))


# The app's theme (app/globals.css).
BACKGROUND = oklch(0.12, 0.015, 240)    # --background
CARD = oklch(0.16, 0.02, 240)           # --card
PRIMARY = oklch(0.2, 0.03, 240)         # --primary
ACCENT = oklch(0.72, 0.15, 195)         # --accent: the logo's teal and the wordmark's "GPT"
FOREGROUND = oklch(0.98, 0.005, 240)    # --foreground: text on the dark, and the logo's waves
# The app's highlight colours (its rings, glows and charts).
CYAN = colors.HexColor("#57E5EA")
SKY = colors.HexColor("#38BDF8")
VIOLET = colors.HexColor("#A78BFA")
EMERALD = colors.HexColor("#34D399")
AMBER = colors.HexColor("#FCD34D")

# The logo's gradient, "to bottom right in oklab" from --accent via --accent-foreground to --primary (Tailwind v4 blends in
# OKLab), as RGB stops close enough together that RGB blending between them can't be told apart.
_LOGO_LAB = [_oklab(0.72, 0.15, 195), _oklab(0.12, 0.015, 240), _oklab(0.2, 0.03, 240)]
LOGO_OFFSETS = tuple(index / 16 for index in range(17))


def _logo_stop(offset: float) -> colors.Color:
    start, end = (_LOGO_LAB[0], _LOGO_LAB[1]) if offset <= 0.5 else (_LOGO_LAB[1], _LOGO_LAB[2])
    t = offset * 2 if offset <= 0.5 else offset * 2 - 1
    return _srgb(tuple(a + (b - a) * t for a, b in zip(start, end)))


LOGO_STOPS = tuple(_logo_stop(offset) for offset in LOGO_OFFSETS)


# ---------------------------------------------------------------- paths and icons
# Lucide icons (ISC licence), as lucide-react 0.454 draws them in the app: every element as path data in a 24-unit box.
ICONS = {
    "waves": ["M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
              "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
              "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"],
    "flag": ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22L4 15"],
    "dumbbell": ["M14.4 14.4 9.6 9.6",
                 "M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z",
                 "m21.5 21.5-1.4-1.4", "M3.9 3.9 2.5 2.5",
                 "M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"],
    "heart": ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"],
    "moon": ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
    "activity": ["M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"],
    "timer": ["M10 2L14 2", "M12 14L15 11", "M4 14a8 8 0 1 0 16 0a8 8 0 1 0 -16 0"],
    "circle_check": ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "m9 12 2 2 4-4"],
    "list_checks": ["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"],
    "sparkles": ["M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
                 "M20 3v4", "M22 5h-4", "M4 17v2", "M5 18H3"],
    "target": ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],
    "lightbulb": ["M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5", "M9 18h6", "M10 22h4"],
    "notebook_pen": ["M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4", "M2 6h4", "M2 10h4", "M2 14h4", "M2 18h4",
                     "M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"],
    "message_square": ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
    "triangle_alert": ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
    "clock": ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 6L12 12L16 14"],
    "layers": ["m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",
               "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65", "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"],
    "map_pin": ["M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0", "M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],
    "trophy": ["M6 9H4.5a2.5 2.5 0 0 1 0-5H6", "M18 9h1.5a2.5 2.5 0 0 0 0-5H18", "M4 22h16", "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",
               "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22", "M18 2H6v7a6 6 0 0 0 12 0V2Z"],
    "check": ["M20 6 9 17l-5-5"],
    "ruler": ["M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",
              "m14.5 12.5 2-2", "m11.5 9.5 2-2", "m8.5 6.5 2-2", "m17.5 15.5 2-2"],
    "repeat": ["m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3"],
    "gauge": ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"],
    "info": ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 16v-4", "M12 8h.01"],
    "user_round": ["M7 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M20 21a8 8 0 0 0-16 0"],
    "zap": ["M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"],
    "flame": ["M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"],
    "snowflake": ["M2 12L22 12", "M12 2L12 22", "m20 16-4-4 4-4", "m4 8 4 4-4 4", "m16 4-4 4-4-4", "m8 20 4-4 4 4"],
}

_TOKEN = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
_ARGS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def _arc(x1: float, y1: float, rx: float, ry: float, rotation: float, large: bool, sweep: bool, x2: float, y2: float) -> list[tuple[float, ...]]:
    """An SVG elliptical arc as cubic Béziers (endpoint to centre form, SVG 1.1 implementation notes F.6.5), each at most
    a quarter turn."""
    if (x1, y1) == (x2, y2):
        return []
    if not rx or not ry:
        return [(x1, y1, x2, y2, x2, y2)]
    rx, ry = abs(rx), abs(ry)
    cos_r, sin_r = math.cos(math.radians(rotation)), math.sin(math.radians(rotation))
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    px, py = cos_r * dx + sin_r * dy, -sin_r * dx + cos_r * dy
    scale = (px / rx) ** 2 + (py / ry) ** 2
    if scale > 1:
        rx, ry = rx * math.sqrt(scale), ry * math.sqrt(scale)
    numerator = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px
    denominator = rx * rx * py * py + ry * ry * px * px
    root = math.sqrt(max(0.0, numerator / denominator)) if denominator else 0.0
    if large == sweep:
        root = -root
    cpx, cpy = root * rx * py / ry, -root * ry * px / rx
    cx, cy = cos_r * cpx - sin_r * cpy + (x1 + x2) / 2, sin_r * cpx + cos_r * cpy + (y1 + y2) / 2

    def angle(ux: float, uy: float, vx: float, vy: float) -> float:
        return math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)

    start = angle(1, 0, (px - cpx) / rx, (py - cpy) / ry)
    delta = angle((px - cpx) / rx, (py - cpy) / ry, (-px - cpx) / rx, (-py - cpy) / ry)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    elif sweep and delta < 0:
        delta += 2 * math.pi
    count = max(1, math.ceil(abs(delta) / (math.pi / 2) - 1e-9))
    step = delta / count
    handle = 4 / 3 * math.tan(step / 4)
    curves = []
    for index in range(count):
        a1, a2 = start + index * step, start + (index + 1) * step
        points = [(math.cos(a1) - handle * math.sin(a1), math.sin(a1) + handle * math.cos(a1)),
                  (math.cos(a2) + handle * math.sin(a2), math.sin(a2) - handle * math.cos(a2)),
                  (math.cos(a2), math.sin(a2))]
        curve: list[float] = []
        for ux, uy in points:
            ex, ey = ux * rx, uy * ry
            curve += [cos_r * ex - sin_r * ey + cx, sin_r * ex + cos_r * ey + cy]
        curves.append(tuple(curve))
    return curves


@lru_cache(maxsize=256)
def path_segments(data: str) -> tuple[tuple[Any, ...], ...]:
    """SVG path data as absolute moves, lines and cubic curves: ("M", x, y), ("L", x, y), ("C", x1, y1, x2, y2, x, y), ("Z",)."""
    tokens = _TOKEN.findall(data)
    segments: list[tuple[Any, ...]] = []
    x = y = start_x = start_y = 0.0
    last_control: tuple[float, float] | None = None   # the previous curve's second control point (for S)
    last_quad: tuple[float, float] | None = None      # the previous quadratic's control point (for T)
    command, index = "", 0
    while index < len(tokens):
        explicit = tokens[index].isalpha()
        if explicit:
            command = tokens[index]
            index += 1
        elif command in ("M", "m"):
            command = "L" if command == "M" else "l"  # coordinates after a move are lines
        upper, relative = command.upper(), command.islower()
        if not command or (upper == "Z" and not explicit):  # numbers with no command to take them
            raise ValueError(f"Malformed path data: {data[:40]}")
        values = [float(token) for token in tokens[index:index + _ARGS[upper]]]
        index += _ARGS[upper]
        ox, oy = (x, y) if relative else (0.0, 0.0)
        control, quad = None, None
        if upper == "Z":
            segments.append(("Z",))
            x, y = start_x, start_y
        elif upper == "M":
            x, y = values[0] + ox, values[1] + oy
            start_x, start_y = x, y
            segments.append(("M", x, y))
        elif upper in ("L", "H", "V"):
            if upper == "H":
                x = values[0] + (x if relative else 0)
            elif upper == "V":
                y = values[0] + (y if relative else 0)
            else:
                x, y = values[0] + ox, values[1] + oy
            segments.append(("L", x, y))
        elif upper in ("C", "S"):
            if upper == "C":
                c1 = (values[0] + ox, values[1] + oy)
                c2, end = (values[2] + ox, values[3] + oy), (values[4] + ox, values[5] + oy)
            else:
                c1 = (2 * x - last_control[0], 2 * y - last_control[1]) if last_control else (x, y)
                c2, end = (values[0] + ox, values[1] + oy), (values[2] + ox, values[3] + oy)
            segments.append(("C", *c1, *c2, *end))
            control, (x, y) = c2, end
        elif upper in ("Q", "T"):
            if upper == "Q":
                q, end = (values[0] + ox, values[1] + oy), (values[2] + ox, values[3] + oy)
            else:
                q = (2 * x - last_quad[0], 2 * y - last_quad[1]) if last_quad else (x, y)
                end = (values[0] + ox, values[1] + oy)
            segments.append(("C", x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y), end[0] + 2 / 3 * (q[0] - end[0]), end[1] + 2 / 3 * (q[1] - end[1]), *end))
            quad, (x, y) = q, end
        elif upper == "A":
            end = (values[5] + ox, values[6] + oy)
            segments += [("C", *curve) for curve in _arc(x, y, values[0], values[1], values[2], bool(values[3]), bool(values[4]), *end)]
            x, y = end
        last_control, last_quad = control, quad
    return tuple(segments)


def trace(c, data: str, transform) -> Any:
    """A ReportLab path of SVG path `data`, each point placed by `transform(x, y) -> (x, y)`."""
    path = c.beginPath()
    for segment in path_segments(data):
        if segment[0] == "M":
            path.moveTo(*transform(*segment[1:]))
        elif segment[0] == "L":
            path.lineTo(*transform(*segment[1:]))
        elif segment[0] == "C":
            path.curveTo(*transform(*segment[1:3]), *transform(*segment[3:5]), *transform(*segment[5:7]))
        else:
            path.close()
    return path


def icon(c, name: str, x: float, y: float, size: float, color, stroke: float = 2.0) -> None:
    """Lucide icon `name` in a `size` box whose bottom-left corner is (x, y), stroked like the app's (2 of its 24 units)."""
    scale = size / 24
    c.saveState()
    c.setStrokeColor(color)
    c.setLineWidth(stroke * scale)
    c.setLineCap(1)
    c.setLineJoin(1)
    for data in ICONS[name]:
        c.drawPath(trace(c, data, lambda px, py: (x + px * scale, y + size - py * scale)), stroke=1, fill=0)
    c.restoreState()


# ---------------------------------------------------------------- the logo
def mark(c, x: float, y: float, size: float) -> None:
    """The SwimGPT logo as the app draws it (a rounded-xl tile, bg-gradient-to-br from-accent via-accent-foreground
    to-primary, holding a 20px Waves icon in its 36px), with its bottom-left corner at (x, y)."""
    c.saveState()
    tile = c.beginPath()
    tile.roundRect(x, y, size, size, size / 3)
    c.clipPath(tile, stroke=0, fill=0)
    c.linearGradient(x, y + size, x + size, y, LOGO_STOPS, LOGO_OFFSETS, extend=True)
    c.restoreState()
    inset = size * 8 / 36
    icon(c, "waves", x + inset, y + inset, size * 20 / 36, FOREGROUND)


def cap_height(font: str, size: float) -> float:
    face = getattr(pdfmetrics.getFont(font), "face", None)
    return (getattr(face, "capHeight", 0) or 718) / 1000 * size


def tracked_width(text: str, font: str, size: float, tracking: float = 0.0) -> float:
    """`text`'s width with `tracking` (em) after every letter, as CSS letter-spacing."""
    return pdfmetrics.stringWidth(text, font, size) + tracking * size * len(text)


def draw(c, x: float, y: float, text: str, font: str, size: float, color, *, tracking: float = 0.0, align: str = "left") -> float:
    """Draw `text` (printable) with its baseline at y, aligned left, right or centre on x; returns its width."""
    text = printable(text)
    width = tracked_width(text, font, size, tracking)
    if align == "right":
        x -= width - tracking * size  # the spacing after the last letter isn't seen
    elif align == "centre":
        x -= (width - tracking * size) / 2
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, text, charSpace=tracking * size)
    return width


def wordmark(c, x: float, y: float, size: float, ink=FOREGROUND) -> float:
    """"SwimGPT" as the app sets it (bold, tracking-tight, "GPT" in the accent), its baseline at y; returns its width."""
    width = draw(c, x, y, "Swim", BOLD, size, ink, tracking=-0.025)
    return width + draw(c, x + width, y, "GPT", BOLD, size, ACCENT, tracking=-0.025)


def lockup(c, x: float, y: float, size: float, ink=FOREGROUND) -> float:
    """The logo and "SwimGPT" side by side as in the app's header (36px tile, 18px wordmark, 10px apart), the tile's
    bottom-left at (x, y); returns the whole width."""
    mark(c, x, y, size)
    text_size = size / 2
    return size * 46 / 36 + wordmark(c, x + size * 46 / 36, y + size / 2 - cap_height(BOLD, text_size) / 2, text_size, ink)
