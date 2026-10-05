"""Branded PDF export for Workout Library workouts (SwimGPT dark-ocean identity, print-friendly body)."""
from __future__ import annotations

import io
from datetime import date
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import BaseDocTemplate, Flowable, Frame, KeepTogether, NextPageTemplate, PageTemplate, Paragraph, Spacer

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
HERO_H = 82 * mm

NAVY = colors.HexColor("#070B10")
NAVY_2 = colors.HexColor("#0E1A24")
CYAN = colors.HexColor("#57E5EA")
CYAN_DARK = colors.HexColor("#0891B2")
VIOLET = colors.HexColor("#A78BFA")
VIOLET_DARK = colors.HexColor("#6D28D9")
INK = colors.HexColor("#0F172A")
BODY = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
HAIR = colors.HexColor("#E2E8F0")
TINT = colors.HexColor("#F6F8FB")
WHITE = colors.white
KIND = {
    "warmup": "#F97316", "activation": "#F59E0B", "main": "#7C3AED", "power": "#C026D3", "accessory": "#0EA5E9",
    "core": "#10B981", "conditioning": "#F43F5E", "mobility": "#14B8A6", "cooldown": "#06B6D4", "custom": "#64748B",
}


def _style(name: str, **kw) -> ParagraphStyle:
    return ParagraphStyle(name, **{"fontName": "Helvetica", "fontSize": 9.5, "leading": 13.5, "textColor": BODY, **kw})


def _text(value: Any) -> str:
    return escape(str(value)).replace("\n", "<br/>")


def _mix(color, amount: float):
    """`color` blended into the navy background (ReportLab gradients ignore alpha, so glows are pre-mixed)."""
    return colors.Color(NAVY.red + (color.red - NAVY.red) * amount, NAVY.green + (color.green - NAVY.green) * amount,
                        NAVY.blue + (color.blue - NAVY.blue) * amount)


def _glow(c: pdf_canvas.Canvas, x: float, y: float, radius: float, color, strength: float) -> None:
    """Soft radial glow that fades exactly into the navy background."""
    stops = [_mix(color, strength * factor) for factor in (1, 0.62, 0.3, 0.1, 0)]
    c.radialGradient(x, y, radius, stops, (0, 0.25, 0.5, 0.75, 1), extend=False)


def _clip(c: pdf_canvas.Canvas, x: float, y: float, w: float, h: float) -> None:
    """Restrict the next gradient fill to a rectangle (gradients otherwise paint the whole clip area)."""
    path = c.beginPath()
    path.rect(x, y, w, h)
    c.clipPath(path, stroke=0, fill=0)


def _logo(c: pdf_canvas.Canvas, x: float, y: float, size: float) -> None:
    """The SwimGPT mark: gradient rounded square with three white waves."""
    c.saveState()
    path = c.beginPath()
    path.roundRect(x, y, size, size, size * 0.26)
    c.clipPath(path, stroke=0, fill=0)
    c.linearGradient(x, y + size, x + size, y, (CYAN, colors.HexColor("#2DD4BF"), colors.HexColor("#1E3A8A")), (0, 0.55, 1), extend=True)
    c.restoreState()
    c.saveState()
    c.setStrokeColor(WHITE)
    c.setLineWidth(size * 0.075)
    c.setLineCap(1)
    for row in range(3):
        cy = y + size * (0.32 + row * 0.18)
        wave = c.beginPath()
        wave.moveTo(x + size * 0.2, cy)
        wave.curveTo(x + size * 0.33, cy + size * 0.07, x + size * 0.42, cy - size * 0.07, x + size * 0.5, cy)
        wave.curveTo(x + size * 0.58, cy + size * 0.07, x + size * 0.67, cy - size * 0.07, x + size * 0.8, cy)
        c.drawPath(wave, stroke=1, fill=0)
    c.restoreState()


def _wordmark(c: pdf_canvas.Canvas, x: float, y: float, size: float, color=WHITE) -> None:
    c.setFont("Helvetica-Bold", size)
    c.setFillColor(color)
    c.drawString(x, y, "Swim")
    c.setFillColor(CYAN)
    c.drawString(x + c.stringWidth("Swim", "Helvetica-Bold", size), y, "GPT")


def _pill_w(text: str, size: float) -> float:
    return stringWidth(text, "Helvetica-Bold", size) + 12


