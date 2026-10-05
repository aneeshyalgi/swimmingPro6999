"""Branded whole-week PDF exports: the swim Training Week and the Workout Library week."""
from __future__ import annotations

import io
import math
from datetime import date, timedelta
from typing import Any, Callable

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Flowable, KeepTogether, NextPageTemplate, PageBreak, Paragraph, Spacer

from app.workout_pdf import (
    BODY, CONTENT_W, CYAN, CYAN_DARK, HAIR, INK, KIND, MUTED, NAVY, TINT, VIOLET, VIOLET_DARK, WHITE,
    _Callout, _Doc, _Exercise, _Notes, _NumberedCanvas, _SectionHeader, _Stats, _pill, _style, _text,
)

EMERALD = colors.HexColor("#10B981")
ORANGE = colors.HexColor("#F97316")
SLATE = colors.HexColor("#94A3B8")
CHIP = colors.HexColor("#E8EDF3")
# Same zone palette as the app's ZoneChip.
ZONE_COLORS = [(("recovery",), "#0EA5E9"), (("race",), "#F97316"), (("sprint",), "#D946EF"),
               (("vo2", "high aerobic"), "#F59E0B"), (("threshold",), "#10B981"), (("aerobic", "endurance"), "#06B6D4")]


def zone_color(zone: str):
    value = zone.lower()
    return colors.HexColor(next((tone for needles, tone in ZONE_COLORS if any(needle in value for needle in needles)), "#94A3B8"))


def _fit(text: str, font: str, size: float, width: float) -> str:
    if stringWidth(text, font, size) <= width:
        return text
    while text and stringWidth(text + "…", font, size) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _range_label(start: date) -> str:
    end = start + timedelta(days=6)
    if start.year != end.year:
        return f"{start.day} {start:%b %Y} – {end.day} {end:%b %Y}"
    if start.month != end.month:
        return f"{start.day} {start:%b} – {end.day} {end:%b %Y}"
    return f"{start.day} – {end.day} {end:%B %Y}"


def _hours(minutes: int) -> tuple[str, str]:
    return (f"{minutes / 60:.1f}".rstrip("0").rstrip("."), "hours") if minutes >= 60 else (str(minutes), "min")


def _tick(c, cx: float, cy: float, r: float, done: bool) -> None:
    """A tick-off circle: filled green with a check when done, an empty ring to tick by hand otherwise."""
    if done:
        c.setFillColor(EMERALD)
        c.circle(cx, cy, r, stroke=0, fill=1)
        c.saveState()
        c.setStrokeColor(WHITE)
        c.setLineWidth(r * 0.3)
        c.setLineCap(1)
        c.setLineJoin(1)
        path = c.beginPath()
        path.moveTo(cx - r * 0.45, cy + r * 0.02)
        path.lineTo(cx - r * 0.12, cy - r * 0.33)
        path.lineTo(cx + r * 0.48, cy + r * 0.36)
        c.drawPath(path, stroke=1, fill=0)
        c.restoreState()
    else:
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.setLineWidth(0.9)
        c.circle(cx, cy, r, stroke=1, fill=0)


def _right_pill(c, right: float, y: float, text: str, fill, ink, size: float = 6.8) -> float:
    width = stringWidth(text, "Helvetica-Bold", size) + 12
    _pill(c, right - width, y, text, fill, ink, size=size)
    return width


# ---------------------------------------------------------------- flowables
class _Glance(Flowable):
    """Seven day tiles: weekday, date, a load bar, headline and completion state."""

    H = 34 * mm

    def __init__(self, cells: list[dict[str, Any]]):
        super().__init__()
        self.cells = cells

    def wrap(self, *_):
        return CONTENT_W, self.H

    def draw(self):
        c, h = self.canv, self.H
        gap = 2.4 * mm
        w = (CONTENT_W - gap * 6) / 7
        for index, cell in enumerate(self.cells):
            x = index * (w + gap)
            accent = cell["accent"]
            c.setFillColor(TINT)
            c.setStrokeColor(HAIR)
            c.setLineWidth(0.6)
            c.roundRect(x, 0, w, h, 3 * mm, stroke=1, fill=1)
            c.setFont("Helvetica-Bold", 6.5)
            c.setFillColor(MUTED)
            c.drawString(x + 3 * mm, h - 6 * mm, cell["day"].strftime("%a").upper())
            c.setFont("Helvetica-Bold", 16)
            c.setFillColor(INK)
            c.drawString(x + 3 * mm, h - 13.5 * mm, str(cell["day"].day))
            if cell["done"] is not None:
                _tick(c, x + w - 4.4 * mm, h - 5 * mm, 2 * mm, cell["done"])
            # Load bar: the day's share of the busiest day.
            bar_w = w - 6 * mm
            c.setFillColor(HAIR)
            c.roundRect(x + 3 * mm, h - 18.2 * mm, bar_w, 1.3 * mm, 0.65 * mm, stroke=0, fill=1)
            if cell["load"] > 0:
                c.setFillColor(accent)
                c.roundRect(x + 3 * mm, h - 18.2 * mm, max(1.6 * mm, bar_w * cell["load"]), 1.3 * mm, 0.65 * mm, stroke=0, fill=1)
            c.setFont("Helvetica-Bold", 8)
            c.setFillColor(INK if cell["load"] > 0 else MUTED)
            c.drawString(x + 3 * mm, h - 24 * mm, _fit(cell["headline"], "Helvetica-Bold", 8, w - 5 * mm))
            c.setFont("Helvetica", 6.8)
            c.setFillColor(MUTED)
            c.drawString(x + 3 * mm, h - 28.4 * mm, _fit(cell["sub"], "Helvetica", 6.8, w - 5 * mm))


