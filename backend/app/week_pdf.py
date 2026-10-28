"""Branded whole-week PDF exports (the Swim Week and the Gym Week) and the Swim Week's single items (a swim, a day's
mobility). Their design is workout_pdf's: the app's dark header, here with the week's strip of days, over a white body."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Callable

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, KeepTogether, Paragraph, Spacer

from app.pdf_brand import BOLD, REGULAR, SEMIBOLD, draw, icon, mix, printable, tracked_width
from app.workout_pdf import (
    AMBER, BODY, CONTENT_W, DONE, FAINT, GYM, HAIR, INK, KIND, KIND_ICONS, MEET, MOBILITY, MUTED, NIGHT, RING, SKY, SLATE, SWIM, WHITE,
    Tone, _bold, _Callout, _Exercise, _Notes, _SectionHeader, _Stats, _fit, _pill, _pill_w, _round, _style, _text, _tick, _wrap, build,
    prepared_for,
)

# The app's zone colours (its ZoneChip), a shade darker for print.
ZONE_COLORS = [(("recovery",), "#0EA5E9"), (("race",), "#F97316"), (("sprint",), "#D946EF"),
               (("vo2", "high aerobic"), "#F59E0B"), (("threshold",), "#10B981"), (("aerobic", "endurance"), "#06B6D4")]


def zone_color(zone: str):
    value = zone.lower()
    return colors.HexColor(next((tone for needles, tone in ZONE_COLORS if any(needle in value for needle in needles)), "#94A3B8"))


def _range_label(start: date) -> str:
    end = start + timedelta(days=6)
    if start.year != end.year:
        return f"{start.day} {start:%b %Y} – {end.day} {end:%b %Y}"
    if start.month != end.month:
        return f"{start.day} {start:%b} – {end.day} {end:%b %Y}"
    return f"{start.day} – {end.day} {end:%B %Y}"


def _hours(minutes: int) -> tuple[str, str]:
    return (f"{minutes / 60:.1f}".rstrip("0").rstrip("."), "hours") if minutes >= 60 else (str(minutes), "min")


def _compact_meters(meters: int) -> str:
    """As the app's strip shows a day's metres: 800 -> "800", 4200 -> "4.2k"."""
    return f"{meters / 1000:.{0 if meters % 1000 == 0 else 1}f}k" if meters >= 1000 else str(meters)


def _right_pill(c, right: float, y: float, text: str, fill, ink, size: float = 6.8, stroke=None) -> float:
    width = _pill_w(text, size)
    _pill(c, right - width, y, text, fill, ink, size=size, stroke=stroke)
    return width


# ---------------------------------------------------------------- flowables
class _ZoneBar(Flowable):
    """The week's (or a swim's) metres by training zone: a stacked bar, and a legend in three columns."""

    def __init__(self, entries: list[tuple[str, int]]):
        super().__init__()
        self.entries = sorted([entry for entry in entries if entry[1] > 0], key=lambda entry: -entry[1])
        self.total = sum(meters for _, meters in self.entries) or 1

    def wrap(self, *_):
        self.height = 4 * mm + 3 * mm + math.ceil(len(self.entries) / 3) * 5.8 * mm
        return CONTENT_W, self.height

    def draw(self):
        c, h = self.canv, self.height
        bar_h = 3.6 * mm
        bar_y = h - bar_h
        c.saveState()
        path = c.beginPath()
        path.roundRect(0, bar_y, CONTENT_W, bar_h, bar_h / 2)
        c.clipPath(path, stroke=0, fill=0)
        c.setFillColor(HAIR)
        c.rect(0, bar_y, CONTENT_W, bar_h, stroke=0, fill=1)
        x = 0.0
        for label, meters in self.entries:
            width = CONTENT_W * meters / self.total
            c.setFillColor(zone_color(label))
            c.rect(x, bar_y, max(0, width - 0.6), bar_h, stroke=0, fill=1)
            x += width
        c.restoreState()
        column = CONTENT_W / 3
        for index, (label, meters) in enumerate(self.entries):
            x, y = (index % 3) * column, bar_y - 6.8 * mm - (index // 3) * 5.8 * mm
            c.setFillColor(zone_color(label))
            c.circle(x + 1.3 * mm, y + 1.15 * mm, 1.3 * mm, stroke=0, fill=1)
            width = draw(c, x + 4 * mm, y, _fit(label, SEMIBOLD, 8.2, column * 0.52), SEMIBOLD, 8.2, INK)
            draw(c, x + 4 * mm + width + 1.8 * mm, y, f"{meters:,} m  ·  {round(meters / self.total * 100)}%", REGULAR, 7.8, MUTED)


class _DayHeader(Flowable):
    """A day: its date on a night-blue badge (as the app's day cards), its name, what it's for, its totals and how it stands."""

    H = 17 * mm

    def __init__(self, day: date, objective: str, meta: str, status: tuple[str, Tone, str] | None, tone: Tone):
        super().__init__()
        self.day, self.meta, self.status, self.tone = day, meta, status, tone
        right = 46 * mm if meta or status else 0
        lines = _wrap(objective, REGULAR, 8.4, CONTENT_W - 17 * mm - right)
        self.objective = lines[:1] + ([_fit(" ".join(lines[1:]), REGULAR, 8.4, CONTENT_W - 17 * mm - right)] if len(lines) > 1 else [])

    def wrap(self, *_):
        self.height = self.H + (3.6 * mm if len(self.objective) > 1 else 0)
        return CONTENT_W, self.height

    def draw(self):
        c, h = self.canv, self.height
        badge = 13 * mm
        by = h - 1.2 * mm - badge
        c.saveState()
        path = c.beginPath()
        path.roundRect(0, by, badge, badge, 3.4 * mm)
        c.clipPath(path, stroke=0, fill=0)
        c.linearGradient(0, by + badge, badge, by, (mix(NIGHT, self.tone.bright, 0.22), NIGHT, colors.HexColor("#081722")), (0, 0.55, 1), extend=True)
        c.restoreState()
        draw(c, badge / 2, by + badge - 4.4 * mm, self.day.strftime("%a").upper(), SEMIBOLD, 5.8, self.tone.bright, tracking=0.14, align="centre")
        draw(c, badge / 2, by + 2.9 * mm, str(self.day.day), BOLD, 13.5, WHITE, align="centre")
        name = self.day.strftime("%A")
        x = badge + 4 * mm
        top = h - 5.6 * mm
        width = draw(c, x, top, name, BOLD, 13.6, INK, tracking=-0.01)
        draw(c, x + width + 2 * mm, top + 0.2 * mm, f"{self.day.day} {self.day:%B}", REGULAR, 8.4, MUTED)
        for index, line in enumerate(self.objective):
            draw(c, x, top - 5.4 * mm - index * 3.6 * mm, line, REGULAR, 8.4, BODY)
        if self.meta:
            draw(c, CONTENT_W, top + 0.1 * mm, self.meta, SEMIBOLD, 8.6, INK, align="right")
        if self.status:
            text, tone, glyph = self.status
            width = _pill_w(text, 6.8) + 3.2 * mm
            px, py = CONTENT_W - width, top - 7.2 * mm
            _round(c, px, py, width, 6.8 + 7.6, (6.8 + 7.6) / 2, fill=tone.solid if tone is not SLATE else WHITE, stroke=None if tone is not SLATE else RING)
            ink = WHITE if tone is not SLATE else MUTED
            icon(c, glyph, px + 4, py + 3.5, 7.4, ink, stroke=2.4)
            draw(c, px + 4 + 3.2 * mm, py + (6.8 + 7.6) / 2 - 6.8 * 0.36, text, SEMIBOLD, 6.8, ink)
        c.saveState()
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.6)
        c.line(0, 0, CONTENT_W, 0)
        c.restoreState()


class _SessionCard(Flowable):
    """A session's card (a swim, a workout, a strength session or a drill): its kicker, title, chips and what it's for,
    and a ring to tick when it's done, as the app's session cards."""

    def __init__(self, kicker: str, title: str, pills: list[tuple[str, Any, Any, Any]], body: str, tone: Tone, done: bool):
        super().__init__()
        self.kicker, self.pills, self.tone, self.done = kicker, pills, tone, done
        self.title = Paragraph(_text(title), _style("card-title", fontName=SEMIBOLD, fontSize=12, leading=14.6, textColor=INK))
        self.body = Paragraph(_text(body), _style("card-body", fontSize=8.7, leading=12.6, textColor=BODY)) if body else None

    def wrap(self, *_):
        self.title_h = self.title.wrap(CONTENT_W - 12 * mm - 36 * mm, 60 * mm)[1]
        self.body_h = self.body.wrap(CONTENT_W - 12 * mm, 120 * mm)[1] + 3 * mm if self.body else 0
        self.height = 8.6 * mm + self.title_h + 8.4 * mm + self.body_h + 1.6 * mm
        return CONTENT_W, self.height + 2.4 * mm

    def draw(self):
        c, y0, tone = self.canv, 2.4 * mm, self.tone
        h = self.height
        c.saveState()
        path = c.beginPath()
        path.roundRect(0, y0, CONTENT_W, h, 3.4 * mm)
        c.clipPath(path, stroke=0, fill=0)
        c.linearGradient(0, y0 + h, CONTENT_W, y0, (mix(WHITE, tone.solid, 0.07), mix(WHITE, tone.solid, 0.02), WHITE), (0, 0.45, 1), extend=True)
        c.setFillColor(tone.solid)
        c.rect(0, y0, 1.3 * mm, h, stroke=0, fill=1)
        c.restoreState()
        _round(c, 0, y0, CONTENT_W, h, 3.4 * mm, stroke=mix(WHITE, tone.solid, 0.26), width=0.6)
        top = y0 + h
        draw(c, 6 * mm, top - 6 * mm, _fit(self.kicker.upper(), SEMIBOLD, 6.4, CONTENT_W - 56 * mm, 0.16), SEMIBOLD, 6.4, tone.ink, tracking=0.16)
        self.title.drawOn(c, 6 * mm, top - 7.6 * mm - self.title_h)
        x, y = 6 * mm, top - 7.6 * mm - self.title_h - 6.6 * mm
        for text, fill, ink, stroke in self.pills:
            if x + _pill_w(text, 7) > CONTENT_W - 4 * mm:
                break
            x += _pill(c, x, y, text, fill, ink, size=7, stroke=stroke) + 3.2
        if self.body:
            self.body.drawOn(c, 6 * mm, y0 + 3.6 * mm)
        _tick(c, CONTENT_W - 6.6 * mm, top - 6.6 * mm, 2.8 * mm, self.done)
        draw(c, CONTENT_W - 11.4 * mm, top - 7.5 * mm, "COMPLETED" if self.done else "TICK WHEN DONE", SEMIBOLD, 5.8,
             DONE.ink if self.done else FAINT, tracking=0.14, align="right")


class _SetRow(Flowable):
    """One set of a swim on the session's timeline, as the app lists them: its number on a ring of its zone's colour, the
    prescription and its metres, the zone, the set's name, interval and target, its description, equipment and focus."""

    def __init__(self, item: dict[str, Any], number: int, first: bool, last: bool):
        super().__init__()
        self.item, self.number, self.first, self.last = item, number, first, last
        self.color = zone_color(item["training_zone"])
        reps = f"{item['repetitions']} × {item['distance_meters']} m" if item["repetitions"] > 1 else f"{item['distance_meters']} m"
        self.prescription = f"{item['rounds']} × ({reps})" if item["rounds"] > 1 else reps
        self.meters = item["rounds"] * item["repetitions"] * item["distance_meters"]
        interval = item["interval"] if item["interval"][:1].isalpha() else f"@ {item['interval']}"
        self.info = "  ·  ".join(part for part in [item["name"], item["stroke"], interval, f"Target {item['target_time']}" if item.get("target_time") else ""] if part)
        # The set's description, then its focus and equipment in the same paragraph (a line saved on most sets).
        extras = []
        if item.get("technical_focus"):
            extras.append(f"{_bold('Focus', '#475569')}&nbsp; {_text(', '.join(item['technical_focus']))}")
        if item.get("equipment"):
            extras.append(f"{_bold('Equipment', '#475569')}&nbsp; {_text(', '.join(item['equipment']))}")
        text = _text(item.get("description") or "")
        if extras:
            text += ("&nbsp;&nbsp;&nbsp;" if text else "") + f"<font size='7.6' color='#64748B'>{'&nbsp;&nbsp;&nbsp;'.join(extras)}</font>"
        self.desc = Paragraph(text, _style("set-desc", fontSize=8.5, leading=12, textColor=BODY)) if text else None

    def wrap(self, *_):
        self.desc_h = self.desc.wrap(CONTENT_W - 12 * mm, 120 * mm)[1] + 1 * mm if self.desc else 0
        self.height = 11.8 * mm + self.desc_h + 2.4 * mm
        return CONTENT_W, self.height

    def draw(self):
        c, h = self.canv, self.height
        cx, cy, r = 4.2 * mm, h - 4.6 * mm, 3.1 * mm
        c.saveState()
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.9)
        if not self.first:
            c.line(cx, cy + r, cx, h)
        if not self.last:
            c.line(cx, 0, cx, cy - r)
        c.setFillColor(WHITE)
        c.setStrokeColor(self.color)
        c.setLineWidth(1)
        c.circle(cx, cy, r, stroke=1, fill=1)
        c.restoreState()
        draw(c, cx, cy - 2.6, str(self.number), BOLD, 7.6, mix(colors.black, self.color, 0.8), align="centre")
        x = 11.5 * mm
        meters = f"{self.meters:,} m"
        meters_w = tracked_width(meters, SEMIBOLD, 9.6)
        zone = printable(self.item["training_zone"])
        zone_w = _pill_w(zone, 6.6)
        draw(c, x, h - 5.9 * mm, _fit(self.prescription, SEMIBOLD, 10.8, CONTENT_W - x - meters_w - zone_w - 8 * mm), SEMIBOLD, 10.8, INK)
        draw(c, CONTENT_W, h - 5.9 * mm, meters, SEMIBOLD, 9.6, INK, align="right")
        _right_pill(c, CONTENT_W - meters_w - 2.6 * mm, h - 5.9 * mm - 3.6, zone, mix(WHITE, self.color, 0.14), mix(colors.black, self.color, 0.72), size=6.6)
        draw(c, x, h - 9.9 * mm, _fit(self.info, REGULAR, 7.8, CONTENT_W - x - 2 * mm), REGULAR, 7.8, MUTED)
        if self.desc:
            self.desc.drawOn(c, x, h - 11.3 * mm - self.desc_h + 1 * mm)
        if not self.last:
            c.saveState()
            c.setStrokeColor(colors.HexColor("#EEF2F6"))
            c.setLineWidth(0.6)
            c.line(x, 0.6, CONTENT_W, 0.6)
            c.restoreState()


