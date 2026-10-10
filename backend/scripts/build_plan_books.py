"""Builds SwimGPT's e-book editions of the premade training plans (premade_training_plans/*.pdf).

Buyers never receive a PDF. The reader redraws every page from the data written here: each page's vector shapes, every
line of text with each character's exact position, and the few images a book uses, all in the PDF's own drawing order,
so the pages match the originals one to one. Page metadata (week dividers, sessions, levels, titles) drives the reader's
contents, session tracking and search. plan_books/index.json sums each book up (pages, weeks, sessions a week) for the
store, which only sells plans that have a book.

Run from backend/ whenever a PDF changes. PyMuPDF and fontTools are needed only here, never by the API:

    pip install pymupdf fonttools brotli
    python scripts/build_plan_books.py
"""
from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

import pymupdf
from pymupdf import mupdf

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "premade_training_plans"
OUT = ROOT / "backend" / "plan_books"
FONTS = ROOT / "public" / "fonts" / "lato"
FORMAT = 1

# Store plan id -> source PDF. A plan without an entry here (or whose PDF is missing) has no book and isn't sold.
BOOKS = {
    "50-free-speed-lab": "50m Freestyle Speed.pdf",
    "100-race-pace-system": "100m Race Pace.pdf",
    "200-free-back-half": "200m Endurance and Speed.pdf",
    "distance-engine": "Distance Freestyle.pdf",
    "dryland-power": "Strength and Power.pdf",
    "im-mastery": "IM Performance.pdf",
    "age-group-foundations": "Age Group Development.pdf",
    "masters-comeback": "Masters Performance.pdf",
}
# The reader's font files for each PDF font (public/fonts/lato).
FONT_FILES = {
    "Lato-Regular": "lato-normal.woff2", "Lato-Italic": "lato-normal-italic.woff2", "Lato-Medium": "lato-medium.woff2",
    "Lato-Semibold": "lato-semibold.woff2", "Lato-Bold": "lato-bold.woff2", "Lato-Heavy": "lato-heavy.woff2", "Lato-Black": "lato-black.woff2",
}

SESSION_LABEL = re.compile(r"WEEK\s+(\d{1,2})\s*/\s*SESSION\s+(\d{1,2})(?:\s*/\s*LEVEL\s+(\d))?")
SUPPLEMENT_LABEL = re.compile(r"WEEK\s+(\d{1,2})\s*/\s*SUPPLEMENT")
VOLUME = re.compile(r"^(?:[\d.,]+(?:\s*/\s*[\d.,]+)?\s?(?:m|M|KM|km)|GYM)$")
NOT_A_TITLE = re.compile(r"^(?:[\d.,:/+%\s–-]+|[\d.,]+(?:\s*/\s*[\d.,]+)?\s?(?:m|M|KM|km|METRES)|SWIMGPT)$")


def num(value: float) -> float | int:
    rounded = round(value, 2)
    return int(rounded) if rounded == int(rounded) else rounded


def hex_color(rgb) -> str | None:
    if rgb is None:
        return None
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(channel * 255))) for channel in rgb)


def path_data(items, close: bool) -> tuple[str, int]:
    parts: list[str] = []
    current = None
    subpaths = 0

    def move(point) -> None:
        nonlocal subpaths
        if current is None or abs(current.x - point.x) > 1e-3 or abs(current.y - point.y) > 1e-3:
            parts.append(f"M{num(point.x)} {num(point.y)}")
            subpaths += 1

    for item in items:
        kind = item[0]
        if kind == "l":
            move(item[1])
            parts.append(f"L{num(item[2].x)} {num(item[2].y)}")
            current = item[2]
        elif kind == "c":
            move(item[1])
            c1, c2, end = item[2], item[3], item[4]
            parts.append(f"C{num(c1.x)} {num(c1.y)} {num(c2.x)} {num(c2.y)} {num(end.x)} {num(end.y)}")
            current = end
        elif kind == "re":
            r = item[1]
            parts.append(f"M{num(r.x0)} {num(r.y0)}H{num(r.x1)}V{num(r.y1)}H{num(r.x0)}Z")
            subpaths += 1
            current = None
        elif kind == "qu":
            q = item[1]
            parts.append(f"M{num(q.ul.x)} {num(q.ul.y)}L{num(q.ur.x)} {num(q.ur.y)}L{num(q.lr.x)} {num(q.lr.y)}L{num(q.ll.x)} {num(q.ll.y)}Z")
            subpaths += 1
            current = None
        else:
            raise ValueError(f"unknown path item {kind!r}")
    if close:
        parts.append("Z")
    return "".join(parts), subpaths


