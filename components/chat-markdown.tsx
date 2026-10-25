import { Fragment, memo, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { parseBlocks, parseInline, type Block, type Inline } from "@/lib/chat-markdown"

export type ChatSource = { source_file: string; coach_name: string; similarity: number }

type List = Extract<Block, { kind: "list" }>

// Links open only to the web or an email address.
const LINKABLE = /^(?:https?:|mailto:)/i

function inline(nodes: Inline[], key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const id = `${key}.${index}`
    switch (node.kind) {
      case "text":
        // A line break in the coach's text is a line break on screen.
        return node.text.includes("\n")
          ? <Fragment key={id}>{node.text.split("\n").map((line, n) => <Fragment key={n}>{n > 0 && <br />}{line}</Fragment>)}</Fragment>
          : node.text
      case "code":
        return <code key={id} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-cyan-100">{node.text}</code>
      case "strong":
        return <strong key={id} className="font-semibold text-white">{inline(node.children, id)}</strong>
      case "em":
        return <em key={id}>{inline(node.children, id)}</em>
      case "del":
        return <del key={id} className="text-slate-400">{inline(node.children, id)}</del>
      case "link":
        return LINKABLE.test(node.href)
          ? <a key={id} href={node.href} target="_blank" rel="noopener noreferrer nofollow"
              className="font-medium text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent">{inline(node.children, id)}</a>
          : <Fragment key={id}>{inline(node.children, id)}</Fragment>
    }
  })
}

const text = (source: string, key: string) => inline(parseInline(source), key)

/** Space above a block, from the block before it: sections stand apart, a list sits close under the line that leads
 *  into it, and inside a list item everything stays close. */
function gap(previous: Block | undefined, block: Block, depth: number): string {
  if (!previous || block.kind === "rule" || previous.kind === "rule") return ""
  if (block.kind === "heading") return block.level <= 2 ? "mt-6" : "mt-5"
  if (previous.kind === "heading") return previous.level <= 2 ? "mt-2" : "mt-1.5"
  if (depth) return block.kind === "list" ? "mt-1" : "mt-1.5"
  return block.kind === "list" && previous.kind === "paragraph" ? "mt-2" : "mt-3"
}

/** How many digits the reply's biggest list number has: every numbered list in it gets room for that many, so their
 *  text lines up ("9." fits the usual indent, "12." and "100." need more). */
function digitsIn(content: Block[]): number {
  let digits = 1
  for (const block of content) {
    if (block.kind === "quote") digits = Math.max(digits, digitsIn(block.blocks))
    if (block.kind !== "list") continue
    if (block.ordered) digits = Math.max(digits, String(block.start + block.items.length - 1).length)
    for (const item of block.items) digits = Math.max(digits, digitsIn(item.blocks))
  }
  return digits
}

/** A list's items: close together, a little apart after an item with points of its own, and further apart where the
 *  coach left a blank line between groups. Points under an item are circles, and squares below that. */
function list(block: List, key: string, space: string, depth: number, digits: number): ReactNode {
  const items = block.items.map((item, n) => (
    <li key={n} className={cn("pl-1", n > 0 && (item.gap ? "mt-3" : block.items[n - 1].blocks.length > 1 ? "mt-2" : depth ? "mt-0.5" : "mt-1"))}>
      {blocks(item.blocks, `${key}.${n}`, depth + 1, digits)}
    </li>
  ))
  const markers = depth ? "marker:text-accent/70" : "marker:text-accent"
  if (!block.ordered) {
    return <ul key={key} className={cn(space, "pl-5", depth === 0 ? "list-disc" : depth === 1 ? "list-[circle]" : "list-[square]", markers)}>{items}</ul>
  }
  return (
    <ol key={key} start={block.start === 1 ? undefined : block.start}
      className={cn(space, "list-decimal marker:font-semibold", digits > 2 ? "pl-9" : digits > 1 ? "pl-7" : "pl-5", markers)}>
      {items}
    </ol>
  )
}

function blocks(content: Block[], key: string, depth: number, digits: number): ReactNode[] {
  return content.map((block, index) => {
    const id = `${key}.${index}`
    const space = gap(content[index - 1], block, depth)
    switch (block.kind) {
      case "paragraph":
        return <p key={id} className={space}>{text(block.lines.join("\n"), id)}</p>
      case "heading": {
        // Headings are bold already.
        const title = text(block.text.replace(/\*\*|__/g, ""), id)
        if (block.level <= 2) return <p key={id} className={cn(space, "text-base font-semibold leading-snug text-white")}>{title}</p>
        if (block.level === 3) return <p key={id} className={cn(space, "text-sm font-semibold uppercase leading-snug tracking-[0.12em] text-accent")}>{title}</p>
        return <p key={id} className={cn(space, "font-semibold leading-snug text-white")}>{title}</p>
      }
      case "rule":
        return <hr key={id} className="my-5 border-white/10 first:mt-0 last:mb-0" />
      case "code":
        return (
          <pre key={id} className={cn(space, "overflow-x-auto rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 font-mono text-[13px] leading-6 text-cyan-100")}>
            <code>{block.text}</code>
          </pre>
        )
      case "quote":
        return <blockquote key={id} className={cn(space, "border-l-2 border-accent/40 pl-3.5 text-slate-300")}>{blocks(block.blocks, id, depth, digits)}</blockquote>
      case "table":
        return (
          <div key={id} className={cn(space, "overflow-x-auto rounded-xl border border-white/10")}>
            <table className="w-full border-collapse text-left text-sm leading-6">
              <thead className="bg-white/[0.05] text-white">
                <tr>
                  {block.head.map((cell, column) => (
                    <th key={column} scope="col" className="px-3 py-2 font-semibold" style={{ textAlign: block.align[column] ?? undefined }}>
                      {text(cell, `${id}.h${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, line) => (
                  <tr key={line} className="border-t border-white/[0.07]">
                    {row.map((cell, column) => (
                      <td key={column} className="px-3 py-2 align-top" style={{ textAlign: block.align[column] ?? undefined }}>
                        {text(cell, `${id}.${line}.${column}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case "list":
        return list(block, id, space, depth, digits)
    }
  })
}

/** Renders the coach's reply (lib/chat-markdown reads it): paragraphs line by line, headings, dividers, lists numbered
 *  through and nested as the coach set them out, tables, code, quotes, emphasis and links. Source markers are hidden. */
export const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  const parsed = parseBlocks(content)
  return <div className="break-words text-[15px] leading-[1.7] text-slate-200">{blocks(parsed, "md", 0, digitsIn(parsed))}</div>
})
