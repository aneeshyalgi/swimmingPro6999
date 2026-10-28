"""The PDF exports' shared design, and the single-workout export (a gym workout, or a Swim Week strength session).

Every export opens with the app's dark header: SwimGPT's logo (pdf_brand), the workout or week, its chips and, for a week,
the strip of its days filling with water as in the app. Its body prints on white, in the app's typeface and colours (cyan
for swims, violet for the gym, emerald for mobility and anything ticked off, amber for meets, recovery and coach's notes),
with a light running header and the logo in the footer of every page.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import BaseDocTemplate, Flowable, Frame, KeepTogether, NextPageTemplate, PageTemplate, Paragraph, Spacer

from app.pdf_brand import (
    BOLD, CYAN, FOREGROUND, MEDIUM, REGULAR, SEMIBOLD, draw, icon, lockup, mark, mix, printable, tracked_width, whole,
    wordmark,
)

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_H = 20 * mm   # the frame's bottom edge: the footer sits below it
HEADER_H = 24 * mm   # pages after the first: the running header sits above the frame

WHITE = colors.white
INK = colors.HexColor("#0B1726")     # headings and figures: the app's navy, lifted a touch for print
BODY = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
FAINT = colors.HexColor("#94A3B8")
HAIR = colors.HexColor("#E2E8F0")
TINT = colors.HexColor("#F4F7FA")
RING = colors.HexColor("#CBD5E1")
NIGHT = colors.HexColor("#0C141C")   # the dark header: the app's week card
NIGHT_DEEP = colors.HexColor("#070C12")
ON_NIGHT = colors.HexColor("#CBD5E1")
ON_NIGHT_MUTED = colors.HexColor("#94A3B8")


@dataclass(frozen=True)
class Tone:
    """One of the app's colours, as each place needs it."""

    bright: Any       # on the dark header: text, icons, water
    light: Any        # chip text on the dark header (the app's -100 shades)
    solid: Any        # filled chips, bars and dots on white
    ink: Any          # text and icons on white
    wash: Any         # card and icon backgrounds on white
    hero: tuple[str, str] = ("#57E5EA", "#3878DC")  # the dark header's tints: top-left, bottom-right


SWIM = Tone(CYAN, colors.HexColor("#CFFAFE"), colors.HexColor("#0891B2"), colors.HexColor("#0E7490"), colors.HexColor("#ECFEFF"))
GYM = Tone(colors.HexColor("#C4B5FD"), colors.HexColor("#EDE9FE"), colors.HexColor("#7C3AED"), colors.HexColor("#6D28D9"),
           colors.HexColor("#F5F3FF"), ("#A78BFA", "#57E5EA"))
MOBILITY = Tone(colors.HexColor("#6EE7B7"), colors.HexColor("#D1FAE5"), colors.HexColor("#059669"), colors.HexColor("#047857"),
                colors.HexColor("#ECFDF5"), ("#34D399", "#57E5EA"))
AMBER = Tone(colors.HexColor("#FCD34D"), colors.HexColor("#FEF3C7"), colors.HexColor("#D97706"), colors.HexColor("#B45309"),
             colors.HexColor("#FFFBEB"), ("#FBBF24", "#F97316"))
MEET = Tone(colors.HexColor("#FDBA74"), colors.HexColor("#FFEDD5"), colors.HexColor("#EA580C"), colors.HexColor("#C2410C"),
            colors.HexColor("#FFF7ED"), ("#FB923C", "#FBBF24"))
SKY = Tone(colors.HexColor("#7DD3FC"), colors.HexColor("#E0F2FE"), colors.HexColor("#0284C7"), colors.HexColor("#0369A1"),
           colors.HexColor("#F0F9FF"))
SLATE = Tone(colors.HexColor("#CBD5E1"), colors.HexColor("#F1F5F9"), colors.HexColor("#64748B"), colors.HexColor("#475569"),
             colors.HexColor("#F8FAFC"))
DONE = MOBILITY

# A gym workout's sections, coloured as the app's builder colours them (a shade darker, for print), and their icons.
KIND = {
    "warmup": "#F97316", "activation": "#F59E0B", "main": "#7C3AED", "power": "#C026D3", "accessory": "#0EA5E9",
    "core": "#10B981", "conditioning": "#F43F5E", "mobility": "#14B8A6", "cooldown": "#06B6D4", "custom": "#64748B",
}
KIND_ICONS = {
    "warmup": "flame", "activation": "zap", "main": "dumbbell", "power": "zap", "accessory": "dumbbell", "core": "target",
    "conditioning": "activity", "mobility": "heart", "cooldown": "snowflake", "custom": "list_checks",
}


def _style(name: str, **kw) -> ParagraphStyle:
    return ParagraphStyle(name, **{"fontName": REGULAR, "fontSize": 9.3, "leading": 13.5, "textColor": BODY, **kw})


def _text(value: Any) -> str:
    """`value` as Paragraph markup: printable, escaped, its line breaks kept."""
    return escape(printable(value)).replace("\n", "<br/>")