class _ZoneBar(Flowable):
    """Stacked distribution bar with a three-column legend."""

    def __init__(self, entries: list[tuple[str, int]]):
        super().__init__()
        self.entries = sorted([entry for entry in entries if entry[1] > 0], key=lambda entry: -entry[1])
        self.total = sum(meters for _, meters in self.entries) or 1

    def wrap(self, *_):
        self.height = 4 * mm + 3 * mm + math.ceil(len(self.entries) / 3) * 5.6 * mm
        return CONTENT_W, self.height

    def draw(self):
        c, h = self.canv, self.height
        bar_y = h - 3.4 * mm
        c.saveState()
        path = c.beginPath()
        path.roundRect(0, bar_y, CONTENT_W, 3.4 * mm, 1.7 * mm)
        c.clipPath(path, stroke=0, fill=0)
        c.setFillColor(HAIR)
        c.rect(0, bar_y, CONTENT_W, 3.4 * mm, stroke=0, fill=1)
        x = 0.0
        for label, meters in self.entries:
            width = CONTENT_W * meters / self.total
            c.setFillColor(zone_color(label))
            c.rect(x, bar_y, max(0, width - 0.5), 3.4 * mm, stroke=0, fill=1)
            x += width
        c.restoreState()
        column = CONTENT_W / 3
        for index, (label, meters) in enumerate(self.entries):
            x, y = (index % 3) * column, bar_y - 6.5 * mm - (index // 3) * 5.6 * mm
            c.setFillColor(zone_color(label))
            c.circle(x + 1.3 * mm, y + 1.1 * mm, 1.3 * mm, stroke=0, fill=1)
            c.setFont("Helvetica-Bold", 8)
            c.setFillColor(INK)
            c.drawString(x + 4 * mm, y, label)
            c.setFont("Helvetica", 7.8)
            c.setFillColor(MUTED)
            c.drawString(x + 4 * mm + stringWidth(label, "Helvetica-Bold", 8) + 2 * mm, y,
                         f"{meters:,} m  ·  {round(meters / self.total * 100)}%")


class _DayHeader(Flowable):
    """Navy date badge, weekday, objective, day totals and a status chip."""

    H = 16 * mm

    def __init__(self, day: date, objective: str, meta: str, status: tuple[str, Any, Any] | None):
        super().__init__()
        self.day, self.objective, self.meta, self.status = day, objective, meta, status

    def wrap(self, *_):
        return CONTENT_W, self.H

    def draw(self):
        c = self.canv
        c.setFillColor(NAVY)
        c.roundRect(0, 3 * mm, 12.5 * mm, 12.5 * mm, 3 * mm, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 6)
        c.setFillColor(CYAN)
        c.drawCentredString(6.25 * mm, 11.6 * mm, self.day.strftime("%a").upper())
        c.setFont("Helvetica-Bold", 13)
        c.setFillColor(WHITE)
        c.drawCentredString(6.25 * mm, 5.5 * mm, str(self.day.day))
        name = self.day.strftime("%A")
        c.setFont("Helvetica-Bold", 13.5)
        c.setFillColor(INK)
        c.drawString(16 * mm, 10.2 * mm, name)
        c.setFont("Helvetica", 8.5)
        c.setFillColor(MUTED)
        c.drawString(16 * mm + stringWidth(name, "Helvetica-Bold", 13.5) + 2.5 * mm, 10.3 * mm, f"{self.day.day} {self.day:%B}")
        c.setFont("Helvetica", 8.5)
        c.setFillColor(BODY)
        c.drawString(16 * mm, 4.8 * mm, _fit(self.objective, "Helvetica", 8.5, CONTENT_W - 16 * mm - 48 * mm))
        if self.meta:
            c.setFont("Helvetica-Bold", 8)
            c.setFillColor(INK)
            c.drawRightString(CONTENT_W, 10.3 * mm, self.meta)
        if self.status:
            _right_pill(c, CONTENT_W, 3.2 * mm, *self.status)
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.6)
        c.line(0, 0, CONTENT_W, 0)