class _SubHead(Flowable):
    """A small heading within a day (mobility, recovery, a workout's sections): its icon, a figure, and a tick."""

    H = 9.4 * mm

    def __init__(self, label: str, color, right: str = "", done: bool | None = None, glyph: str = "list_checks"):
        super().__init__()
        self.label, self.color, self.right, self.done, self.glyph = label, color, right, done, glyph

    def wrap(self, *_):
        return CONTENT_W, self.H

    def draw(self):
        c = self.canv
        square = 5.8 * mm
        _round(c, 0, 1.6 * mm, square, square, 1.7 * mm, fill=mix(WHITE, self.color, 0.15))
        icon(c, self.glyph, 1.2 * mm, 1.6 * mm + 1.2 * mm, square - 2.4 * mm, mix(colors.black, self.color, 0.8), stroke=2.3)
        draw(c, square + 2.4 * mm, 3.2 * mm, self.label, SEMIBOLD, 9.8, INK)
        right = CONTENT_W
        if self.done is not None:
            _tick(c, CONTENT_W - 2.3 * mm, 4.5 * mm, 2.2 * mm, self.done)
            right -= 7 * mm
        if self.right:
            draw(c, right, 3.4 * mm, self.right, REGULAR, 7.8, MUTED, align="right")
        c.saveState()
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.5)
        c.line(0, 0.3 * mm, CONTENT_W, 0.3 * mm)
        c.restoreState()


