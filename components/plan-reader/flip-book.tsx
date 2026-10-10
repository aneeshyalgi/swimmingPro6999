"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import type { Book, Highlight } from "@/lib/plan-book"
import { cn } from "@/lib/utils"
import { BookPage } from "./book-page"

export type BookLayout = "spread" | "single"

const spreadOf = (page: number) => (page <= 0 ? 0 : Math.floor((page + 1) / 2))
const leftOf = (spread: number, count: number) => (spread > 0 && 2 * spread - 1 < count ? 2 * spread - 1 : null)
const rightOf = (spread: number, count: number) => (2 * spread < count ? 2 * spread : null)
const spreadCount = (count: number) => Math.floor(count / 2) + 1

/** The pages on screen: the page itself, or its spread (the cover alone on the right, a last page alone on the left). */
export function visiblePages(page: number, layout: BookLayout, count: number): number[] {
  if (layout === "single") return [page]
  const spread = spreadOf(page)
  return [leftOf(spread, count), rightOf(spread, count)].filter((index): index is number => index !== null)
}

/** Where a closed book sits: the cover alone moves half a page left, a last page alone half a page right (page widths). */
function bookShift(spread: number, count: number) {
  if (leftOf(spread, count) === null) return -0.5
  if (rightOf(spread, count) === null) return 0.5
  return 0
}

/** One page turn: what lies underneath, the turning sheet's two faces, and its swing (degrees) around the spine. */
type Turn = {
  dir: 1 | -1
  to: number
  under: [number | null, number | null]
  front: number | null
  /** null: the blank back of a single page */
  back: number | null
  slot: "left" | "right" | "single"
  from: number
  end: number
  shift: [number, number]
  drag?: boolean
}

function planTurn(page: number, dir: 1 | -1, layout: BookLayout, count: number): Turn | null {
  if (layout === "single") {
    const to = page + dir
    if (to < 0 || to >= count) return null
    return dir === 1
      ? { dir, to, under: [to, null], front: page, back: null, slot: "single", from: 0, end: -180, shift: [0, 0] }
      : { dir, to, under: [page, null], front: to, back: null, slot: "single", from: -180, end: 0, shift: [0, 0] }
  }
  const spread = spreadOf(page)
  const target = spread + dir
  if (target < 0 || target >= spreadCount(count)) return null
  const to = leftOf(target, count) ?? (rightOf(target, count) as number)
  const shift: [number, number] = [bookShift(spread, count), bookShift(target, count)]
  return dir === 1
    ? { dir, to, under: [leftOf(spread, count), rightOf(target, count)], front: rightOf(spread, count), back: leftOf(target, count), slot: "right", from: 0, end: -180, shift }
    : { dir, to, under: [leftOf(target, count), rightOf(spread, count)], front: leftOf(spread, count), back: rightOf(target, count), slot: "left", from: 0, end: 180, shift }
}

type Side = "left" | "right" | "single"
type BookItem =
  | { kind: "slot"; key: string; index: number; side: Side; hidden: boolean }
  | { kind: "sheet"; key: string; plan: Turn; hidden: boolean }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** A CSS-style cubic-bezier easing, solved for x with Newton steps. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a1: number, a2: number, t: number) => ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t
  const slope = (t: number) => (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1
  return (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const error = at(x1, x2, t) - x
      const gradient = slope(t)
      if (Math.abs(error) < 1e-5 || gradient === 0) break
      t = clamp(t - error / gradient, 0, 1)
    }
    return at(y1, y2, t)
  }
}
/** A page lifts off briskly and settles softly. */
const turnEase = bezier(0.3, 0.15, 0.2, 1)
export const MAX_ZOOM = 4

export type FlipBookHandle = {
  /** Turns a page (or a spread) forwards or back, with the page-turn animation. */
  turn: (dir: 1 | -1) => void
  zoomBy: (factor: number) => void
  resetZoom: () => void
}