class _SessionCard(Flowable):
    """Session headline card (swim, workout or strength): kicker, title, chips, objective and a tick circle."""

    def __init__(self, kicker: str, title: str, pills: list[tuple[str, Any, Any]], body: str, accent, done: bool):
        super().__init__()
        self.kicker, self.pills, self.accent, self.done = kicker, pills, accent, done
        self.title = Paragraph(_text(title), _style("card-title", fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=INK))
        self.body = Paragraph(_text(body), _style("card-body", fontSize=8.8, leading=12.5, textColor=BODY)) if body else None

    def wrap(self, *_):
        width = CONTENT_W - 12 * mm - 32 * mm
        self.title_h = self.title.wrap(width, 60 * mm)[1]
        self.body_h = self.body.wrap(CONTENT_W - 12 * mm, 80 * mm)[1] + 2.5 * mm if self.body else 0
        self.height = 8 * mm + self.title_h + 8.5 * mm + self.body_h + 1.5 * mm
        return CONTENT_W, self.height + 2.4 * mm

    def draw(self):
        c, y0 = self.canv, 2.4 * mm
        h = self.height
        c.saveState()
        path = c.beginPath()
        path.roundRect(0, y0, CONTENT_W, h, 3 * mm)
        c.clipPath(path, stroke=0, fill=0)
        c.setFillColor(TINT)
        c.rect(0, y0, CONTENT_W, h, stroke=0, fill=1)
        c.setFillColor(self.accent)
        c.rect(0, y0, 1.5 * mm, h, stroke=0, fill=1)
        c.restoreState()
        top = y0 + h
        c.setFont("Helvetica-Bold", 6.8)
        c.setFillColor(self.accent)
        c.drawString(6 * mm, top - 5.6 * mm, _fit(self.kicker.upper(), "Helvetica-Bold", 6.8, CONTENT_W - 52 * mm))
        self.title.drawOn(c, 6 * mm, top - 7.2 * mm - self.title_h)
        x, y = 6 * mm, top - 7.2 * mm - self.title_h - 6.6 * mm
        for text, fill, ink in self.pills:
            x += _pill(c, x, y, text, fill, ink, size=7) + 4
        if self.body:
            self.body.drawOn(c, 6 * mm, y0 + 3.5 * mm)
        _tick(c, CONTENT_W - 6.5 * mm, top - 6.5 * mm, 2.7 * mm, self.done)
        c.setFont("Helvetica-Bold", 6.3)
        c.setFillColor(EMERALD if self.done else MUTED)
        c.drawRightString(CONTENT_W - 11 * mm, top - 7.6 * mm, "COMPLETED" if self.done else "TICK WHEN DONE")


class _SetRow(Flowable):
    """One swim set: prescription, zone, interval/target, description, equipment and focus."""

    def __init__(self, item: dict[str, Any]):
        super().__init__()
        self.item = item
        self.color = zone_color(item["training_zone"])
        reps = f"{item['repetitions']} × {item['distance_meters']} m" if item["repetitions"] > 1 else f"{item['distance_meters']} m"
        self.prescription = f"{item['rounds']} × ({reps})" if item["rounds"] > 1 else reps
        self.meters = item["rounds"] * item["repetitions"] * item["distance_meters"]
        self.info = "  ·  ".join(part for part in [item["name"], item["stroke"], item["interval"] if item["interval"][:1].isalpha() else f"@ {item['interval']}",
                                                    f"Target {item['target_time']}" if item.get("target_time") else ""] if part)
        self.desc = Paragraph(_text(item["description"]), _style("set-desc", fontSize=8.5, leading=12, textColor=BODY))
        extras = []
        if item.get("equipment"):
            extras.append(f"<font name='Helvetica-Bold' color='#334155'>Equipment</font>&nbsp; {_text(', '.join(item['equipment']))}")
        if item.get("technical_focus"):
            extras.append(f"<font name='Helvetica-Bold' color='#334155'>Focus</font>&nbsp; {_text(', '.join(item['technical_focus']))}")
        self.extra = Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;".join(extras), _style("set-extra", fontSize=7.5, leading=10.5, textColor=MUTED)) if extras else None

    def wrap(self, *_):
        width = CONTENT_W - 10 * mm
        self.desc_h = self.desc.wrap(width, 80 * mm)[1]
        self.extra_h = self.extra.wrap(width, 40 * mm)[1] + 1.4 * mm if self.extra else 0
        self.height = 13 * mm + self.desc_h + self.extra_h + 3.2 * mm
        return CONTENT_W, self.height + 2 * mm

    def draw(self):
        c, y0 = self.canv, 2 * mm
        h = self.height
        c.saveState()
        path = c.beginPath()
        path.roundRect(0, y0, CONTENT_W, h, 2.6 * mm)
        c.clipPath(path, stroke=0, fill=0)
        c.setFillColor(WHITE)
        c.rect(0, y0, CONTENT_W, h, stroke=0, fill=1)
        c.setFillColor(self.color)
        c.rect(0, y0, 1.3 * mm, h, stroke=0, fill=1)
        c.restoreState()
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.7)
        c.roundRect(0, y0, CONTENT_W, h, 2.6 * mm, stroke=1, fill=0)
        top = y0 + h
        c.setFont("Helvetica-Bold", 10.5)
        c.setFillColor(INK)
        c.drawString(5.5 * mm, top - 6.2 * mm, self.prescription)
        meters = f"{self.meters:,} m"
        c.setFont("Helvetica-Bold", 9.5)
        c.drawRightString(CONTENT_W - 4.5 * mm, top - 6.2 * mm, meters)
        _right_pill(c, CONTENT_W - 4.5 * mm - stringWidth(meters, "Helvetica-Bold", 9.5) - 3 * mm, top - 6.2 * mm - 4.6,
                    self.item["training_zone"].upper(), self.color, WHITE)
        c.setFont("Helvetica", 7.8)
        c.setFillColor(MUTED)
        c.drawString(5.5 * mm, top - 10.6 * mm, _fit(self.info, "Helvetica", 7.8, CONTENT_W - 10 * mm))
        self.desc.drawOn(c, 5.5 * mm, top - 12.6 * mm - self.desc_h)
        if self.extra:
            self.extra.drawOn(c, 5.5 * mm, top - 12.6 * mm - self.desc_h - self.extra_h)


