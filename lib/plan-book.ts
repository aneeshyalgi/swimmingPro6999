/** SwimGPT's e-book format for the premade training plans (built by backend/scripts/build_plan_books.py).
 *
 * Every page is the original PDF page's drawing, op by op in its own order: vector paths, lines of text with each
 * character's exact x position, and images. The reader redraws them as SVG, so pages match the originals one to one
 * while the text stays real text (crisp at any zoom, searchable, selectable). */

/** ["p", path data, fill, stroke, stroke width, extras] */
export type PathOp = ["p", string, string | null, string | null, number, PathExtras?]
export type PathExtras = { fo?: number; so?: number; eo?: 1; cap?: number; join?: number; dash?: string }
/** ["t", font index, size, colour, x, baseline y, text, gaps between each character's x, opacity] */
export type TextOp = ["t", number, number, string, number, number, string, number[], number?]
/** ["i", image key, a, b, c, d, e, f (maps the unit square onto the page), opacity] */
export type ImageOp = ["i", string, number, number, number, number, number, number, number?]
export type Op = PathOp | TextOp | ImageOp

export type PageMeta =
  | { k: "cover"; t: string }
  | { k: "page"; t: string }
  | { k: "week"; w: number; t: string }
  | { k: "session"; w: number; s: number; t: string; st: string; v: string; l?: number }

export type BookPage = {
  /** The colour the page reads as ("image" for a photographic background). */
  bg: string
  ops: Op[]
  meta: PageMeta
  /** In-book links: [x0, y0, x1, y1, target page index] */
  links?: [number, number, number, number, number][]
}

export type TocEntry = { t: string; st?: string; p: number; w?: number; session?: string; c?: TocEntry[] }

export type BookSession = {
  id: string
  w: number
  /** 0 for a week's supplementary session */
  s: number
  p: number
  t: string
  st: string
  v: string
  /** Books written at two levels (Age Group): each level's page and distance. */
  levels?: Record<string, { p: number; v: string }>
}

export type Book = {
  format: number
  plan_id: string
  size: [number, number]
  fonts: string[]
  images: Record<string, { w: number; h: number; src: string }>
  pages: BookPage[]
  toc: TocEntry[]
  sessions: BookSession[]
}

/** Each PDF font as the reader's "SwimGPT Book" face (Lato 2.0, self-hosted in public/fonts/lato). */
export const FONT_FACES: Record<string, { weight: number; italic?: boolean }> = {
  "Lato-Regular": { weight: 400 },
  "Lato-Italic": { weight: 400, italic: true },
  "Lato-Medium": { weight: 500 },
  "Lato-Semibold": { weight: 600 },
  "Lato-Bold": { weight: 700 },
  "Lato-Heavy": { weight: 800 },
  "Lato-Black": { weight: 900 },
}

/** Each character's x on the page, rebuilt from the line's start and the gaps between characters. */
export function characterXs(op: TextOp): number[] {
  const xs = [op[4]]
  let x = op[4]
  for (const gap of op[7]) {
    x = Math.round((x + gap) * 100) / 100
    xs.push(x)
  }
  return xs
}

/** The page's text lines in reading order: top to bottom, then left to right. */
export function pageLines(page: BookPage): TextOp[] {
  return page.ops
    .filter((op): op is TextOp => op[0] === "t")
    .sort((a, b) => (Math.abs(a[5] - b[5]) > 1 ? a[5] - b[5] : a[4] - b[4]))
}

export type Highlight = { x: number; y: number; w: number; h: number }
export type SearchHit = { page: number; snippet: [string, string, string]; rects: Highlight[] }

const fold = (text: string) => text.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")

