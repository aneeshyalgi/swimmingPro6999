import type { ReactNode } from "react"

export type ChatSource = { source_file: string; coach_name: string; similarity: number }

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[\d+(?:\s*,\s*\d+)*\])/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, idx) => {
    const key = `${keyPrefix}-${idx}`
    if (!part) return null
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key} className="font-semibold text-white">{part.slice(2, -2)}</strong>
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-cyan-100">{part.slice(1, -1)}</code>
    if (/^\[\d/.test(part)) return null // source markers are not shown in the UI
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>
    return part
  })
}

/** Renders the coach's reply: paragraphs, headings, bullet/numbered lists and emphasis (source markers are hidden). */
export function ChatMarkdown({ content }: { content: string }) {
  // Source markers like [1] or [1, 2] are dropped together with the space before them.
  const lines = content.replace(/\r\n/g, "\n").replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").split("\n")
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    const key = `p-${blocks.length}`
    blocks.push(<p key={key} className="leading-7">{renderInline(paragraph.join(" "), key)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const key = `l-${blocks.length}`
    const items = list.items.map((item, idx) => (
      <li key={`${key}-${idx}`} className="pl-1 leading-7 marker:text-accent">
        {renderInline(item, `${key}-${idx}`)}
      </li>
    ))
    blocks.push(
      list.ordered ? (
        <ol key={key} className="list-decimal space-y-1 pl-5 marker:font-semibold">{items}</ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-5">{items}</ul>
      ),
    )
    list = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    if (!line) {
      flushParagraph()
      flushList()
    } else if (heading) {
      flushParagraph()
      flushList()
      const key = `h-${blocks.length}`
      blocks.push(
        <p key={key} className="pt-1 text-sm font-semibold uppercase tracking-[0.12em] text-accent">
          {renderInline(heading[2].replace(/\*\*/g, ""), key)}
        </p>,
      )
    } else if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
    } else if (list && /^\s{2,}/.test(raw)) {
      // Indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line}`
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()

  return <div className="space-y-3 text-[15px] text-slate-200">{blocks}</div>
}