class _SubHead(Flowable):
    """Small in-day heading with an optional tick circle (mobility, recovery, workout sections)."""

    H = 9 * mm

    def __init__(self, label: str, color, right: str = "", done: bool | None = None):
        super().__init__()
        self.label, self.color, self.right, self.done = label, color, right, done

    def wrap(self, *_):
        return CONTENT_W, self.H

    def draw(self):
        c = self.canv
        c.setFillColor(self.color)
        c.roundRect(0, 2.6 * mm, 2.6 * mm, 2.6 * mm, 0.7 * mm, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(INK)
        c.drawString(4.6 * mm, 2.7 * mm, self.label.upper())
        right = CONTENT_W
        if self.done is not None:
            _tick(c, CONTENT_W - 2.3 * mm, 3.9 * mm, 2.2 * mm, self.done)
            right -= 7 * mm
        if self.right:
            c.setFont("Helvetica", 7.8)
            c.setFillColor(MUTED)
            c.drawRightString(right, 2.9 * mm, self.right)
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.5)
        c.line(0, 0.6 * mm, CONTENT_W, 0.6 * mm)


class _Bullets(Flowable):
    """Bulleted rich-text lines (mobility drills, recovery actions)."""

    def __init__(self, lines: list[str], color=CYAN_DARK):
        super().__init__()
        self.color = color
        self.lines = [Paragraph(line, _style("bullet", fontSize=8.8, leading=12.5, textColor=BODY)) for line in lines]

    def wrap(self, *_):
        self.heights = [line.wrap(CONTENT_W - 6 * mm, 60 * mm)[1] for line in self.lines]
        self.height = sum(self.heights) + 1.6 * mm * len(self.lines)
        return CONTENT_W, self.height

    def draw(self):
        y = self.height
        for line, height in zip(self.lines, self.heights):
            y -= height
            self.canv.setFillColor(self.color)
            self.canv.circle(1.8 * mm, y + height - 4.1, 0.8 * mm, stroke=0, fill=1)
            line.drawOn(self.canv, 5 * mm, y)
            y -= 1.6 * mm


class _Quiet(Flowable):
    """Muted one-line note for an empty day."""

    def __init__(self, text: str):
        super().__init__()
        self.text = text

    def wrap(self, *_):
        return CONTENT_W, 9 * mm

    def draw(self):
        c = self.canv
        c.setDash(2, 2)
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.setLineWidth(0.7)
        c.roundRect(0, 0, CONTENT_W, 9 * mm, 2.6 * mm, stroke=1, fill=0)
        c.setDash()
        c.setFont("Helvetica", 8.5)
        c.setFillColor(MUTED)
        c.drawString(5 * mm, 3.4 * mm, self.text)


class _Reflection(Flowable):
    """End-of-week prompts with ruled lines for handwritten notes."""

    PROMPTS = ["How did the week feel overall?", "Wins, best sets and personal bests", "What should change next week?"]

    def wrap(self, *_):
        self.height = 13 * mm + len(self.PROMPTS) * 20 * mm
        return CONTENT_W, self.height

    def draw(self):
        c, h = self.canv, self.height
        c.setFillColor(TINT)
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.6)
        c.roundRect(0, 0, CONTENT_W, h, 3.5 * mm, stroke=1, fill=1)
        c.setFont("Helvetica-Bold", 6.8)
        c.setFillColor(VIOLET_DARK)
        c.drawString(6 * mm, h - 7 * mm, "WEEK REFLECTION")
        for index, prompt in enumerate(self.PROMPTS):
            y = h - 15 * mm - index * 20 * mm
            c.setFont("Helvetica-Bold", 8.8)
            c.setFillColor(INK)
            c.drawString(6 * mm, y, prompt)
            c.setStrokeColor(colors.HexColor("#CBD5E1"))
            c.setLineWidth(0.5)
            for line in range(2):
                c.line(6 * mm, y - 7 * mm - line * 6.5 * mm, CONTENT_W - 6 * mm, y - 7 * mm - line * 6.5 * mm)