class _Bullet(Flowable):
    """A line of rich text after a dot of its colour (a mobility drill, a piece of recovery advice). A list is a bullet
    each, so a long one carries on over the page rather than leaving a gap."""

    def __init__(self, line: str, color=SWIM.solid):
        super().__init__()
        self.color = color
        self.para = Paragraph(line, _style("bullet", fontSize=8.7, leading=12.6, textColor=BODY))

    def wrap(self, *_):
        self.para_h = self.para.wrap(CONTENT_W - 6 * mm, 80 * mm)[1]
        return CONTENT_W, self.para_h + 1.7 * mm

    def draw(self):
        y = 1.7 * mm
        self.canv.setFillColor(self.color)
        self.canv.circle(1.9 * mm, y + self.para_h - 4.1, 0.8 * mm, stroke=0, fill=1)
        self.para.drawOn(self.canv, 5.2 * mm, y)


def _bullets(lines: list[str], color) -> list[Flowable]:
    return [_Bullet(line, color) for line in lines]


class _Quiet(Flowable):
    """A day with nothing on it: one muted line in a dashed outline."""

    def __init__(self, text: str):
        super().__init__()
        self.text = text

    def wrap(self, *_):
        return CONTENT_W, 9.6 * mm

    def draw(self):
        c = self.canv
        c.saveState()
        c.setDash(2, 2)
        c.setStrokeColor(RING)
        c.setLineWidth(0.7)
        c.roundRect(0, 0, CONTENT_W, 9.6 * mm, 3 * mm, stroke=1, fill=0)
        c.restoreState()
        icon(c, "moon", 4.4 * mm, 3 * mm, 3.6 * mm, FAINT, stroke=2.2)
        draw(c, 10 * mm, 3.6 * mm, self.text, REGULAR, 8.5, MUTED)