type Gesture = {
  mode: "maybe" | "turn" | "pan" | "pinch"
  pointer: number
  x0: number
  y0: number
  t0: number
  lastX: number
  lastT: number
  velocity: number
  scrollLeft: number
  scrollTop: number
  pinch?: { distance: number; startX: number; startY: number; midX: number; midY: number; scale: number; u: number; v: number }
}

/** The book itself: spreads (or single pages on narrow screens) that turn like paper. Drag a page to turn it, tap the edges
 * on touch screens, pinch, double-tap or ctrl+scroll to zoom, scroll to turn. */
export const FlipBook = forwardRef<FlipBookHandle, {
  book: Book
  images: Record<string, string>
  page: number
  layout: BookLayout
  onPage: (page: number) => void
  /** Changes when the reader jumps (contents, search, scrubber): the book fades to the new page instead of turning. */
  jump: number
  highlights?: Map<number, Highlight[]>
  activeHighlight?: { page: number; index: number } | null
  onLink?: (page: number) => void
  onTapCenter?: () => void
  onZoom?: (zoom: number) => void
  reducedMotion?: boolean
  className?: string
}>(function FlipBook({ book, images, page, layout, onPage, jump, highlights, activeHighlight, onLink, onTapCenter, onZoom, reducedMotion, className }, ref) {
  const count = book.pages.length
  const stageRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [turn, setTurn] = useState<Turn | null>(null)
  const turnRef = useRef<Turn | null>(null)
  const progress = useRef(0)
  const frame = useRef(0)
  const queued = useRef<1 | -1 | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const zoomFocus = useRef<{ x: number; y: number; u: number; v: number } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const tapTimer = useRef(0)
  const pointerType = useRef("mouse")
  // The next and previous turns are built a moment after the reader settles on a page, hidden, ready to move at once.
  const [preloadPage, setPreloadPage] = useState<number | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setPreloadPage(page), 160)
    return () => window.clearTimeout(timer)
  }, [page, layout, jump])
  const live = useRef({ page, layout, zoom, reducedMotion, onPage, onTapCenter })
  live.current = { page, layout, zoom, reducedMotion, onPage, onTapCenter }

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // Page geometry: fit the spread (or page) into the stage, then scale by the zoom.
  const ratio = book.size[0] / book.size[1]
  const pad = layout === "spread" ? 28 : 12
  const availableW = Math.max(0, size.w - pad * 2)
  const availableH = Math.max(0, size.h - pad * 2)
  const fitH = layout === "spread" ? Math.min(availableH, availableW / 2 / ratio) : Math.min(availableH, availableW / ratio)
  const pageW = Math.floor(fitH * ratio * zoom)
  const pageH = Math.floor(fitH * zoom)
  const bookW = layout === "spread" ? pageW * 2 : pageW

  // What moves during a turn (the sheet, its shading and the shadows it casts), styled directly every frame. Never through
  // inherited CSS variables: changing those on the book would restyle every element of every page, every frame.
  const parts = useRef<{ sheet: HTMLElement | null; shades: HTMLElement[]; reveal: HTMLElement[]; land: HTMLElement[] }>({ sheet: null, shades: [], reveal: [], land: [] })
  const pageWidth = useRef(0)
  /** A button or key turn waiting for its sheet to appear: how long it should take. */
  const autoTurn = useRef<number | null>(null)

  const paint = useCallback((plan: Turn, p: number) => {
    progress.current = p
    const { sheet, shades, reveal, land } = parts.current
    const element = bookRef.current
    if (!sheet || !element) return
    const angle = plan.from + (plan.end - plan.from) * p
    sheet.style.transform = `rotateY(${angle.toFixed(2)}deg)`
    const shade = Math.abs(Math.sin((angle * Math.PI) / 180)).toFixed(3)
    for (const part of shades) part.style.opacity = shade
    for (const part of reveal) part.style.opacity = ((1 - p) * 0.95).toFixed(3)
    for (const part of land) part.style.opacity = (Math.sin(p * Math.PI) * 0.85).toFixed(3)
    if (plan.shift[0] !== plan.shift[1]) element.style.transform = `translateX(${((plan.shift[0] + (plan.shift[1] - plan.shift[0]) * p) * pageWidth.current).toFixed(2)}px)`
  }, [])

  const start = useCallback((dir: 1 | -1, quick = false) => {
    if (turnRef.current) {
      if (!turnRef.current.drag) queued.current = dir
      return
    }
    const { page: current, layout: currentLayout, reducedMotion: still } = live.current
    const plan = planTurn(current, dir, currentLayout, count)
    if (!plan) return
    if (live.current.zoom > 1) setZoom(1)
    if (still) {
      live.current.onPage(plan.to)
      return
    }
    turnRef.current = plan
    progress.current = 0
    autoTurn.current = quick ? 380 : 700
    setTurn(plan)
  }, [count])

  const animate = useCallback((plan: Turn, to: 0 | 1, duration: number) => {
    cancelAnimationFrame(frame.current)
    const from = progress.current
    const began = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration)
      paint(plan, from + (to - from) * turnEase(t))
      if (t < 1) {
        frame.current = requestAnimationFrame(step)
        return
      }
      turnRef.current = null
      if (to === 1) live.current.onPage(plan.to)
      setTurn(null)
      const next = queued.current
      queued.current = null
      if (next && to === 1) requestAnimationFrame(() => start(next, true))
    }
    frame.current = requestAnimationFrame(step)
  }, [paint, start])

  const zoomTo = useCallback((next: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current
    const element = bookRef.current
    const target = clamp(next, 1, MAX_ZOOM)
    if (!stage || !element || target === live.current.zoom) return
    const box = element.getBoundingClientRect()
    const stageBox = stage.getBoundingClientRect()
    const x = clientX ?? stageBox.left + stageBox.width / 2
    const y = clientY ?? stageBox.top + stageBox.height / 2
    zoomFocus.current = { x, y, u: clamp((x - box.left) / box.width, 0, 1), v: clamp((y - box.top) / box.height, 0, 1) }
    setZoom(target)
  }, [])

  // Keep the point under the cursor (or fingers) where it was after a zoom.
  useLayoutEffect(() => {
    onZoom?.(zoom)
    const focus = zoomFocus.current
    const stage = stageRef.current
    const element = bookRef.current
    zoomFocus.current = null
    if (!focus || !stage || !element) return
    const box = element.getBoundingClientRect()
    stage.scrollLeft += box.left + focus.u * box.width - focus.x
    stage.scrollTop += box.top + focus.v * box.height - focus.y
  }, [zoom, onZoom])

  useImperativeHandle(ref, () => ({
    turn: (dir) => start(dir),
    zoomBy: (factor) => zoomTo(live.current.zoom * factor),
    resetZoom: () => zoomTo(1),
  }), [start, zoomTo])

  // A new layout (rotating a phone, resizing) or a jump abandons any turn in progress.
  useEffect(() => {
    cancelAnimationFrame(frame.current)
    turnRef.current = null
    queued.current = null
    autoTurn.current = null
    progress.current = 0
    setTurn(null)
  }, [layout, jump])

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    window.clearTimeout(tapTimer.current)
  }, [])

  // Scroll turns pages; ctrl/⌘ + scroll (and trackpad pinch) zooms; when zoomed in, scroll moves around the page.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let total = 0
    let idle = 0
    let lastTurn = 0
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        zoomTo(live.current.zoom * Math.exp(-event.deltaY * 0.012), event.clientX, event.clientY)
        return
      }
      if (live.current.zoom > 1) return
      event.preventDefault()
      total += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      window.clearTimeout(idle)
      idle = window.setTimeout(() => { total = 0 }, 180)
      const now = performance.now()
      if (Math.abs(total) > 50 && now - lastTurn > 480) {
        start(total > 0 ? 1 : -1)
        total = 0
        lastTurn = now
      }
    }
    stage.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      stage.removeEventListener("wheel", onWheel)
      window.clearTimeout(idle)
    }
  }, [start, zoomTo])

  // When a sheet appears: find its moving parts, draw it where the turn is, and start a button or key turn right away. When
  // it goes, hand the book back to its resting position.
  pageWidth.current = pageW
  useLayoutEffect(() => {
    const element = bookRef.current
    if (!turn || !element) {
      parts.current.sheet?.style.removeProperty("transform")
      parts.current = { sheet: null, shades: [], reveal: [], land: [] }
      element?.style.removeProperty("transform")
      return
    }
    const sheet = element.querySelector<HTMLElement>(".fb-sheet:not(.is-preload)")
    parts.current = {
      sheet,
      shades: sheet ? [...sheet.querySelectorAll<HTMLElement>(".fb-shade")] : [],
      reveal: [...element.querySelectorAll<HTMLElement>(".fb-cast.is-reveal")],
      land: [...element.querySelectorAll<HTMLElement>(".fb-cast.is-land")],
    }
    paint(turn, progress.current)
    const duration = autoTurn.current
    if (duration !== null && !turn.drag) {
      autoTurn.current = null
      animate(turn, 1, duration)
    }
  }, [turn, paint, animate, pageW])

  const releaseTurn = (plan: Turn, velocity: number) => {
    const towards = plan.dir === 1 ? -velocity : velocity
    const finish = progress.current > 0.32 || towards > 0.45
    animate(plan, finish ? 1 : 0, Math.max(160, (finish ? 1 - progress.current : progress.current) * 560))
  }

  const tap = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return
    const stage = stageRef.current
    if (!stage) return
    const box = stage.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    const now = performance.now()
    const previous = lastTap.current
    if (previous && now - previous.t < 300 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 40) {
      window.clearTimeout(tapTimer.current)
      lastTap.current = null
      zoomTo(live.current.zoom > 1 ? 1 : 2.5, event.clientX, event.clientY)
      return
    }
    lastTap.current = { t: now, x: event.clientX, y: event.clientY }
    if (live.current.zoom === 1 && (x < 0.22 || x > 0.78)) {
      start(x < 0.22 ? -1 : 1)
      return
    }
    window.clearTimeout(tapTimer.current)
    tapTimer.current = window.setTimeout(() => live.current.onTapCenter?.(), 300)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    const stage = stageRef.current
    if (!stage) return
    pointerType.current = event.pointerType
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const plan = turnRef.current
      if (plan?.drag) animate(plan, 0, 160)
      const [a, b] = [...pointers.current.values()]
      const box = bookRef.current?.getBoundingClientRect()
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      gesture.current = {
        mode: "pinch", pointer: event.pointerId, x0: midX, y0: midY, t0: performance.now(), lastX: midX, lastT: performance.now(), velocity: 0,
        scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop,
        pinch: { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, startX: midX, startY: midY, midX, midY, scale: 1,
          u: box ? clamp((midX - box.left) / box.width, 0, 1) : 0.5, v: box ? clamp((midY - box.top) / box.height, 0, 1) : 0.5 },
      }
      for (const id of pointers.current.keys()) stage.setPointerCapture(id)
      return
    }
    if (pointers.current.size > 2) return
    const now = performance.now()
    gesture.current = {
      mode: live.current.zoom > 1 ? "pan" : "maybe", pointer: event.pointerId, x0: event.clientX, y0: event.clientY, t0: now,
      lastX: event.clientX, lastT: now, velocity: 0, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const current = gesture.current
    const stage = stageRef.current
    if (!current || !stage) return
    if (current.mode === "pinch" && current.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const scale = clamp(Math.hypot(a.x - b.x, a.y - b.y) / current.pinch.distance, 1 / live.current.zoom, MAX_ZOOM / live.current.zoom)
      current.pinch.scale = scale
      const element = bookRef.current
      if (element) {
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        element.style.transformOrigin = `${current.pinch.u * 100}% ${current.pinch.v * 100}%`
        element.style.transform = `translate(${midX - current.pinch.startX}px, ${midY - current.pinch.startY}px) translateX(calc(var(--shift, 0) * var(--page-w))) scale(${scale})`
        current.pinch.midX = midX
        current.pinch.midY = midY
      }
      return
    }
    if (event.pointerId !== current.pointer) return
    const dx = event.clientX - current.x0
    const dy = event.clientY - current.y0
    const now = performance.now()
    if (now > current.lastT) {
      current.velocity = (event.clientX - current.lastX) / (now - current.lastT)
      current.lastX = event.clientX
      current.lastT = now
    }
    if (current.mode === "pan") {
      if (Math.hypot(dx, dy) > 3) stage.setPointerCapture(event.pointerId)
      stage.scrollLeft = current.scrollLeft - dx
      stage.scrollTop = current.scrollTop - dy
      return
    }
    if (current.mode === "maybe") {
      if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.15 && !turnRef.current) {
        const plan = planTurn(live.current.page, dx < 0 ? 1 : -1, live.current.layout, count)
        if (!plan || live.current.reducedMotion) {
          gesture.current = null
          if (plan) live.current.onPage(plan.to)
          return
        }
        stage.setPointerCapture(event.pointerId)
        const dragging = { ...plan, drag: true }
        turnRef.current = dragging
        progress.current = 0
        setTurn(dragging)
        current.mode = "turn"
      } else if (Math.abs(dy) > 14) {
        gesture.current = null
      }
      return
    }
    if (current.mode === "turn" && turnRef.current) {
      paint(turnRef.current, clamp(Math.abs(dx) / (pageW * 1.1), 0, 1))
    }
  }

  const endPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (!current) return
    if (current.mode === "pinch") {
      if (pointers.current.size > 0) return
      gesture.current = null
      const element = bookRef.current
      const scale = current.pinch?.scale ?? 1
      if (element) {
        element.style.transform = ""
        element.style.transformOrigin = ""
      }
      if (current.pinch && Math.abs(scale - 1) > 0.02) {
        const target = clamp(live.current.zoom * scale, 1, MAX_ZOOM)
        zoomFocus.current = { x: current.pinch.midX, y: current.pinch.midY, u: current.pinch.u, v: current.pinch.v }
        setZoom(target < 1.08 ? 1 : target)
      }
      return
    }
    if (event.pointerId !== current.pointer) return
    gesture.current = null
    if (current.mode === "turn" && turnRef.current) {
      if (cancelled) animate(turnRef.current, 0, 200)
      else releaseTurn(turnRef.current, current.velocity)
      return
    }
    const moved = Math.hypot(event.clientX - current.x0, event.clientY - current.y0)
    if (!cancelled && current.mode === "maybe" && moved < 10 && performance.now() - current.t0 < 450) tap(event)
  }

  const restingShift = layout === "spread" ? bookShift(spreadOf(page), count) : 0
  const edgeLayers = (pagesBeyond: number) => Math.min(5, Math.ceil(pagesBeyond / 10))
  const sideOf = (position: number): Side => (layout === "single" ? "single" : position === 0 ? "left" : "right")
  const restingPages = (at: number): [number | null, number | null] =>
    layout === "single" ? [at, null] : [leftOf(spreadOf(at), count), rightOf(spreadOf(at), count)]

  // Everything in the book, keyed so a page keeps its element as it goes from built-ahead (hidden) to turning to resting.
  const items = new Map<string, BookItem>()
  const addSlot = (index: number | null, side: Side, hidden: boolean) => {
    if (index === null) return
    const key = `${side}-${index}`
    const existing = items.get(key)
    if (existing) existing.hidden = existing.hidden && hidden
    else items.set(key, { kind: "slot", key, index, side, hidden })
  }
  const addSheet = (plan: Turn, hidden: boolean) => {
    const key = `sheet-${plan.slot}-${plan.front}-${plan.back ?? "blank"}`
    if (!items.has(key)) items.set(key, { kind: "sheet", key, plan, hidden })
  }
  if (turn) {
    turn.under.forEach((index, position) => addSlot(index, sideOf(position), false))
    restingPages(turn.to).forEach((index, position) => addSlot(index, sideOf(position), true))
    addSheet(turn, false)
  } else {
    restingPages(page).forEach((index, position) => addSlot(index, sideOf(position), false))
    if (preloadPage === page && !reducedMotion && zoom === 1) {
      for (const dir of [1, -1] as const) {
        const plan = planTurn(page, dir, layout, count)
        if (!plan) continue
        plan.under.forEach((index, position) => addSlot(index, sideOf(position), true))
        restingPages(plan.to).forEach((index, position) => addSlot(index, sideOf(position), true))
        addSheet(plan, true)
      }
    }
  }

  const renderPage = (index: number | null) => index === null ? null : (
    <BookPage book={book} index={index} images={images} highlights={highlights?.get(index)}
      activeHighlight={activeHighlight?.page === index ? activeHighlight.index : undefined}
      onLink={onLink} label={`Page ${index + 1}`} />
  )

  const renderSlot = ({ key, index, side, hidden }: Extract<BookItem, { kind: "slot" }>) => {
    const beyond = side === "left" ? index : count - 1 - index
    const layers = layout === "spread" && !(index === 0 || index === count - 1) ? edgeLayers(beyond) : 0
    const edge = side === "left" ? -1 : 1
    const stack = Array.from({ length: layers }, (_, layer) => `${edge * (layer + 1)}px ${layer * 0.5 + 0.5}px 0 ${layer % 2 ? "#eef1f3" : "#cfd5da"}`).join(", ")
    const revealing = !hidden && turn && ((turn.slot === "right" && side === "right") || (turn.slot === "left" && side === "left") || turn.slot === "single")
    const landing = !hidden && turn && turn.slot !== "single" && !revealing
    return (
      <div key={key} aria-hidden={hidden || undefined} className={cn("fb-page", `is-${side}`, hidden && "is-preload")}
        style={{ left: side === "right" ? pageW : 0, width: pageW, height: pageH, boxShadow: [stack, "0 28px 64px -20px rgba(0,0,0,0.7)"].filter(Boolean).join(", ") }}>
        {renderPage(index)}
        {layout === "spread" && <div className={cn("fb-gutter", `is-${side}`)} />}
        {revealing && <div className={cn("fb-cast is-reveal", `from-${turn.slot === "left" ? "right" : "left"}`)} />}
        {landing && <div className={cn("fb-cast is-land", `from-${side === "left" ? "right" : "left"}`)} />}
      </div>
    )
  }

  const renderSheet = ({ key, plan, hidden }: Extract<BookItem, { kind: "sheet" }>) => (
    <div key={key} aria-hidden={hidden || undefined} className={cn("fb-sheet", `is-${plan.slot}`, hidden && "is-preload")}
      style={{ left: plan.slot === "right" ? pageW : 0, width: pageW, height: pageH }}>
      <div className="fb-face is-front">
        {renderPage(plan.front)}
        <div className={cn("fb-shade", plan.slot === "left" ? "from-right" : "from-left")} />
      </div>
      <div className="fb-face is-back">
        {plan.back === null ? <div className="fb-paper-back" /> : renderPage(plan.back)}
        <div className={cn("fb-shade", plan.slot === "left" ? "from-left" : "from-right")} />
      </div>
    </div>
  )

  return (
    <div ref={stageRef} className={cn("fb-stage", zoom > 1 && "is-zoomed", className)} role="region" aria-label="Plan pages" aria-roledescription="book"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => endPointer(event)}
      onPointerCancel={(event) => endPointer(event, true)}
      onDoubleClick={(event) => {
        if (pointerType.current === "mouse" && !(event.target as Element).closest(".plan-book-link")) zoomTo(zoom > 1 ? 1 : 2, event.clientX, event.clientY)
      }}>
      {size.w > 0 && pageW > 0 && (
        <div className="fb-canvas" style={{ minWidth: `max(100%, ${bookW + pad * 2}px)`, minHeight: `max(100%, ${pageH + pad * 2}px)` }}>
          <div key={jump} className={cn("fb-jump", reducedMotion && "is-still")}>
            <div ref={bookRef} className={cn("fb-book", `is-${layout}`, turn && "is-turning")}
              style={{ width: bookW, height: pageH, "--page-w": `${pageW}px`, "--shift": restingShift } as CSSProperties}>
              {[...items.values()].map((item) => (item.kind === "slot" ? renderSlot(item) : renderSheet(item)))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