# ---------------------------------------------------------------- shared builders
class _Glue(list):
    """Flowables that must stay on one page (turned into a single, non-nested KeepTogether)."""


def _lead(heading: list[Flowable], items: list[Flowable]) -> list[Any]:
    """A heading glued to its first item, followed by the remaining items."""
    return [_Glue(heading + items[:1]), *items[1:]]


def _day_block(header: Flowable, body: list[Any]) -> list[Flowable]:
    """Day header kept on the same page as the first item of the day."""
    first = list(body[0]) if isinstance(body[0], _Glue) else [body[0]]
    rest = [KeepTogether(list(item)) if isinstance(item, _Glue) else item for item in body[1:]]
    return [Spacer(1, 7 * mm), KeepTogether([header, Spacer(1, 3 * mm), *first]), *rest]


def _short_focus(focus: str) -> str:
    """"Upper-body pull strength and core (lats...)" -> "Upper-body pull strength"."""
    for marker in [" (", ",", " and ", " plus ", " + ", ":"]:
        focus = focus.split(marker)[0]
    return focus.strip().capitalize()


def _hero(kicker: str, start: date, name: str, details: list[str], pills: list[tuple[str, Any, Any, float]]) -> dict[str, Any]:
    label = _range_label(start)
    return {"kicker": kicker, "date_line": f"Week {start.isocalendar()[1]}  ·  {start.year}", "title": label,
            "details": details, "pills": pills, "compact": f"{name}  ·  {label}", "subject": name}


def _build(hero: dict[str, Any], story: list[Flowable]) -> bytes:
    buffer = io.BytesIO()
    _Doc(buffer, hero).build([NextPageTemplate("later"), Spacer(1, 2 * mm), *story], canvasmaker=_NumberedCanvas)
    return buffer.getvalue()


def strength_sections(strength: dict[str, Any]) -> list[dict[str, Any]]:
    """A Training Week strength session as one exercise section (for the single-workout PDF)."""
    return [{"title": "Strength", "kind": "main", "notes": "", "exercises": _strength_rows(strength["exercises"])}]


def _strength_rows(exercises: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"name": row["exercise"], "sets": row["sets"], "reps": row["repetitions"], "load": row["load"],
             "rest_seconds": row["rest_seconds"], "tempo": row.get("tempo"), "notes": " · ".join(row.get("demonstration") or [])}
            for row in exercises]