class _Reflection(Flowable):
    """The week's end: three questions to answer in the athlete's own hand."""

    PROMPTS = ["How did the week feel overall?", "Wins, best sets and personal bests", "What should change next week?"]

    def __init__(self, tone: Tone):
        super().__init__()
        self.tone = tone

    def wrap(self, *_):
        self.height = 16 * mm + len(self.PROMPTS) * 20 * mm
        return CONTENT_W, self.height

    def draw(self):
        c, h, tone = self.canv, self.height, self.tone
        _round(c, 0, 0, CONTENT_W, h, 3.8 * mm, fill=mix(WHITE, tone.solid, 0.03), stroke=mix(WHITE, tone.solid, 0.22))
        square = 8.2 * mm
        _round(c, 5 * mm, h - 5 * mm - square, square, square, 2.4 * mm, fill=mix(WHITE, tone.solid, 0.13))
        icon(c, "notebook_pen", 5 * mm + 1.9 * mm, h - 5 * mm - square + 1.9 * mm, square - 3.8 * mm, tone.ink)
        draw(c, 16.6 * mm, h - 8.3 * mm, "WEEK REFLECTION", SEMIBOLD, 6.6, tone.ink, tracking=0.16)
        draw(c, 16.6 * mm, h - 12.4 * mm, "In your own words: it helps your coach plan the next one.", REGULAR, 7.8, MUTED)
        for index, prompt in enumerate(self.PROMPTS):
            y = h - 21 * mm - index * 20 * mm
            draw(c, 6 * mm, y, prompt, SEMIBOLD, 8.8, INK)
            c.saveState()
            c.setStrokeColor(RING)
            c.setLineWidth(0.5)
            for line in range(2):
                c.line(6 * mm, y - 7 * mm - line * 6.5 * mm, CONTENT_W - 6 * mm, y - 7 * mm - line * 6.5 * mm)
            c.restoreState()


