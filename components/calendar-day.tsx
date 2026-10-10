"use client"

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react"
import { Check, Maximize2 } from "lucide-react"
import { cn } from "@/lib/utils"

const TONES = {
  swim: { ring: "wk-ring-swim", hover: "hover:bg-accent/45", fill: "wk-fill-swim", label: "text-cyan-100", day: "text-accent", glow: "hover:shadow-[0_18px_40px_-12px_rgba(87,229,234,0.45)]" },
  gym: { ring: "wk-ring-gym", hover: "hover:bg-violet-300/45", fill: "wk-fill-gym", label: "text-violet-100", day: "text-violet-200", glow: "hover:shadow-[0_18px_40px_-12px_rgba(167,139,250,0.45)]" },
} as const

/**
 * One day of the swim or gym week calendar, drawn as a lane that fills with water to the day's training load. Clicking
 * it opens the day full screen (see DayFocus); it hands back its own position so the view can grow out of it.
 */
export function CalendarDay({ tone, index, date, dayName, isToday, past, level, amount, unit, total, done, emptyLabel, icons, onOpen }: {
  tone: keyof typeof TONES
  /** Position in the week, for the staggered entrance. */
  index: number
  date: string
  dayName: string
  isToday: boolean
  past: boolean
  /** Training load relative to the week's biggest day, 0–1. */
  level: number
  /** The load as text ("4.2k", "45"), shown with `unit`; null when nothing is planned. */
  amount: string | null
  unit: string
  total: number
  done: number
  /** Shown when nothing is planned ("Rest", "Free"). */
  emptyLabel: string
  /** Small markers along the bottom (meet, strength, mobility…). */
  icons?: ReactNode
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const styles = TONES[tone]
  const ref = useRef<HTMLButtonElement>(null)
  // The water rises once the tile is on screen.
  const [filled, setFilled] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const complete = total > 0 && done === total
  const height = amount && filled ? 14 + Math.min(1, Math.max(0, level)) * 62 : 0

  const track = (event: PointerEvent<HTMLButtonElement>) => {
    const element = ref.current
    if (!element) return
    const box = element.getBoundingClientRect()
    element.style.setProperty("--mx", `${event.clientX - box.left}px`)
    element.style.setProperty("--my", `${event.clientY - box.top}px`)
  }

  return (
    <button ref={ref} type="button" onClick={onOpen} onPointerMove={track} style={{ "--i": index } as CSSProperties}
      aria-label={`${dayName} ${Number(date.slice(8))}${amount ? `, ${amount} ${unit}` : `, ${emptyLabel.toLowerCase()}`}${total ? `, ${done} of ${total} done` : ""}. Open full screen.`}
      className={cn("wk-in wk-tile group relative h-32 rounded-[20px] p-px text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:h-40",
        isToday ? cn("wk-ring", styles.ring) : cn("bg-white/[0.08]", styles.hover), styles.glow, past && !isToday && "opacity-70 hover:opacity-100")}>
      <span className="relative flex h-full flex-col items-center overflow-hidden rounded-[19px] bg-[linear-gradient(180deg,#0c141c,#070c12)] px-1 pb-2 pt-2.5">
        <span aria-hidden className="wk-spot pointer-events-none absolute inset-0" />

        {/* The day's water */}
        <span aria-hidden className={cn("wk-fill absolute inset-x-0 bottom-0", complete ? "wk-fill-done" : styles.fill)} style={{ height: `${height}%` }}>
          {height > 0 && <>
            <svg className="gs-wave absolute -top-2.5 left-0 h-3 w-[200%]" viewBox="0 0 400 16" preserveAspectRatio="none">
              <path d="M0 8 Q 25 0 50 8 T 100 8 T 150 8 T 200 8 T 250 8 T 300 8 T 350 8 T 400 8 V16 H0 Z" fill="currentColor" />
            </svg>
            <svg className="gs-wave gs-wave-back absolute -top-2 left-0 h-3 w-[200%]" viewBox="0 0 400 16" preserveAspectRatio="none">
              <path d="M0 8 Q 25 16 50 8 T 100 8 T 150 8 T 200 8 T 250 8 T 300 8 T 350 8 T 400 8 V16 H0 Z" fill="currentColor" />
            </svg>
          </>}
        </span>

        <span aria-hidden className="wk-open absolute right-1.5 top-1.5 hidden h-5 w-5 place-items-center rounded-full bg-white/10 text-white backdrop-blur sm:grid">
          <Maximize2 className="h-3 w-3" />
        </span>
        {complete && (
          <span aria-hidden className="check-pop absolute left-1.5 top-1.5 hidden h-5 w-5 place-items-center rounded-full bg-emerald-400 text-slate-950 shadow-[0_0_14px_rgba(52,211,153,0.7)] sm:grid">
            <Check className="h-3 w-3" strokeWidth={3.5} />
          </span>
        )}

        <span className={cn("relative text-[10px] font-semibold uppercase tracking-[0.14em]", isToday ? styles.day : "text-slate-500")}>{dayName.slice(0, 3)}</span>
        <span className="relative mt-0.5 text-xl font-bold tabular-nums leading-none text-white sm:text-2xl">{Number(date.slice(8))}</span>
        {isToday && <span className={cn("relative mt-1 rounded-full px-1.5 text-[8px] font-bold uppercase tracking-wider sm:text-[9px]", tone === "swim" ? "bg-accent text-accent-foreground" : "bg-violet-300 text-slate-950")}>Today</span>}

        <span className="relative mt-auto flex flex-col items-center gap-1">
          {amount ? (
            <span className="text-center leading-none">
              <span className={cn("block text-xs font-bold tabular-nums drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] sm:text-sm", styles.label)}>{amount}</span>
              <span className="block text-[9px] font-medium text-white/60">{unit}</span>
            </span>
          ) : (
            <span className="text-[10px] font-medium text-slate-500">{emptyLabel}</span>
          )}
          <span className="flex h-3 items-center gap-0.5">{complete && <Check aria-hidden className="h-3 w-3 text-emerald-300 sm:hidden" strokeWidth={3.5} />}{icons}</span>
        </span>
      </span>
    </button>
  )
}

/** Compact distance for a narrow tile: 800 → "800", 4200 → "4.2k". */
export const compactMeters = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)}k` : String(meters))