def _bold(value: Any, color: str = "#0B1726") -> str:
    """`value` in bold within Paragraph markup."""
    return f"<font name='{SEMIBOLD}' color='{color}'>{_text(value)}</font>"


def _fit(text: str, font: str, size: float, width: float, tracking: float = 0.0) -> str:
    """`text` (printable) shortened with an ellipsis to fit `width`."""
    text = printable(text)
    if tracked_width(text, font, size, tracking) <= width:
        return text
    while text and tracked_width(text + "…", font, size, tracking) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _wrap(text: str, font: str, size: float, width: float, tracking: float = 0.0) -> list[str]:
    lines: list[str] = []
    line = ""
    for word in printable(text).split():
        trial = f"{line} {word}".strip()
        if line and tracked_width(trial, font, size, tracking) > width:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + ([line] if line else [])


def _hex(color) -> str:
    return "#" + color.hexval()[2:]


def _round(c, x: float, y: float, w: float, h: float, radius: float, fill=None, stroke=None, width: float = 0.6) -> None:
    c.saveState()
    if fill is not None:
        c.setFillColor(fill)
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(width)
    c.roundRect(x, y, w, h, radius, stroke=1 if stroke is not None else 0, fill=1 if fill is not None else 0)
    c.restoreState()


def _clip_round(c, x: float, y: float, w: float, h: float, radius: float) -> None:
    path = c.beginPath()
    path.roundRect(x, y, w, h, radius)
    c.clipPath(path, stroke=0, fill=0)


def _glow(c, x: float, y: float, radius: float, base, color, strength: float) -> None:
    """A soft glow of `color` that fades exactly into `base` (gradients can't fade through alpha, so it's pre-mixed)."""
    c.radialGradient(x, y, radius, [mix(base, color, strength * factor) for factor in (1, 0.62, 0.3, 0.1, 0)],
                     (0, 0.25, 0.5, 0.75, 1), extend=False)


def _chip_width(text: str, size: float = 7.4, lead: bool = False) -> float:
    return tracked_width(printable(text), MEDIUM, size) + 4.4 * mm + (3.9 * mm if lead else 0)


def _chip_dark(c, x: float, y: float, text: str, tone: Tone, *, dot: bool = False, glyph: str | None = None) -> float:
    """A chip on the dark header as the app draws them (a hairline of the tone, a wash of it, its -100 shade for text),
    with a dot or an icon before the text; its bottom-left at (x, y). Returns its width."""
    height = 6.2 * mm
    width = _chip_width(text, lead=dot or bool(glyph))
    _round(c, x, y, width, height, height / 2, fill=mix(NIGHT, tone.bright, 0.12), stroke=mix(NIGHT, tone.bright, 0.4), width=0.6)
    tx = x + 2.2 * mm
    if dot:
        c.setFillColor(tone.bright)
        c.circle(tx + 0.9 * mm, y + height / 2, 0.75 * mm, stroke=0, fill=1)
        tx += 3.9 * mm
    elif glyph:
        icon(c, glyph, tx - 0.1 * mm, y + height / 2 - 1.5 * mm, 3 * mm, tone.bright)
        tx += 3.9 * mm
    draw(c, tx, y + height / 2 - 2.6, text, MEDIUM, 7.4, tone.light)
    return width


def _pill(c, x: float, y: float, text: str, fill, ink, size: float = 7.2, stroke=None) -> float:
    """A chip on white, its bottom-left at (x, y): filled, or outlined when `stroke` is given. Returns its width."""
    text = printable(text)
    height = size + 7.6
    width = tracked_width(text, SEMIBOLD, size) + 11
    _round(c, x, y, width, height, height / 2, fill=fill, stroke=stroke, width=0.6)
    draw(c, x + 5.5, y + height / 2 - size * 0.36, text, SEMIBOLD, size, ink)
    return width


def _pill_w(text: str, size: float) -> float:
    return tracked_width(printable(text), SEMIBOLD, size) + 11


def _tick(c, cx: float, cy: float, r: float, done: bool) -> None:
    """The app's tick: a filled emerald circle with a dark check when done, an empty ring to tick by hand otherwise."""
    if done:
        c.saveState()
        c.setFillColor(colors.HexColor("#10B981"))
        c.setStrokeColor(colors.HexColor("#6EE7B7"))
        c.setLineWidth(0.6)
        c.circle(cx, cy, r, stroke=1, fill=1)
        c.restoreState()
        icon(c, "check", cx - r * 0.62, cy - r * 0.62, r * 1.24, colors.HexColor("#022C22"), stroke=3.4)
    else:
        c.saveState()
        c.setStrokeColor(RING)
        c.setLineWidth(0.9)
        c.circle(cx, cy, r, stroke=1, fill=0)
        c.restoreState()