# ---------------------------------------------------------------- shared builders
class _Glue(list):
    """Flowables that must stay on one page (turned into a single, non-nested KeepTogether)."""


def _lead(heading: list[Flowable], items: list[Flowable]) -> list[Any]:
    """A heading glued to its first item, followed by the remaining items."""
    return [_Glue(heading + items[:1]), *items[1:]]


def _day_block(header: Flowable, body: list[Any]) -> list[Flowable]:
    """A day's header kept on the page of the first thing on the day."""
    first = list(body[0]) if isinstance(body[0], _Glue) else [body[0]]
    rest = [KeepTogether(list(item)) if isinstance(item, _Glue) else item for item in body[1:]]
    return [Spacer(1, 6.5 * mm), KeepTogether([header, Spacer(1, 3.2 * mm), *first]), *rest]


def _short_focus(focus: str) -> str:
    """"Upper-body pull strength and core (lats...)" -> "Upper-body pull strength"."""
    for marker in [" (", ",", " and ", " plus ", " + ", ":"]:
        focus = focus.split(marker)[0]
    return focus.strip().capitalize()


def _week_hero(tone: Tone, kicker: str, start: date, name: str, details: list[str], chips: list[tuple[str, Tone, str | None]],
               strip: list[dict[str, Any]]) -> dict[str, Any]:
    label = _range_label(start)
    return {"tone": tone, "kicker": kicker, "date_line": f"Week {start.isocalendar()[1]}  ·  {start.year}", "title": label, "details": details,
            "chips": chips, "strip": strip, "compact": f"{name}  ·  {label}", "subject": name}


def strength_sections(strength: dict[str, Any]) -> list[dict[str, Any]]:
    """A Swim Week strength session as one exercise section (for the single-workout PDF)."""
    return [{"title": "Strength", "kind": "main", "notes": "", "exercises": _strength_rows(strength["exercises"])}]


def _strength_rows(exercises: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"name": row["exercise"], "sets": row["sets"], "reps": row["repetitions"], "load": row["load"],
             "rest_seconds": row["rest_seconds"], "tempo": row.get("tempo"), "notes": " · ".join(row.get("demonstration") or [])}
            for row in exercises]


def _swim_rows(sets: list[dict[str, Any]]) -> list[Flowable]:
    return [_SetRow(item, index, index == 1, index == len(sets)) for index, item in enumerate(sets, 1)]


def _outline(text: str) -> tuple[str, Any, Any, Any]:
    """A chip outlined in grey, on white."""
    return (text, WHITE, BODY, RING)


