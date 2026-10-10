"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, LayoutGrid, List, Maximize2, Minimize2, Minus, Plus, RotateCcw, Search, X } from "lucide-react"
import {
  FONT_FACES, pageLabel, readProgress, searchBook, sessionsByPage, spreadLabel, titleCase, writeProgress, type Book, type BookSession, type Highlight,
} from "@/lib/plan-book"
import { cn } from "@/lib/utils"
import { FlipBook, MAX_ZOOM, visiblePages, type BookLayout, type FlipBookHandle } from "./flip-book"
import { ContentsPanel, PageThumb, PagesGrid, SearchPanel, sessionName } from "./reader-panels"

type Panel = "contents" | "search" | "pages" | null
type Toast = { id: number; tone: "resume" | "done" | "week"; title: string; detail?: string; resumeFrom?: number }

const pickLayout = (): BookLayout => (window.innerWidth >= 860 && window.innerWidth / window.innerHeight >= 1.2 ? "spread" : "single")

/** Fonts and images first, so the first page appears complete rather than reflowing. */
function usePreparedBook(book: Book) {
  const [images, setImages] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    const fonts = book.fonts.map((name) => {
      const face = FONT_FACES[name] ?? FONT_FACES["Lato-Regular"]
      return document.fonts.load(`${face.italic ? "italic " : ""}${face.weight} 16px "SwimGPT Book"`).catch(() => [])
    })
    const pictures = Object.entries(book.images).map(async ([key, image]) => {
      const url = URL.createObjectURL(await (await fetch(image.src)).blob())
      urls.push(url)
      return [key, url] as const
    })
    Promise.all([Promise.all(fonts), Promise.all(pictures)])
      .then(([, entries]) => { if (!cancelled) setImages(Object.fromEntries(entries)) })
      .catch(() => { if (!cancelled) setImages(Object.fromEntries(Object.entries(book.images).map(([key, image]) => [key, image.src]))) })
    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [book])
  return images
}