# ---------------------------------------------------------------- the dark header
def _title(text: str) -> tuple[list[str], float]:
    """The header's title in at most two lines: as large as fits."""
    width = CONTENT_W - 6 * mm
    for size in (28, 24, 20):
        lines = _wrap(text, BOLD, size, width, -0.02)
        if len(lines) <= 2 and all(tracked_width(line, BOLD, size, -0.02) <= width for line in lines):
            return lines, size
    lines = _wrap(text, BOLD, 20, width, -0.02)
    return [_fit(lines[0], BOLD, 20, width, -0.02), _fit(" ".join(lines[1:]), BOLD, 20, width, -0.02)][:len(lines)], 20


def _hero_layout(hero: dict[str, Any]) -> dict[str, Any]:
    """Where the header's parts go, measured down from the top of the page, and its height."""
    lines, size = _title(hero["title"])
    leading = size * 1.1
    y = 30 * mm
    layout: dict[str, Any] = {"lines": lines, "size": size, "title": [y + size * 0.86 + index * leading for index in range(len(lines))]}
    y += len(lines) * leading + 1.2 * mm
    if hero.get("details"):
        layout["details"] = y + 4.6 * mm
        y += 7 * mm
    if hero.get("chips"):
        layout["chips"] = y + 2.6 * mm + 6.2 * mm
        y += 11.4 * mm
    if hero.get("strip"):
        layout["strip"] = y + 3 * mm
        y += 3 * mm + _Strip.H
    layout["height"] = y + 9 * mm
    return layout


def _night(c, height: float, tone: Tone, art_bottom: float) -> None:
    """The dark header's ground, as the app's week card: the night, its tone glowing from the top-left and a second tint
    from the bottom-right (each glow fades exactly into the night, so no edge shows), and the logo's waves, large and
    faint, on the right above `art_bottom` (where the week's strip starts)."""
    bottom = PAGE_H - height
    start, end = colors.HexColor(tone.hero[0]), colors.HexColor(tone.hero[1])
    c.setFillColor(NIGHT)
    c.rect(0, bottom, PAGE_W, height, stroke=0, fill=1)
    for x, y, radius, color, strength in [(PAGE_W * 0.06, PAGE_H - 4 * mm, 118 * mm, start, 0.3),
                                          (PAGE_W * 0.99, bottom - 6 * mm, 104 * mm, end, 0.2)]:
        c.saveState()
        path = c.beginPath()
        path.rect(0, bottom, PAGE_W, height)
        c.clipPath(path, stroke=0, fill=0)
        _glow(c, x, y, radius, NIGHT, color, strength)
        c.restoreState()
    c.saveState()
    path = c.beginPath()
    path.rect(0, art_bottom, PAGE_W, PAGE_H - art_bottom)
    c.clipPath(path, stroke=0, fill=0)
    size = min(58 * mm, (PAGE_H - art_bottom) * 0.66)
    icon(c, "waves", PAGE_W - size * 0.74, PAGE_H - 20 * mm - size * 0.8, size, mix(NIGHT, tone.bright, 0.055))
    c.restoreState()