# ---------------------------------------------------------------- swim training week
def render_training_week_pdf(week: dict[str, Any], athlete: str | None) -> bytes:
    start = date.fromisoformat(week["week_start"])
    summary = week["summary"]
    days = week["days"]

    def tasks(day) -> list[bool]:
        return ([item["completed"] for item in day["workouts"]] + ([day["strength_completed"]] if day["strength"] else [])
                + ([day["mobility_completed"]] if day["mobility"] else []))

    all_tasks = [state for day in days for state in tasks(day)]
    hours, unit = _hours(summary["duration_minutes"])
    story: list[Flowable] = [_Stats([
        ("Swim volume", f"{summary['swim_volume_meters'] / 1000:.1f}", "km"),
        ("Swim sessions", str(summary["swim_sessions"]), ""),
        ("Training time", hours, unit),
        ("Completed", f"{sum(all_tasks)}/{len(all_tasks)}" if all_tasks else "—", ""),
    ]), Spacer(1, 6 * mm)]
    if week.get("coaching_note"):
        story += [_Callout("Coach's note for the week", week["coaching_note"], CYAN_DARK), Spacer(1, 6 * mm)]

    meters = [sum(item["distance_meters"] for item in day["workouts"]) for day in days]
    busiest = max(meters + [1])
    cells = []
    for day, day_meters in zip(days, meters):
        swims = len(day["workouts"])
        if day["competitions"]:
            headline, sub, accent = "Race day", day["competitions"][0]["name"], ORANGE
        elif swims:
            headline, sub, accent = f"{day_meters / 1000:.1f} km", f"{swims} swim{'s' if swims > 1 else ''}" + (" + gym" if day["strength"] else ""), CYAN_DARK
        elif day["rest"]:
            headline, sub, accent = "Rest", "Recovery day", SLATE
        elif day["strength"] or day["mobility"]:
            headline, sub, accent = "Dryland", "Strength & mobility" if day["strength"] else "Mobility", VIOLET_DARK
        else:
            headline, sub, accent = "Open", "Nothing planned", SLATE
        state = tasks(day)
        cells.append({"day": date.fromisoformat(day["date"]), "headline": headline, "sub": sub, "accent": accent,
                      "load": day_meters / busiest, "done": all(state) if state else None})
    story += [KeepTogether([_SectionHeader("Week at a glance", "#0891B2", f"{summary['swim_volume_meters']:,} m planned"), Spacer(1, 3.5 * mm), _Glance(cells)])]
    if week.get("zones"):
        entries = [(zone["zone"], zone["meters"]) for zone in week["zones"]]
        story += [Spacer(1, 7 * mm), KeepTogether([_SectionHeader("Intensity distribution", "#7C3AED", "Metres per training zone"), Spacer(1, 4 * mm), _ZoneBar(entries)])]
    if week.get("composition"):
        parts = "&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;".join(f"<font name='Helvetica-Bold' color='#0F172A'>{_text(item['label'])}</font>&nbsp; {item['meters']:,} m" for item in week["composition"])
        story += [Spacer(1, 3 * mm), Paragraph(parts, _style("composition", fontSize=8, leading=11, textColor=MUTED))]
    story.append(PageBreak())

    for day in days:
        when = date.fromisoformat(day["date"])
        body: list[Flowable] = []
        for meet in day["competitions"]:
            text = f"{meet['name']}  ·  {meet.get('location', '')}  ·  {meet.get('pool_length', '')} m pool  ·  Priority {meet.get('priority', '')}"
            if meet.get("events"):
                text += f"\nEvents: {', '.join(meet['events'])}"
            body += [_Callout("Competition", text, ORANGE), Spacer(1, 3 * mm)]
        for index, item in enumerate(day["workouts"], 1):
            workout = item["workout"]
            pills = [(f"{item['distance_meters']:,} m", CYAN_DARK, WHITE), (f"{workout['estimated_duration_minutes']} MIN", CHIP, INK)]
            if item.get("pool_length"):
                pills.append((f"{item['pool_length']} M POOL", CHIP, INK))
            if item.get("event"):
                pills.append((item["event"].upper(), VIOLET, NAVY))
            kicker = f"Swim {index} of {len(day['workouts'])}" if len(day["workouts"]) > 1 else "Swim session"
            body += _lead([_SessionCard(kicker, workout["title"], pills, workout["objective"], CYAN_DARK, item["completed"])],
                          [_SetRow(item_set) for item_set in workout["sets"]])
            if workout.get("notes", "").strip():
                body += [Spacer(1, 1 * mm), _Callout("Session notes", workout["notes"], CYAN_DARK)]
            body.append(Spacer(1, 3 * mm))
        if day["strength"]:
            strength = day["strength"]
            body += _lead([_SessionCard("Strength", strength["title"], [(f"{len(strength['exercises'])} EXERCISES", VIOLET, NAVY),
                                          (f"{strength['estimated_duration_minutes']} MIN", CHIP, INK)], strength["objective"], VIOLET_DARK, day["strength_completed"])],
                          [_Exercise(index, row, "main") for index, row in enumerate(_strength_rows(strength["exercises"]), 1)])
            body.append(Spacer(1, 3 * mm))
        if day["mobility"]:
            minutes = sum(work["duration_minutes"] for work in day["mobility"])
            body += [_Glue([_SubHead("Mobility", colors.HexColor(KIND["mobility"]), f"{minutes} min", day["mobility_completed"]), Spacer(1, 2 * mm), _Bullets([
                f"<font name='Helvetica-Bold' color='#0F172A'>{_text(work['exercise'])}</font>  "
                f"<font color='#64748B'>{work['duration_minutes']} min · {_text(work['category'])}</font><br/>{_text(' '.join(work['instructions']))}"
                for work in day["mobility"]], colors.HexColor(KIND["mobility"]))]), Spacer(1, 3 * mm)]
        if day["recovery"]:
            body.append(_Glue([_SubHead("Recovery", colors.HexColor(KIND["cooldown"])), Spacer(1, 2 * mm),
                                      _Bullets([_text(line) for line in day["recovery"]], colors.HexColor(KIND["cooldown"]))]))
        if not body:
            body = [_Quiet("Nothing planned for this day.")]

        day_meters = sum(item["distance_meters"] for item in day["workouts"])
        day_minutes = (sum(item["workout"]["estimated_duration_minutes"] for item in day["workouts"])
                       + (day["strength"]["estimated_duration_minutes"] if day["strength"] else 0)
                       + sum(work["duration_minutes"] for work in day["mobility"]))
        meta = "  ·  ".join(part for part in [f"{day_meters:,} m" if day_meters else "", f"{day_minutes} min" if day_minutes else ""] if part)
        state = tasks(day)
        status = (("RACE DAY", ORANGE, WHITE) if day["competitions"] else ("ALL DONE", EMERALD, WHITE) if state and all(state)
                  else ("REST DAY", CHIP, MUTED) if day["rest"] else None)
        objective = day["objective"] if day["objective"] != "Not planned" else "No AI plan for this day"
        story += _day_block(_DayHeader(when, objective, meta, status), body)

    story += [Spacer(1, 9 * mm), KeepTogether([_Reflection()])]
    pills = [(week["phase"].upper(), VIOLET, NAVY, 1)] if week.get("phase") else []
    pills += [("AI COACH PLAN" if week.get("generated") else "YOUR SESSIONS", CYAN, NAVY, 1),
              (f"{summary['swim_volume_meters'] / 1000:.1f} KM", WHITE, WHITE, 0.12)]
    details = [part for part in [f"Prepared for {athlete}" if athlete else "", f"{summary['swim_sessions']} swims", f"{hours} {unit} of training"] if part]
    return _build(_hero("SWIM WEEK", start, "Swim Week", details, pills), story)