def _clip_text(text: str, width: float, size: float, font: str = "Helvetica-Bold") -> str:
    """Shorten `text` with an ellipsis so it fits `width` (pill text includes its padding)."""
    pad = 12 if font == "Helvetica-Bold" else 0
    if stringWidth(text, font, size) + pad <= width:
        return text
    while text and stringWidth(text + "…", font, size) + pad > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _pill(c: pdf_canvas.Canvas, x: float, y: float, text: str, fill, ink, size: float = 7.5, alpha: float = 1.0) -> float:
    width = c.stringWidth(text, "Helvetica-Bold", size) + 12
    c.saveState()
    c.setFillColor(fill)
    c.setFillAlpha(alpha)
    c.roundRect(x, y, width, size + 8, (size + 8) / 2, stroke=0, fill=1)
    c.restoreState()
    c.setFont("Helvetica-Bold", size)
    c.setFillColor(ink)
    c.drawString(x + 6, y + 4.6, text)
    return width


def _waves(c: pdf_canvas.Canvas, top: float, height: float) -> None:
    c.saveState()
    c.setStrokeColor(CYAN)
    c.setLineWidth(0.7)
    for index in range(7):
        c.setStrokeAlpha(0.05 + index * 0.012)
        base = top - height + 10 * mm + index * 4.2 * mm
        wave = c.beginPath()
        wave.moveTo(0, base)
        for step in range(6):
            x0 = step * PAGE_W / 6
            wave.curveTo(x0 + PAGE_W / 18, base + 5 + index, x0 + PAGE_W / 9, base - 5 - index, x0 + PAGE_W / 6, base)
        c.drawPath(wave, stroke=1, fill=0)
    c.restoreState()


class _Doc(BaseDocTemplate):
    """Branded document: full hero on page one, compact header on later pages, gradient footer on all.

    `hero` keys: kicker, date_line, title, details (list of strings), pills [(text, fill, ink, alpha)], compact, subject.
    """

    def __init__(self, buffer, hero: dict[str, Any]):
        super().__init__(buffer, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=20 * mm,
                         title=hero["title"], author="SwimGPT", subject=hero.get("subject", "Workout"))
        self.hero = hero
        first = Frame(MARGIN, 20 * mm, CONTENT_W, PAGE_H - HERO_H - 26 * mm, id="first", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        later = Frame(MARGIN, 20 * mm, CONTENT_W, PAGE_H - 44 * mm, id="later", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate("first", [first], onPage=self._hero), PageTemplate("later", [later], onPage=self._compact)])

    def _hero(self, c: pdf_canvas.Canvas, doc) -> None:
        hero = self.hero
        top = PAGE_H
        c.saveState()
        c.setFillColor(NAVY)
        c.rect(0, top - HERO_H, PAGE_W, HERO_H, stroke=0, fill=1)
        _clip(c, 0, top - HERO_H, PAGE_W, HERO_H)
        _glow(c, PAGE_W * 0.06, top - 4 * mm, 100 * mm, CYAN, 0.46)
        _glow(c, PAGE_W * 0.97, top - HERO_H - 4 * mm, 100 * mm, VIOLET, 0.55)
        c.restoreState()
        _waves(c, top, HERO_H)
        _logo(c, MARGIN, top - 17 * mm, 9 * mm)
        _wordmark(c, MARGIN + 12 * mm, top - 13.6 * mm, 13)
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(CYAN)
        c.drawRightString(PAGE_W - MARGIN, top - 11.5 * mm, hero["kicker"])
        c.setFont("Helvetica", 8.5)
        c.setFillColor(colors.HexColor("#94A3B8"))
        c.drawRightString(PAGE_W - MARGIN, top - 16 * mm, hero["date_line"])

        size = 26 if len(hero["title"]) <= 34 else 22 if len(hero["title"]) <= 60 else 18
        title = Paragraph(_text(hero["title"]), _style("hero", fontName="Helvetica-Bold", fontSize=size, leading=size * 1.12, textColor=WHITE))
        _, height = title.wrap(CONTENT_W * 0.92, 40 * mm)
        title.drawOn(c, MARGIN, top - 30 * mm - height)
        y = top - 37.5 * mm - height
        if hero.get("details"):
            c.setFont("Helvetica", 9.5)
            c.setFillColor(colors.HexColor("#CBD5E1"))
            c.drawString(MARGIN, y, "   ·   ".join(hero["details"]))
            y -= 9 * mm
        else:
            y -= 3 * mm
        x = MARGIN
        for text, fill, ink, alpha in hero["pills"]:
            x += _pill(c, x, y, text, fill, ink, alpha=alpha) + 5
        self._footer(c)

    def _compact(self, c: pdf_canvas.Canvas, doc) -> None:
        top = PAGE_H
        c.setFillColor(NAVY)
        c.rect(0, top - 18 * mm, PAGE_W, 18 * mm, stroke=0, fill=1)
        c.saveState()
        _clip(c, 0, top - 18 * mm, PAGE_W, 18 * mm)
        _glow(c, PAGE_W * 0.08, top - 2 * mm, 60 * mm, CYAN, 0.3)
        c.restoreState()
        _logo(c, MARGIN, top - 13 * mm, 7 * mm)
        _wordmark(c, MARGIN + 9.5 * mm, top - 10.6 * mm, 10.5)
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(WHITE)
        title = self.hero.get("compact") or self.hero["title"]
        c.drawRightString(PAGE_W - MARGIN, top - 10.6 * mm, title if len(title) < 60 else title[:57] + "…")
        self._footer(c)

    def _footer(self, c: pdf_canvas.Canvas) -> None:
        c.saveState()
        _clip(c, MARGIN, 13.7 * mm, CONTENT_W, 0.6 * mm)
        c.linearGradient(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm, (CYAN, VIOLET), (0, 1), extend=False)
        c.restoreState()
        _logo(c, MARGIN, 7.2 * mm, 4.4 * mm)
        c.setFont("Helvetica-Bold", 7.5)
        c.setFillColor(INK)
        c.drawString(MARGIN + 6.2 * mm, 8.6 * mm, "SwimGPT")
        c.setFont("Helvetica", 7.5)
        c.setFillColor(MUTED)
        c.drawString(MARGIN + 6.2 * mm + c.stringWidth("SwimGPT", "Helvetica-Bold", 7.5) + 2.2 * mm, 8.6 * mm, "·   Train smarter in and out of the pool")


