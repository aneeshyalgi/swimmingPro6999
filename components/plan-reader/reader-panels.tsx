"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, ChevronUp, Search, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { pageLabel, titleCase, type Book, type BookSession, type SearchHit, type TocEntry } from "@/lib/plan-book"
import { cn } from "@/lib/utils"
import { BookPage } from "./book-page"

/** A page drawn small, only once it scrolls near the screen. */
export function PageThumb({ book, images, index, className, eager }: {
  book: Book; images: Record<string, string>; index: number; className?: string; eager?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(Boolean(eager))
  useEffect(() => {
    if (shown || !ref.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShown(true)
        observer.disconnect()
      }
    }, { rootMargin: "320px" })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [shown])
  const background = book.pages[index]?.bg
  return (
    <div ref={ref} aria-hidden className={cn("relative overflow-hidden", className)}
      style={{ aspectRatio: `${book.size[0]} / ${book.size[1]}`, background: background === "image" ? "#0c3b42" : background ?? "#fff" }}>
      {shown && <BookPage book={book} index={index} images={images} />}
    </div>
  )
}

const two = (value: number) => String(value).padStart(2, "0")

export function sessionName(session: BookSession) {
  return session.s ? `Session ${two(session.s)}` : "Supplement"
}

function DoneToggle({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={done} aria-label={label}
      className={cn("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all",
        done ? "border-emerald-300/60 bg-emerald-400 text-emerald-950 shadow-[0_0_14px_rgba(52,211,153,0.45)]" : "border-white/20 text-transparent hover:border-emerald-300/60 hover:text-emerald-200/70")}>
      <Check className="h-3.5 w-3.5" strokeWidth={3.2} />
    </button>
  )
}

