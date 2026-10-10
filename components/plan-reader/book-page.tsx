"use client"

import { memo, useMemo, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { FONT_FACES, characterXs, type Book, type Highlight, type Op } from "@/lib/plan-book"

const CAPS = ["butt", "round", "square"] as const
const JOINS = ["miter", "round", "bevel"] as const

function drawOp(op: Op, key: number, fonts: string[], images: Record<string, string>): ReactNode {
  if (op[0] === "p") {
    const [, d, fill, stroke, width, extras] = op
    return (
      <path
        key={key}
        d={d}
        fill={fill ?? "none"}
        fillOpacity={extras?.fo}
        fillRule={extras?.eo ? "evenodd" : undefined}
        stroke={stroke ?? undefined}
        strokeWidth={stroke ? width : undefined}
        strokeOpacity={extras?.so}
        strokeLinecap={extras?.cap ? CAPS[extras.cap] : undefined}
        strokeLinejoin={extras?.join ? JOINS[extras.join] : undefined}
        strokeDasharray={extras?.dash ? extras.dash.replace(/^\[([^\]]*)\].*$/, "$1") || undefined : undefined}
      />
    )
  }
  if (op[0] === "t") {
    const face = FONT_FACES[fonts[op[1]]] ?? FONT_FACES["Lato-Regular"]
    return (
      <text key={key} x={characterXs(op).join(" ")} y={op[5]} fontSize={op[2]} fill={op[3]} fontWeight={face.weight}
        fontStyle={face.italic ? "italic" : undefined} opacity={op[8]}>
        {op[6]}
      </text>
    )
  }
  const [, image, a, b, c, d, e, f, alpha] = op
  return (
    <image key={key} href={images[image]} width={1} height={1} preserveAspectRatio="none"
      transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`} opacity={alpha} />
  )
}

/** One page of a plan book, redrawn as SVG exactly as the PDF drew it. `images` maps the book's image keys to URLs. */
export const BookPage = memo(function BookPage({ book, index, images, highlights, activeHighlight, onLink, className, label }: {
  book: Book
  index: number
  images: Record<string, string>
  highlights?: Highlight[]
  /** The highlight to emphasise (the current search result). */
  activeHighlight?: number
  /** In-book links (a contents page's entries) jump to their page. */
  onLink?: (page: number) => void
  className?: string
  label?: string
}) {
  const page = book.pages[index]
  const [width, height] = book.size
  const drawing = useMemo(() => page.ops.map((op, key) => drawOp(op, key, book.fonts, images)), [page, book.fonts, images])
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("plan-book-page", className)} xmlSpace="preserve"
      aria-label={label} aria-roledescription="page">
      <rect width={width} height={height} fill="#ffffff" />
      {drawing}
      {highlights?.map((box, key) => (
        <rect key={`h${key}`} x={box.x} y={box.y} width={box.w} height={box.h} rx={1.5}
          className={cn("plan-book-highlight", key === activeHighlight && "is-active")} />
      ))}
      {onLink && page.links?.map(([x0, y0, x1, y1, target], key) => (
        <rect key={`l${key}`} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="transparent" className="plan-book-link"
          role="link" aria-label={`Go to page ${target + 1}`} onClick={(event) => { event.stopPropagation(); onLink(target) }} />
      ))}
    </svg>
  )
})