class _NumberedCanvas(pdf_canvas.Canvas):
    """Adds "Page X of Y" once the total page count is known."""

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
            self.setFont("Helvetica", 7.5)
            self.setFillColor(MUTED)
            self.drawRightString(PAGE_W - MARGIN, 8.6 * mm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


class _Stats(Flowable):
    def __init__(self, stats: list[tuple[str, str, str]]):
        super().__init__()
        self.stats = stats

    def wrap(self, *_):
        return CONTENT_W, 21 * mm

    def draw(self):
        c = self.canv
        gap = 3.5 * mm
        width = (CONTENT_W - gap * (len(self.stats) - 1)) / len(self.stats)
        for index, (label, value, unit) in enumerate(self.stats):
            x = index * (width + gap)
            c.setFillColor(TINT)
            c.setStrokeColor(HAIR)
            c.setLineWidth(0.6)
            c.roundRect(x, 0, width, 21 * mm, 3.5 * mm, stroke=1, fill=1)
            c.setFillColor([CYAN_DARK, VIOLET_DARK, colors.HexColor("#D97706"), colors.HexColor("#059669")][index % 4])
            c.roundRect(x + 4 * mm, 21 * mm - 5.5 * mm, 7 * mm, 1.3 * mm, 0.65 * mm, stroke=0, fill=1)
            c.setFont("Helvetica-Bold", 6.8)
            c.setFillColor(MUTED)
            c.drawString(x + 4 * mm, 21 * mm - 9.5 * mm, label.upper())
            c.setFont("Helvetica-Bold", 17)
            c.setFillColor(INK)
            c.drawString(x + 4 * mm, 4.6 * mm, value)
            if unit:
                c.setFont("Helvetica", 8.5)
                c.setFillColor(MUTED)
                c.drawString(x + 4 * mm + c.stringWidth(value, "Helvetica-Bold", 17) + 1.4 * mm, 4.6 * mm, unit)


class _Callout(Flowable):
    def __init__(self, label: str, body: str, accent):
        super().__init__()
        self.label, self.accent = label, accent
        self.para = Paragraph(_text(body), _style("callout", fontSize=9.5, leading=14, textColor=INK))

    def wrap(self, *_):
        _, height = self.para.wrap(CONTENT_W - 14 * mm, 200 * mm)
        self.height = height + 13 * mm
        return CONTENT_W, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(TINT)
        c.roundRect(0, 0, CONTENT_W, self.height, 3 * mm, stroke=0, fill=1)
        c.setFillColor(self.accent)
        c.roundRect(0, 0, 1.4 * mm, self.height, 0.7 * mm, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 6.8)
        c.drawString(6 * mm, self.height - 6 * mm, self.label.upper())
        self.para.drawOn(c, 6 * mm, 4.5 * mm)


class _SectionHeader(Flowable):
    def __init__(self, title: str, kind: str, meta: str):
        super().__init__()
        self.title, self.meta = title, meta
        self.color = colors.HexColor(kind if kind.startswith("#") else KIND.get(kind, KIND["custom"]))

    def wrap(self, *_):
        return CONTENT_W, 10 * mm

    def draw(self):
        c = self.canv
        c.setFillColor(self.color)
        c.roundRect(0, 2.6 * mm, 3.2 * mm, 3.2 * mm, 0.9 * mm, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 12.5)
        c.setFillColor(INK)
        c.drawString(5.6 * mm, 2.5 * mm, self.title.upper())
        if self.meta:
            c.setFont("Helvetica", 8)
            c.setFillColor(MUTED)
            c.drawRightString(CONTENT_W, 2.8 * mm, self.meta)
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.6)
        c.line(0, 0, CONTENT_W, 0)