/** The book's contents: front pages, each week with its sessions (tick them off here), and the closing pages. */
export function ContentsPanel({ open, onOpenChange, book, images, title, current, done, onGo, onToggleDone }: {
  open: boolean; onOpenChange: (open: boolean) => void; book: Book; images: Record<string, string>; title: string
  current: number[]; done: Set<string>; onGo: (page: number) => void; onToggleDone: (session: BookSession) => void
}) {
  const sessions = new Map(book.sessions.map((session) => [session.id, session]))
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => listRef.current?.querySelector("[aria-current='page']")?.scrollIntoView({ block: "center" }), 80)
    return () => window.clearTimeout(timer)
  }, [open])
  const total = book.sessions.length
  const doneCount = book.sessions.filter((session) => done.has(session.id)).length
  const isCurrent = (page: number) => current.includes(page)
  const go = (page: number) => { onGo(page); onOpenChange(false) }

  const row = (entry: TocEntry, nested: boolean): ReactNode => {
    const session = entry.session ? sessions.get(entry.session) : undefined
    const here = isCurrent(entry.p) || Boolean(session?.levels && Object.values(session.levels).some((level) => isCurrent(level.p)))
    return (
      <li key={`${entry.p}-${entry.t}`} className={cn("group relative flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
        nested && "pl-4", here ? "bg-cyan-300/[0.09] ring-1 ring-cyan-300/25" : "hover:bg-white/[0.05]")}>
        {session ? (
          <DoneToggle done={done.has(session.id)} onToggle={() => onToggleDone(session)} label={`${done.has(session.id) ? "Untick" : "Tick off"} ${sessionName(session)}`} />
        ) : (
          <span className="w-6 shrink-0 text-center font-mono text-[11px] tabular-nums text-slate-500">{entry.p + 1}</span>
        )}
        <button type="button" onClick={() => go(entry.p)} aria-current={here ? "page" : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-cyan-300/70">
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-[13px] font-semibold", here ? "text-white" : "text-slate-200")}>
              {session ? <><span className="mr-1.5 font-mono text-[11px] text-cyan-200/80">{session.s ? `S${two(session.s)}` : "SUP"}</span>{titleCase(session.t)}</> : titleCase(entry.t)}
            </span>
            {session && (session.st || session.v) && (
              <span className="block truncate text-[11px] text-slate-500">
                {[session.st && titleCase(session.st), session.levels ? Object.entries(session.levels).map(([level, info]) => `L${level} ${info.v.toLowerCase()}`).join(" · ") : session.v.toLowerCase()].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
          {!session && <span className="text-[11px] tabular-nums text-slate-600 group-hover:text-slate-400">p.{entry.p + 1}</span>}
        </button>
      </li>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-[min(92vw,400px)] flex-col gap-0 border-white/10 bg-[#091017] p-0 text-white sm:max-w-none"
        onOpenAutoFocus={(event) => { event.preventDefault(); window.setTimeout(() => listRef.current?.querySelector<HTMLElement>("[aria-current='page']")?.focus({ preventScroll: true }), 90) }}>
        <div className="flex items-center gap-4 border-b border-white/[0.07] p-5 pr-12">
          <PageThumb book={book} images={images} index={0} eager className="w-14 shrink-0 rounded-md shadow-[0_10px_24px_rgba(0,0,0,0.5)] ring-1 ring-white/10" />
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-lg font-bold text-white">{title}</SheetTitle>
            <SheetDescription className="mt-0.5 text-xs text-slate-400">{doneCount} of {total} sessions done</SheetDescription>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-[width] duration-500" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
        <div ref={listRef} className="reader-scroll flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {book.toc.map((entry) => {
              if (!entry.c) return row(entry, false)
              const weekSessions = entry.c.map((child) => child.session).filter((id): id is string => Boolean(id))
              const weekDone = weekSessions.filter((id) => done.has(id)).length
              const here = isCurrent(entry.p)
              return (
                <li key={`week-${entry.p}`} className="pt-3">
                  <button type="button" onClick={() => go(entry.p)} aria-current={here ? "page" : undefined}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors", here ? "bg-cyan-300/[0.09] ring-1 ring-cyan-300/25" : "hover:bg-white/[0.05]")}>
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-bold",
                      weekSessions.length && weekDone === weekSessions.length ? "bg-emerald-400 text-emerald-950" : "bg-white/[0.07] text-cyan-200")}>
                      {entry.w ? two(entry.w) : "•"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200/90">{entry.t}</span>
                      {entry.st && <span className="block truncate text-[13px] font-semibold text-white">{titleCase(entry.st)}</span>}
                    </span>
                    {weekSessions.length > 0 && <span className="text-[11px] tabular-nums text-slate-500">{weekDone}/{weekSessions.length}</span>}
                  </button>
                  <ul className="ml-[22px] mt-1 space-y-0.5 border-l border-white/[0.07] pl-1.5">{entry.c.map((child) => row(child, true))}</ul>
                </li>
              )
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Find any word in the book: every match, with its page and the line it's on. */
export function SearchPanel({ open, onOpenChange, book, query, onQuery, hits, active, onPick }: {
  open: boolean; onOpenChange: (open: boolean) => void; book: Book; query: string; onQuery: (query: string) => void
  hits: SearchHit[]; active: number; onPick: (index: number) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector("[aria-current='true']")?.scrollIntoView({ block: "nearest" })
  }, [active])
  const step = (by: number) => hits.length && onPick((active + by + hits.length) % hits.length)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" onInteractOutside={(event) => event.preventDefault()}
        className="flex w-[min(92vw,400px)] flex-col gap-0 border-white/10 bg-[#091017]/95 p-0 text-white backdrop-blur-xl sm:max-w-none">
        <div className="border-b border-white/[0.07] p-5 pr-12">
          <SheetTitle className="text-lg font-bold text-white">Search this plan</SheetTitle>
          <SheetDescription className="sr-only">Find words anywhere in the book.</SheetDescription>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Sets, drills, equipment…"
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); step(event.shiftKey ? -1 : 1) } }}
              className="h-11 w-full rounded-full border border-white/[0.1] bg-white/[0.04] pl-10 pr-9 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/40" />
            {query && (
              <button type="button" onClick={() => onQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400" aria-live="polite">
            <span>{query.trim().length < 2 ? "Type at least two letters." : hits.length ? `${active + 1} of ${hits.length}${hits.length >= 200 ? "+" : ""} matches` : "No matches in this plan."}</span>
            {hits.length > 1 && (
              <span className="flex gap-1">
                <button type="button" onClick={() => step(-1)} aria-label="Previous match" className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12]"><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => step(1)} aria-label="Next match" className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12]"><ChevronDown className="h-4 w-4" /></button>
              </span>
            )}
          </div>
        </div>
        <ul ref={listRef} className="reader-scroll flex-1 space-y-1 overflow-y-auto p-3">
          {hits.map((hit, index) => (
            <li key={`${hit.page}-${index}`}>
              <button type="button" onClick={() => onPick(index)} aria-current={index === active}
                className={cn("w-full rounded-xl px-3 py-2.5 text-left transition-colors", index === active ? "bg-amber-300/[0.1] ring-1 ring-amber-300/30" : "hover:bg-white/[0.05]")}>
                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Page {hit.page + 1} · {pageLabel(book, hit.page)}</span>
                <span className="mt-1 block text-[13px] leading-5 text-slate-300">
                  {hit.snippet[0] && "…"}{hit.snippet[0]}<mark className="rounded bg-amber-300/90 px-0.5 font-semibold text-slate-950">{hit.snippet[1]}</mark>{hit.snippet[2]}{hit.snippet[2] && "…"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}

/** Every page at a glance; tap one to go there. */
export function PagesGrid({ open, onOpenChange, book, images, current, done, sessionsAt, onGo }: {
  open: boolean; onOpenChange: (open: boolean) => void; book: Book; images: Record<string, string>; current: number[]
  done: Set<string>; sessionsAt: Map<number, BookSession>; onGo: (page: number) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => gridRef.current?.querySelector("[aria-current='page']")?.scrollIntoView({ block: "center" }), 60)
    return () => window.clearTimeout(timer)
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92dvh,900px)] w-[min(96vw,1200px)] max-w-none flex-col gap-0 border-white/10 bg-[#091017] p-0 text-white sm:max-w-none"
        onOpenAutoFocus={(event) => { event.preventDefault(); window.setTimeout(() => gridRef.current?.querySelector<HTMLElement>("[aria-current='page']")?.focus({ preventScroll: true }), 70) }}>
        <div className="border-b border-white/[0.07] px-6 py-5">
          <DialogTitle className="text-lg font-bold text-white">All {book.pages.length} pages</DialogTitle>
          <DialogDescription className="text-xs text-slate-400">Tap a page to open it.</DialogDescription>
        </div>
        <div ref={gridRef} className="reader-scroll grid flex-1 grid-cols-3 content-start gap-x-4 gap-y-5 overflow-y-auto p-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7">
          {book.pages.map((_, index) => {
            const session = sessionsAt.get(index)
            const here = current.includes(index)
            const meta = book.pages[index].meta
            return (
              <button key={index} type="button" onClick={() => { onGo(index); onOpenChange(false) }} aria-current={here ? "page" : undefined}
                aria-label={`Page ${index + 1}: ${pageLabel(book, index)}`} className="group flex flex-col items-center gap-1.5 text-left">
                <span className={cn("relative block w-full overflow-hidden rounded-[6px] ring-2 transition-all duration-200",
                  here ? "ring-cyan-300 shadow-[0_0_24px_rgba(103,232,249,0.35)]" : "ring-white/[0.06] group-hover:-translate-y-1 group-hover:ring-white/30")}>
                  <PageThumb book={book} images={images} index={index} />
                  {session && done.has(session.id) && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-emerald-950 shadow-lg"><Check className="h-3 w-3" strokeWidth={3.5} /></span>
                  )}
                </span>
                <span className={cn("w-full truncate text-center text-[10px] font-semibold", here ? "text-cyan-200" : "text-slate-500")}>
                  {index + 1}{meta.k === "session" ? ` · W${meta.w} ${meta.s ? `S${two(meta.s)}` : "SUP"}${meta.l ? ` L${meta.l}` : ""}` : meta.k === "week" ? ` · Week ${meta.w}` : ""}
                </span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