# ---------------------------------------------------------------- strength & dryland week
def render_gym_week_pdf(week: dict[str, Any], athlete: str | None, sections_for: Callable[[dict[str, Any]], list[dict[str, Any]]]) -> bytes:
    start = date.fromisoformat(week["week_start"])
    summary = week["summary"]
    days = week["days"]
    hours, unit = _hours(summary["minutes"])
    story: list[Flowable] = [_Stats([
        ("Workouts", str(summary["sessions"]), ""),
        ("Completed", f"{summary['completed']}/{summary['sessions']}" if summary["sessions"] else "—", ""),
        ("Total time", hours, unit),
        ("Exercises", str(summary["exercises"]), ""),
    ]), Spacer(1, 6 * mm)]
    if week.get("equipment"):
        story += [_Callout("Your equipment", week["equipment"], VIOLET_DARK), Spacer(1, 6 * mm)]

    minutes = [sum(item["workout"]["estimated_duration_minutes"] for item in day["workouts"]) for day in days]
    busiest = max(minutes + [1])
    cells = []
    for day, day_minutes in zip(days, minutes):
        items = day["workouts"]
        if items:
            focus = _short_focus(items[0].get("focus") or "") or items[0]["workout"]["title"]
            sub = focus if len(items) == 1 else f"{len(items)} workouts"
            cells.append({"day": date.fromisoformat(day["date"]), "headline": f"{day_minutes} min", "sub": sub,
                          "accent": VIOLET_DARK, "load": day_minutes / busiest, "done": all(item["completed"] for item in items)})
        else:
            cells.append({"day": date.fromisoformat(day["date"]), "headline": "Open", "sub": "No workout",
                          "accent": SLATE, "load": 0, "done": None})
    story += [KeepTogether([_SectionHeader("Week at a glance", "#7C3AED", f"{summary['sessions']} workouts · {summary['minutes']} min"),
                            Spacer(1, 3.5 * mm), _Glance(cells)])]
    story.append(PageBreak())

    for day in days:
        when = date.fromisoformat(day["date"])
        body: list[Flowable] = []
        for item in day["workouts"]:
            workout = item["workout"]
            meta = workout.get("meta") or {}
            pills = [((item.get("dose") or workout.get("intensity") or "Moderate").upper(), VIOLET, NAVY),
                     ("BUILT BY YOU" if item.get("source") == "manual" else "AI COACH PLAN", CYAN, NAVY),
                     (f"{workout['estimated_duration_minutes']} MIN", CHIP, INK)]
            time = " – ".join(part for part in [meta.get("start_time"), meta.get("end_time")] if part)
            if time:
                pills.append((time, CHIP, INK))
            if meta.get("location"):
                pills.append((meta["location"][:28].upper(), CHIP, INK))
            kicker = f"{_short_focus(item['focus'])} workout" if item.get("focus") else "Workout"
            card: list[Flowable] = [_SessionCard(kicker, workout["title"], pills, workout.get("objective") or "", VIOLET_DARK, item["completed"])]
            sections = [section for section in sections_for(workout) if section["exercises"] or section.get("notes", "").strip()]
            if not sections:
                body += [_Glue([*card, Spacer(1, 1.5 * mm), _Quiet("No exercises added yet: open this workout in the builder to fill it in.")])]
                card = []
            for section in sections:
                color = colors.HexColor(KIND.get(section.get("kind", "custom"), KIND["custom"]))
                sets = sum(row["sets"] for row in section["exercises"])
                right = f"{len(section['exercises'])} exercise{'s' if len(section['exercises']) != 1 else ''}  ·  {sets} sets" if section["exercises"] else ""
                heading = [*card, Spacer(1, 1.5 * mm), _SubHead(section["title"], color, right), Spacer(1, 2 * mm)]
                card = []  # the workout card travels with its first section only
                items: list[Flowable] = [_Notes(section["notes"]), Spacer(1, 2 * mm)] if section.get("notes", "").strip() else []
                items += [_Exercise(index, row, section.get("kind", "custom")) for index, row in enumerate(section["exercises"], 1)]
                body += _lead(heading, items)
            body += card
            if workout.get("coaching_notes"):
                body += [Spacer(1, 1.5 * mm), _Callout("Coach's notes", workout["coaching_notes"], colors.HexColor("#D97706"))]
            body.append(Spacer(1, 4 * mm))
        if not body:
            body = [_Quiet("No workout planned for this day.")]
        items = day["workouts"]
        day_minutes = sum(item["workout"]["estimated_duration_minutes"] for item in items)
        meta = f"{len(items)} workout{'s' if len(items) != 1 else ''}  ·  {day_minutes} min" if items else ""
        status = ("ALL DONE", EMERALD, WHITE) if items and all(item["completed"] for item in items) else None
        objective = items[0]["workout"].get("objective") or items[0]["workout"]["title"] if items else "Open day"
        story += _day_block(_DayHeader(when, objective, meta, status), body)

    story += [Spacer(1, 9 * mm), KeepTogether([_Reflection()])]
    pills = [(f"{summary['sessions']} WORKOUTS", VIOLET, NAVY, 1), (f"{summary['completed']}/{summary['sessions']} DONE", CYAN, NAVY, 1),
             (f"{summary['minutes']} MIN", WHITE, WHITE, 0.12)]
    details = [part for part in [f"Prepared for {athlete}" if athlete else "", f"{summary['exercises']} exercises",
                                 f"{hours} {unit} of strength & dryland"] if part]
    return _build(_hero("GYM WEEK  ·  STRENGTH & DRYLAND", start, "Gym Week", details, pills), story)