def path_op(drawing: dict) -> list:
    d, subpaths = path_data(drawing["items"], bool(drawing.get("closePath")))
    fills, strokes = "f" in drawing["type"], "s" in drawing["type"]
    extras: dict = {}
    if fills and drawing.get("fill_opacity") not in (None, 1):
        extras["fo"] = num(drawing["fill_opacity"])
    if strokes and drawing.get("stroke_opacity") not in (None, 1):
        extras["so"] = num(drawing["stroke_opacity"])
    if fills and drawing.get("even_odd") and subpaths > 1:
        extras["eo"] = 1
    if strokes:
        cap = (drawing.get("lineCap") or (0,))[0]
        join = drawing.get("lineJoin") or 0
        if cap:
            extras["cap"] = int(cap)
        if join:
            extras["join"] = int(join)
        if drawing.get("dashes") not in (None, "[] 0"):
            extras["dash"] = drawing["dashes"]
    width = num(drawing["width"] or 0) if strokes else 0
    if strokes and width == 0:
        width = 0.25  # PDF zero-width lines are the thinnest the device can draw
    op = ["p", d, hex_color(drawing["fill"]) if fills else None, hex_color(drawing["color"]) if strokes else None, width]
    if extras:
        op.append(extras)
    return op


def text_ops(span: dict, fonts: dict[str, int]) -> list[list]:
    if span["dir"] != (1.0, 0.0) or span["wmode"] or span["type"] != 0:
        raise ValueError(f"unsupported text span {span['font']} dir={span['dir']} type={span['type']}")
    font = re.sub(r"^[A-Z]{6}\+", "", span["font"])
    if font not in FONT_FILES:
        raise ValueError(f"no reader font for {font}")
    index = fonts.setdefault(font, len(fonts))
    lines: list[list] = []
    for unicode, _glyph, origin, _bbox in span["chars"]:
        if lines and abs(origin[1] - lines[-1][-1][1][1]) <= 0.01:
            lines[-1].append((unicode, origin))
        else:
            lines.append([(unicode, origin)])
    ops = []
    for line in lines:
        while line and chr(line[0][0]).isspace():
            line = line[1:]
        while line and chr(line[-1][0]).isspace():
            line = line[:-1]
        if not line:
            continue
        xs = [round(origin[0], 2) for _, origin in line]
        op = ["t", index, num(span["size"]), hex_color(span["color"]), num(xs[0]), num(line[0][1][1]),
              "".join(chr(unicode) for unicode, _ in line), [num(b - a) for a, b in zip(xs, xs[1:])]]
        if span["opacity"] != 1:
            op.append(num(span["opacity"]))
        ops.append(op)
    return ops


def image_source(doc: pymupdf.Document, xref: int) -> dict:
    info = doc.extract_image(xref)
    if info["smask"]:
        pixmap = pymupdf.Pixmap(pymupdf.Pixmap(doc, xref), pymupdf.Pixmap(doc, info["smask"]))
        data, mime = pixmap.tobytes("png"), "image/png"
    elif info["ext"] in ("png", "jpeg", "jpg"):
        data, mime = info["image"], "image/png" if info["ext"] == "png" else "image/jpeg"
    else:
        data, mime = pymupdf.Pixmap(doc, xref).tobytes("png"), "image/png"
    return {"w": info["width"], "h": info["height"], "src": f"data:{mime};base64,{base64.b64encode(data).decode()}"}