class _Doc(BaseDocTemplate):
    """An export: the dark header on its first page, a light running header on the rest, the footer on every page.

    `hero`: tone (a Tone), kicker, date_line, title, details (strings), chips [(text, Tone, "dot" | icon name | None)],
    strip (a week's days, see _Strip), compact (the running header's title) and subject.
    """

    def __init__(self, buffer, hero: dict[str, Any]):
        self.hero = hero
        self.layout = _hero_layout(hero)
        title = printable(hero["title"])
        super().__init__(buffer, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=HEADER_H, bottomMargin=FOOTER_H,
                         title=title, author="SwimGPT", subject=hero.get("subject", "Workout"), creator="SwimGPT")
        first_top = PAGE_H - self.layout["height"] - 7 * mm
        first = Frame(MARGIN, FOOTER_H, CONTENT_W, first_top - FOOTER_H, id="first", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        later = Frame(MARGIN, FOOTER_H, CONTENT_W, PAGE_H - HEADER_H - FOOTER_H, id="later", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate("first", [first], onPage=self._first), PageTemplate("later", [later], onPage=self._later)])

    def _first(self, c: pdf_canvas.Canvas, doc) -> None:
        hero, layout, tone = self.hero, self.layout, self.hero["tone"]
        top = PAGE_H
        _night(c, layout["height"], tone, top - layout["strip"] + 1 * mm if "strip" in layout else top - layout["height"])
        lockup(c, MARGIN, top - 19.5 * mm, 8.6 * mm)
        draw(c, PAGE_W - MARGIN, top - 13.6 * mm, hero["kicker"].upper(), SEMIBOLD, 7, tone.bright, tracking=0.2, align="right")
        draw(c, PAGE_W - MARGIN, top - 18.4 * mm, hero["date_line"], REGULAR, 8.4, ON_NIGHT_MUTED, align="right")
        for line, y in zip(layout["lines"], layout["title"]):
            draw(c, MARGIN, top - y, line, BOLD, layout["size"], FOREGROUND, tracking=-0.02)
        if "details" in layout:
            x = MARGIN
            for index, part in enumerate(hero["details"]):
                if index:
                    c.setFillColor(mix(NIGHT, FOREGROUND, 0.35))
                    c.circle(x + 2.4 * mm, top - layout["details"] + 2.4, 0.42 * mm, stroke=0, fill=1)
                    x += 4.8 * mm
                x += draw(c, x, top - layout["details"], part, REGULAR, 9.4, ON_NIGHT)
        if "chips" in layout:
            x = MARGIN
            for text, chip_tone, lead in hero["chips"]:
                if x + _chip_width(text, lead=bool(lead)) > PAGE_W - MARGIN:
                    break
                x += _chip_dark(c, x, top - layout["chips"], text, chip_tone, dot=lead == "dot", glyph=lead if lead not in (None, "dot") else None) + 2 * mm
        if "strip" in layout:
            _Strip(hero["strip"], tone).draw_at(c, MARGIN, top - layout["strip"] - _Strip.H)

    def _later(self, c: pdf_canvas.Canvas, doc) -> None:
        top = PAGE_H
        tone = self.hero["tone"]
        lockup(c, MARGIN, top - 15.6 * mm, 6.4 * mm, ink=INK)
        title = self.hero.get("compact") or self.hero["title"]
        kicker = self.hero["kicker"].split("  ·  ")[0]
        # What the export is goes under its title, unless the title says it already ("Swim Week · 26 Oct – 1 Nov").
        if kicker.lower() in title.lower():
            draw(c, PAGE_W - MARGIN, top - 13.4 * mm, _fit(title, SEMIBOLD, 8.6, CONTENT_W - 50 * mm), SEMIBOLD, 8.6, INK, align="right")
        else:
            draw(c, PAGE_W - MARGIN, top - 11.2 * mm, _fit(title, SEMIBOLD, 8.6, CONTENT_W - 50 * mm), SEMIBOLD, 8.6, INK, align="right")
            draw(c, PAGE_W - MARGIN, top - 15.3 * mm, kicker.upper(), SEMIBOLD, 6.2, tone.ink, tracking=0.18, align="right")
        c.saveState()
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.6)
        c.line(MARGIN, top - 19.4 * mm, PAGE_W - MARGIN, top - 19.4 * mm)
        c.restoreState()


class _NumberedCanvas(pdf_canvas.Canvas):
    """Draws every page's footer once the number of pages is known ("Page 2 of 5")."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pages: list[dict] = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            _footer(self, self._pageNumber, total)
            super().showPage()
        super().save()


def _footer(c, page: int, total: int) -> None:
    """The logo, the line and the page number, under a hairline in the app's swim-to-gym colours."""
    c.saveState()
    path = c.beginPath()
    path.rect(MARGIN, 14.6 * mm, CONTENT_W, 0.32 * mm)
    c.clipPath(path, stroke=0, fill=0)
    c.linearGradient(MARGIN, 14.6 * mm, PAGE_W - MARGIN, 14.6 * mm, (colors.HexColor("#22D3EE"), colors.HexColor("#38BDF8"), colors.HexColor("#A78BFA")),
                     (0, 0.5, 1), extend=False)
    c.restoreState()
    mark(c, MARGIN, 7.9 * mm, 4.4 * mm)
    x = MARGIN + 6.1 * mm
    x += wordmark(c, x, 9.3 * mm, 8, ink=INK)
    draw(c, x + 2.4 * mm, 9.3 * mm, "Train smarter in and out of the pool", REGULAR, 7.2, MUTED)
    draw(c, PAGE_W - MARGIN, 9.3 * mm, f"Page {page} of {total}", MEDIUM, 7.2, MUTED, align="right")