# ---------------------------------------------------------------- the Swim Week
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
        ("Swim volume", f"{summary['swim_volume_meters'] / 1000:.1f}", "km", "waves", SWIM),
        ("Swim sessions", str(summary["swim_sessions"]), "", "activity", SKY),
        ("Training time", hours, unit, "timer", AMBER),
        ("Ticked off", f"{sum(all_tasks)}/{len(all_tasks)}" if all_tasks else "—", "", "circle_check", DONE),
    ]), Spacer(1, 5 * mm)]
    if week.get("coaching_note"):
        story += [_Callout(week.get("phase") or "Your coach's note for the week", week["coaching_note"], SWIM, "sparkles"), Spacer(1, 6 * mm)]
    if week.get("zones"):
        entries = [(zone["zone"], zone["meters"]) for zone in week["zones"]]
        block: list[Flowable] = [_SectionHeader("Intensity distribution", "#7C3AED", "Metres per training zone", "activity"), Spacer(1, 4 * mm), _ZoneBar(entries)]
        if week.get("composition"):
            parts = "&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;".join(f"{_bold(item['label'])}&nbsp; {item['meters']:,} m" for item in week["composition"])
            block += [Spacer(1, 2.6 * mm), Paragraph(parts, _style("composition", fontSize=8, leading=11.5, textColor=MUTED))]
        story.append(KeepTogether(block))

    for day in days:
        when = date.fromisoformat(day["date"])
        body: list[Flowable] = []
        for meet in day["competitions"]:
            text = "  ·  ".join(part for part in [meet["name"], meet.get("location"), f"{meet.get('pool_length')} m pool" if meet.get("pool_length") else "",
                                                   f"Priority {meet['priority']}" if meet.get("priority") else ""] if part)
            if meet.get("events"):
                text += f"\nEvents: {', '.join(meet['events'])}"
            body += [_Callout("Competition", text, MEET, "flag"), Spacer(1, 3 * mm)]
        for index, item in enumerate(day["workouts"], 1):
            workout = item["workout"]
            pills = [(f"{item['distance_meters']:,} m", SWIM.solid, WHITE, None), _outline(f"{workout['estimated_duration_minutes']} min")]
            if item.get("pool_length"):
                pills.append(_outline(f"{item['pool_length']} m pool"))
            if item.get("event"):
                pills.append((item["event"], GYM.wash, GYM.ink, mix(WHITE, GYM.solid, 0.3)))
            own = item.get("origin") == "My workout"
            kicker = "Your swim" if own else f"Swim {index} of {len(day['workouts'])}" if len(day["workouts"]) > 1 else "Swim session"
            body += _lead([_SessionCard(kicker, workout["title"], pills, workout["objective"], SWIM, item["completed"]), Spacer(1, 1.2 * mm)],
                          _swim_rows(workout["sets"]))
            if workout.get("notes", "").strip():
                body += [Spacer(1, 1.4 * mm), _Callout("Session notes", workout["notes"], SWIM, "notebook_pen")]
            body.append(Spacer(1, 3.4 * mm))
        if day["strength"]:
            strength = day["strength"]
            body += _lead([_SessionCard("Strength", strength["title"], [(f"{len(strength['exercises'])} exercises", GYM.solid, WHITE, None),
                                                                           _outline(f"{strength['estimated_duration_minutes']} min")],
                                        strength["objective"], GYM, day["strength_completed"])],
                          [_Exercise(index, row, "main") for index, row in enumerate(_strength_rows(strength["exercises"]), 1)])
            body.append(Spacer(1, 3.4 * mm))
        if day["mobility"]:
            minutes = sum(work["duration_minutes"] for work in day["mobility"])
            body += _lead([_SubHead("Mobility", MOBILITY.solid, f"{minutes} min", day["mobility_completed"], "heart"), Spacer(1, 2.2 * mm)], _bullets([
                f"{_bold(work['exercise'])}&nbsp; <font color='#64748B'>{work['duration_minutes']} min · {_text(work['category'])}</font><br/>{_text(' '.join(work['instructions']))}"
                for work in day["mobility"]], MOBILITY.solid))
            body.append(Spacer(1, 3 * mm))
        if day["recovery"]:
            body += _lead([_SubHead("Recovery", AMBER.solid, glyph="moon"), Spacer(1, 2.2 * mm)], _bullets([_text(line) for line in day["recovery"]], AMBER.solid))
        if not body:
            body = [_Quiet("Nothing planned for this day.")]

        day_meters = sum(item["distance_meters"] for item in day["workouts"])
        day_minutes = (sum(item["workout"]["estimated_duration_minutes"] for item in day["workouts"])
                       + (day["strength"]["estimated_duration_minutes"] if day["strength"] else 0)
                       + sum(work["duration_minutes"] for work in day["mobility"]))
        meta = "  ·  ".join(part for part in [f"{day_meters:,} m" if day_meters else "", f"{day_minutes} min" if day_minutes else ""] if part)
        state = tasks(day)
        status = (("Race day", MEET, "flag") if day["competitions"] else ("All done", DONE, "check") if state and all(state)
                  else ("Rest day", SLATE, "moon") if day["rest"] else None)
        objective = day["objective"] if day["objective"] != "Not planned" else "No plan from your coach for this day"
        story += _day_block(_DayHeader(when, objective, meta, status, SWIM), body)

    story += [Spacer(1, 9 * mm), KeepTogether([_Reflection(SWIM)])]

    meters = [sum(item["distance_meters"] for item in day["workouts"]) for day in days]
    busiest = max(meters + [1])
    strip = []
    for day, day_meters in zip(days, meters):
        state = tasks(day)
        rest = day["rest"] and not day["workouts"] and not day["strength"]
        markers = [name for name, on in [("flag", bool(day["competitions"])), ("dumbbell", bool(day["strength"])), ("heart", bool(day["mobility"])),
                                         ("moon", rest)] if on]
        strip.append({"day": date.fromisoformat(day["date"]), "amount": _compact_meters(day_meters) if day_meters else None, "unit": "metres",
                      "level": day_meters / busiest, "done": all(state) if state else None, "markers": markers,
                      "empty": "Meet" if day["competitions"] else "Gym" if day["strength"] else "Mobility" if day["mobility"] else "Rest" if rest else "Free"})
    chips: list[tuple[str, Tone, str | None]] = [(week["phase"], SWIM, "layers")] if week.get("phase") else []
    chips += [("AI week from your coach" if week.get("generated") else "Your sessions", DONE if week.get("generated") else SLATE, "dot"),
              (f"{summary['swim_volume_meters'] / 1000:.1f} km", SKY, "waves")]
    details = [part for part in [prepared_for(athlete), f"{summary['swim_sessions']} swims", f"{hours} {unit} of training"] if part]
    return build(_week_hero(SWIM, "Swim week", start, "Swim Week", details, chips, strip), story)