class _Exercise(Flowable):
    """One exercise card: number, name, prescription chips, notes and a tick circle per set."""

    def __init__(self, index: int, row: dict[str, Any], kind: str):
        super().__init__()
        self.index, self.row = index, row
        self.color = colors.HexColor(KIND.get(kind, KIND["custom"]))
        details = " · ".join(part for part in [f"Rest {row['rest_seconds']}s", f"Tempo {row['tempo']}" if row.get("tempo") else ""] if part)
        self.name = Paragraph(_text(row["name"]), _style("name", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=INK))
        self.notes = Paragraph(_text(row["notes"]), _style("notes", fontSize=8.5, leading=12, textColor=MUTED)) if row.get("notes") else None
        self.details = details
        self.sets = max(1, min(int(row.get("sets") or 1), 12))
        self.text_w = CONTENT_W - 16 * mm - 52 * mm
        self.dose = _clip_text(f"{row['sets']} × {row['reps'] or '—'}", self.text_w * 0.62, 7.5)
        load = row.get("load") if row.get("load") not in (None, "", "—") else ""
        self.load = _clip_text(load, self.text_w - _pill_w(self.dose, 7.5) - 4, 7.5) if load else ""
        pills = _pill_w(self.dose, 7.5) + 4 + (_pill_w(self.load, 7.5) + 4 if self.load else 0)
        # Rest/tempo move to their own line when they do not fit beside the chips.
        self.details_below = bool(details) and pills + stringWidth(details, "Helvetica", 7.8) + 2 > self.text_w

    def wrap(self, *_):
        _, name_h = self.name.wrap(self.text_w, 40 * mm)
        notes_h = self.notes.wrap(self.text_w, 80 * mm)[1] + 1.5 * mm if self.notes else 0
        self.name_h, self.notes_h = name_h, notes_h + (5.2 * mm if self.details_below else 0)
        self.height = max(18 * mm, name_h + self.notes_h + 13 * mm)
        return CONTENT_W, self.height + 2.4 * mm

    def draw(self):
        c, h = self.canv, self.height
        y0 = 2.4 * mm
        c.setFillColor(WHITE)
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.7)
        c.roundRect(0, y0, CONTENT_W, h, 3 * mm, stroke=1, fill=1)
        c.setFillColor(self.color)
        c.circle(7 * mm, y0 + h - 7 * mm, 3.4 * mm, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 8.5)
        c.setFillColor(WHITE)
        c.drawCentredString(7 * mm, y0 + h - 8.1 * mm, str(self.index))
        top = y0 + h - 4.2 * mm
        self.name.drawOn(c, 13 * mm, top - self.name_h)
        x, y = 13 * mm, top - self.name_h - 6.2 * mm
        x += _pill(c, x, y, self.dose, self.color, WHITE, size=7.5) + 4
        if self.load:
            x += _pill(c, x, y, self.load, TINT, INK, size=7.5) + 4
        c.setFont("Helvetica", 7.8)
        c.setFillColor(MUTED)
        if self.details_below:
            y -= 5.2 * mm
            c.drawString(13 * mm, y + 4.6, _clip_text(self.details, self.text_w, 7.8, "Helvetica"))
        else:
            c.drawString(x + 1, y + 4.6, self.details)
        if self.notes:
            self.notes.drawOn(c, 13 * mm, y - 1.5 * mm - self.notes.height)
        # Set tracker
        right = CONTENT_W - 5 * mm
        c.setFont("Helvetica-Bold", 6.3)
        c.setFillColor(MUTED)
        c.drawRightString(right, y0 + h - 6 * mm, "SETS")
        per_row = 6
        for set_index in range(self.sets):
            col, line = set_index % per_row, set_index // per_row
            in_line = min(per_row, self.sets - line * per_row)
            cx = right - (in_line - 1 - col) * 6.6 * mm - 2.3 * mm
            cy = y0 + h - 11.5 * mm - line * 6.6 * mm
            c.setStrokeColor(self.color)
            c.setLineWidth(0.9)
            c.circle(cx, cy, 2.3 * mm, stroke=1, fill=0)
            c.setFont("Helvetica", 5.5)
            c.setFillColor(MUTED)
            c.drawCentredString(cx, cy - 1.9, str(set_index + 1))