def traced_images(page: pymupdf.Page) -> list[tuple[float, list[float], int, int]]:
    """Every image the page draws, in order, as (alpha, transform, width, height). MuPDF's trace device sees all of them,
    including images drawn under transparency, which PyMuPDF's image listing leaves out."""
    buffer = mupdf.fz_new_buffer(4096)
    output = mupdf.FzOutput(buffer)
    device = mupdf.fz_new_trace_device(output)
    mupdf.fz_run_page(page.this, device, mupdf.FzMatrix(), mupdf.FzCookie())
    mupdf.fz_close_device(device)
    output.fz_close_output()
    trace = mupdf.fz_buffer_extract(buffer).decode("utf-8", "replace")
    # An image's own soft mask shows up as clip_image_mask around it; that alpha is already in the image we extract.
    if re.search(r"<(?:fill_image_mask|fill_shade|clip_path|clip_stroke_path|clip_text|clip_stroke_text|begin_mask|begin_tile)\b", trace):
        raise ValueError(f"page {page.number + 1}: uses masks, shadings, clipping or tiles, which the reader doesn't draw")
    draws = []
    for attributes in re.findall(r"<fill_image\b([^>]*)>", trace):
        fields = dict(re.findall(r'(\w+)="([^"]*)"', attributes))
        draws.append((float(fields["alpha"]), [float(v) for v in fields["transform"].split()], int(fields["width"]), int(fields["height"])))
    return draws


def page_ops(doc: pymupdf.Document, page: pymupdf.Page, fonts: dict[str, int], images: dict[str, dict]) -> list[list]:
    ordered: list[tuple[int, int, list]] = []
    for drawing in page.get_drawings(extended=True):
        if drawing["type"] in ("group", "clip"):
            if drawing["type"] == "clip" or drawing.get("opacity", 1) != 1 or drawing["rect"] != page.rect:
                raise ValueError(f"page {page.number + 1}: unsupported {drawing['type']}")
            continue
        ordered.append((drawing["seqno"], 0, path_op(drawing)))
    for span in page.get_texttrace():
        for part, op in enumerate(text_ops(span, fonts)):
            ordered.append((span["seqno"], part, op))
    slots = [seqno for seqno, (kind, _rect) in enumerate(page.get_bboxlog()) if kind == "fill-image"]
    draws = traced_images(page)
    if len(slots) != len(draws):
        raise ValueError(f"page {page.number + 1}: {len(slots)} image draws logged but {len(draws)} traced")
    listed = page.get_image_info(xrefs=True)
    by_size: dict[tuple[int, int], set[int]] = {}
    for image in page.get_images(full=True):
        by_size.setdefault((image[2], image[3]), set()).add(image[0])
    for seqno, (alpha, transform, width, height) in zip(slots, draws):
        # Which image: the listed draw at this exact position, or else the page's only image of this size.
        xref = next((info["xref"] for info in listed if all(abs(a - b) < 0.01 for a, b in zip(info["transform"], transform))), None)
        if xref is None:
            candidates = by_size.get((width, height), set())
            if len(candidates) != 1:
                raise ValueError(f"page {page.number + 1}: can't tell which {width}x{height} image is drawn at {transform}")
            xref = next(iter(candidates))
        key = f"i{xref}"
        if key not in images:
            images[key] = image_source(doc, xref)
        op = ["i", key, *(num(v) for v in transform)]
        if alpha != 1:
            op.append(num(alpha))
        ordered.append((seqno, 0, op))
    ordered.sort(key=lambda entry: (entry[0], entry[1]))
    return [op for _seqno, _part, op in ordered]


def page_background(ops: list[list], size: tuple[float, float]) -> str:
    """The colour a page reads as (thumbnail placeholders, the reader's page edges): its first full-page fill or image."""
    for op in ops[:3]:
        if op[0] == "p" and op[2] and op[1].startswith("M0 0H") and f"V{num(size[1])}" in op[1]:
            return op[2]
        if op[0] == "i" and op[2] >= size[0] - 1 and op[5] >= size[1] - 1:
            return "image"
    return "#ffffff"