# ---------------------------------------------------------------- single Training Week items
def render_swim_pdf(item: dict[str, Any], athlete: str | None) -> bytes:
    """One swim workout: summary, goal, zone split and every set."""
    workout = item["workout"]
    day = date.fromisoformat(item["date"]) if item.get("date") else None
    meters = item["distance_meters"]
    minutes = workout["estimated_duration_minutes"]
    story: list[Flowable] = [_Stats([
        ("Distance", f"{meters:,}", "m"), ("Sets", str(len(workout["sets"])), ""),
        ("Duration", str(minutes), "min"), ("Pool", f"{item['pool_length']}" if item.get("pool_length") else "—", "m" if item.get("pool_length") else ""),
    ]), Spacer(1, 6 * mm), _Callout("Goal", workout["objective"], CYAN_DARK), Spacer(1, 6 * mm)]
    zones = [(zone, value) for zone, value in item.get("zones", {}).items() if value]
    if zones:
        story += [KeepTogether([_SectionHeader("Intensity distribution", "#7C3AED", "Metres per training zone"), Spacer(1, 4 * mm), _ZoneBar(zones)]), Spacer(1, 6 * mm)]
    rows = [_SetRow(item_set) for item_set in workout["sets"]]
    story += [KeepTogether([_SectionHeader("Sets", "#0891B2", f"{len(rows)} sets  ·  {meters:,} m"), Spacer(1, 3 * mm), rows[0]]), *rows[1:]]
    if workout.get("equipment"):
        story += [Spacer(1, 4 * mm), _Callout("Equipment", ", ".join(workout["equipment"]), VIOLET_DARK)]
    if workout.get("notes", "").strip():
        story += [Spacer(1, 3 * mm), _Callout("Coach's notes", workout["notes"], colors.HexColor("#D97706"))]
    pills = [(f"{meters / 1000:.1f} KM", CYAN, NAVY, 1), (f"{minutes} MIN", VIOLET, NAVY, 1)]
    if item.get("event"):
        pills.append((item["event"].upper(), WHITE, WHITE, 0.12))
    hero = {"kicker": "SWIM WORKOUT", "date_line": day.strftime("%A %d %B %Y") if day else "Not scheduled", "title": workout["title"],
            "details": [part for part in [item.get("phase"), f"Prepared for {athlete}" if athlete else ""] if part],
            "pills": pills, "compact": workout["title"], "subject": "Swim workout"}
    return _build(hero, story)


def render_mobility_pdf(day: date, mobility: list[dict[str, Any]], completed: bool, athlete: str | None) -> bytes:
    """A day's mobility work: one card per drill with its instructions and a tick circle."""
    minutes = sum(work["duration_minutes"] for work in mobility)
    accent = colors.HexColor("#0D9488")
    cards = [_SessionCard(work["category"], work["exercise"], [(f"{work['duration_minutes']} MIN", CHIP, INK)],
                          " ".join(work["instructions"]), accent, completed) for work in mobility]
    story: list[Flowable] = [_Stats([
        ("Exercises", str(len(mobility)), ""), ("Duration", str(minutes), "min"),
        ("Focus areas", str(len({work["category"] for work in mobility})), ""), ("Status", "Done" if completed else "Planned", ""),
    ]), Spacer(1, 6 * mm), KeepTogether([_SectionHeader("Mobility drills", KIND["mobility"], f"{len(mobility)} drills  ·  {minutes} min"), Spacer(1, 3 * mm), cards[0]]), *cards[1:]]
    hero = {"kicker": "MOBILITY SESSION", "date_line": day.strftime("%A %d %B %Y"), "title": f"{day:%A} mobility",
            "details": [part for part in ["Swim Week", f"Prepared for {athlete}" if athlete else ""] if part],
            "pills": [(f"{len(mobility)} DRILLS", CYAN, NAVY, 1), (f"{minutes} MIN", VIOLET, NAVY, 1)] + ([("COMPLETED", WHITE, WHITE, 0.12)] if completed else []),
            "compact": f"{day:%A} mobility", "subject": "Mobility"}
    return _build(hero, story)
