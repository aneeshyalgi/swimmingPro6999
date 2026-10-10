"use client"

import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { CheckCircle2, ChevronLeft, ChevronRight, X } from "lucide-react"
import { shortDate, todayISO } from "@/components/training-ui"
import { cn } from "@/lib/utils"

/** A day in the strip along the top: how many sessions it holds and how many are ticked off. */
export type FocusDay = { date: string; day_name: string; total: number; done: number }
/** A workout the single-workout view can step to. */
export type FocusSession = { id: string; eyebrow: string; title: string }
type Origin = { x: number; y: number } | null

const TONES = {
  swim: {
    eyebrow: "text-accent",
    active: "border-accent/60 bg-accent/15 text-white shadow-[0_8px_24px_rgba(87,229,234,0.22)]",
    dot: "bg-accent",
    glow: "bg-[radial-gradient(ellipse_70%_50%_at_15%_0%,rgba(87,229,234,0.16),transparent_60%),radial-gradient(ellipse_60%_50%_at_100%_100%,rgba(56,120,220,0.14),transparent_60%)]",
    today: "bg-accent text-accent-foreground",
  },
  gym: {
    eyebrow: "text-violet-300",
    active: "border-violet-300/60 bg-violet-400/15 text-white shadow-[0_8px_24px_rgba(167,139,250,0.22)]",
    dot: "bg-violet-300",
    glow: "bg-[radial-gradient(ellipse_70%_50%_at_15%_0%,rgba(167,139,250,0.18),transparent_60%),radial-gradient(ellipse_60%_50%_at_100%_100%,rgba(87,229,234,0.1),transparent_60%)]",
    today: "bg-violet-300 text-slate-950",
  },
} as const

/**
 * The full-screen shell: grows out of whatever was clicked, steps through a list with the arrows and the ← → keys,
 * and closes with Esc or ✕.
 */
