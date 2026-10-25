/**
 * The coach's chat replies read into blocks and inline pieces, for components/chat-markdown.tsx to draw. The coach
 * writes Markdown, and it's read the way the coach means it rather than strictly by CommonMark:
 *
 * - A list goes on across blank lines and sub-lists, so its numbers do too (1, 2, 3, never 1, 1, 1). A blank line
 *   between items only adds a little space, the way the coach groups the parts of a set.
 * - Whatever is indented under an item belongs to it (its points, a note), however many spaces it's indented by.
 * - Points or notes written without indenting, straight under a numbered item or between it and the next number,
 *   belong to that item too.
 * - Every line is its own line: "Total: ~2180 m" and "Goal: …" on the next line stay on two lines.
 * - Text after a list, not indented, is a new paragraph rather than more of the list's last item.
 * - "---" is a divider; headings, tables, code and quotes are read too, and source markers ([1]) are dropped.
 *
 * Emphasis (bold, italic, strikethrough), code and links follow CommonMark's rules.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }

export type Align = "left" | "center" | "right" | null

/** `gap`: a blank line came before the item, so it starts a new group. */
export type ListItem = { blocks: Block[]; gap: boolean }

export type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "rule" }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "table"; align: Align[]; head: string[]; rows: string[][] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }

type List = Extract<Block, { kind: "list" }>
type Paragraph = Extract<Block, { kind: "paragraph" }>
type Line = { indent: number; text: string; raw: string; blank: boolean }
// An open list: how far its markers are indented, its latest item and that item's number as written. `nested`: points
// written without indenting under a numbered item, which end when the numbering goes on. `flat`: a numbered list
// whose points or notes the coach writes without indenting them, so its last item's are its own too.
type Frame = { list: List; indent: number; item: ListItem; number: number; nested: boolean; flat: boolean }