/** Every place the query appears, page by page, with a snippet around it and the boxes to highlight on the page. */
export function searchBook(book: Book, query: string, limit = 200): SearchHit[] {
  const needle = fold(query.trim()).replace(/\s+/g, " ")
  if (needle.length < 2) return []
  const hits: SearchHit[] = []
  book.pages.forEach((page, pageIndex) => {
    for (const line of pageLines(page)) {
      const haystack = fold(line[6]).replace(/\s/g, " ")
      let from = haystack.indexOf(needle)
      while (from !== -1 && hits.length < limit) {
        const to = from + needle.length
        const xs = characterXs(line)
        const lastGap = to < xs.length ? xs[to] - xs[to - 1] : line[2] * 0.55
        const text = line[6]
        hits.push({
          page: pageIndex,
          snippet: [text.slice(Math.max(0, from - 36), from), text.slice(from, to), text.slice(to, to + 48)],
          rects: [{ x: xs[from] - 0.6, y: line[5] - line[2] * 0.82, w: xs[to - 1] + lastGap - xs[from] + 1.2, h: line[2] * 1.06 }],
        })
        from = haystack.indexOf(needle, to)
      }
    }
  })
  return hits
}

/** A short label for a page: what the contents call it. */
export function pageLabel(book: Book, index: number): string {
  const meta = book.pages[index]?.meta
  if (!meta) return ""
  if (meta.k === "cover") return "Cover"
  if (meta.k === "week") return `Week ${String(meta.w).padStart(2, "0")} · ${titleCase(meta.t)}`
  if (meta.k === "session") {
    const level = meta.l ? ` · Level ${meta.l}` : ""
    return `Week ${String(meta.w).padStart(2, "0")} · ${meta.s ? `Session ${String(meta.s).padStart(2, "0")}` : "Supplement"}${level}`
  }
  return titleCase(meta.t)
}

/** What a spread shows, in one line: "Week 01 · Sessions 02 & 03" rather than both pages' labels. */
export function spreadLabel(book: Book, pages: number[]): string {
  const metas = pages.map((index) => book.pages[index]?.meta)
  if (metas.length === 2 && metas[0]?.k === "session" && metas[1]?.k === "session" && metas[0].w === metas[1].w && metas[0].s === metas[1].s && metas[0].l && metas[1].l) {
    return `Week ${String(metas[0].w).padStart(2, "0")} · Session ${String(metas[0].s).padStart(2, "0")} · Levels ${metas[0].l} & ${metas[1].l}`
  }
  if (metas.length === 2 && metas[0]?.k === "session" && metas[1]?.k === "session" && metas[0].w === metas[1].w && metas[0].s && metas[1].s && !metas[0].l && !metas[1].l) {
    return `Week ${String(metas[0].w).padStart(2, "0")} · Sessions ${String(metas[0].s).padStart(2, "0")} & ${String(metas[1].s).padStart(2, "0")}`
  }
  return [...new Set(pages.map((index) => pageLabel(book, index)))].join("  ·  ")
}

const KEEP_UPPER = /^(?:IM|USRPT|VO2MAX|FES|BES|MS|RPE|PB|SCM|LCM|SCY|CSS|TT|ID|II|III|PM|AM|\d.*)$/

/** "TOP END SPEED" -> "Top End Speed" (acronyms and numbers stay as they are); mixed-case text is left alone. */
export function titleCase(text: string): string {
  if (text !== text.toUpperCase()) return text
  return text
    .toLowerCase()
    .split(/(\s+|\/|\+|-|&)/)
    .map((word) => (KEEP_UPPER.test(word.toUpperCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("")
}

/** Where a reader is in a book and which sessions they've ticked off. Kept in this browser, per account and plan. */
export type ReadingProgress = { page: number; done: string[]; at: number }

const progressKey = (userId: string, planId: string) => `swimgpt:plan-book:${userId}:${planId}`

export function readProgress(userId: string, planId: string): ReadingProgress | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(progressKey(userId, planId)) ?? "null")
    if (!saved || typeof saved.page !== "number" || !Array.isArray(saved.done)) return null
    return { page: saved.page, done: saved.done.filter((id: unknown) => typeof id === "string"), at: Number(saved.at) || 0 }
  } catch {
    return null
  }
}

export function writeProgress(userId: string, planId: string, progress: ReadingProgress) {
  try {
    window.localStorage.setItem(progressKey(userId, planId), JSON.stringify(progress))
  } catch {}
}

/** Each page's session id (both levels of a two-level session share one). */
export function sessionsByPage(book: Book): Map<number, BookSession> {
  const map = new Map<number, BookSession>()
  for (const session of book.sessions) {
    map.set(session.p, session)
    for (const level of Object.values(session.levels ?? {})) map.set(level.p, session)
  }
  return map
}