def text_lines(ops: list[list]) -> list[tuple[float, float, float, str]]:
    return sorted((op[5], op[4], op[2], op[6]) for op in ops if op[0] == "t")


def heading(lines: list[tuple[float, float, float, str]], after: float = -1) -> tuple[str, float]:
    """The page's largest real heading (numbers, volumes and the logo word don't count), joined with the lines of a
    similar size right above or below it, so a headline set over two or three lines reads as one."""
    candidates = [line for line in lines if line[0] > after and not NOT_A_TITLE.match(line[3].strip())]
    if not candidates:
        return "", after
    top = max(range(len(candidates)), key=lambda i: candidates[i][2])
    size = candidates[top][2]
    first = last = top
    while last + 1 < len(candidates) and candidates[last + 1][2] >= size * 0.75 and candidates[last + 1][0] - candidates[last][0] <= candidates[last][2] * 1.7:
        last += 1
    while first > 0 and candidates[first - 1][2] >= size * 0.75 and candidates[first][0] - candidates[first - 1][0] <= candidates[first - 1][2] * 1.7:
        first -= 1
    group = candidates[first:last + 1]
    return " ".join(line[3].strip() for line in group), group[-1][0]


def page_meta(index: int, ops: list[list]) -> dict:
    lines = text_lines(ops)
    texts = [line[3] for line in lines]
    if index == 0:
        return {"k": "cover", "t": heading(lines)[0]}
    for text in texts:
        if match := SESSION_LABEL.search(text):
            title, title_end = heading([line for line in lines if not SESSION_LABEL.search(line[3])])
            subtitle = next((line[3].strip() for line in lines if title_end < line[0] <= title_end + 34 and 9.5 <= line[2] <= 16
                             and not NOT_A_TITLE.match(line[3].strip())), "")
            volumes = sorted((line for line in lines if line[2] >= 18 and VOLUME.match(line[3].strip())), key=lambda line: -line[2])
            meta = {"k": "session", "w": int(match.group(1)), "s": int(match.group(2)), "t": title, "st": subtitle,
                    "v": volumes[0][3].strip() if volumes else ""}
            if match.group(3):
                meta["l"] = int(match.group(3))
            return meta
        if match := SUPPLEMENT_LABEL.search(text):
            title, _ = heading([line for line in lines if not SUPPLEMENT_LABEL.search(line[3])])
            return {"k": "session", "w": int(match.group(1)), "s": 0, "t": title, "st": "Supplementary session", "v": ""}
    big = [line for line in lines if line[2] >= 90 and re.fullmatch(r"\d{2}", line[3].strip())]
    if big:
        title, _ = heading([line for line in lines if line[2] < 90])
        return {"k": "week", "w": int(big[0][3]), "t": title}
    return {"k": "page", "t": heading(lines)[0]}


