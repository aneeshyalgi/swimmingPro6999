"""Branded PDF export of the Pace Calculator: one coloured section and pace table per training zone."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, KeepTogether, Paragraph, Spacer

from app.week_pdf import ZONE_COLORS, _build, _fit
from app.workout_pdf import (
    BODY, CONTENT_W, CYAN, HAIR, INK, MUTED, NAVY, TINT, VIOLET, WHITE, _Callout, _SectionHeader, _Stats, _style, _text,
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
    """Rep / push / dive / note rows on a tinted card with the zone's colour stripe."""

    ROW = 7.6 * mm
    HEAD = 7 * mm

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
        path.roundRect(0, 0, CONTENT_W, h, 3 * mm)
        c.clipPath(path, stroke=0, fill=0)
        c.setFillColor(TINT)
        c.rect(0, 0, CONTENT_W, h, stroke=0, fill=1)
        c.setFillColor(self.color)
        c.rect(0, 0, 1.4 * mm, h, stroke=0, fill=1)
        c.restoreState()
        widths = [52 * mm] + [38 * mm] * (len(self.columns) - 1)
        xs, x = [], 6 * mm
        for width in widths:
            xs.append(x)
            x += width
        note_x = x
        c.setFont("Helvetica-Bold", 6.6)
        c.setFillColor(MUTED)
        for (title, _), cx in zip(self.columns, xs):
            c.drawString(cx, h - 4.8 * mm, title)
        if self.has_notes:
            c.drawString(note_x, h - 4.8 * mm, "NOTE")
        y = h - self.HEAD
        for index, row in enumerate(self.rows):
            if index:
                c.setStrokeColor(HAIR)
                c.setLineWidth(0.5)
                c.line(6 * mm, y, CONTENT_W - 4 * mm, y)
            baseline = y - self.ROW / 2 - 1.2
            for (_, field), cx in zip(self.columns, xs):
                if field == "label":
                    c.setFont("Helvetica-Bold", 9)
                    c.setFillColor(INK)
                    c.drawString(cx, baseline, _fit(row["label"], "Helvetica-Bold", 9, 50 * mm))
                else:
                    c.setFont("Helvetica-Bold", 10)
                    c.setFillColor(INK if row.get(field) else MUTED)
                    c.drawString(cx, baseline, fmt_range(row.get(field)))
            if row.get("note"):
                c.setFont("Helvetica", 7.4)
                c.setFillColor(MUTED)
                c.drawString(note_x, baseline, _fit(row["note"], "Helvetica", 7.4, CONTENT_W - note_x - 5 * mm))
            y -= self.ROW


def render_pace_pdf(result: dict[str, Any], prepared_by: str | None) -> bytes:
    reference = result["reference"]
    unit = result["unit"]
    story: list[Flowable] = [_Stats([
        ("Threshold (CSS)", fmt(reference["css_per_100"]), f"/100 {unit}"),
        ("50 speed", fmt(reference["pace_50"]), f"/100 {unit}"),
        ("PBs used", str(reference["pbs_used"]), ""),
        ("Start advantage", f"{result['start_advantage']:.1f}", "s"),
    ]), Spacer(1, 6 * mm)]
    warnings = [flag["text"] for flag in result["flags"] if flag["level"] == "warning"]
    notes = [flag["text"] for flag in result["flags"] if flag["level"] != "warning"]
    if warnings:
        story += [_Callout("Check before you swim", "\n".join(f"•  {text}" for text in warnings), colors.HexColor("#D97706")), Spacer(1, 3 * mm)]
    if notes:
        story += [_Callout("How these paces were set", "\n".join(f"•  {text}" for text in notes), colors.HexColor("#0891B2")), Spacer(1, 3 * mm)]
    story.append(Spacer(1, 3 * mm))
    for zone in result["zones"]:
        color = zone_hex(zone["zone"])
        meta = f"{fmt_range(zone['per_100'])} /100 {unit}  ·  {zone['rest']}"
        block = [
            _SectionHeader(zone["zone"], color, meta), Spacer(1, 2.5 * mm),
            Paragraph(_text(zone["purpose"]), _style("purpose", fontSize=9, leading=13, textColor=BODY)), Spacer(1, 2.5 * mm),
            _PaceTable(zone["rows"], result["display"], colors.HexColor(color), zone["dive_relevant"]), Spacer(1, 2 * mm),
            Paragraph(_text(f"Why: {zone['why']}"), _style("why", fontSize=7.6, leading=10.5, textColor=MUTED)),
        ]
        story += [KeepTogether(block), Spacer(1, 7 * mm)]

    athlete = result["athlete"]
    details = [COURSES[result["course"]], SUITS[result["suit"]]]
    if prepared_by and prepared_by != athlete:
        details.append(f"Prepared by {prepared_by}")
    hero = {
        "kicker": "PACE CALCULATOR", "date_line": datetime.now(timezone.utc).strftime("%d %B %Y"),
        "title": f"{athlete}  ·  {result['stroke']}", "details": details,
        "pills": [(f"CSS {fmt(reference['css_per_100'])}/100", CYAN, NAVY, 1), (result["course"], VIOLET, NAVY, 1),
                  ({"BOTH": "PUSH + DIVE", "PUSH": "PUSH STARTS", "DIVE": "DIVE STARTS"}[result["display"]], WHITE, WHITE, 0.12)],
        "compact": f"{athlete} · {result['stroke']} paces", "subject": "Pace calculator",
    }
    return _build(hero, story)