# ---------------------------------------------------------------- the Gym Week
def render_gym_week_pdf(week: dict[str, Any], athlete: str | None, sections_for: Callable[[dict[str, Any]], list[dict[str, Any]]]) -> bytes:
    start = date.fromisoformat(week["week_start"])
    summary = week["summary"]
    days = week["days"]
    hours, unit = _hours(summary["minutes"])
    story: list[Flowable] = [_Stats([
        ("Workouts", str(summary["sessions"]), "", "dumbbell", GYM),
        ("Ticked off", f"{summary['completed']}/{summary['sessions']}" if summary["sessions"] else "—", "", "circle_check", DONE),
        ("Total time", hours, unit, "timer", AMBER),
        ("Exercises", str(summary["exercises"]), "", "list_checks", SKY),
    ]), Spacer(1, 5 * mm)]
    if week.get("equipment"):
        story += [_Callout("Your equipment", week["equipment"], GYM, "dumbbell")]

    for day in days:
        when = date.fromisoformat(day["date"])
        body: list[Flowable] = []
        for item in day["workouts"]:
            workout = item["workout"]
            meta = workout.get("meta") or {}
            source = item.get("source")
            pills = [(f"{item.get('dose') or workout.get('intensity') or 'Moderate'} intensity", GYM.solid, WHITE, None),
                     ("Built by you" if source == "manual" else "From your coach" if source == "coach" else "AI coach plan", SWIM.wash, SWIM.ink, mix(WHITE, SWIM.solid, 0.3)),
                     _outline(f"{workout['estimated_duration_minutes']} min")]
            time = " – ".join(part for part in [meta.get("start_time"), meta.get("end_time")] if part)
            if time:
                pills.append(_outline(time))
            if meta.get("location"):
                pills.append(_outline(meta["location"][:28]))
            focus = _short_focus(item.get("focus") or "")
            # A workout added from the coach chat has "From your coach" as its focus.
            kicker = "Workout from your coach" if focus.lower().startswith("from your coach") else f"{focus} workout" if focus else "Workout"
            card: list[Flowable] = [_SessionCard(kicker, workout["title"], pills, workout.get("objective") or "", GYM, item["completed"])]
            sections = [section for section in sections_for(workout) if section["exercises"] or section.get("notes", "").strip()]
            if not sections:
                body += [_Glue([*card, Spacer(1, 1.5 * mm), _Quiet("No exercises added yet: open this workout in the builder to fill it in.")])]
                card = []
            for section in sections:
                kind = section.get("kind", "custom")
                color = colors.HexColor(KIND.get(kind, KIND["custom"]))
                sets = sum(row["sets"] for row in section["exercises"])
                count = len(section["exercises"])
                right = f"{count} exercise{'s' if count != 1 else ''}  ·  {sets} sets" if count else ""
                heading = [*card, Spacer(1, 1.6 * mm), _SubHead(section["title"], color, right, glyph=KIND_ICONS.get(kind, "list_checks")), Spacer(1, 2.2 * mm)]
                card = []  # the workout's card travels with its first section only
                items: list[Flowable] = [_Notes(section["notes"], color), Spacer(1, 2 * mm)] if section.get("notes", "").strip() else []
                items += [_Exercise(index, row, kind) for index, row in enumerate(section["exercises"], 1)]
                body += _lead(heading, items)
            body += card
            if workout.get("coaching_notes"):
                body += [Spacer(1, 1.6 * mm), _Callout("Coach's notes", workout["coaching_notes"], AMBER, "message_square")]
            body.append(Spacer(1, 4 * mm))
        if not body:
            body = [_Quiet("No workout planned for this day.")]
        items = day["workouts"]
        day_minutes = sum(item["workout"]["estimated_duration_minutes"] for item in items)
        meta = f"{len(items)} workout{'s' if len(items) != 1 else ''}  ·  {day_minutes} min" if items else ""
        status = ("All done", DONE, "check") if items and all(item["completed"] for item in items) else None
        objective = items[0]["workout"].get("objective") or items[0]["workout"]["title"] if items else "A free day"
        story += _day_block(_DayHeader(when, objective, meta, status, GYM), body)

    story += [Spacer(1, 9 * mm), KeepTogether([_Reflection(GYM)])]

    minutes = [sum(item["workout"]["estimated_duration_minutes"] for item in day["workouts"]) for day in days]
    busiest = max(minutes + [1])
    strip = [{"day": date.fromisoformat(day["date"]), "amount": str(day_minutes) if day_minutes else None, "unit": "min", "level": day_minutes / busiest,
              "done": all(item["completed"] for item in day["workouts"]) if day["workouts"] else None,
              "markers": ["dumbbell"] * min(len(day["workouts"]), 2), "empty": "Free"} for day, day_minutes in zip(days, minutes)]
    chips = [(f"{summary['sessions']} workouts", GYM, "dumbbell"), (f"{summary['completed']} of {summary['sessions']} ticked off", DONE, "dot"),
             (f"{summary['minutes']} min", SLATE, "timer")]
    details = [part for part in [prepared_for(athlete), f"{summary['exercises']} exercises", f"{hours} {unit} of strength & dryland"] if part]
    return build(_week_hero(GYM, "Gym week  ·  Strength & dryland", start, "Gym Week", details, chips, strip), story)