def contents(pages: list[dict]) -> tuple[list[dict], list[dict]]:
    """The reader's table of contents and the list of trackable sessions, both from the page metadata."""
    toc: list[dict] = []
    sessions: dict[tuple[int, int], dict] = {}
    week_entry = None
    last_week_page = max((index for index, page in enumerate(pages) if page["meta"]["k"] in ("week", "session")), default=-1)
    for index, page in enumerate(pages):
        meta = page["meta"]
        if meta["k"] == "week":
            week_entry = {"t": f"Week {meta['w']:02d}", "st": meta["t"], "p": index, "w": meta["w"], "c": []}
            toc.append(week_entry)
        elif meta["k"] == "session":
            key = (meta["w"], meta["s"])
            if key not in sessions:
                sessions[key] = {"id": f"w{meta['w']}s{meta['s']}", "w": meta["w"], "s": meta["s"], "p": index, "t": meta["t"],
                                 "st": meta["st"], "v": meta["v"], "levels": {}}
                label = "Supplement" if meta["s"] == 0 else f"Session {meta['s']:02d}"
                child = {"t": label, "st": meta["t"], "p": index, "session": sessions[key]["id"]}
                if week_entry is not None and week_entry["w"] == meta["w"]:
                    week_entry["c"].append(child)
                else:
                    toc.append(child)
            if "l" in meta:
                sessions[key]["levels"][str(meta["l"])] = {"p": index, "v": meta["v"]}
        elif week_entry is not None and index < last_week_page:
            week_entry["c"].append({"t": meta["t"], "p": index})  # a plain page inside a week stays in that week
        else:
            toc.append({"t": "Cover" if meta["k"] == "cover" else meta["t"], "p": index})
    for session in sessions.values():
        if not session["levels"]:
            del session["levels"]
    return toc, sorted(sessions.values(), key=lambda s: (s["w"], s["s"] == 0, s["s"]))


def check_fonts(books: list[dict]) -> None:
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("fontTools isn't installed: skipped checking the reader fonts cover every character")
        return
    for font_name, file_name in FONT_FILES.items():
        cmap = TTFont(FONTS / file_name).getBestCmap()
        missing = {char for book in books for page in book["pages"] for op in page["ops"]
                   if op[0] == "t" and book["fonts"][op[1]] == font_name for char in op[6] if ord(char) not in cmap and not char.isspace()}
        if missing:
            raise SystemExit(f"{file_name} is missing {''.join(sorted(missing))!r}")


def build(plan_id: str, file_name: str) -> dict:
    doc = pymupdf.open(SOURCE / file_name)
    size = (num(doc[0].rect.width), num(doc[0].rect.height))
    fonts: dict[str, int] = {}
    images: dict[str, dict] = {}
    pages = []
    for page in doc:
        if (num(page.rect.width), num(page.rect.height)) != size or page.rotation:
            raise ValueError(f"{file_name} page {page.number + 1}: pages must share one size, unrotated")
        ops = page_ops(doc, page, fonts, images)
        entry = {"bg": page_background(ops, size), "ops": ops, "meta": page_meta(page.number, ops)}
        links = [[num(link["from"].x0), num(link["from"].y0), num(link["from"].x1), num(link["from"].y1), link["page"]]
                 for link in page.get_links() if link["kind"] == pymupdf.LINK_GOTO and 0 <= link["page"] < len(doc)]
        if links:
            entry["links"] = links
        pages.append(entry)
    toc, sessions = contents(pages)
    return {"format": FORMAT, "plan_id": plan_id, "source": file_name, "size": list(size), "fonts": list(fonts),
            "images": images, "pages": pages, "toc": toc, "sessions": sessions}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    books = []
    for plan_id, file_name in BOOKS.items():
        if not (SOURCE / file_name).exists():
            print(f"skipped {plan_id}: {file_name} isn't in {SOURCE.name}/")
            continue
        book = build(plan_id, file_name)
        books.append(book)
        data = json.dumps(book, ensure_ascii=False, separators=(",", ":"))
        (OUT / f"{plan_id}.json").write_text(data, encoding="utf-8")
        print(f"{plan_id}: {len(book['pages'])} pages, {len(book['sessions'])} sessions, {len(data) / 1024:.0f} KB")
    check_fonts(books)
    index = {book["plan_id"]: {"pages": len(book["pages"]), "weeks": max(s["w"] for s in book["sessions"]),
                               "sessions_per_week": sum(1 for s in book["sessions"] if s["w"] == 1), "sessions": len(book["sessions"])}
             for book in books}
    (OUT / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    stale = {path.stem for path in OUT.glob("*.json")} - {book["plan_id"] for book in books} - {"index"}
    for plan_id in sorted(stale):
        print(f"note: {plan_id}.json has no source PDF any more; delete it if that plan shouldn't be readable")


if __name__ == "__main__":
    sys.exit(main())
