"use client"

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react"
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, FileDown, FileText, Loader2, Maximize2, Moon, Sparkles, Trash2, Trophy, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCountUp } from "@/components/dashboard-ui"
import { cn } from "@/lib/utils"

/** A workout card's title: one line with an ellipsis, but up to two lines on a phone, where one line leaves too little. */
export const phoneTitle = "max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:break-words"

/** Shared input styling for the training screens. */
export const inputClass = "h-10 rounded-xl border-white/10 bg-white/[0.03] transition-colors hover:border-white/20 focus-visible:border-accent/50 focus-visible:ring-accent/20"
export const textareaClass = "rounded-xl border-white/10 bg-white/[0.03] transition-colors hover:border-white/20 focus-visible:border-accent/50 focus-visible:ring-accent/20"
export const labelClass = "space-y-1.5 text-xs font-medium text-slate-400"

type ZoneTone = { solid: string; bar: string; chip: string; text: string }

const zoneTones: [string[], ZoneTone][] = [
  [["recovery"], { solid: "bg-sky-300", bar: "from-sky-300 to-sky-400", chip: "border-sky-300/25 bg-sky-300/10 text-sky-200", text: "text-sky-200" }],
  [["race"], { solid: "bg-orange-400", bar: "from-orange-300 to-rose-400", chip: "border-orange-300/25 bg-orange-400/10 text-orange-200", text: "text-orange-200" }],
  [["sprint"], { solid: "bg-fuchsia-400", bar: "from-rose-400 to-fuchsia-500", chip: "border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-200", text: "text-fuchsia-200" }],
  [["vo2", "high aerobic"], { solid: "bg-amber-300", bar: "from-amber-200 to-orange-300", chip: "border-amber-300/25 bg-amber-300/10 text-amber-100", text: "text-amber-100" }],
  [["threshold"], { solid: "bg-emerald-400", bar: "from-emerald-300 to-lime-300", chip: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200", text: "text-emerald-200" }],
  [["aerobic", "endurance"], { solid: "bg-cyan-400", bar: "from-cyan-300 to-teal-400", chip: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200", text: "text-cyan-200" }],
]
const otherTone: ZoneTone = { solid: "bg-slate-400", bar: "from-slate-300 to-slate-400", chip: "border-white/15 bg-white/[0.05] text-slate-300", text: "text-slate-300" }

/** Consistent colour per training zone, matched by name. */
export function zoneTone(zone: string): ZoneTone {
  const value = zone.toLowerCase()
  return zoneTones.find(([needles]) => needles.some((needle) => value.includes(needle)))?.[1] ?? otherTone
}

export function ZoneChip({ zone, className }: { zone: string; className?: string }) {
  const tone = zoneTone(zone)
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", tone.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.solid)} />
      {zone}
    </span>
  )
}

/** Animated stacked bar showing how volume splits across zones. */
export function ZoneStack({ entries, className }: { entries: { label: string; meters: number }[]; className?: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const total = entries.reduce((sum, entry) => sum + entry.meters, 0)
  return (
    <div className={cn("flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/[0.06]", className)} role="img" aria-label={entries.map((entry) => `${entry.label} ${entry.meters} m`).join(", ") || "No volume"}>
      {total > 0 && entries.filter((entry) => entry.meters > 0).map((entry) => (
        <div
          key={entry.label}
          title={`${entry.label} · ${entry.meters.toLocaleString()} m`}
          className={cn("h-full transition-[width] duration-1000 ease-out first:rounded-l-full last:rounded-r-full motion-reduce:transition-none", zoneTone(entry.label).solid)}
          style={{ width: shown ? `${(entry.meters / total) * 100}%` : "0%" }}
        />
      ))}
    </div>
  )
}

/**
 * Accessible disclosure with a smooth height transition. With `onOpen` it doesn't expand in place: the header opens
 * the content full screen instead (handled by the caller) and the chevron becomes a full-screen button.
 */
export function Expander({
  header,
  children,
  className,
  defaultOpen = false,
  actions,
  onOpen,
}: {
  header: ReactNode
  children?: ReactNode
  className?: string
  defaultOpen?: boolean
  /** Controls shown beside the header (e.g. a ••• menu); kept outside the toggle button. */
  actions?: ReactNode
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const expanded = open && !onOpen
  return (
    <div className={cn("group/expander overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] transition-colors duration-300", expanded && "border-white/15 bg-white/[0.04]", onOpen && "hover:border-white/15", className)}>
      <div className="flex items-center">
      <button
        type="button"
        {...(onOpen ? { "aria-haspopup": "dialog" as const, title: "Open full screen" } : { "aria-expanded": open, "aria-controls": panelId })}
        onClick={(event) => (onOpen ? onOpen(event) : setOpen((value) => !value))}
        className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <div className="min-w-0 flex-1">{header}</div>
        {onOpen ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-all duration-300 group-hover/expander:scale-110 group-hover/expander:border-accent/40 group-hover/expander:bg-accent/15 group-hover/expander:text-accent group-hover/expander:shadow-[0_0_18px_rgba(87,229,234,0.35)]">
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="sr-only">Open full screen</span>
          </span>
        ) : (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition-transform duration-300", open && "rotate-180 border-accent/30 text-accent")}>
            <ChevronDown className="h-4 w-4" />
          </span>
        )}
      </button>
      {actions && <div className="shrink-0 pr-3">{actions}</div>}
      </div>
      {!onOpen && (
        <div id={panelId} inert={!open} className={cn("grid transition-[grid-template-rows] duration-500 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="min-w-0 overflow-hidden">
            <div className={cn("border-t border-white/[0.06] p-4 transition-opacity duration-500", open ? "opacity-100" : "opacity-0")}>{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}

const bannerTones = {
  error: { icon: AlertTriangle, className: "border-rose-400/30 bg-rose-500/10 text-rose-100", iconClass: "text-rose-300" },
  success: { icon: CheckCircle2, className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100", iconClass: "text-emerald-300" },
  busy: { icon: Loader2, className: "border-accent/25 bg-accent/[0.07] text-cyan-100", iconClass: "animate-spin text-accent" },
}

/** Status message that slides in. */
export function Banner({ tone, children, action, role }: { tone: keyof typeof bannerTones; children: ReactNode; action?: ReactNode; role?: "alert" | "status" }) {
  const { icon: Icon, className, iconClass } = bannerTones[tone]
  return (
    <div role={role ?? (tone === "error" ? "alert" : "status")} className={cn("dash-reveal flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-md", className)}>
      <Icon className={cn("h-4 w-4 shrink-0", iconClass)} />
      <div className="min-w-0 flex-1 leading-6">{children}</div>
      {action}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="dash-reveal flex flex-col items-center rounded-[22px] border border-dashed border-white/12 bg-white/[0.015] px-6 py-12 text-center">
      <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10">
        <span className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" />
        <Icon className="relative h-6 w-6 text-accent" />
      </span>
      <p className="mt-4 font-semibold text-white">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-slate-400">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Short "5 Oct" style label for an ISO date (UTC, matching the training calendar). */
export function shortDate(iso: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { ...options, timeZone: "UTC" })
}

export const todayISO = () => new Date().toISOString().slice(0, 10)

export function daysUntil(iso: string) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86_400_000)
}

/** Equal-width segmented control with a sliding highlight. */
export function Segmented<T extends string | number>({ value, options, onChange, label, disabled, className }: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  return (
    <div role="radiogroup" aria-label={label} className={cn("relative grid h-10 rounded-xl border border-white/10 bg-white/[0.03] p-1", disabled && "opacity-50", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className="absolute inset-y-1 left-1 rounded-lg bg-accent shadow-[0_4px_14px_rgba(87,229,234,0.3)] transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }} />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button key={String(option.value)} type="button" role="radio" aria-checked={active} disabled={disabled} onClick={() => { if (!active) onChange(option.value) }}
            className={cn("relative z-10 truncate rounded-lg px-2 text-xs font-medium transition-colors duration-300 sm:text-sm", active ? "text-accent-foreground" : "text-slate-400 hover:text-white")}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Pill that toggles on/off with a check mark. */
export function ToggleChip({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5",
        active ? "border-accent/50 bg-accent/15 text-white shadow-[0_6px_18px_rgba(87,229,234,0.15)]" : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-white", className)}>
      <span className={cn("flex h-4 w-4 items-center justify-center rounded-full transition-all duration-300", active ? "bg-accent text-accent-foreground" : "border border-white/25")}>
        <Check strokeWidth={3} className={cn("h-2.5 w-2.5 transition-transform duration-300", active ? "scale-100" : "scale-0")} />
      </span>
      {children}
    </button>
  )
}

/** Animated step list shown while the AI coaches generate something. */
const flowGaps = { 4: "gap-4 xl:gap-4", 5: "gap-5 xl:gap-5" } as const

/**
 * Cards in two tightly stacked columns from xl up, so a short card never leaves an empty band next to a tall one.
 * Each card goes to the lighter column (by `weights`, an estimate of its height that stays stable while cards
 * expand); below xl the cards form one column in their original order.
 */
export function TwoColumnFlow({ items, weights, gap = 5 }: { items: ReactNode[]; weights?: number[]; gap?: keyof typeof flowGaps }) {
  const columns: { node: ReactNode; order: number }[][] = [[], []]
  const load = [0, 0]
  items.forEach((node, index) => {
    const column = load[1] < load[0] ? 1 : 0
    columns[column].push({ node, order: index })
    load[column] += weights?.[index] ?? 1
  })
  return (
    <div className={cn("flex flex-col xl:flex-row xl:items-start", flowGaps[gap])}>
      {columns.map((column, index) => (
        <div key={index} className={cn("contents xl:flex xl:min-w-0 xl:flex-1 xl:flex-col", flowGaps[gap])}>
          {column.map(({ node, order }) => <div key={order} className="min-w-0" style={{ order }}>{node}</div>)}
        </div>
      ))}
    </div>
  )
}

/** "Export week" pill: downloads the visible week as one branded PDF, with its own progress state. Just its icon on a
 *  phone, so the week's buttons fit on fewer lines. */
export function ExportWeekButton({ onExport, disabled }: { onExport: () => Promise<unknown>; disabled?: boolean }) {
  const [exporting, setExporting] = useState(false)
  const run = async () => {
    setExporting(true)
    try { await onExport() } finally { setExporting(false) }
  }
  return (
    <Button variant="outline" disabled={disabled || exporting} aria-busy={exporting} onClick={() => void run()} title="Download this week as a PDF"
      className="rounded-full border-white/15 bg-white/[0.04] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/10 hover:text-white max-sm:w-9 max-sm:px-0">
      {exporting ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <FileDown className="h-4 w-4 sm:mr-1.5" />}
      <span className="max-sm:sr-only">{exporting ? "Preparing PDF…" : "Export week"}</span>
    </Button>
  )
}

/** One of the week's totals in its header (distance, sessions, minutes…), counting up as it appears. */
export function WeekStat({ icon: Icon, label, value, unit, tone }: { icon: LucideIcon; label: string; value: number; unit?: string; tone: string }) {
  const shown = useCountUp(value)
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 backdrop-blur-md">
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tone)}><Icon className="h-3.5 w-3.5" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-bold tabular-nums leading-tight text-white sm:text-base">
          {shown.toLocaleString()}{unit && <span className="ml-0.5 text-xs font-medium text-slate-400">{unit}</span>}
        </span>
        <span className="block truncate text-[11px] leading-tight text-slate-400">{label}</span>
      </span>
    </div>
  )
}

/** Whether an element's text runs past its line clamp; measured again whenever its size changes. */
function useOverflow<T extends HTMLElement>(watch: unknown, active: boolean) {
  const ref = useRef<T>(null)
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || !active) return
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [watch, active])
  return [ref, overflows] as const
}

/** Text cut to a few lines (`clamp`, line-clamp classes), with Read more when it runs longer. */
export function ClampText({ text, clamp, className }: { text: string; clamp: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [ref, overflows] = useOverflow<HTMLParagraphElement>(text, !open)
  return (
    <>
      <p ref={ref} className={cn(className, !open && clamp)}>{text}</p>
      {(overflows || open) && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          className="mt-1.5 inline-flex items-center gap-1 rounded-full text-xs font-semibold text-accent transition-colors hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {open ? "Show less" : "Read more"}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", open && "rotate-180")} />
        </button>
      )}
    </>
  )
}

/**
 * What a day of the week is for, under its name: a line (two on a phone) until it's opened, then in full with the day's
 * recovery advice. It only opens when there's more to read.
 */
export function DayNotes({ objective, recovery }: { objective: string; recovery: string[] }) {
  const [open, setOpen] = useState(false)
  const [ref, overflows] = useOverflow<HTMLParagraphElement>(objective, !open)
  const panel = useId()
  if (!objective.trim() && !recovery.length) return null
  const more = overflows || open || recovery.length > 0
  const toggle = () => setOpen((value) => !value)
  return (
    <div className="mt-2">
      <div className="flex items-start gap-2">
        <p ref={ref} onClick={more ? toggle : undefined}
          className={cn("min-w-0 flex-1 text-sm leading-6 text-slate-400", !open && "line-clamp-2 sm:line-clamp-1", more && "cursor-pointer transition-colors hover:text-slate-300")}>
          {objective.trim() || "Recovery for this day"}
        </p>
        {more && (
          <button type="button" aria-expanded={open} aria-controls={panel} onClick={toggle}
            aria-label={open ? "Show less of this day's plan" : `Show this day's full plan${recovery.length ? ` and ${recovery.length} recovery tip${recovery.length === 1 ? "" : "s"}` : ""}`}
            className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            {recovery.length > 0 && <><Moon className="h-3 w-3 text-amber-200" /><span className="tabular-nums">{recovery.length}</span></>}
            <span className="max-sm:hidden">{open ? "Less" : "More"}</span>
            <ChevronDown className={cn("h-3 w-3 transition-transform duration-300", open && "rotate-180")} />
          </button>
        )}
      </div>
      {recovery.length > 0 && (
        <div id={panel} hidden={!open} className="dash-reveal mt-2 rounded-xl border border-amber-200/10 bg-amber-200/[0.035] px-3 py-2.5">
          <h5 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100/80"><Moon className="h-3 w-3 text-amber-200" />Recovery</h5>
          <ul className="space-y-1 text-sm leading-6 text-slate-300">
            {recovery.map((item, index) => <li key={index} className="flex gap-2"><span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-amber-200/80" />{item}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

const DAY_TONES = {
  swim: { today: "border-accent/30 shadow-[0_0_0_1px_rgba(87,229,234,0.06),0_14px_36px_rgba(0,0,0,0.25)]", badge: "border-accent/40 bg-accent/15", month: "text-accent", pill: "bg-accent text-accent-foreground" },
  gym: { today: "border-violet-300/30 shadow-[0_0_0_1px_rgba(167,139,250,0.06),0_14px_36px_rgba(0,0,0,0.25)]", badge: "border-violet-300/40 bg-violet-400/15", month: "text-violet-200", pill: "bg-violet-300 text-slate-950" },
} as const

/**
 * One day in the swim or gym week's list: its date and name (which open the day full screen), what it comes to
 * (`summary`), a button to add to it (`add`), what it's for (`notes`) and its sessions (`children`), a line each.
 */
export function WeekDay({ id, tone, date, dayName, isToday, summary, total, done, add, notes, onOpen, children }: {
  id: string
  tone: keyof typeof DAY_TONES
  date: string
  dayName: string
  isToday: boolean
  summary: string
  /** Sessions on the day and how many are ticked off: all of them makes it complete. */
  total: number
  done: number
  add?: ReactNode
  notes?: ReactNode
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void
  children?: ReactNode
}) {
  const style = DAY_TONES[tone]
  const complete = total > 0 && done === total
  return (
    <div id={id} className="scroll-mt-32">
      <div className={cn("rounded-2xl border bg-[linear-gradient(160deg,rgba(22,32,42,0.72),rgba(10,15,21,0.9))] p-3 transition-colors duration-500 sm:p-4",
        isToday ? style.today : complete ? "border-emerald-400/25" : "border-white/[0.07]")}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpen} aria-haspopup="dialog" title="Open this day full screen"
            className="group/day flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <span className={cn("flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border transition-colors duration-300 group-hover/day:border-white/25", isToday ? style.badge : "border-white/10 bg-white/[0.04]")}>
              <span className={cn("text-[9px] font-semibold uppercase leading-none tracking-wider", isToday ? style.month : "text-slate-500")}>{shortDate(date, { month: "short" })}</span>
              <span className="mt-0.5 text-base font-bold leading-none text-white">{Number(date.slice(8))}</span>
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold tracking-tight text-white">{dayName}</span>
                {isToday && <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider", style.pill)}>Today</span>}
              </span>
              <span className="mt-0.5 block truncate text-xs tabular-nums text-slate-400">{summary}</span>
            </span>
          </button>
          {complete && (
            <span key={`${done}/${total}`} title="Day complete" className="chip-pop inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/50 bg-gradient-to-r from-emerald-400/25 to-teal-400/15 px-1.5 py-1 text-[11px] font-semibold text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,0.3)] sm:px-2 sm:py-0.5">
              <Trophy className="h-3 w-3 text-amber-200" /><span className="max-sm:sr-only">Day complete</span>
            </span>
          )}
          {add}
        </div>
        {notes}
        {children && <div className="mt-3 space-y-2">{children}</div>}
      </div>
    </div>
  )
}

/**
 * A session in the week's list, on one line: its kind's icon, its title and what it comes to (`meta` under the title;
 * `aside` on the right from sm up, where the numbers line up down the week). The line opens it full screen (`onOpen`);
 * its ••• menu (`actions`) sits beside it.
 */
export function SessionLine({ icon, iconClassName, title, meta, aside, actions, className, onOpen }: {
  icon: ReactNode
  iconClassName?: string
  title: string
  meta?: ReactNode
  aside?: ReactNode
  actions?: ReactNode
  className?: string
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <div className={cn("group/line flex items-center rounded-xl border border-white/[0.07] bg-white/[0.025] transition-colors duration-300 hover:border-white/15 hover:bg-white/[0.045]", className)}>
      <button type="button" aria-haspopup="dialog" title="Open full screen" onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2.5 pl-2.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:pl-3">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", iconClassName)}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-semibold text-white", phoneTitle)}>{title}</span>
          {meta && <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">{meta}</span>}
        </span>
        {aside && <span className="shrink-0 text-right max-sm:hidden">{aside}</span>}
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-500 transition-[color,transform] duration-300 group-hover/line:translate-x-0.5 group-hover/line:text-slate-300" />
      </button>
      {actions && <div className="shrink-0 pr-1">{actions}</div>}
    </div>
  )
}

export function GenerationProgress({ title, subtitle, steps, interval = 5000 }: { title: string; subtitle: string; steps: string[]; interval?: number }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, steps.length - 1)), interval)
    return () => window.clearInterval(timer)
  }, [steps.length, interval])
  return (
    <div role="status" aria-live="polite" className="dash-reveal relative overflow-hidden rounded-[22px] border border-accent/30 bg-[linear-gradient(135deg,rgba(87,229,234,0.12),rgba(10,15,21,0.92))] p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 animate-pulse rounded-full bg-accent/20 blur-3xl" />
      <div className="relative flex flex-wrap items-start gap-4">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15">
          <span className="status-ping absolute inset-0 rounded-2xl bg-accent/25" />
          <Sparkles className="relative h-5 w-5 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{title}</p>
          <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>
          <ol className="mt-4 space-y-2">
            {steps.map((label, index) => (
              <li key={label} className={cn("flex items-center gap-2.5 text-sm transition-all duration-500", index > step ? "text-slate-600" : index === step ? "text-white" : "text-slate-400")}>
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-500",
                  index < step ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300" : index === step ? "border-accent bg-accent/15" : "border-white/15")}>
                  {index < step ? <Check className="h-3 w-3" /> : index === step ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> : null}
                </span>
                <span className={cn(index === step && "thinking-shimmer")}>{label}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

/** Round tick box. `burst` increments when the athlete ticks it, replaying the celebration. */
export type SaveState = "idle" | "saving" | "saved" | "failed"

export function CheckToggle({ checked, burst = 0, disabled, onClick, label, hint, className, save = "idle" }: {
  checked: boolean; burst?: number; disabled?: boolean; onClick: () => void; label: string; hint?: string; className?: string
  /** Progress of the save this tick triggered, shown on the checkbox itself. */
  save?: SaveState
}) {
  const celebrate = checked && burst > 0
  const saving = save === "saving"
  const gradient = useId()
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-busy={saving} aria-label={saving ? `${label} (saving)` : label}
      title={saving ? "Saving…" : save === "failed" ? "Couldn't save. Try again." : hint ?? label} disabled={disabled} onClick={onClick}
      className={cn("group/check relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1218] disabled:cursor-not-allowed",
        saving && "cursor-progress", save === "failed" && "check-shake", className)}>
      <span key={`face-${burst}`} aria-hidden className={cn(
        "absolute inset-0 rounded-full border-2 transition-[background-color,border-color,box-shadow,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        checked
          ? "border-emerald-300 bg-gradient-to-br from-emerald-300 via-emerald-400 to-teal-500 shadow-[0_0_0_3px_rgba(52,211,153,0.15),0_6px_22px_rgba(52,211,153,0.55)]"
          : "border-white/20 bg-white/[0.03] group-hover/check:border-emerald-300/70 group-hover/check:bg-emerald-400/[0.06] group-active/check:scale-90 group-disabled/check:opacity-35 group-disabled/check:group-hover/check:border-white/20 group-disabled/check:group-hover/check:bg-white/[0.03]",
        saving && "check-saving-face", save === "failed" && "!border-rose-400/80",
        celebrate && "check-pop")} />
      {celebrate && <span key={`ring-${burst}`} aria-hidden className="check-ring absolute inset-0 rounded-full border-2 border-emerald-300" />}
      {celebrate && Array.from({ length: 8 }, (_, index) => (
        <span key={`spark-${burst}-${index}`} aria-hidden className={cn("check-spark absolute left-1/2 top-1/2 -ml-[2px] -mt-[2px] h-1 w-1 rounded-full", index % 2 ? "bg-cyan-200" : "bg-emerald-200")}
          style={{ "--angle": `${index * 45 + 22}deg` } as CSSProperties} />
      ))}
      {saving && (
        <svg aria-hidden viewBox="0 0 44 44" className="check-saving pointer-events-none absolute -inset-[5px] h-[46px] w-[46px]">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#a7f3d0" /><stop offset="55%" stopColor="#34d399" /><stop offset="100%" stopColor="#67e8f9" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(110,231,183,0.2)" strokeWidth="3" />
          <circle cx="22" cy="22" r="20" fill="none" stroke={`url(#${CSS.escape(gradient)})`} strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray="42 58" />
        </svg>
      )}
      {save === "saved" && <span aria-hidden className="check-saved absolute inset-0 rounded-full" />}
      <svg viewBox="0 0 24 24" aria-hidden className="relative h-[18px] w-[18px]">
        <path key={`tick-${burst}-${checked}`} d="M5 12.5l4.5 4.5L19 7.5" pathLength={24} fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"
          className={cn("transition-[color,opacity] duration-300", checked ? "text-slate-950" : "text-transparent group-hover/check:text-emerald-300/50 group-disabled/check:group-hover/check:text-transparent", celebrate && "check-draw")} />
      </svg>
      {!checked && saving && <span aria-hidden className="check-saving-dot absolute h-1.5 w-1.5 rounded-full bg-emerald-300" />}
    </button>
  )
}

// ---------------------------------------------------------------- deleting a workout in place
/**
 * A workout being deleted, shown on the workout itself rather than in a banner: `deleting` while the delete is saved,
 * `deleted` while it slides away and its space closes, `failed` with the reason under it.
 */
export type Removal = { phase: "deleting" | "deleted" | "failed"; message?: string }

/** How long a deleted workout takes to say so, slide away and close up its space (the removal-* styles). */
export const REMOVAL_MS = 700

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** Resolves once a deleted workout has slid away. */
export const removalDone = () => new Promise<void>((resolve) => window.setTimeout(resolve, reducedMotion() ? 150 : REMOVAL_MS))

/**
 * Workouts being deleted in place, by id (shown by CompletionRow's `removal`). `run` deletes one: it shows as deleting
 * while `remove` saves, then as deleted while it slides away, and only then does `done` take it out of the week (with
 * what `remove` returned), so nothing below it jumps. A delete that fails stays on the workout with its reason and
 * resolves false. `announcement` tells screen readers what happened.
 */
export function useRemovals() {
  const [removals, setRemovals] = useState<ReadonlyMap<string, Removal>>(() => new Map())
  const [announcement, setAnnouncement] = useState("")
  const set = useCallback((id: string, removal: Removal | null) => setRemovals((current) => {
    const next = new Map(current)
    if (removal) next.set(id, removal)
    else next.delete(id)
    return next
  }), [])
  const run = useCallback(async <T,>(id: string, title: string, remove: () => Promise<T>, done: (result: T) => void): Promise<boolean> => {
    set(id, { phase: "deleting" })
    setAnnouncement(`Deleting ${title}…`)
    let result: T
    try {
      result = await remove()
    } catch (failure) {
      set(id, { phase: "failed", message: failure instanceof Error ? failure.message : "Please try again." })
      setAnnouncement("")
      return false
    }
    set(id, { phase: "deleted" })
    setAnnouncement(`${title} deleted.`)
    await removalDone()
    done(result)
    set(id, null)
    return true
  }, [set])
  const dismiss = useCallback((id: string) => set(id, null), [set])
  return {
    get: (id: string) => removals.get(id),
    /** A delete is under way (not just a failed one still showing its reason). */
    active: [...removals.values()].some((removal) => removal.phase !== "failed"),
    run, dismiss, announcement,
  }
}

/**
 * Over a workout being deleted: a rose veil with a passing shine and, over its controls, a label saying what's happening
 * (`done`: deleted). Without `label` (a workout open in the builder, whose toolbar says it) it's just the veil.
 */
export function RemovalVeil({ done, label = true, className }: { done: boolean; label?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("removal-veil pointer-events-none absolute inset-0 rounded-2xl", done && "removal-veil-done", className)}>
      {label && <>
        <span className="removal-veil-fade absolute inset-y-0 right-0 w-2/5 rounded-r-[inherit]" />
        <span key={done ? "done" : "deleting"} className="chip-pop absolute right-3 top-[min(50%,2.5rem)] inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-rose-300/40 bg-[#1d0b12]/95 px-2.5 py-1 text-[11px] font-semibold text-rose-100 shadow-[0_6px_20px_rgba(244,63,94,0.3)]">
          {done ? <Trash2 className="h-3.5 w-3.5 text-rose-300" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-300" />}
          {done ? "Deleted" : "Deleting…"}
        </span>
      </>}
    </span>
  )
}

/** Why a workout couldn't be deleted, right under it. */
export function RemovalError({ message, onDismiss, className }: { message?: string; onDismiss?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("dash-reveal mt-2 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-100", className)}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
      <span className="min-w-0 flex-1">Couldn&apos;t delete this. {message}</span>
      {onDismiss && <button type="button" aria-label="Dismiss" onClick={onDismiss}
        className="-m-1 shrink-0 rounded-full p-1 text-rose-200/70 transition-colors hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>}
    </div>
  )
}

/**
 * A workout with its completion tick. The tick responds instantly (optimistic) and saves in the background, so the next
 * workout can be ticked straight away. It shows its own save progress: a ring orbits the checkbox while saving, a glow
 * confirms the save, a shake and revert signal a failure. A workout being deleted (`removal`) says so on itself, then
 * slides away while its row closes up, so the workouts below rise into its place.
 */
export function CompletionRow({ checked, saving, locked, busy, label, hint, onToggle, removal, onDismissRemoval, compact = false, children }: {
  checked: boolean; locked?: boolean; label: string; hint?: string; children: ReactNode
  /** Beside a one-line session (SessionLine) rather than a card: the tick sits level with it. */
  compact?: boolean
  /** This workout's tick is being saved, from here or from another view of it (the day or workout opened full screen). */
  saving?: boolean
  /** Another change is being saved: ticking waits until it's done. */
  busy?: boolean
  /** Saves the opposite of `checked`; resolves whether it was saved (the owner then shows what is saved). */
  onToggle: () => Promise<boolean>
  /** This workout is being deleted (see useRemovals). */
  removal?: Removal
  /** Hides why a delete failed. */
  onDismissRemoval?: () => void
}) {
  const [pending, setPending] = useState<boolean | null>(null)
  const [burst, setBurst] = useState(0)
  const [result, setResult] = useState<"saved" | "failed" | null>(null)
  const alive = useRef(false)
  const row = useRef<HTMLDivElement>(null)
  const dismiss = useRef(onDismissRemoval)
  useEffect(() => { dismiss.current = onDismissRemoval })
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!result) return
    const timer = window.setTimeout(() => setResult(null), result === "saved" ? 900 : 1200)
    return () => window.clearTimeout(timer)
  }, [result])
  const phase = removal?.phase
  const gone = phase === "deleted"
  const removing = phase === "deleting" || gone
  // A workout deleted out of sight (from its editor, or a day scrolled away) is brought into view to be seen going.
  useEffect(() => {
    const element = row.current
    if (!removing || !element) return
    const box = element.getBoundingClientRect()
    if (box.bottom < 0 || box.top > window.innerHeight) element.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" })
  }, [removing])
  // Why a delete failed goes away on its own after a while.
  useEffect(() => {
    if (phase !== "failed") return
    const timer = window.setTimeout(() => dismiss.current?.(), 8000)
    return () => window.clearTimeout(timer)
  }, [phase, removal?.message])
  const shown = pending ?? checked
  const save: SaveState = pending !== null || saving ? "saving" : result ?? "idle"
  const toggle = () => {
    if (locked || busy || saving || removing || pending !== null) return
    const next = !shown
    setResult(null)
    setPending(next)
    if (next) {
      setBurst((value) => value + 1)
      try { navigator.vibrate?.(14) } catch { /* vibration unsupported */ }
    }
    void onToggle().catch(() => false).then((saved) => {
      if (!alive.current) return
      // A failed save leaves `checked` as it was, so the tick reverts.
      setPending(null)
      setResult(saved ? "saved" : "failed")
    })
  }
  return (
    <div ref={row} data-gone={gone || undefined} className="removal-row">
      <div className={cn("min-h-0", gone && "overflow-hidden")}>
        <div className={cn("flex", compact ? "items-center gap-2.5" : "items-start gap-3", gone && "removal-out", phase === "failed" && "removal-shake")}>
          <CheckToggle className={cn("transition-opacity duration-300", !compact && "mt-[18px]", removing && "opacity-30")} checked={shown} burst={burst} disabled={locked || removing}
            onClick={toggle} save={save} label={`${shown ? "Untick" : "Mark completed"}: ${label}`} hint={hint} />
          <div className={cn("relative min-w-0 flex-1 transition-[box-shadow,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", compact ? "rounded-xl" : "rounded-2xl",
            shown && (compact ? "shadow-[0_0_0_1px_rgba(52,211,153,0.3),0_8px_22px_rgba(52,211,153,0.08)]" : "shadow-[0_0_0_1px_rgba(52,211,153,0.35),0_12px_32px_rgba(52,211,153,0.10)]"))}>
            <div inert={removing} className={cn("transition-[opacity,filter] duration-300", removing && "opacity-45 saturate-[0.35]")}>{children}</div>
            {shown && burst > 0 && <span key={burst} aria-hidden className={cn("completion-sweep pointer-events-none absolute inset-0", compact ? "rounded-xl" : "rounded-2xl")} />}
            {removing && <RemovalVeil done={gone} className={compact ? "rounded-xl" : undefined} />}
            {phase === "failed" && <RemovalError message={removal?.message} onDismiss={onDismissRemoval} />}
          </div>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{save === "saving" ? "Saving" : save === "saved" ? "Saved" : save === "failed" ? "Couldn't save" : ""}</span>
    </div>
  )
}

// ---------------------------------------------------------------- loading states
type LoadTone = "swim" | "gym" | "meets"
const LOAD_TONES: Record<LoadTone, { text: string; glow: string; bar: string; ring: string }> = {
  swim: { text: "text-cyan-200", glow: "bg-cyan-400/20", bar: "from-cyan-300 via-sky-400 to-cyan-200", ring: "border-cyan-300/25" },
  gym: { text: "text-violet-200", glow: "bg-violet-400/20", bar: "from-violet-300 via-fuchsia-400 to-cyan-300", ring: "border-violet-300/25" },
  meets: { text: "text-amber-200", glow: "bg-amber-300/20", bar: "from-amber-200 via-orange-300 to-amber-100", ring: "border-amber-300/25" },
}

/** Animated status card shown while a Training section loads: themed art, rotating messages and a flowing bar. */
export function LoadingLane({ tone, title, messages }: { tone: LoadTone; title: string; messages: string[] }) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % messages.length), 1700)
    return () => window.clearInterval(timer)
  }, [messages.length])
  const style = LOAD_TONES[tone]
  return (
    <div role="status" aria-live="polite" aria-busy="true"
      className={cn("tl-appear relative flex items-center gap-4 overflow-hidden rounded-[22px] border bg-[linear-gradient(135deg,rgba(22,32,42,0.85),rgba(10,15,21,0.94))] p-4 sm:gap-5 sm:p-5", style.ring)}>
      <div aria-hidden className={cn("pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full blur-3xl", style.glow)} />
      <div aria-hidden className="relative h-16 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#071622] sm:w-36">
        {tone === "swim" ? <SwimmerArt /> : tone === "gym" ? <BarbellArt /> : <StopwatchArt />}
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          {title}
          <span className="tl-dots inline-flex gap-0.5" aria-hidden><span /><span /><span /></span>
        </p>
        <p key={index} className={cn("tl-message mt-1 truncate text-xs sm:text-sm", style.text)}>{messages[index]}</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className={cn("tl-flow h-full w-1/3 rounded-full bg-gradient-to-r", style.bar)} />
        </div>
      </div>
    </div>
  )
}

function SwimmerArt() {
  return (
    <>
      <span className="tl-rope absolute inset-x-0 top-[22%] h-[2px]" />
      <span className="tl-rope absolute inset-x-0 bottom-[22%] h-[2px]" />
      <span className="tl-caustic absolute inset-0" />
      <span className="tl-swimmer absolute top-1/2">
        <span className="tl-wake absolute right-3 top-1/2 h-2 w-14 -translate-y-1/2 rounded-full" />
        <svg viewBox="0 0 40 20" className="relative h-5 w-10">
          <circle cx="33" cy="10" r="3.4" fill="#e0fbff" />
          <path d="M6 11 H29" stroke="#a5f3fc" strokeWidth="3.2" strokeLinecap="round" />
          <path className="tl-arm" d="M27 10 Q 31 2 37 4" stroke="#e0fbff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path className="tl-kick" d="M6 11 L1 9" stroke="#a5f3fc" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
      {[0, 1, 2, 3].map((bubble) => <span key={bubble} className="tl-bubble absolute" style={{ left: `${20 + bubble * 18}%`, "--i": bubble } as CSSProperties} />)}
    </>
  )
}

function BarbellArt() {
  return (
    <>
      <span className="absolute inset-x-3 bottom-2 h-[2px] rounded-full bg-white/10" />
      <span className="tl-lift absolute left-1/2 top-1/2 flex items-center">
        <span className="h-7 w-2 rounded-sm bg-violet-300" /><span className="ml-0.5 h-5 w-1.5 rounded-sm bg-violet-200/80" />
        <span className="h-1 w-12 rounded-full bg-slate-200" />
        <span className="mr-0.5 h-5 w-1.5 rounded-sm bg-violet-200/80" /><span className="h-7 w-2 rounded-sm bg-violet-300" />
      </span>
      <span className="tl-lift-shadow absolute bottom-1.5 left-1/2 h-1.5 w-16 rounded-full bg-violet-400/30 blur-[2px]" />
    </>
  )
}

function StopwatchArt() {
  return (
    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <svg viewBox="0 0 40 40" className="h-11 w-11">
        <rect x="17" y="1" width="6" height="4" rx="1" fill="#fcd34d" />
        <circle cx="20" cy="22" r="15" fill="none" stroke="rgba(252,211,77,0.25)" strokeWidth="2.5" />
        <circle className="tl-dial" cx="20" cy="22" r="15" fill="none" stroke="#fcd34d" strokeWidth="2.5" strokeLinecap="round" pathLength={100} strokeDasharray="100" transform="rotate(-90 20 22)" />
        <line className="tl-hand" x1="20" y1="22" x2="20" y2="11" stroke="#fff7ed" strokeWidth="2" strokeLinecap="round" />
        <circle cx="20" cy="22" r="2" fill="#fff7ed" />
      </svg>
    </span>
  )
}

/** A shimmering placeholder block. */
export function Skeleton({ className, delay = 0 }: { className?: string; delay?: number }) {
  return <span aria-hidden className={cn("tl-skeleton block rounded-lg", className)} style={{ "--d": `${delay}ms` } as CSSProperties} />
}

/** Day tile placeholder for the week strip; the shimmer ripples across the seven days like a wave. */
export function DayTileSkeleton({ index }: { index: number }) {
  return (
    <div aria-hidden className="tl-day flex h-28 flex-col items-center justify-between rounded-[20px] border border-white/[0.06] bg-white/[0.025] px-1 py-2.5 sm:h-32" style={{ "--i": index } as CSSProperties}>
      <Skeleton className="h-2 w-7" delay={index * 90} />
      <Skeleton className="h-5 w-6 rounded-md" delay={index * 90} />
      <span className="tl-level relative h-8 w-2 overflow-hidden rounded-full bg-white/[0.06] sm:w-3"><span /></span>
      <Skeleton className="h-2 w-4" delay={index * 90} />
    </div>
  )
}

/** Days of the week's list (see WeekDay) in their shape, so nothing jumps when the data arrives. */
export function WeekSkeleton() {
  return (
    <div className="tl-appear space-y-3" aria-hidden>
      {[0, 1, 2, 3].map((card) => (
        <div key={card} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 shrink-0 rounded-xl" delay={card * 150} />
            <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-28" delay={card * 150 + 60} /><Skeleton className="h-3 w-44 max-w-full" delay={card * 150 + 120} /></div>
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-[54px] w-full rounded-xl" delay={card * 150 + 180} />
            {card % 2 === 0 && <Skeleton className="h-[54px] w-full rounded-xl" delay={card * 150 + 240} />}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Meet cards in the shape of a competition entry. */
export function CompetitionSkeleton() {
  return (
    <div className="tl-appear space-y-5" aria-hidden>
      {[0, 1].map((card) => (
        <div key={card} className="rounded-[24px] border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10">
              <span className="tl-skeleton-amber h-4 w-full" />
              <span className="flex flex-1 items-center justify-center"><Skeleton className="h-5 w-6" delay={card * 200} /></span>
            </div>
            <div className="flex-1 space-y-2.5">
              <Skeleton className="h-5 w-48 max-w-full" delay={card * 200 + 60} />
              <Skeleton className="h-3 w-64 max-w-full" delay={card * 200 + 120} />
              <div className="flex flex-wrap gap-2 pt-1">{[0, 1, 2].map((chip) => <Skeleton key={chip} className="h-6 w-20 rounded-full" delay={card * 200 + 180 + chip * 60} />)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