# ---------------------------------------------------------------- single Swim Week items
def render_swim_pdf(item: dict[str, Any], athlete: str | None) -> bytes:
    """One swim: its totals, goal and zone split, then every set on its timeline."""
    workout = item["workout"]
    day = date.fromisoformat(item["date"]) if item.get("date") else None
    meters = item["distance_meters"]
    minutes = workout["estimated_duration_minutes"]
    story: list[Flowable] = [_Stats([
        ("Distance", f"{meters:,}", "m", "waves", SWIM), ("Sets", str(len(workout["sets"])), "", "list_checks", SKY),
        ("Duration", str(minutes), "min", "timer", AMBER),
        ("Pool", f"{item['pool_length']}" if item.get("pool_length") else "—", "m" if item.get("pool_length") else "", "ruler", MOBILITY),
    ]), Spacer(1, 5 * mm), _Callout("Goal", workout["objective"], SWIM, "target"), Spacer(1, 6 * mm)]
    zones = [(zone, value) for zone, value in item.get("zones", {}).items() if value]
    if zones:
        story += [KeepTogether([_SectionHeader("Intensity distribution", "#7C3AED", "Metres per training zone", "activity"), Spacer(1, 4 * mm), _ZoneBar(zones)]),
                  Spacer(1, 6 * mm)]
    rows = _swim_rows(workout["sets"])
    if rows:
        story += [KeepTogether([_SectionHeader("Sets", "#0891B2", f"{len(rows)} sets  ·  {meters:,} m", "waves"), Spacer(1, 3 * mm), rows[0]]), *rows[1:]]
    if workout.get("equipment"):
        story += [Spacer(1, 4 * mm), _Callout("Equipment", ", ".join(workout["equipment"]), GYM, "dumbbell")]
    if workout.get("notes", "").strip():
        story += [Spacer(1, 3 * mm), _Callout("Coach's notes", workout["notes"], AMBER, "message_square")]
    chips: list[tuple[str, Tone, str | None]] = [(f"{meters / 1000:.1f} km", SWIM, "waves"), (f"{minutes} min", SLATE, "timer")]
    if item.get("event"):
        chips.append((item["event"], GYM, "target"))
    hero = {"tone": SWIM, "kicker": "Swim workout", "date_line": day.strftime("%A %d %B %Y") if day else "Not scheduled", "title": workout["title"],
            "details": [part for part in [item.get("phase"), prepared_for(athlete)] if part], "chips": chips, "compact": workout["title"],
            "subject": "Swim workout"}
    return build(hero, story)


def render_mobility_pdf(day: date, mobility: list[dict[str, Any]], completed: bool, athlete: str | None) -> bytes:
    """A day's mobility: its totals, then a card for every drill with its instructions and a ring to tick."""
    minutes = sum(work["duration_minutes"] for work in mobility)
    cards = [_SessionCard(work["category"], work["exercise"], [_outline(f"{work['duration_minutes']} min")], " ".join(work["instructions"]), MOBILITY, completed)
             for work in mobility]
    story: list[Flowable] = [_Stats([
        ("Drills", str(len(mobility)), "", "list_checks", MOBILITY), ("Duration", str(minutes), "min", "timer", AMBER),
        ("Focus areas", str(len({work["category"] for work in mobility})), "", "target", SKY),
        ("Status", "Done" if completed else "Planned", "", "circle_check", DONE),
    ]), Spacer(1, 6 * mm), KeepTogether([_SectionHeader("Mobility drills", KIND["mobility"], f"{len(mobility)} drills  ·  {minutes} min", "heart"),
                                         Spacer(1, 3 * mm), cards[0]]), *cards[1:]]
    chips: list[tuple[str, Tone, str | None]] = [(f"{len(mobility)} drills", MOBILITY, "heart"), (f"{minutes} min", SLATE, "timer")]
    if completed:
        chips.append(("Ticked off", DONE, "dot"))
    hero = {"tone": MOBILITY, "kicker": "Mobility session", "date_line": day.strftime("%A %d %B %Y"), "title": f"{day:%A} mobility",
            "details": [part for part in ["Swim Week", prepared_for(athlete)] if part], "chips": chips, "compact": f"{day:%A} mobility",
            "subject": "Mobility"}
    return build(hero, story)