const BULLET = /^[-*+•]\s+(.*)$/
const NUMBERED = /^(\d{1,9})[.)]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/
const RULE = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/
// A code fence: three or more backticks (with no backtick after them: "```x```" is code in a line) or tildes.
const FENCE = /^(?:(`{3,})[^`]*|(~{3,}).*)$/
const QUOTE = /^>\s?/
const DIVIDER_CELL = /^:?-+:?$/
// Source markers ([1], [1, 2]) and the space before them; a link's text ([1](…)) stays.
const SOURCE = /[ \t]*\[\d+(?:\s*,\s*\d+)*\](?!\()/g

/** The fence a line opens or closes code with ("```", "~~~~"), or null. */
const fenceOf = (text: string): string | null => {
  const fence = text.match(FENCE)
  return fence ? fence[1] ?? fence[2] : null
}

/** Whether `text` closes code opened with `fence`: the same character, at least as many, and nothing after them. */
const closes = (text: string, fence: string) => /^(`+|~+)$/.test(text) && text[0] === fence[0] && text.length >= fence.length

function readLines(content: string): Line[] {
  return content.replace(/\r\n?/g, "\n").replace(SOURCE, "").split("\n").map((raw) => {
    const lead = raw.match(/^[ \t]*/)![0]
    // A hard break at a line's end (two spaces or a backslash) isn't needed: every line is its own line.
    const text = raw.slice(lead.length).trimEnd().replace(/\\$/, "").trimEnd()
    return { indent: lead.replace(/\t/g, "    ").length, text, raw, blank: !text }
  })
}

/** A line with up to `indent` columns of its indentation taken off (for code inside a list item). */
function outdent(raw: string, indent: number): string {
  let column = 0
  let index = 0
  while (index < raw.length && column < indent && (raw[index] === " " || raw[index] === "\t")) {
    column += raw[index] === "\t" ? 4 : 1
    index++
  }
  return raw.slice(index)
}

/** A table row's cells: split at each "|" that isn't escaped, without the row's outer pipes. */
function cells(text: string): string[] {
  let row = text.trim()
  if (row.startsWith("|")) row = row.slice(1)
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1)
  const found: string[] = []
  let cell = ""
  for (let index = 0; index < row.length; index++) {
    if (row[index] === "\\" && row[index + 1] === "|") {
      cell += "|"
      index++
    } else if (row[index] === "|") {
      found.push(cell.trim())
      cell = ""
    } else {
      cell += row[index]
    }
  }
  found.push(cell.trim())
  return found
}

/** The table starting at line `at` (a header row, then a row of dashes), and the line after it; null if there isn't one. */
function tableAt(lines: Line[], at: number): { table: Block; end: number } | null {
  const header = lines[at]
  const divider = lines[at + 1]
  if (!divider || divider.blank || !header.text.includes("|") || !divider.text.includes("-")) return null
  const head = cells(header.text)
  const marks = cells(divider.text)
  if (head.length !== marks.length || !marks.every((mark) => DIVIDER_CELL.test(mark))) return null
  const align = marks.map((mark): Align =>
    mark.startsWith(":") && mark.endsWith(":") ? "center" : mark.endsWith(":") ? "right" : mark.startsWith(":") ? "left" : null)
  const rows: string[][] = []
  let end = at + 2
  for (; end < lines.length && !lines[end].blank && lines[end].text.includes("|"); end++) {
    const row = cells(lines[end].text)
    rows.push(head.map((_, column) => row[column] ?? ""))
  }
  return { table: { kind: "table", align, head, rows }, end }
}

/** Whether `frame`'s numbering goes on after line `at`: the next numbered item at its level, before any heading or
 *  divider, is the next number (or the same one, for a coach who numbers every item 1). */
function numberingGoesOn(lines: Line[], at: number, frame: Frame): boolean {
  for (let index = at + 1; index < lines.length; index++) {
    const { indent, text, blank } = lines[index]
    if (blank) continue
    const fence = fenceOf(text)
    if (fence) {
      // Skip the code: what's in it isn't the reply's numbering.
      while (++index < lines.length && !closes(lines[index].text, fence)) { /* inside the code */ }
      continue
    }
    if (indent > frame.indent + 1) continue
    if (HEADING.test(text) || RULE.test(text)) return false
    const numbered = text.match(NUMBERED)
    if (numbered) return Number(numbered[1]) === frame.number + 1 || Number(numbered[1]) === frame.number
  }
  return false
}

export function parseBlocks(content: string): Block[] {
  const lines = readLines(content)
  const root: Block[] = []
  const stack: Frame[] = []
  // The paragraph the next line carries on, if it isn't something else. (Set in the helpers below too, so TypeScript
  // mustn't narrow it to null here.)
  let paragraph = null as Paragraph | null
  // A blank line came before the current one.
  let blank = false

  const top = () => stack[stack.length - 1]
  const add = (block: Block, into: Block[]) => {
    into.push(block)
    paragraph = block.kind === "paragraph" ? block : null
  }

  // Where a line that isn't a list item goes: into the deepest open item it's indented under; not indented, after the
  // lists, or into the numbered item before it when the numbering goes on after it (or it's straight under an item of
  // a list whose notes aren't indented).
  const owner = (indent: number, at: number): Block[] => {
    for (let depth = stack.length - 1; depth >= 0; depth--) {
      if (indent > stack[depth].indent + 1) {
        stack.length = depth + 1
        return stack[depth].item.blocks
      }
    }
    const list = stack[0]
    if (list?.list.ordered && ((!blank && list.flat) || numberingGoesOn(lines, at, list))) {
      stack.length = 1
      list.flat = true
      return list.item.blocks
    }
    stack.length = 0
    return root
  }

  const open = (into: Block[], indent: number, ordered: boolean, number: number, content: string, nested = false) => {
    const item: ListItem = { blocks: [], gap: false }
    // Straight after a list of the same kind (a sub-list indented unevenly, say), the list goes on.
    const last = into[into.length - 1]
    const list: List = last?.kind === "list" && last.ordered === ordered ? last : { kind: "list", ordered, start: ordered ? number : 1, items: [] }
    if (list !== last) into.push(list)
    else item.gap = blank
    list.items.push(item)
    stack.push({ list, indent, item, number, nested, flat: false })
    paragraph = null
    if (content) add({ kind: "paragraph", lines: [content] }, item.blocks)
  }

  const listItem = (indent: number, ordered: boolean, number: number, content: string, at: number) => {
    // Lists this item is outdented from have ended.
    while (stack.length && indent < top().indent - 1) stack.pop()
    const level = () => (stack.length && Math.abs(indent - top().indent) <= 1 ? top() : undefined)
    let frame = level()
    // Unindented points under a numbered item end at the next number.
    while (frame && frame.nested && frame.list.ordered !== ordered) {
      stack.pop()
      frame = level()
    }
    if (frame && frame.list.ordered !== ordered) {
      if (frame.list.ordered && (!blank || frame.flat || numberingGoesOn(lines, at, frame))) {
        // Points written straight under a numbered item, or between it and the next number, are that item's points.
        frame.flat = true
        open(frame.item.blocks, frame.indent, ordered, number, content, true)
        return
      }
      stack.pop()
      frame = undefined
    }
    if (!frame) {
      open(stack.length ? top().item.blocks : root, indent, ordered, number, content)
      return
    }
    // The list's next item, however far from the last (a blank line between them only adds a little space).
    const item: ListItem = { blocks: [], gap: blank }
    frame.list.items.push(item)
    frame.item = item
    frame.number = number
    paragraph = null
    if (content) add({ kind: "paragraph", lines: [content] }, item.blocks)
  }

  for (let at = 0; at < lines.length; at++) {
    const { indent, text, blank: empty } = lines[at]
    if (empty) {
      paragraph = null
      blank = true
      continue
    }

    const fence = fenceOf(text)
    const heading = text.match(HEADING)
    const bullet = text.match(BULLET)
    const numbered = bullet ? null : text.match(NUMBERED)
    const table = text.includes("|") ? tableAt(lines, at) : null
    if (fence) {
      const into = owner(indent, at)
      const code: string[] = []
      let end = at + 1
      for (; end < lines.length && !closes(lines[end].text, fence); end++) code.push(outdent(lines[end].raw, indent))
      add({ kind: "code", text: code.join("\n").replace(/\n+$/, "") }, into)
      paragraph = null
      at = end
    } else if (heading) {
      stack.length = 0
      add({ kind: "heading", level: heading[1].length, text: heading[2] }, root)
      paragraph = null
    } else if (RULE.test(text)) {
      stack.length = 0
      add({ kind: "rule" }, root)
    } else if (table) {
      add(table.table, owner(indent, at))
      paragraph = null
      at = table.end - 1
    } else if (QUOTE.test(text)) {
      const into = owner(indent, at)
      const quoted: string[] = []
      let end = at
      for (; end < lines.length && QUOTE.test(lines[end].text); end++) quoted.push(lines[end].text.replace(QUOTE, ""))
      add({ kind: "quote", blocks: parseBlocks(quoted.join("\n")) }, into)
      paragraph = null
      at = end - 1
    } else if (bullet || numbered) {
      listItem(indent, Boolean(numbered), numbered ? Number(numbered[1]) : 0, bullet ? bullet[1] : numbered![2], at)
    } else {
      const into = owner(indent, at)
      if (paragraph && !blank && into[into.length - 1] === paragraph) paragraph.lines.push(text)
      else add({ kind: "paragraph", lines: [text] }, into)
    }
    blank = false
  }
  return root
}

// ---------------------------------------------------------------- inline: emphasis, code and links

type Delimiter = { kind: "delimiter"; char: "*" | "_" | "~"; count: number; length: number; opens: boolean; closes: boolean }
type Piece = Inline | Delimiter

const ESCAPABLE = /[!-/:-@[-`{-~]/
const LINK = /^\[([^\][\n]+)\]\(\s*(?:<([^<>\n]+)>|((?:[^\s()<>]|\([^\s()<>]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i
const BARE_URL = /^https?:\/\/[^\s<]+/i
// A bare link's end: closing punctuation isn't part of it.
const URL_END = /[?!.,:;*_~'"\])]+$/
const BREAK_TAG = /^<br\s*\/?>/i

const isSpace = (char: string) => !char || /\s/u.test(char)
const isPunctuation = (char: string) => /[\p{P}\p{S}]/u.test(char)

function text(pieces: Piece[]): Inline[] {
  const merged: Inline[] = []
  for (const piece of pieces) {
    const inline: Inline = piece.kind === "delimiter" ? { kind: "text", text: piece.char.repeat(piece.count) } : piece
    const last = merged[merged.length - 1]
    if (inline.kind === "text" && last?.kind === "text") merged[merged.length - 1] = { kind: "text", text: last.text + inline.text }
    else if (inline.kind !== "text" || inline.text) merged.push(inline)
  }
  return merged
}

/** Matches emphasis delimiters, innermost first, as CommonMark does ("process emphasis"). */
function emphasise(pieces: Piece[]): void {
  let at = 0
  while (at < pieces.length) {
    const closer = pieces[at]
    if (closer.kind !== "delimiter" || !closer.closes || !closer.count) {
      at++
      continue
    }
    let from = at - 1
    for (; from >= 0; from--) {
      const opener = pieces[from]
      if (opener.kind !== "delimiter" || opener.char !== closer.char || !opener.opens || !opener.count) continue
      if (closer.char === "~") {
        if (opener.count === closer.count) break
      } else if (!((opener.closes || closer.opens) && (opener.length + closer.length) % 3 === 0 && (opener.length % 3 || closer.length % 3))) {
        break
      }
    }
    if (from < 0) {
      at++
      continue
    }
    const opener = pieces[from] as Delimiter
    const used = closer.char === "~" ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1
    const kind = closer.char === "~" ? "del" : used === 2 ? "strong" : "em"
    opener.count -= used
    closer.count -= used
    pieces.splice(from + 1, at - from - 1, { kind, children: text(pieces.slice(from + 1, at)) })
    at = from + 2
    if (!opener.count) {
      pieces.splice(from, 1)
      at--
    }
    if (!closer.count) pieces.splice(at, 1)
  }
}

/** `links`: false inside a link's own text, which can't hold another link. */
export function parseInline(source: string, links = true): Inline[] {
  const pieces: Piece[] = []
  let plain = ""
  const flush = () => {
    if (plain) pieces.push({ kind: "text", text: plain })
    plain = ""
  }
  for (let at = 0; at < source.length;) {
    const char = source[at]
    const rest = source.slice(at)
    if (char === "\\" && ESCAPABLE.test(source[at + 1] ?? "")) {
      plain += source[at + 1]
      at += 2
      continue
    }
    if (char === "`") {
      const run = rest.match(/^`+/)![0]
      let close = at + run.length
      for (;;) {
        close = source.indexOf(run, close)
        if (close < 0 || source[close + run.length] !== "`") break
        close = source.slice(close).match(/^`+/)![0].length + close
      }
      if (close >= 0 && source[close - 1] !== "`") {
        let code = source.slice(at + run.length, close).replace(/\n/g, " ")
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1)
        flush()
        pieces.push({ kind: "code", text: code })
        at = close + run.length
        continue
      }
      plain += run
      at += run.length
      continue
    }
    const link = !links ? null : char === "[" ? rest.match(LINK) : char === "<" ? rest.match(AUTOLINK) : null
    if (link) {
      flush()
      pieces.push(char === "["
        ? { kind: "link", href: link[2] ?? link[3], children: parseInline(link[1], false) }
        : { kind: "link", href: link[1], children: [{ kind: "text", text: link[1] }] })
      at += link[0].length
      continue
    }
    const breakTag = char === "<" ? rest.match(BREAK_TAG) : null
    if (breakTag) {
      plain += "\n"
      at += breakTag[0].length
      continue
    }
    if (links && (char === "h" || char === "H") && (at === 0 || /[\s(*_~]/.test(source[at - 1]))) {
      const url = rest.match(BARE_URL)?.[0].replace(URL_END, "")
      if (url && url.length > 8) {
        flush()
        pieces.push({ kind: "link", href: url, children: [{ kind: "text", text: url }] })
        at += url.length
        continue
      }
    }
    if (char === "*" || char === "_" || char === "~") {
      const run = rest.match(char === "*" ? /^\*+/ : char === "_" ? /^_+/ : /^~+/)![0]
      // Strikethrough takes two tildes: one is "about" (~2180 m).
      if (char === "~" && run.length !== 2) {
        plain += run
        at += run.length
        continue
      }
      const before = source[at - 1] ?? ""
      const after = source[at + run.length] ?? ""
      const left = !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before))
      const right = !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after))
      flush()
      pieces.push({
        kind: "delimiter", char, count: run.length, length: run.length,
        opens: char === "_" ? left && (!right || isPunctuation(before)) : left,
        closes: char === "_" ? right && (!left || isPunctuation(after)) : right,
      })
      at += run.length
      continue
    }
    plain += char
    at++
  }
  flush()
  emphasise(pieces)
  return text(pieces)
}