# ---------------------------------------------------------------- the week strip (in a week's dark header)
class _Strip:
    """A week's seven days as the app's strip: each a lane that fills with water to the day's load (cyan for swims,
    violet for the gym, emerald once everything on it is ticked off), with its weekday, date, amount and markers.

    `days`: dicts of day (date), amount ("2.9k", "45" or None), unit, level (0-1, against the week's biggest day), done
    (True, False, or None with nothing to tick), markers (icon names) and empty (said when nothing's planned)."""

    H = 33 * mm
    GAP = 2 * mm
    WATER = {
        "swim": ("#38BDF8", 0.5, "#0E7490", 0.8, "#38BDF8", 0.55, "#7DF0FF", 0.45),
        "gym": ("#A78BFA", 0.45, "#5B21B6", 0.75, "#A78BFA", 0.5, "#C4B5FD", 0.4),
        "done": ("#34D399", 0.45, "#047857", 0.8, "#34D399", 0.5, "#6EE7B7", 0.4),
    }
    MARKERS = {"flag": "#FCD34D", "dumbbell": "#C4B5FD", "heart": "#6EE7B7", "moon": "#94A3B8", "waves": "#7DF0FF"}

    def __init__(self, days: list[dict[str, Any]], tone: Tone):
        self.days, self.tone = days, tone
        self.water = "gym" if tone is GYM else "swim"

    def draw_at(self, c, x0: float, y0: float) -> None:
        width = (CONTENT_W - self.GAP * 6) / 7
        for index, day in enumerate(self.days):
            self._lane(c, x0 + index * (width + self.GAP), y0, width, self.H, day)

    def _lane(self, c, x: float, y: float, w: float, h: float, day: dict[str, Any]) -> None:
        radius = 4.6 * mm
        _round(c, x, y, w, h, radius, fill=mix(NIGHT, WHITE, 0.1))
        inset = 0.32 * mm
        ix, iy, iw, ih = x + inset, y + inset, w - 2 * inset, h - 2 * inset
        c.saveState()
        _clip_round(c, ix, iy, iw, ih, radius - inset)
        c.linearGradient(ix, iy + ih, ix, iy, (colors.HexColor("#0C141C"), NIGHT_DEEP), (0, 1), extend=True)
        c.restoreState()
        if day["amount"]:
            self._water(c, ix, iy, iw, ih, radius - inset, 0.14 + min(1.0, max(0.0, day["level"])) * 0.62, "done" if day["done"] else self.water)
        cx = x + w / 2
        draw(c, cx, y + h - 5.1 * mm, day["day"].strftime("%a").upper(), SEMIBOLD, 5.8, ON_NIGHT_MUTED, tracking=0.14, align="centre")
        draw(c, cx, y + h - 11.4 * mm, str(day["day"].day), BOLD, 14.5, FOREGROUND, align="centre")
        if day["amount"]:
            ink = colors.HexColor("#D1FAE5") if day["done"] else self.tone.light
            draw(c, cx, y + 8.3 * mm, day["amount"], BOLD, 8.6, ink, align="centre")
            draw(c, cx, y + 5.4 * mm, day["unit"], MEDIUM, 5.4, mix(NIGHT_DEEP, WHITE, 0.62), align="centre")
        else:
            draw(c, cx, y + 6.6 * mm, day["empty"], MEDIUM, 6.4, MUTED, align="centre")
        markers = day.get("markers") or []
        if markers:
            size, gap = 2.5 * mm, 1 * mm
            mx = cx - (len(markers) * size + (len(markers) - 1) * gap) / 2
            for name in markers:
                icon(c, name, mx, y + 1.5 * mm, size, colors.HexColor(self.MARKERS.get(name, "#CBD5E1")), stroke=2.2)
                mx += size + gap
        if day["done"]:
            _tick(c, x + 3.2 * mm, y + h - 3.2 * mm, 1.75 * mm, True)

    def _water(self, c, x: float, y: float, w: float, h: float, radius: float, fraction: float, kind: str) -> None:
        top_hex, top_alpha, bottom_hex, bottom_alpha, front_hex, front_alpha, back_hex, back_alpha = self.WATER[kind]
        level = y + h * fraction
        amp = 0.95 * mm
        c.saveState()
        _clip_round(c, x, y, w, h, radius)
        ground = colors.HexColor("#0A1118")

        def crest(base: float, phase: float):
            """The water's surface: two waves across the lane, as the app's wave paths (a period every half lane)."""
            path = c.beginPath()
            path.moveTo(x, y)
            path.lineTo(x, base)
            steps = 4
            for step in range(steps):
                x1 = x + w * step / steps
                x2 = x + w * (step + 1) / steps
                lift = amp if (step + phase) % 2 == 0 else -amp
                path.curveTo(x1 + (x2 - x1) / 3, base + lift * 1.33, x1 + (x2 - x1) * 2 / 3, base + lift * 1.33, x2, base)
            path.lineTo(x + w, y)
            path.close()
            return path

        c.setFillColor(mix(ground, colors.HexColor(back_hex), back_alpha))
        c.drawPath(crest(level + 0.35 * mm, 1), stroke=0, fill=1)
        c.clipPath(crest(level, 0), stroke=0, fill=0)
        c.linearGradient(x, level + amp, x, y, (mix(ground, colors.HexColor(front_hex), front_alpha), mix(ground, colors.HexColor(top_hex), top_alpha),
                                                 mix(NIGHT_DEEP, colors.HexColor(bottom_hex), bottom_alpha)), (0, 0.06, 1), extend=True)
        c.restoreState()