export function PlanReader({ book, title, userId }: { book: Book; title: string; userId: string }) {
  const images = usePreparedBook(book)
  const count = book.pages.length
  const flip = useRef<FlipBookHandle>(null)
  const [page, setPage] = useState(0)
  const [jump, setJump] = useState(0)
  const [layout, setLayout] = useState<BookLayout>("spread")
  const [zoom, setZoom] = useState(1)
  const [panel, setPanel] = useState<Panel>(null)
  const [query, setQuery] = useState("")
  const [activeHit, setActiveHit] = useState(0)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [chrome, setChrome] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const restored = useRef(false)
  const pageRef = useRef(page)
  pageRef.current = page

  const sessionsAt = useMemo(() => sessionsByPage(book), [book])
  const shown = visiblePages(page, layout, count)
  const deferredQuery = useDeferredValue(query)
  const hits = useMemo(() => (panel === "search" ? searchBook(book, deferredQuery) : []), [book, deferredQuery, panel])
  const highlights = useMemo(() => {
    const map = new Map<number, Highlight[]>()
    for (const hit of hits) map.set(hit.page, [...(map.get(hit.page) ?? []), ...hit.rects])
    return map
  }, [hits])
  const activeHighlight = useMemo(() => {
    const hit = hits[activeHit]
    if (!hit) return null
    return { page: hit.page, index: hits.slice(0, activeHit).filter((other) => other.page === hit.page).length }
  }, [hits, activeHit])

  // Screen shape, reduced motion, full screen, and no page scrolling behind the book.
  useEffect(() => {
    const update = () => setLayout(pickLayout())
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onMotion = () => setReducedMotion(motion.matches)
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    update()
    onMotion()
    window.addEventListener("resize", update)
    motion.addEventListener("change", onMotion)
    document.addEventListener("fullscreenchange", onFullscreen)
    document.documentElement.classList.add("reader-open")
    return () => {
      window.removeEventListener("resize", update)
      motion.removeEventListener("change", onMotion)
      document.removeEventListener("fullscreenchange", onFullscreen)
      document.documentElement.classList.remove("reader-open")
    }
  }, [])

  // Back where they left off, with their ticked-off sessions.
  useEffect(() => {
    const saved = readProgress(userId, book.plan_id)
    if (saved) {
      setDone(new Set(saved.done))
      if (saved.page > 0 && saved.page < count) {
        setPage(saved.page)
        setToast({ id: Date.now(), tone: "resume", title: `Welcome back · page ${saved.page + 1}`, detail: pageLabel(book, saved.page), resumeFrom: saved.page })
      }
    }
    restored.current = true
  }, [book, count, userId])

  useEffect(() => {
    if (!restored.current) return
    const timer = window.setTimeout(() => writeProgress(userId, book.plan_id, { page, done: [...done], at: Date.now() }), 300)
    return () => window.clearTimeout(timer)
  }, [page, done, userId, book.plan_id])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.tone === "resume" ? 6500 : 3800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const goTo = useCallback((target: number) => {
    const next = Math.max(0, Math.min(count - 1, target))
    if (!visiblePages(pageRef.current, layout, count).includes(next)) setJump((value) => value + 1)
    setPage(next)
  }, [count, layout])

  const turn = useCallback((dir: 1 | -1) => flip.current?.turn(dir), [])

  const toggleDone = useCallback((session: BookSession) => {
    const next = new Set(done)
    if (next.has(session.id)) {
      next.delete(session.id)
      setDone(next)
      return
    }
    next.add(session.id)
    setDone(next)
    const week = book.sessions.filter((other) => other.w === session.w)
    setToast(week.every((other) => next.has(other.id))
      ? { id: Date.now(), tone: "week", title: `Week ${String(session.w).padStart(2, "0")} complete`, detail: `All ${week.length} sessions done · ${next.size} of ${book.sessions.length} in the plan` }
      : { id: Date.now(), tone: "done", title: `${sessionName(session)} done`, detail: `${next.size} of ${book.sessions.length} sessions in the plan` })
  }, [done, book.sessions])

  const pickHit = useCallback((index: number) => {
    setActiveHit(index)
    const hit = hits[index]
    if (hit) goTo(hit.page)
  }, [hits, goTo])

  useEffect(() => { setActiveHit(0) }, [deferredQuery])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  // Keyboard: arrows, page keys and space turn; Home/End; ⌘/Ctrl+F search; C contents; G pages; +/-/0 zoom; F full screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, [contenteditable='true']")) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault()
        setPanel("search")
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || panel === "contents" || panel === "pages") return
      const key = event.key
      if (key === "ArrowRight" || key === "PageDown" || (key === " " && !event.shiftKey)) turn(1)
      else if (key === "ArrowLeft" || key === "PageUp" || (key === " " && event.shiftKey)) turn(-1)
      else if (key === "Home") goTo(0)
      else if (key === "End") goTo(count - 1)
      else if (key === "+" || key === "=") flip.current?.zoomBy(1.4)
      else if (key === "-" || key === "_") flip.current?.zoomBy(1 / 1.4)
      else if (key === "0") flip.current?.resetZoom()
      else if (key.toLowerCase() === "c") setPanel("contents")
      else if (key.toLowerCase() === "g") setPanel("pages")
      else if (key.toLowerCase() === "f") toggleFullscreen()
      else if (key === "Escape" && zoom > 1) flip.current?.resetZoom()
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [turn, goTo, count, panel, zoom, toggleFullscreen])

  const sessionsShown = [...new Map(shown.map((index) => sessionsAt.get(index)).filter((session): session is BookSession => Boolean(session)).map((session) => [session.id, session])).values()]
  // The level switch, unless every level is already open (a spread shows Level 1 and Level 2 side by side).
  const levelSession = sessionsShown.find((session) => session.levels && Object.values(session.levels).some((level) => !shown.includes(level.p)))
  const pageText = shown.length > 1 ? `${shown[0] + 1}–${shown[1] + 1}` : `${shown[0] + 1}`
  const atStart = page === 0
  const atEnd = shown.includes(count - 1)

  if (!images) {
    return <ReaderLoading title={title} />
  }

  return (
    <div className={cn("reader-root fixed inset-0 z-50 flex flex-col overflow-hidden text-white", !chrome && "is-immersive")} >
      <div aria-hidden className="reader-backdrop pointer-events-none absolute inset-0" />

      {/* top bar */}
      <header className={cn("reader-bar relative z-20 flex h-14 shrink-0 items-center gap-2 px-2.5 sm:gap-3 sm:px-4", !chrome && "is-hidden-top")}>
        <Link href="/training-plans" className="reader-icon-btn is-wide" aria-label="Back to Training Plans">
          <ArrowLeft className="h-4 w-4" /><span className="hidden whitespace-nowrap text-sm font-medium sm:inline">Training Plans</span>
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold leading-5 text-white">{title}</p>
          <p className="truncate text-[11px] leading-4 text-slate-400" aria-live="polite">{spreadLabel(book, shown)}</p>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button type="button" className="reader-icon-btn" onClick={() => setPanel("search")} aria-label="Search this plan" title="Search (Ctrl+F)"><Search className="h-4 w-4" /></button>
          <button type="button" className="reader-icon-btn" onClick={() => setPanel("contents")} aria-label="Contents" title="Contents (C)"><List className="h-4 w-4" /></button>
          <button type="button" className="reader-icon-btn" onClick={() => setPanel("pages")} aria-label="All pages" title="All pages (G)"><LayoutGrid className="h-4 w-4" /></button>
          <span className="mx-1 hidden h-5 w-px bg-white/10 md:block" />
          <button type="button" className="reader-icon-btn hidden md:flex" onClick={() => flip.current?.zoomBy(1 / 1.4)} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out (-)"><Minus className="h-4 w-4" /></button>
          <span className="hidden w-11 text-center font-mono text-[11px] tabular-nums text-slate-400 md:block">{Math.round(zoom * 100)}%</span>
          <button type="button" className="reader-icon-btn hidden md:flex" onClick={() => flip.current?.zoomBy(1.4)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+)"><Plus className="h-4 w-4" /></button>
          <button type="button" className="reader-icon-btn hidden md:flex" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title="Full screen (F)">
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* the book */}
      <main className="reader-stage-wrap relative z-10 min-h-0 flex-1">
        <FlipBook ref={flip} book={book} images={images} page={page} layout={layout} onPage={setPage} jump={jump} highlights={highlights}
          activeHighlight={panel === "search" ? activeHighlight : null} onLink={goTo} onTapCenter={() => setChrome((value) => !value)}
          onZoom={setZoom} reducedMotion={reducedMotion} className="reader-enter absolute inset-0" />
        {layout === "spread" && zoom === 1 && (
          <>
            <button type="button" onClick={() => turn(-1)} disabled={atStart} aria-label="Previous page" className="reader-turn-btn left-4"><ChevronLeft className="h-6 w-6" /></button>
            <button type="button" onClick={() => turn(1)} disabled={atEnd} aria-label="Next page" className="reader-turn-btn right-4"><ChevronRight className="h-6 w-6" /></button>
          </>
        )}
        {zoom > 1 && (
          <button type="button" onClick={() => flip.current?.resetZoom()} className="absolute bottom-4 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-[#0b141c]/90 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur">
            <RotateCcw className="h-3.5 w-3.5" />Fit page ({Math.round(zoom * 100)}%)
          </button>
        )}
        {toast && <ReaderToast toast={toast} onClose={() => setToast(null)} onStartOver={() => { goTo(0); setToast(null) }} />}
      </main>

      {/* bottom bar */}
      <footer className={cn("reader-bar is-bottom relative z-20 shrink-0 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 sm:px-5", !chrome && "is-hidden-bottom")}>
        {(sessionsShown.length > 0 || levelSession) && (
          <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
            {sessionsShown.map((session) => {
              const isDone = done.has(session.id)
              return (
                <button key={session.id} type="button" onClick={() => toggleDone(session)} aria-pressed={isDone}
                  className={cn("reader-done-chip", isDone && "is-done")}>
                  <span className="reader-done-dot">{isDone && <Check className="h-3 w-3" strokeWidth={3.5} />}</span>
                  <span className="truncate">{isDone ? `${sessionName(session)} done` : `Mark ${sessionName(session).toLowerCase()} done`}</span>
                  <span className="hidden max-w-[180px] truncate text-slate-400 sm:inline">· {titleCase(session.t)}</span>
                </button>
              )
            })}
            {levelSession?.levels && (
              <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-0.5" role="group" aria-label="Development level">
                {Object.entries(levelSession.levels).map(([level, info]) => {
                  const active = shown.includes(info.p)
                  return (
                    <button key={level} type="button" onClick={() => goTo(info.p)} aria-pressed={active}
                      className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", active ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:text-white")}>
                      Level {level}<span className={cn("ml-1.5 font-normal", active ? "text-slate-800" : "text-slate-500")}>{info.v.toLowerCase()}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          {layout === "single" && <button type="button" className="reader-icon-btn" onClick={() => turn(-1)} disabled={atStart} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>}
          <span className="w-[74px] shrink-0 font-mono text-xs tabular-nums text-slate-300">{pageText}<span className="text-slate-600"> / {count}</span></span>
          <div className="relative flex-1">
            {scrub !== null && (
              <div className="pointer-events-none absolute bottom-7 z-30 hidden w-[110px] -translate-x-1/2 sm:block" style={{ left: `${(scrub / Math.max(1, count - 1)) * 100}%` }}>
                <PageThumb book={book} images={images} index={scrub} eager className="rounded-md shadow-[0_18px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/20" />
                <p className="mt-1.5 truncate text-center text-[10px] font-semibold text-slate-300">{scrub + 1} · {pageLabel(book, scrub)}</p>
              </div>
            )}
            <input type="range" min={0} max={count - 1} value={scrub ?? page} aria-label="Go to page" aria-valuetext={`Page ${page + 1} of ${count}`}
              onChange={(event) => setScrub(Number(event.target.value))}
              onPointerUp={() => { if (scrub !== null) { goTo(scrub); setScrub(null) } }}
              onKeyUp={() => { if (scrub !== null) { goTo(scrub); setScrub(null) } }}
              onBlur={() => setScrub(null)}
              className="reader-scrubber w-full" style={{ "--fill": `${((scrub ?? page) / Math.max(1, count - 1)) * 100}%` } as CSSProperties} />
          </div>
          <span className="hidden w-[74px] shrink-0 text-right text-[11px] tabular-nums text-slate-500 sm:block">{done.size}/{book.sessions.length} done</span>
          {layout === "single" && <button type="button" className="reader-icon-btn" onClick={() => turn(1)} disabled={atEnd} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>}
        </div>
      </footer>

      <ContentsPanel open={panel === "contents"} onOpenChange={(open) => setPanel(open ? "contents" : null)} book={book} images={images} title={title}
        current={shown} done={done} onGo={goTo} onToggleDone={toggleDone} />
      <SearchPanel open={panel === "search"} onOpenChange={(open) => setPanel(open ? "search" : null)} book={book} query={query} onQuery={setQuery}
        hits={hits} active={activeHit} onPick={pickHit} />
      <PagesGrid open={panel === "pages"} onOpenChange={(open) => setPanel(open ? "pages" : null)} book={book} images={images} current={shown}
        done={done} sessionsAt={sessionsAt} onGo={goTo} />
    </div>
  )
}

function ReaderToast({ toast, onClose, onStartOver }: { toast: Toast; onClose: () => void; onStartOver: () => void }) {
  return (
    <div key={toast.id} role="status" className={cn("reader-toast", `is-${toast.tone}`)}>
      <span className="reader-toast-icon">{toast.tone === "resume" ? <BookOpen className="h-4 w-4" /> : <Check className="h-4 w-4" strokeWidth={3} />}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">{toast.title}</span>
        {toast.detail && <span className="block truncate text-xs text-slate-400">{toast.detail}</span>}
      </span>
      {toast.tone === "resume" && <button type="button" onClick={onStartOver} className="ml-1 shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">From the cover</button>}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}

/** While the book loads: a book whose pages keep turning. */
export function ReaderLoading({ title, message }: { title?: string; message?: string }) {
  return (
    <div className="reader-root fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 text-white" role="status" aria-live="polite">
      <div aria-hidden className="reader-backdrop pointer-events-none absolute inset-0" />
      <div aria-hidden className="reader-loader relative">
        <span className="reader-loader-page is-1" /><span className="reader-loader-page is-2" /><span className="reader-loader-page is-3" />
      </div>
      <div className="relative text-center">
        <p className="text-base font-semibold">{message ?? "Opening your plan"}</p>
        {title && <p className="mt-1 text-sm text-slate-400">{title}</p>}
      </div>
    </div>
  )
}