function FocusView({ tone, eyebrow, title, origin, index, count, onMove, onClose, contentKey, counter, strip, summary, children }: {
  tone: keyof typeof TONES
  eyebrow: ReactNode
  title: string
  origin: Origin
  /** Position of the open entry; -1 keeps the view closed. */
  index: number
  count: number
  onMove: (index: number) => void
  onClose: () => void
  /** Changes whenever the shown entry does, so its content slides in. */
  contentKey: string
  /** Shown beside the arrows ("2 of 9"). */
  counter?: string
  strip?: (select: (index: number) => void) => ReactNode
  summary?: ReactNode
  children: ReactNode
}) {
  const styles = TONES[tone]
  const open = index >= 0
  // Which way the content slides when the entry changes.
  const [direction, setDirection] = useState<"next" | "prev">("next")

  const select = (target: number) => {
    if (target < 0 || target >= count || target === index) return
    setDirection(target > index ? "next" : "prev")
    onMove(target)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    // Leave arrow keys to menus and fields opened from inside the view.
    if ((event.target as HTMLElement).closest('[role="menu"], input, textarea, select, [contenteditable="true"]')) return
    event.preventDefault()
    select(index + (event.key === "ArrowLeft" ? -1 : 1))
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        {/* Invisible, but Radix locks the page's scroll from the overlay: without it the page behind kept scrolling and
            showed a second scrollbar beside the view's own. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50" />
        <DialogPrimitive.Content onKeyDown={onKeyDown} aria-describedby={undefined}
          style={{ "--dv-x": origin ? `${origin.x}px` : "50%", "--dv-y": origin ? `${origin.y}px` : "50%" } as CSSProperties}
          className="dv-root fixed inset-0 z-50 flex flex-col bg-[#05090d] text-foreground outline-none">
          <div aria-hidden className={cn("pointer-events-none absolute inset-0", styles.glow)} />
          <div aria-hidden className="au-grid pointer-events-none absolute inset-0 opacity-60" />

          {open && <>
            <header className="relative z-10 border-b border-white/[0.07] bg-[#05090d]/70 backdrop-blur-xl">
              <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 pb-3 pt-4 sm:px-6">
                <DialogPrimitive.Close aria-label="Close full screen view"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-[10px] font-semibold uppercase tracking-[0.22em]", styles.eyebrow)}>{eyebrow}</p>
                  <DialogPrimitive.Title className="truncate text-lg font-bold tracking-tight text-white sm:text-xl">{title}</DialogPrimitive.Title>
                </div>
                {counter && <span className="hidden shrink-0 text-xs tabular-nums text-slate-400 sm:block">{counter}</span>}
                {count > 1 && (
                  <div className="flex shrink-0 items-center rounded-full border border-white/10 bg-black/30 p-1">
                    <button type="button" onClick={() => select(index - 1)} disabled={index <= 0} aria-label="Previous"
                      className="grid h-8 w-8 place-items-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => select(index + 1)} disabled={index >= count - 1} aria-label="Next"
                      className="grid h-8 w-8 place-items-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              {strip?.(select)}
            </header>

            <div className="relative flex-1 overflow-y-auto overscroll-contain">
              <div key={contentKey} className={cn("mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6", direction === "next" ? "dv-next" : "dv-prev")}>
                {summary && <div className="mb-5 flex flex-wrap items-center gap-2">{summary}</div>}
                {children}
              </div>
            </div>
          </>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** One day of the swim or gym week full screen, opened from its calendar tile; a strip of the week's days on top. */
export function DayFocus({ tone, eyebrow, days, date, origin, onDate, onClose, summary, children }: {
  tone: keyof typeof TONES
  eyebrow: string
  days: FocusDay[]
  /** The open day; null keeps the view closed. */
  date: string | null
  /** Centre of the clicked calendar tile, where the view grows from. */
  origin: Origin
  onDate: (date: string) => void
  onClose: () => void
  /** Chips under the day's title (distance, minutes, progress). */
  summary?: ReactNode
  /** The day's sessions. */
  children: ReactNode
}) {
  const styles = TONES[tone]
  const index = days.findIndex((day) => day.date === date)
  const today = todayISO()
  return (
    <FocusView tone={tone} eyebrow={eyebrow} title={index >= 0 ? shortDate(days[index].date, { weekday: "long", day: "numeric", month: "long" }) : ""}
      origin={origin} index={index} count={days.length} onMove={(target) => onDate(days[target].date)} onClose={onClose}
      contentKey={date ?? ""} summary={summary}
      strip={(select) => (
        <nav aria-label="Days this week" className="mx-auto grid max-w-4xl grid-cols-7 gap-1.5 px-4 pb-3 sm:gap-2 sm:px-6">
          {days.map((item, position) => {
            const active = position === index
            const complete = item.total > 0 && item.done === item.total
            return (
              <button key={item.date} type="button" onClick={() => select(position)} aria-current={active ? "date" : undefined}
                aria-label={`${item.day_name}${item.total ? `, ${item.done} of ${item.total} done` : ", nothing planned"}`}
                className={cn("flex flex-col items-center gap-0.5 rounded-xl border py-1.5 transition-all duration-300",
                  active ? styles.active : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-white")}>
                <span className="text-[10px] font-semibold uppercase tracking-wider">{item.day_name.slice(0, 3)}</span>
                <span className={cn("grid h-6 min-w-6 place-items-center rounded-full px-1 text-sm font-bold", item.date === today && !active && styles.today)}>
                  {Number(item.date.slice(8))}
                </span>
                <span className="flex h-2 items-center">
                  {complete ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-300" />
                    : item.total > 0 ? <span className={cn("h-1.5 w-1.5 rounded-full", styles.dot)} /> : null}
                </span>
              </button>
            )
          })}
        </nav>
      )}>
      {children}
    </FocusView>
  )
}

/** One workout full screen, opened from its card; the arrows step through the week's workouts in order. */
export function WorkoutFocus({ tone, sessions, id, origin, onSelect, onClose, summary, children }: {
  tone: keyof typeof TONES
  sessions: FocusSession[]
  /** The open workout; null keeps the view closed. */
  id: string | null
  origin: Origin
  onSelect: (id: string) => void
  onClose: () => void
  summary?: ReactNode
  /** The workout in full. */
  children: ReactNode
}) {
  const index = sessions.findIndex((session) => session.id === id)
  const session = index >= 0 ? sessions[index] : null
  return (
    <FocusView tone={tone} eyebrow={session?.eyebrow} title={session?.title ?? ""} origin={origin} index={index} count={sessions.length}
      onMove={(target) => onSelect(sessions[target].id)} onClose={onClose} contentKey={id ?? ""} summary={summary}
      counter={session ? `Workout ${index + 1} of ${sessions.length} this week` : undefined}>
      {children}
    </FocusView>
  )
}

/** Where an element sits on screen, so a full-screen view can grow out of it. */
export const tileCentre = (element: HTMLElement) => {
  const box = element.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}