# ---------------------------------------------------------------- the body's parts
class _Stats(Flowable):
    """A row of the export's totals, each a card with its icon, as the app's stats: (label, value, unit, icon, Tone)."""

    H = 17.5 * mm

    def __init__(self, stats: list[tuple[str, str, str, str, Tone]]):
        super().__init__()
        self.stats = stats

    def wrap(self, *_):
        return CONTENT_W, self.H

    def draw(self):
        c = self.canv
        gap = 3 * mm
        width = (CONTENT_W - gap * (len(self.stats) - 1)) / len(self.stats)
        for index, (label, value, unit, glyph, tone) in enumerate(self.stats):
            x = index * (width + gap)
            _round(c, x, 0, width, self.H, 3.4 * mm, fill=WHITE, stroke=HAIR)
            square = 8.2 * mm
            sx, sy = x + 3.4 * mm, (self.H - square) / 2
            _round(c, sx, sy, square, square, 2.4 * mm, fill=tone.wash)
            icon(c, glyph, sx + 1.9 * mm, sy + 1.9 * mm, square - 3.8 * mm, tone.ink)
            tx = sx + square + 3 * mm
            room = x + width - tx - 3 * mm
            unit_w = tracked_width(unit, MEDIUM, 7.6) + 1.2 * mm if unit else 0
            size = 15
            while size > 11 and tracked_width(printable(value), BOLD, size, -0.02) + unit_w > room:
                size -= 1
            if tracked_width(printable(value), BOLD, size, -0.02) + unit_w <= room:
                vw = draw(c, tx, self.H / 2 + 0.2 * mm, value, BOLD, size, INK, tracking=-0.02)
                if unit:
                    draw(c, tx + vw + 0.6 * mm, self.H / 2 + 0.2 * mm, unit, MEDIUM, 7.6, MUTED)
                draw(c, tx, self.H / 2 - 4.6 * mm, _fit(label, MEDIUM, 7.1, room), MEDIUM, 7.1, MUTED)
            else:
                # A word for a value ("Sprint race-pace build"): two smaller lines over the label.
                lines = _wrap(value, SEMIBOLD, 9, room)
                lines = lines[:1] + ([_fit(" ".join(lines[1:]), SEMIBOLD, 9, room)] if len(lines) > 1 else [])
                for index, line in enumerate(lines):
                    draw(c, tx, self.H / 2 + (2.6 if len(lines) > 1 else 0.6) * mm - index * 3.6 * mm, line, SEMIBOLD, 9, INK)
                draw(c, tx, self.H / 2 - (5.6 if len(lines) > 1 else 4.6) * mm, _fit(label, MEDIUM, 7.1, room), MEDIUM, 7.1, MUTED)


class _Callout(Flowable):
    """A note on a wash of its tone (a coach's note, a goal, a warning), with its icon and label as the app's cards."""

    def __init__(self, label: str, body: str, tone: Tone, glyph: str = "info"):
        super().__init__()
        self.label, self.tone, self.glyph = label, tone, glyph
        self.para = Paragraph(_text(body), _style("callout", fontSize=9.2, leading=13.6, textColor=INK))

    def wrap(self, *_):
        _, self.para_h = self.para.wrap(CONTENT_W - 21 * mm, 400 * mm)
        self.height = max(self.para_h + 15.4 * mm, 17 * mm)
        return CONTENT_W, self.height

    def draw(self):
        c, h, tone = self.canv, self.height, self.tone
        _round(c, 0, 0, CONTENT_W, h, 3.6 * mm, fill=mix(WHITE, tone.solid, 0.045), stroke=mix(WHITE, tone.solid, 0.3))
        square = 8.2 * mm
        _round(c, 4.4 * mm, h - 4.4 * mm - square, square, square, 2.4 * mm, fill=mix(WHITE, tone.solid, 0.14))
        icon(c, self.glyph, 4.4 * mm + 1.9 * mm, h - 4.4 * mm - square + 1.9 * mm, square - 3.8 * mm, tone.ink)
        draw(c, 16.6 * mm, h - 7.6 * mm, self.label.upper(), SEMIBOLD, 6.6, tone.ink, tracking=0.16)
        self.para.drawOn(c, 16.6 * mm, h - 10.4 * mm - self.para_h)


class _SectionHeader(Flowable):
    """A section's title with its icon on a wash of its colour, a figure on the right, and a hairline under it."""

    H = 10.5 * mm

    def __init__(self, title: str, kind: str, meta: str, glyph: str | None = None):
        super().__init__()
        self.title, self.meta = title, meta
        self.color = colors.HexColor(kind if kind.startswith("#") else KIND.get(kind, KIND["custom"]))
        self.glyph = glyph or KIND_ICONS.get(kind, "list_checks")

    def wrap(self, *_):
        return CONTENT_W, self.H

    def draw(self):
        c = self.canv
        square = 6.8 * mm
        _round(c, 0, 2.3 * mm, square, square, 2 * mm, fill=mix(WHITE, self.color, 0.14))
        icon(c, self.glyph, 1.5 * mm, 2.3 * mm + 1.5 * mm, square - 3 * mm, mix(colors.black, self.color, 0.82))
        meta_w = tracked_width(self.meta, REGULAR, 8) + 4 * mm if self.meta else 0
        draw(c, square + 2.6 * mm, 3.9 * mm, _fit(self.title, SEMIBOLD, 12.2, CONTENT_W - square - meta_w - 4 * mm, -0.01), SEMIBOLD, 12.2, INK, tracking=-0.01)
        if self.meta:
            draw(c, CONTENT_W, 4.1 * mm, self.meta, REGULAR, 8, MUTED, align="right")
        c.saveState()
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.6)
        c.line(0, 0, CONTENT_W, 0)
        c.restoreState()


