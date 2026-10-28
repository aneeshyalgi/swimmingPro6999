"""Branded PDF export of the Pace Calculator: one section and pace table per training zone, in its zone's colour."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, KeepTogether, Paragraph, Spacer

from app.pdf_brand import MONO_BOLD, REGULAR, SEMIBOLD, draw, mix
from app.week_pdf import ZONE_COLORS
from app.workout_pdf import (
    AMBER, BODY, CONTENT_W, DONE, FAINT, HAIR, INK, MUTED, SKY, SLATE, SWIM, WHITE, _Callout, _SectionHeader, _Stats, _fit, _round, _style,
    _text, build, whole,
)

SUITS = {"TRAINING_SUIT": "Training suit", "TECH": "Tech suit"}
COURSES = {"LCM": "Long course metres", "SCM": "Short course metres", "SCY": "Short course yards"}


def zone_hex(zone: str) -> str:
    value = zone.lower()
    return next((tone for needles, tone in ZONE_COLORS if any(needle in value for needle in needles)), "#94A3B8")


def fmt(seconds: float) -> str:
    minutes, rest = divmod(seconds, 60)
    return f"{int(minutes)}:{rest:04.1f}" if minutes else f"{rest:.1f}"


def fmt_range(value: dict[str, float] | None) -> str:
    if not value:
        return "—"
    return fmt(value["fast"]) if abs(value["fast"] - value["slow"]) < 0.05 else f"{fmt(value['fast'])} – {fmt(value['slow'])}"


class _PaceTable(Flowable):
    """A zone's reps and their paces (push start, dive start) with any note, on a card edged in the zone's colour."""

    ROW = 7.8 * mm
    HEAD = 7.4 * mm

    def __init__(self, rows: list[dict[str, Any]], display: str, color, dive_relevant: bool):
        super().__init__()
        self.rows, self.color = rows, color
        self.columns = [("REP", "label")]
        if display in ("BOTH", "PUSH") or not dive_relevant:
            self.columns.append(("PUSH START", "push"))
        if display in ("BOTH", "DIVE") and dive_relevant:
            self.columns.append(("DIVE START", "dive"))
        self.has_notes = any(row.get("note") for row in rows)

    def wrap(self, *_):
        self.height = self.HEAD + self.ROW * len(self.rows) + 2 * mm
        return CONTENT_W, self.height

    def draw(self):
        c, h = self.canv, self.height
        c.saveState()
        path = c.beginPath()
        path.roundRect(0, 0, CONTENT_W, h, 3.2 * mm)
        c.clipPath(path, stroke=0, fill=0)
        c.setFillColor(WHITE)
        c.rect(0, 0, CONTENT_W, h, stroke=0, fill=1)
        c.setFillColor(mix(WHITE, self.color, 0.06))
        c.rect(0, h - self.HEAD, CONTENT_W, self.HEAD, stroke=0, fill=1)
        c.setFillColor(self.color)
        c.rect(0, 0, 1.3 * mm, h, stroke=0, fill=1)
        c.restoreState()
        _round(c, 0, 0, CONTENT_W, h, 3.2 * mm, stroke=HAIR, width=0.7)
        widths = [52 * mm] + [40 * mm] * (len(self.columns) - 1)
        xs, x = [], 6 * mm
        for width in widths:
            xs.append(x)
            x += width
        note_x = x
        for (title, _), cx in zip(self.columns, xs):
            draw(c, cx, h - 4.9 * mm, title, SEMIBOLD, 6.2, mix(colors.black, self.color, 0.75), tracking=0.14)
        if self.has_notes:
            draw(c, note_x, h - 4.9 * mm, "NOTE", SEMIBOLD, 6.2, mix(colors.black, self.color, 0.75), tracking=0.14)
        y = h - self.HEAD
        for index, row in enumerate(self.rows):
            if index:
                c.saveState()
                c.setStrokeColor(colors.HexColor("#EEF2F6"))
                c.setLineWidth(0.6)
                c.line(6 * mm, y, CONTENT_W - 4 * mm, y)
                c.restoreState()
            baseline = y - self.ROW / 2 - 1.3
            for (_, field), cx in zip(self.columns, xs):
                if field == "label":
                    draw(c, cx, baseline, _fit(row["label"], SEMIBOLD, 9, 50 * mm), SEMIBOLD, 9, INK)
                else:
                    draw(c, cx, baseline, fmt_range(row.get(field)), MONO_BOLD, 9.6, INK if row.get(field) else FAINT)
            if row.get("note"):
                draw(c, note_x, baseline, _fit(row["note"], REGULAR, 7.4, CONTENT_W - note_x - 5 * mm), REGULAR, 7.4, MUTED)
            y -= self.ROW


def render_pace_pdf(result: dict[str, Any], prepared_by: str | None) -> bytes:
    reference = result["reference"]
    unit = result["unit"]
    story: list[Flowable] = [_Stats([
        ("Threshold (CSS)", fmt(reference["css_per_100"]), f"/100 {unit}", "gauge", SWIM),
        ("50 speed", fmt(reference["pace_50"]), f"/100 {unit}", "zap", AMBER),
        ("PBs used", str(reference["pbs_used"]), "", "list_checks", SKY),
        ("Start advantage", f"{result['start_advantage']:.1f}", "s", "timer", DONE),
    ]), Spacer(1, 6 * mm)]
    warnings = [flag["text"] for flag in result["flags"] if flag["level"] == "warning"]
    notes = [flag["text"] for flag in result["flags"] if flag["level"] != "warning"]
    if warnings:
        story += [_Callout("Check before you swim", "\n".join(f"•  {text}" for text in warnings), AMBER, "triangle_alert"), Spacer(1, 3 * mm)]
    if notes:
        story += [_Callout("How these paces were set", "\n".join(f"•  {text}" for text in notes), SWIM, "info"), Spacer(1, 3 * mm)]
    story.append(Spacer(1, 3 * mm))
    for zone in result["zones"]:
        color = zone_hex(zone["zone"])
        meta = f"{fmt_range(zone['per_100'])} /100 {unit}  ·  {zone['rest']}"
        block = [
            _SectionHeader(zone["zone"], color, meta, "activity"), Spacer(1, 2.6 * mm),
            Paragraph(_text(zone["purpose"]), _style("purpose", fontSize=9, leading=13, textColor=BODY)), Spacer(1, 2.8 * mm),
            _PaceTable(zone["rows"], result["display"], colors.HexColor(color), zone["dive_relevant"]), Spacer(1, 2.2 * mm),
            Paragraph(_text(f"Why: {zone['why']}"), _style("why", fontSize=7.6, leading=10.8, textColor=MUTED)),
        ]
        story += [KeepTogether(block), Spacer(1, 7 * mm)]

    athlete = result["athlete"]
    details = [COURSES[result["course"]], SUITS[result["suit"]]]
    by = whole(prepared_by)
    if by and by != athlete:
        details.append(f"Prepared by {by}")
    hero = {
        "tone": SWIM, "kicker": "Pace calculator", "date_line": datetime.now(timezone.utc).strftime("%d %B %Y"),
        "title": f"{athlete}  ·  {result['stroke']}", "details": details,
        "chips": [(f"CSS {fmt(reference['css_per_100'])} /100 {unit}", SWIM, "gauge"), (result["course"], SKY, "ruler"),
                  ({"BOTH": "Push and dive starts", "PUSH": "Push starts", "DIVE": "Dive starts"}[result["display"]], SLATE, "zap")],
        "compact": f"{athlete} · {result['stroke']} paces", "subject": "Pace calculator",
    }
    return build(hero, story)