class _Notes(Flowable):
    def __init__(self, text: str):
        super().__init__()
        self.lines = [Paragraph(_text(line), _style("line", fontSize=9.5, leading=13.5, textColor=BODY)) for line in text.splitlines() if line.strip()]

    def wrap(self, *_):
        self.heights = [line.wrap(CONTENT_W - 7 * mm, 60 * mm)[1] for line in self.lines]
        self.height = sum(self.heights) + 1.2 * mm * len(self.lines)
        return CONTENT_W, self.height

    def draw(self):
        y = self.height
        for line, height in zip(self.lines, self.heights):
            y -= height
            self.canv.setFillColor(CYAN_DARK)
            self.canv.circle(2 * mm, y + height - 4.3, 0.8 * mm, stroke=0, fill=1)
            line.drawOn(self.canv, 5.5 * mm, y)
            y -= 1.2 * mm


def render_workout_pdf(item: dict[str, Any], sections: list[dict[str, Any]], *, kicker: str = "STRENGTH & DRYLAND WORKOUT",
                       pills: list[tuple[str, str]] | None = None, last_stat: tuple[str, str] | None = None) -> bytes:
    """`pills` override the hero chips as (text, "violet" | "cyan" | "glass"); `last_stat` replaces the Intensity card."""
    workout = item["workout"]
    exercises = sum(len(section["exercises"]) for section in sections)
    sets = sum(row["sets"] for section in sections for row in section["exercises"])
    story: list[Any] = [NextPageTemplate("later"), Spacer(1, 2 * mm), _Stats([
        ("Exercises", str(exercises), ""), ("Total sets", str(sets), ""),
        ("Duration", str(workout["estimated_duration_minutes"]), "min"),
        (*(last_stat or ("Intensity", item.get("dose") or workout.get("intensity") or "—")), ""),
    ]), Spacer(1, 6 * mm)]
    if workout.get("objective"):
        story += [_Callout("Goal", workout["objective"], CYAN_DARK), Spacer(1, 3 * mm)]
    if workout.get("rationale"):
        story += [_Callout("Why this workout", workout["rationale"], VIOLET_DARK), Spacer(1, 3 * mm)]
    for section in sections:
        section_sets = sum(row["sets"] for row in section["exercises"])
        meta = f"{len(section['exercises'])} exercise{'s' if len(section['exercises']) != 1 else ''}  ·  {section_sets} sets" if section["exercises"] else ""
        body: list[Any] = []
        if section.get("notes", "").strip():
            body += [_Notes(section["notes"]), Spacer(1, 2.5 * mm)]
        body += [_Exercise(index, row, section.get("kind", "custom")) for index, row in enumerate(section["exercises"], 1)]
        # Keep the heading on the same page as the first block of its content.
        head = [_SectionHeader(section["title"], section.get("kind", "custom"), meta), Spacer(1, 3 * mm)]
        story += [Spacer(1, 4 * mm), KeepTogether(head + body[:1]), *body[1:]]
    if workout.get("coaching_notes"):
        story += [Spacer(1, 5 * mm), _Callout("Coach's notes", workout["coaching_notes"], colors.HexColor("#D97706"))]
    buffer = io.BytesIO()
    meta = workout.get("meta") or {}
    hero = {
        "kicker": kicker, "date_line": date.fromisoformat(item["date"]).strftime("%A %d %B %Y"),
        "title": workout["title"], "subject": "Workout",
        "details": [part for part in [" – ".join(part for part in [meta.get("start_time"), meta.get("end_time")] if part),
                                      meta.get("label"), meta.get("location")] if part],
        "pills": [{"violet": (text, VIOLET, NAVY, 1), "cyan": (text, CYAN, NAVY, 1), "glass": (text, WHITE, WHITE, 0.12)}[tone] for text, tone in pills] if pills else [
            ((item.get("dose") or workout.get("intensity") or "Moderate").upper() + " INTENSITY", VIOLET, NAVY, 1),
            ("BUILT BY YOU" if item.get("source") == "manual" else "AI COACH PLAN", CYAN, NAVY, 1),
            (f"{workout['estimated_duration_minutes']} MIN", WHITE, WHITE, 0.12)],
    }
    _Doc(buffer, hero).build(story, canvasmaker=_NumberedCanvas)
    return buffer.getvalue()