class _Exercise(Flowable):
    """One exercise: its number, name, prescription chips, rest and tempo, notes, and a ring to tick for every set."""

    def __init__(self, index: int, row: dict[str, Any], kind: str):
        super().__init__()
        self.index, self.row = index, row
        self.color = colors.HexColor(KIND.get(kind, KIND["custom"]))
        self.details = "  ·  ".join(part for part in [f"Rest {row['rest_seconds']}s", f"Tempo {printable(row['tempo'])}" if row.get("tempo") else ""] if part)
        self.name = Paragraph(_text(row["name"]), _style("name", fontName=SEMIBOLD, fontSize=10.6, leading=13.2, textColor=INK))
        self.notes = Paragraph(_text(row["notes"]), _style("notes", fontSize=8.3, leading=11.8, textColor=MUTED)) if row.get("notes") else None
        self.sets = max(1, min(int(row.get("sets") or 1), 12))
        self.text_w = CONTENT_W - 15 * mm - 50 * mm
        self.dose = _fit(f"{row['sets']} × {row['reps'] or '—'}", SEMIBOLD, 7.2, self.text_w * 0.62 - 11)
        load = row.get("load") if row.get("load") not in (None, "", "—") else ""
        self.load = _fit(load, SEMIBOLD, 7.2, self.text_w - _pill_w(self.dose, 7.2) - 4 - 11) if load else ""
        chips = _pill_w(self.dose, 7.2) + 4 + (_pill_w(self.load, 7.2) + 4 if self.load else 0)
        # Rest and tempo go on their own line when they don't fit beside the chips.
        self.details_below = bool(self.details) and chips + tracked_width(self.details, REGULAR, 7.8) + 2 > self.text_w

    def wrap(self, *_):
        _, name_h = self.name.wrap(self.text_w, 40 * mm)
        notes_h = self.notes.wrap(self.text_w, 80 * mm)[1] + 1.6 * mm if self.notes else 0
        self.name_h, self.notes_h = name_h, notes_h + (5 * mm if self.details_below else 0)
        rows = (self.sets - 1) // 6 + 1
        self.height = max(17.5 * mm, name_h + self.notes_h + 12.6 * mm, 12 * mm + rows * 6.4 * mm)
        return CONTENT_W, self.height + 2.4 * mm

    def draw(self):
        c, h = self.canv, self.height
        y0 = 2.4 * mm
        _round(c, 0, y0, CONTENT_W, h, 3.2 * mm, fill=WHITE, stroke=HAIR, width=0.7)
        c.setFillColor(self.color)
        c.circle(7 * mm, y0 + h - 7 * mm, 3.3 * mm, stroke=0, fill=1)
        draw(c, 7 * mm, y0 + h - 8.05 * mm, str(self.index), BOLD, 8.4, WHITE, align="centre")
        top = y0 + h - 4.3 * mm
        self.name.drawOn(c, 13 * mm, top - self.name_h)
        x, y = 13 * mm, top - self.name_h - 6.1 * mm
        x += _pill(c, x, y, self.dose, self.color, WHITE, size=7.2) + 4
        if self.load:
            x += _pill(c, x, y, self.load, TINT, INK, size=7.2, stroke=HAIR) + 4
        if self.details_below:
            y -= 5 * mm
            draw(c, 13 * mm, y + 4.4, _fit(self.details, REGULAR, 7.8, self.text_w), REGULAR, 7.8, MUTED)
        elif self.details:
            draw(c, x + 1, y + 4.4, self.details, REGULAR, 7.8, MUTED)
        if self.notes:
            self.notes.drawOn(c, 13 * mm, y - 1.6 * mm - self.notes.height)
        right = CONTENT_W - 5 * mm
        draw(c, right, y0 + h - 6.2 * mm, "SETS", SEMIBOLD, 5.8, FAINT, tracking=0.16, align="right")
        per_row = 6
        for set_index in range(self.sets):
            column, line = set_index % per_row, set_index // per_row
            in_line = min(per_row, self.sets - line * per_row)
            cx = right - (in_line - 1 - column) * 6.4 * mm - 2.3 * mm
            cy = y0 + h - 11.6 * mm - line * 6.4 * mm
            c.saveState()
            c.setStrokeColor(mix(WHITE, self.color, 0.7))
            c.setLineWidth(0.9)
            c.circle(cx, cy, 2.3 * mm, stroke=1, fill=0)
            c.restoreState()
            draw(c, cx, cy - 1.9, str(set_index + 1), MEDIUM, 5.6, FAINT, align="centre")


class _Notes(Flowable):
    """A section's notes, a line each, after a dot of its colour."""

    def __init__(self, text: str, color=None):
        super().__init__()
        self.color = color or SWIM.solid
        self.lines = [Paragraph(_text(line), _style("line", fontSize=9.2, leading=13.4, textColor=BODY)) for line in text.splitlines() if line.strip()]

    def wrap(self, *_):
        self.heights = [line.wrap(CONTENT_W - 7 * mm, 60 * mm)[1] for line in self.lines]
        self.height = sum(self.heights) + 1.2 * mm * len(self.lines)
        return CONTENT_W, self.height

    def draw(self):
        y = self.height
        for line, height in zip(self.lines, self.heights):
            y -= height
            self.canv.setFillColor(self.color)
            self.canv.circle(2 * mm, y + height - 4.2, 0.8 * mm, stroke=0, fill=1)
            line.drawOn(self.canv, 5.4 * mm, y)
            y -= 1.2 * mm


def build(hero: dict[str, Any], story: list[Any]) -> bytes:
    """The export's PDF: `story` under the dark header, continued on as many pages as it takes."""
    buffer = io.BytesIO()
    _Doc(buffer, hero).build([NextPageTemplate("later"), *story], canvasmaker=_NumberedCanvas)
    return buffer.getvalue()


def prepared_for(athlete: str | None) -> str | None:
    """"Prepared for <name>" when the name prints in full (never part of it, see pdf_brand.whole)."""
    name = whole(athlete)
    return f"Prepared for {name}" if name else None


def render_workout_pdf(item: dict[str, Any], sections: list[dict[str, Any]], *, kicker: str = "Strength & dryland workout",
                       pills: list[tuple[str, str]] | None = None, last_stat: tuple[str, str] | None = None) -> bytes:
    """A gym workout (or a Swim Week strength session): its totals, goal and reasons, then each section's exercises.
    `pills` replace the header's chips as (text, "violet" | "cyan" | "glass"); `last_stat` replaces the Intensity card."""
    workout = item["workout"]
    exercises = sum(len(section["exercises"]) for section in sections)
    sets = sum(row["sets"] for section in sections for row in section["exercises"])
    intensity = item.get("dose") or workout.get("intensity") or "Moderate"
    story: list[Any] = [_Stats([
        ("Exercises", str(exercises), "", "list_checks", GYM), ("Total sets", str(sets), "", "repeat", SKY),
        ("Duration", str(workout["estimated_duration_minutes"]), "min", "timer", AMBER),
        (*(last_stat or ("Intensity", intensity)), "", "gauge", MOBILITY),
    ]), Spacer(1, 6 * mm)]
    if workout.get("objective"):
        story += [_Callout("Goal", workout["objective"], SWIM, "target"), Spacer(1, 3 * mm)]
    if workout.get("rationale"):
        story += [_Callout("Why this workout", workout["rationale"], GYM, "lightbulb"), Spacer(1, 3 * mm)]
    for section in sections:
        section_sets = sum(row["sets"] for row in section["exercises"])
        count = len(section["exercises"])
        meta = f"{count} exercise{'s' if count != 1 else ''}  ·  {section_sets} sets" if count else ""
        kind = section.get("kind", "custom")
        body: list[Any] = []
        if section.get("notes", "").strip():
            body += [_Notes(section["notes"], colors.HexColor(KIND.get(kind, KIND["custom"]))), Spacer(1, 2.5 * mm)]
        body += [_Exercise(index, row, kind) for index, row in enumerate(section["exercises"], 1)]
        # The heading stays on the page of the first thing under it.
        head = [_SectionHeader(section["title"], kind, meta), Spacer(1, 3 * mm)]
        story += [Spacer(1, 4.5 * mm), KeepTogether(head + body[:1]), *body[1:]]
    if workout.get("coaching_notes"):
        story += [Spacer(1, 5 * mm), _Callout("Coach's notes", workout["coaching_notes"], AMBER, "message_square")]
    meta = workout.get("meta") or {}
    source = item.get("source")
    tones = {"violet": (GYM, "dumbbell"), "cyan": (SWIM, "waves"), "glass": (SLATE, "timer")}
    chips = [(text, *tones.get(tone, (SLATE, None))) for text, tone in pills] if pills else [
        (f"{intensity} intensity", GYM, "gauge"),
        ("Built by you" if source == "manual" else "From your coach" if source == "coach" else "AI coach plan", SWIM,
         "user_round" if source == "manual" else "message_square" if source == "coach" else "sparkles"),
        (f"{workout['estimated_duration_minutes']} min", SLATE, "timer"),
    ]
    hero = {
        "tone": GYM, "kicker": kicker, "date_line": date.fromisoformat(item["date"]).strftime("%A %d %B %Y"),
        "title": workout["title"], "subject": "Workout",
        "details": [part for part in [" – ".join(part for part in [meta.get("start_time"), meta.get("end_time")] if part),
                                      meta.get("label"), meta.get("location")] if part],
        "chips": chips,
    }
    return build(hero, story)
