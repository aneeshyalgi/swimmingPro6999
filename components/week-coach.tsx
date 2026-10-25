"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  ArrowRight, ArrowUp, ArrowUpRight, CalendarRange, Check, ChevronDown, Clock, Copy, Dumbbell, Heart, Info, Loader2, MapPin, MessageCircle, Pencil, Plus,
  RefreshCw, RotateCcw, Sparkles, Trash2, Undo2, Waves, X,
} from "lucide-react"
import { CoachAvatar } from "@/components/coach-avatar"
import { shortDate } from "@/components/training-ui"
import { cn } from "@/lib/utils"
import { randomId, type BuilderSection, type GymWeek, type GymWorkoutData, type SwimWorkout, type TrainingWeek } from "@/lib/training"
import {
  FRESH_PLAN, applyWeekChanges, askWeekCoach, diffList, parseGym, sameName, parseMobility, parseSections, parseSwim, suggestions, swimMeters, undoWeekChange,
  weekday, type ChangeAction, type DiffRow, type Mobility, type ReadyChange, type Turn, type WeekKind,
} from "@/lib/week-coach"

type Week = TrainingWeek | GymWeek
type Draft = ReadyChange & { state: "writing" | "ready" | "failed"; detail?: string; include: boolean }
type Outcome = { state: "applying" | "applied" | "undoing" | "undone" | "discarded"; id?: string; undo?: boolean }
type CoachMessage = {
  id: string; role: "coach"; text: string
  /** The athlete's message it answers, to ask again. */
  request: string
  phase: "thinking" | "answered" | "failed"
  /** Still streaming in: the changes are being written. */
  streaming: boolean
  changes: Draft[]
  notes: string[]
  /** The message was for the main coach chat, not about changing this week. */
  elsewhere?: boolean
  outcome?: Outcome
  error?: string
}
type Message = { id: string; role: "athlete"; text: string } | CoachMessage

/**
 * What the week shows of its coach panel while it's open: the days being read (`scanning`, while the coach works it
 * out), the changes suggested and not yet applied, on the days they'd change (`pending`), and the day of the change
 * being looked at (`focus`).
 */
export type WeekLink = { scanning: boolean; pending: Record<string, ChangeAction>; focus: string | null }

/** Each week's chat and anything half written in it, kept while the dashboard is open: closing the chat and opening it
 *  again carries on. */
const threads = new Map<string, Message[]>()
const drafts = new Map<string, string>()

const TONES = {
  swim: {
    name: "Swim week", accent: "text-accent", soft: "text-cyan-100", icon: Waves, tone: "wc-swim",
    focus: "focus-within:border-accent/50 focus-within:shadow-[0_0_0_4px_rgba(87,229,234,0.08)]",
    send: "from-cyan-200 via-cyan-300 to-sky-400", unit: "swim",
  },
  gym: {
    name: "Gym week", accent: "text-violet-300", soft: "text-violet-100", icon: Dumbbell, tone: "wc-gym",
    focus: "focus-within:border-violet-300/50 focus-within:shadow-[0_0_0_4px_rgba(167,139,250,0.1)]",
    send: "from-violet-200 via-violet-300 to-fuchsia-300", unit: "workout",
  },
} as const

export const ACTIONS = {
  edit: { icon: Pencil, word: "Change", bar: "bg-amber-300", chip: "bg-amber-300/15 text-amber-200", beam: "#fcd34d" },
  add: { icon: Plus, word: "New", bar: "bg-emerald-300", chip: "bg-emerald-400/15 text-emerald-200", beam: "#6ee7b7" },
  remove: { icon: Trash2, word: "Remove", bar: "bg-rose-400", chip: "bg-rose-400/15 text-rose-200", beam: "#fb7185" },
  move: { icon: ArrowRight, word: "Move", bar: "bg-sky-300", chip: "bg-sky-400/15 text-sky-200", beam: "#7dd3fc" },
  copy: { icon: Copy, word: "Copy", bar: "bg-violet-300", chip: "bg-violet-400/15 text-violet-200", beam: "#c4b5fd" },
  replan: { icon: RefreshCw, word: "Re-plan", bar: "bg-gradient-to-b from-cyan-300 via-sky-300 to-violet-300", chip: "bg-white/10 text-white", beam: "#a5f3fc" },
} as const

const THINKING = {
  swim: ["Reading your week", "Looking through your sets", "Working out the changes"],
  gym: ["Reading your week", "Checking your equipment", "Working out the changes"],
}

/** What a fresh plan of the week rewrites and keeps, in each week (it runs as generating the week does): from today, or
 *  all of it while it's still ahead (`whole`). */
const FRESH_PLAN_KEEPS = {
  swim: (whole: boolean) => `${whole ? "The whole week" : "Today to Sunday"} is written again from your coach's weekly order: new swims, mobility and day plans. ${whole ? "S" : "The days before today stay, and so do s"}wims you've ticked off, favorited or saved as a template, swims you've added, moved or copied, and mobility you've ticked off${whole ? " stay" : ""}. To keep any other swim, favorite it first.`,
  gym: (whole: boolean) => `Every planned workout you haven't ticked off is replaced${whole ? "" : ", from today to Sunday"}. Your own workouts, ticked-off ones and ones from your coach stay.`,
}

const firstName = (coach: string) => coach.replace(/^coach\s+/i, "").split(" ")[0] || coach
const dayLabel = (iso: string) => shortDate(iso, { weekday: "short", day: "numeric" })
/** "Oct 19 – 25", or "Oct 26 – Nov 1" across two months. */
function weekSpan(start: string) {
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)
  return `${shortDate(start)} – ${end.slice(5, 7) === start.slice(5, 7) ? shortDate(end, { day: "numeric" }) : shortDate(end)}`
}
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** What the chat so far tells the coach: what was said, and what came of each change it suggested. */
function turns(messages: Message[]): Turn[] {
  return messages.filter((item) => item.role === "athlete" || item.phase === "answered").slice(-12).map((item) => {
    if (item.role === "athlete") return { role: "athlete", text: item.text.slice(0, 3800) }
    if (!item.changes.length) return { role: "coach", text: item.text.slice(0, 3800) }
    const outcome = item.outcome?.state === "applied" ? "The athlete applied them." : item.outcome?.state === "undone" ? "The athlete applied them, then undid them."
      : item.outcome?.state === "discarded" ? "The athlete didn't apply them." : "Not applied yet."
    const listed = item.changes.map((change) => `${change.label} (${change.action} ${change.ref ?? change.kind}, ${weekday(change.to ?? change.date)})`).join("; ")
    return { role: "coach", text: `${item.text}\n(Changes suggested: ${listed}. ${outcome})`.slice(0, 3800) }
  })
}

// ---------------------------------------------------------------- the week ring: the coach, inside the seven days they plan
type DayState = "past" | "today" | "busy" | "free"
function dayStates(week: Week | null, today: string): DayState[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = week?.days[index]
    if (!day) return "free"
    if (day.date < today) return "past"
    if (day.date === today) return "today"
    return day.workouts.length ? "busy" : "free"
  })
}

/**
 * The coach inside a ring of seven arcs, Monday to Sunday: past days dim, today bright, days with training lit in the
 * week's colour. It's how the week's re-planner looks everywhere (unlike the coach chat's plain avatar). `live`: the
 * ring turns while the coach is working on the week.
 */
export function WeekRing({ coach, week, today, size, avatar, live = false }: {
  coach: string; week: Week | null; today: string; size: number; avatar: string; live?: boolean
}) {
  const radius = 16
  const around = 2 * Math.PI * radius
  const arc = around / 7
  return (
    <span className={cn("wc-ring relative grid shrink-0 place-items-center", live && "wc-ring-live")} style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full" aria-hidden>
        <g className="wc-ring-arcs">
          {dayStates(week, today).map((state, index) => (
            <circle key={index} cx="18" cy="18" r={radius} fill="none" strokeWidth="2.4" strokeLinecap="round" className={cn("wc-arc", `wc-arc-${state}`)}
              style={{ "--i": index } as CSSProperties} strokeDasharray={`${arc - 2.6} ${around - arc + 2.6}`}
              strokeDashoffset={-(index * arc) + around / 4} />
          ))}
        </g>
      </svg>
      <CoachAvatar name={coach} shape="circle" className={cn("relative", avatar)} title={`${coach} re-plans this week`} />
    </span>
  )
}

// ---------------------------------------------------------------- the launcher in the week's header
/**
 * Opens the week's re-planner from its header ("Re-plan with Robert", this week only). While that button is scrolled
 * out of view, a floating week ring does the same from the corner of the screen.
 */
export function WeekCoachButton({ kind, coach, week, today, open, disabled, onOpen }: {
  kind: WeekKind; coach: string; week: Week | null; today: string; open: boolean; disabled?: boolean; onOpen: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [away, setAway] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) => setAway(!entry.isIntersecting && entry.boundingClientRect.top < 0), { threshold: 0 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const name = firstName(coach)
  const tone = TONES[kind]
  return (
    <>
      <button ref={ref} type="button" onClick={onOpen} disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        title={`Change this ${tone.name.toLowerCase()} with ${coach}: you see every change before it's saved`}
        className={cn("wc-launch group relative inline-flex h-11 items-center gap-2.5 overflow-hidden rounded-full pl-1 pr-4 text-left text-white transition-transform duration-300 hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50",
          tone.tone, open && "wc-launch-open")}>
        <WeekRing coach={coach} week={week} today={today} size={38} avatar="h-[26px] w-[26px]" live={open} />
        <span className="flex flex-col leading-none">
          <span className={cn("text-[9px] font-bold uppercase tracking-[0.2em]", tone.accent)}>{open ? "Live · this week" : "This week"}</span>
          <span className="mt-1 whitespace-nowrap text-sm font-semibold">Re-plan with {name}</span>
        </span>
        <span aria-hidden className="wc-launch-sheen" />
      </button>
      {mounted && away && !open && !disabled && createPortal(
        <button type="button" onClick={onOpen} aria-label={`Re-plan this ${tone.name.toLowerCase()} with ${coach}`}
          className={cn("wc-dock group fixed bottom-5 right-5 z-[44] flex items-center rounded-full", tone.tone)}>
          <span className="wc-dock-label pointer-events-none mr-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-white">Re-plan this week</span>
          <span className="wc-dock-orb relative grid h-14 w-14 place-items-center rounded-full">
            <span aria-hidden className="wc-dock-ring absolute inset-0 rounded-full" />
            <WeekRing coach={coach} week={week} today={today} size={52} avatar="h-9 w-9" />
          </span>
        </button>, document.body)}
    </>
  )
}

// ---------------------------------------------------------------- the week, small, at the top of the panel
function MiniWeek({ kind, week, today, link, onPick }: {
  kind: WeekKind; week: Week | null; today: string; link: WeekLink; onPick: (date: string) => void
}) {
  const days = week?.days ?? []
  const loads = days.map((day) => kind === "swim"
    ? (day as TrainingWeek["days"][number]).workouts.reduce((sum, item) => sum + item.distance_meters, 0)
    : (day as GymWeek["days"][number]).workouts.reduce((sum, item) => sum + item.workout.estimated_duration_minutes, 0))
  const most = Math.max(1, ...loads)
  return (
    <div data-wc-mini className={cn("mt-3 grid grid-cols-7 gap-1", link.scanning && "wc-mini-scanning")} role="group" aria-label="The week being re-planned">
      {days.map((day, index) => {
        const action = link.pending[day.date]
        const Mark = action ? ACTIONS[action].icon : null
        const past = day.date < today
        return (
          <button key={day.date} type="button" disabled={past} onClick={() => onPick(day.date)} style={{ "--i": index } as CSSProperties}
            title={past ? `${day.day_name} is over` : `Ask about ${day.day_name}`} data-wc-mini-day={day.date}
            className={cn("wc-mini-day relative flex flex-col items-center rounded-xl border px-0.5 pb-1.5 pt-1 transition-all duration-300",
              past ? "cp-past border-white/[0.04] opacity-50" : "border-white/[0.08] bg-white/[0.03] hover:-translate-y-0.5 hover:border-white/25",
              day.date === today && "border-white/30", action && `wc-mini-pending wc-pending-${action}`, link.focus === day.date && "wc-mini-focus")}>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{day.day_name.slice(0, 2)}</span>
            <span className="text-xs font-bold tabular-nums leading-tight text-white">{Number(day.date.slice(8))}</span>
            <span className="mt-1 h-1 w-5 overflow-hidden rounded-full bg-white/10">
              <span className="wc-mini-fill block h-full rounded-full" style={{ width: `${(loads[index] / most) * 100}%` }} />
            </span>
            {Mark && <span aria-hidden className="wc-mini-mark absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full text-slate-950"><Mark className="h-2.5 w-2.5" strokeWidth={3} /></span>}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- light from the chat to the week
type Point = { x: number; y: number }
type Beam = { id: string; from: Point; to: Point; color: string; delay: number }

/** Beams of light from the chat to the week: on opening (the coach plugging into the week) and on applying (each change
 *  flying into its day). Drawn over the page for a moment, then gone. */
function Beams({ beams }: { beams: Beam[] }) {
  if (!beams.length) return null
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[47]">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {beams.map((beam) => {
          const bend = Math.max(60, Math.abs(beam.to.x - beam.from.x) * 0.45)
          const path = `M ${beam.from.x} ${beam.from.y} C ${beam.from.x - bend} ${beam.from.y}, ${beam.to.x + bend} ${beam.to.y}, ${beam.to.x} ${beam.to.y}`
          return (
            <g key={beam.id} style={{ "--d": `${beam.delay}ms`, "--c": beam.color } as CSSProperties}>
              <path d={path} pathLength={1} className="wc-beam-glow" />
              <path d={path} pathLength={1} className="wc-beam" />
            </g>
          )
        })}
      </svg>
      {beams.map((beam) => {
        const bend = Math.max(60, Math.abs(beam.to.x - beam.from.x) * 0.45)
        const path = `M ${beam.from.x} ${beam.from.y} C ${beam.from.x - bend} ${beam.from.y}, ${beam.to.x + bend} ${beam.to.y}, ${beam.to.x} ${beam.to.y}`
        return <span key={beam.id} className="wc-spark" style={{ offsetPath: `path("${path}")`, "--d": `${beam.delay}ms`, "--c": beam.color } as CSSProperties} />
      })}
      {beams.map((beam) => <span key={`${beam.id}:land`} className="wc-land" style={{ left: beam.to.x, top: beam.to.y, "--d": `${beam.delay}ms`, "--c": beam.color } as CSSProperties} />)}
    </div>,
    document.body,
  )
}

const centre = (box: DOMRect): Point => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
const visible = (box: DOMRect) => box.width > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth

// ---------------------------------------------------------------- the panel
/**
 * The week's re-planner: the athlete asks for changes to this week in their own words, the coach answers with the
 * changes it would make (each shown against the session as it is, and marked on the week), and nothing changes until
 * they're applied. It's not the coach chat: anything else goes there (`onOpenChat`). `guard` runs a save the way the week
 * runs its own (one at a time, after ticks still saving); `onApplied` and `onUndone` hand back the week as saved, with
 * the sessions to show changed; `onReplan` plans the rest of the week again as generating it does. `onLink` tells the
 * week what to show of the panel (see WeekLink).
 */
export function WeekCoach({ kind, coach, weekStart, week, today, busy, guard, onClose, onApplied, onUndone, onShow, onReplan, onOpenChat, onLink }: {
  kind: WeekKind
  coach: string
  weekStart: string
  week: Week | null
  today: string
  busy: boolean
  guard: <T>(work: () => Promise<T>) => Promise<T>
  onClose: () => void
  onApplied: (week: Week, highlight: string[]) => void
  onUndone: (week: Week, highlight: string[]) => void
  /** Show the changed sessions on the week (the chat steps aside on a phone). */
  onShow: (highlight: string[]) => void
  /** Plan the rest of the week again; resolves whether it was. */
  onReplan: () => Promise<boolean>
  /** Open the coach chat, with a message to send there. */
  onOpenChat?: (draft: string) => void
  onLink?: (link: WeekLink | null) => void
}) {
  const thread = `${kind}:${weekStart}`
  const [messages, setMessages] = useState<Message[]>(() => threads.get(thread) ?? [])
  const [input, setInput] = useState(() => drafts.get(thread) ?? "")
  const [leaving, setLeaving] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [highlights, setHighlights] = useState<Record<string, string[]>>({})
  const [focus, setFocus] = useState<string | null>(null)
  const [beams, setBeams] = useState<Beam[]>([])
  const panel = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const request = useRef<AbortController | null>(null)
  const tone = TONES[kind]
  const name = firstName(coach)
  const working = messages.some((item) => item.role === "coach" && (item.streaming || item.outcome?.state === "applying" || item.outcome?.state === "undoing"))
  const over = !!week && week.days[6].date < today

  useEffect(() => setMounted(true), [])
  // On a wide screen the dashboard makes room for the chat, so the whole week stays in view beside it.
  useEffect(() => {
    if (leaving) return
    document.body.classList.add("wc-docked")
    return () => document.body.classList.remove("wc-docked")
  }, [leaving])
  useEffect(() => { threads.set(thread, messages) }, [thread, messages])
  useEffect(() => { drafts.set(thread, input) }, [thread, input])
  useEffect(() => () => request.current?.abort(), [])
  // The field is ready to type in, except on a touch screen: there the keyboard would come up over the sheet before the
  // athlete has read it, so the field waits for a tap.
  useEffect(() => {
    if (mounted && !window.matchMedia("(pointer: coarse)").matches) window.setTimeout(() => field.current?.focus({ preventScroll: true }), 350)
  }, [mounted])

  // On a phone the keyboard comes up over the page without making it any smaller, so the sheet, which sits on the
  // bottom of the screen, would be under it. While the field is typed in, the sheet sits on the keyboard instead and
  // fits the screen that's left (`lift`: how far up the page the keyboard reaches; `room`: the height still seen).
  const [keyboard, setKeyboard] = useState<{ lift: number; room: number } | null>(null)
  useEffect(() => {
    const view = window.visualViewport
    const element = field.current
    if (!mounted || !view || !element) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Zoomed in, less of the page is seen too, but that isn't the keyboard.
        const up = document.activeElement === element && view.scale < 1.01 && window.innerHeight - view.height > 80
          && window.matchMedia("(max-width: 639px)").matches
        const lift = Math.max(0, Math.round(window.innerHeight - view.height - view.offsetTop))
        const room = Math.round(view.height)
        setKeyboard((current) => (!up ? null : current?.lift === lift && current.room === room ? current : { lift, room }))
      })
    }
    view.addEventListener("resize", measure)
    view.addEventListener("scroll", measure)
    element.addEventListener("focus", measure)
    element.addEventListener("blur", measure)
    return () => {
      cancelAnimationFrame(frame)
      view.removeEventListener("resize", measure)
      view.removeEventListener("scroll", measure)
      element.removeEventListener("focus", measure)
      element.removeEventListener("blur", measure)
    }
  }, [mounted])

  // What the week shows of the panel: the days being read, the changes waiting to be applied, the one looked at.
  const link = useMemo<WeekLink>(() => {
    const scanning = messages.some((item) => item.role === "coach" && (item.phase === "thinking" || item.outcome?.state === "applying"))
    const pending: Record<string, ChangeAction> = {}
    const latest = [...messages].reverse().find((item): item is CoachMessage => item.role === "coach" && item.changes.length > 0)
    if (latest && !latest.outcome) {
      for (const change of latest.changes) {
        if (!change.include || change.state === "failed") continue
        if (change.action === "replan") {
          for (const day of week?.days ?? []) if (day.date >= change.date) pending[day.date] = "replan"
          continue
        }
        pending[change.date] = change.action
        if (change.to) pending[change.to] = change.action
      }
    }
    return { scanning, pending, focus }
  }, [messages, focus, week])
  const linked = useRef(onLink)
  useEffect(() => { linked.current = onLink })
  useEffect(() => { linked.current?.(leaving ? null : link) }, [link, leaving])
  useEffect(() => () => linked.current?.(null), [])

  /** Light from `from` (elements of the panel) to days of the week, in the change's colour. */
  const shine = useCallback((pairs: { from: Element | null; date: string; action: ChangeAction }[]) => {
    if (reducedMotion() || window.innerWidth < 1024) return
    const panelBox = panel.current?.getBoundingClientRect()
    const made: Beam[] = []
    pairs.forEach(({ from, date, action }, index) => {
      const tile = document.querySelector(`[data-coach-week="${kind}"] [data-day="${date}"]`)
      if (!from || !tile) return
      const start = from.getBoundingClientRect()
      const end = tile.getBoundingClientRect()
      // A day behind the panel (on a screen too narrow to make room for it) gets no beam.
      if (!visible(start) || !visible(end) || (panelBox && end.right > panelBox.left - 8)) return
      made.push({ id: `${randomId()}`, from: { x: start.left, y: start.top + start.height / 2 }, to: centre(end), color: ACTIONS[action].beam, delay: index * 110 })
    })
    if (!made.length) return
    setBeams((current) => [...current, ...made])
    window.setTimeout(() => setBeams((current) => current.filter((beam) => !made.includes(beam))), 1500 + made.length * 110)
  }, [kind])

  // Opening: the coach plugs into the week, a beam from the panel's small week to the week itself.
  useEffect(() => {
    if (!mounted) return
    const timer = window.setTimeout(() => {
      const mini = panel.current?.querySelector("[data-wc-mini]")
      const days = (week?.days ?? []).filter((day) => day.date >= today).slice(0, 3)
      shine(days.map((day) => ({ from: mini?.querySelector(`[data-wc-mini-day="${day.date}"]`) ?? mini ?? null, date: day.date, action: "replan" as ChangeAction })))
    }, 520)
    return () => window.clearTimeout(timer)
    // Once, as the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  const close = useCallback(() => {
    setLeaving(true)
    window.setTimeout(onClose, 240)
  }, [onClose])
  useEffect(() => {
    // Esc closes the chat, unless it's closing something open over the page (a dialog, a menu) first.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=alertdialog], [role=dialog][data-state=open]:not(.wc-panel), [role=menu][data-state=open]")) close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close])

  // New messages and changes scroll into view, unless the athlete has scrolled up to read.
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const element = body.current
    if (element && pinned.current) element.scrollTo({ top: element.scrollHeight, behavior: messages.length ? "smooth" : "auto" })
  }, [messages])
  const track = () => {
    const element = body.current
    if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }
  // With the keyboard up less of the chat is seen: its latest part stays in view.
  useLayoutEffect(() => {
    const element = body.current
    if (keyboard && element && pinned.current) element.scrollTop = element.scrollHeight
  }, [keyboard])

  const update = (id: string, change: (message: CoachMessage) => CoachMessage) =>
    setMessages((list) => list.map((item) => (item.id === id && item.role === "coach" ? change(item) : item)))

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || working || over) return
    const coachId = randomId()
    const history = turns(messages)
    pinned.current = true
    setMessages((list) => [...list, { id: randomId(), role: "athlete", text: message },
      { id: coachId, role: "coach", text: "", request: message, phase: "thinking", streaming: true, changes: [], notes: [] }])
    setInput("")
    const controller = new AbortController()
    request.current = controller
    const unfinished = (detail: string) => (item: Draft): Draft => (item.state === "writing" ? { ...item, state: "failed", include: false, detail } : item)
    try {
      await askWeekCoach({ kind, week_start: weekStart, message, history }, (event) => {
        if (event.type === "plan") {
          update(coachId, (item) => ({ ...item, phase: "answered", text: event.message, notes: event.notes, elsewhere: event.elsewhere,
            changes: event.changes.map((change) => ({ ...change, state: change.writing ? "writing" : "ready", include: true })) }))
        } else if (event.type === "change") {
          update(coachId, (item) => ({ ...item, changes: item.changes.map((change) => change.id === event.id
            ? { ...change, state: "ready", workout: event.workout, doc: event.doc, mobility: event.mobility } : change) }))
        } else if (event.type === "failed") {
          update(coachId, (item) => ({ ...item, changes: item.changes.map((change) => change.id === event.id
            ? { ...change, state: "failed", include: false, detail: event.detail } : change) }))
        } else if (event.type === "error") {
          update(coachId, (item) => ({ ...item, phase: item.phase === "answered" ? "answered" : "failed", error: event.detail }))
        }
      }, controller.signal)
      update(coachId, (item) => ({ ...item, streaming: false, changes: item.changes.map(unfinished("This change didn't finish writing.")),
        ...(item.phase === "thinking" && { phase: "failed", error: item.error ?? "Your coach didn't answer. Please try again." }) }))
    } catch (failure) {
      if (controller.signal.aborted) return
      update(coachId, (item) => ({ ...item, streaming: false, phase: item.phase === "answered" ? "answered" : "failed",
        error: failure instanceof Error ? failure.message : "Your coach couldn't answer just now. Please try again.",
        changes: item.changes.map(unfinished("The connection dropped before this was written.")) }))
    } finally {
      if (request.current === controller) request.current = null
    }
  }

  /** Each change's card to the days it changes, as light. */
  const shineChanges = (changes: Draft[]) => {
    const pairs = changes.flatMap((change) => {
      const card = panel.current?.querySelector(`[data-change-id="${change.id}"]`) ?? null
      const dates = change.action === "replan" ? (week?.days ?? []).map((day) => day.date).filter((date) => date >= change.date)
        : [change.date, ...(change.to ? [change.to] : [])]
      return dates.map((date) => ({ from: card, date, action: change.action }))
    })
    // After the week has drawn what's saved.
    window.setTimeout(() => shine(pairs), 120)
  }

  const apply = async (message: CoachMessage) => {
    const chosen = message.changes.filter((change) => change.include && change.state === "ready")
    if (!chosen.length || busy || working) return
    update(message.id, (item) => ({ ...item, error: undefined, outcome: { state: "applying" } }))
    if (chosen.some((change) => change.action === "replan")) {
      // A fresh plan runs as generating the week does (its own progress over the page); it can't be undone.
      const replanned = await onReplan()
      update(message.id, (item) => ({ ...item, outcome: replanned ? { state: "applied", undo: false } : undefined,
        error: replanned ? undefined : "The week wasn't re-planned. The reason is shown above the week; you can try again." }))
      if (replanned) shineChanges(chosen)
      return
    }
    const changeId = randomId()
    try {
      const result = await guard(() => applyWeekChanges(kind, weekStart, changeId, chosen))
      update(message.id, (item) => ({ ...item, outcome: { state: "applied", id: changeId, undo: result.change.undo } }))
      setHighlights((current) => ({ ...current, [message.id]: result.change.highlight }))
      onApplied(result.week, result.change.highlight)
      shineChanges(chosen)
    } catch (failure) {
      update(message.id, (item) => ({ ...item, outcome: undefined, error: failure instanceof Error ? failure.message : "Your changes weren't saved. Please try again." }))
    }
  }

  const undo = async (message: CoachMessage) => {
    const id = message.outcome?.id
    if (!id || busy || working) return
    update(message.id, (item) => ({ ...item, error: undefined, outcome: { ...item.outcome!, state: "undoing" } }))
    try {
      const result = await guard(() => undoWeekChange(kind, weekStart, id))
      update(message.id, (item) => ({ ...item, outcome: { state: "undone", id } }))
      onUndone(result.week, result.highlight)
    } catch (failure) {
      update(message.id, (item) => ({ ...item, outcome: { ...item.outcome!, state: "applied" }, error: failure instanceof Error ? failure.message : "That couldn't be undone. Please try again." }))
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void send(input)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(input)
    }
  }
  // The field grows with what's written, up to a few lines.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`
  }, [input])
  /** A day picked on the small week starts the message with it. */
  const pick = (date: string) => {
    const day = `${weekday(date)}: `
    setInput((current) => (current.trim() ? current : day))
    window.setTimeout(() => {
      const element = field.current
      if (!element) return
      element.focus()
      element.setSelectionRange(element.value.length, element.value.length)
    }, 0)
  }

  const ideas = useMemo(() => suggestions(kind, week, today), [kind, week, today])
  const restart = () => {
    if (working) return
    request.current?.abort()
    setMessages([])
  }

  if (!mounted) return null
  return createPortal(
    <div className={cn("wc-root", leaving && "wc-leaving")}>
      <div aria-hidden className="wc-backdrop fixed inset-0 z-[45] sm:hidden" onClick={close} />
      <aside ref={panel} role="dialog" aria-modal="false" aria-labelledby="wc-title"
        className={cn("wc-panel fixed z-[46] flex flex-col overflow-hidden border border-white/10 bg-[#091017]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-2xl",
          "max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[88dvh] max-sm:rounded-t-[28px] sm:bottom-3 sm:right-3 sm:top-3 sm:w-[440px] sm:rounded-[28px]", tone.tone)}
        style={keyboard ? { bottom: keyboard.lift, height: `min(88dvh, ${keyboard.room - 12}px)` } : undefined}>
        <span aria-hidden className="wc-aura" />
        <header className="relative border-b border-white/[0.07] px-4 pb-3 pt-4 sm:px-5">
          <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-white/15 sm:hidden" />
          <div className="flex items-center gap-3">
            <WeekRing coach={coach} week={week} today={today} size={48} avatar="h-[34px] w-[34px]" live={working} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-[10px] font-bold uppercase tracking-[0.2em]", tone.accent)}>Re-plan with {name}</p>
              <p id="wc-title" className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-white"><tone.icon className={cn("h-4 w-4 shrink-0", tone.accent)} />{tone.name} · {weekSpan(weekStart)}</p>
            </div>
            {messages.length > 0 && <button type="button" onClick={restart} disabled={working} title="Start again about this week" aria-label="Start again"
              className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"><RotateCcw className="h-4 w-4" /></button>}
            <button type="button" onClick={close} aria-label="Close the re-planner"
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <MiniWeek kind={kind} week={week} today={today} link={link} onPick={pick} />
          {working && <span aria-hidden className="wc-progress absolute inset-x-0 -bottom-px h-px" />}
        </header>

        <div ref={body} onScroll={track} className="wc-scroll relative flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5" aria-live="polite">
          {!messages.length ? (
            <Welcome kind={kind} coach={coach} week={week} today={today} weekStart={weekStart} over={over} ideas={ideas}
              onSend={(text) => void send(text)} onOpenChat={onOpenChat ? () => onOpenChat("") : undefined} />
          ) : (
            <ol className="space-y-5">
              {messages.map((message) => message.role === "athlete" ? (
                <li key={message.id} className="wc-rise flex justify-end">
                  <p className="wc-bubble max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md px-4 py-2.5 text-sm leading-6 text-white">{message.text}</p>
                </li>
              ) : (
                <li key={message.id} className="wc-rise flex gap-2.5">
                  <CoachAvatar name={coach} shape="circle" className="mt-0.5 h-7 w-7 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <CoachReply message={message} kind={kind} name={name} busy={busy || working} today={today} week={week}
                      onFocus={setFocus}
                      onToggle={(id) => update(message.id, (item) => ({ ...item, changes: item.changes.map((change) => change.id === id ? { ...change, include: !change.include } : change) }))}
                      onApply={() => void apply(message)} onUndo={() => void undo(message)} onRetry={() => void send(message.request)}
                      onDiscard={() => update(message.id, (item) => ({ ...item, outcome: { state: "discarded" } }))}
                      onOpenChat={onOpenChat ? () => onOpenChat(message.request) : undefined}
                      onShow={() => {
                        onShow(highlights[message.id] ?? [])
                        if (window.matchMedia("(max-width: 639px)").matches) close()
                      }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <form onSubmit={submit} className={cn("relative border-t border-white/[0.07] px-3 pt-3 sm:px-4", keyboard ? "pb-3" : "pb-[max(0.75rem,env(safe-area-inset-bottom))]")}>
          <div className={cn("flex items-end gap-2 rounded-[22px] border border-white/10 bg-white/[0.04] p-1.5 pl-4 transition-all duration-300", tone.focus)}>
            <textarea ref={field} rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} maxLength={2000} disabled={over}
              aria-label={`Tell ${coach} what to change in this ${tone.name.toLowerCase()}`} placeholder={over ? "This week is over" : `What should change this week, ${name}?`}
              className="max-h-[132px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm leading-6 text-white outline-none placeholder:text-slate-500 disabled:opacity-50" />
            <button type="submit" disabled={!input.trim() || working || over} aria-label="Send"
              className={cn("wc-send grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-slate-950 transition-all duration-300 disabled:opacity-35", tone.send)}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 px-2 text-[11px] leading-4 text-slate-500">Only this week changes, and only when you apply it. AI can make mistakes: check a session before you train it.</p>
        </form>
      </aside>
      <Beams beams={beams} />
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- before the first message: what this is, and what it isn't
function Welcome({ kind, coach, week, today, weekStart, over, ideas, onSend, onOpenChat }: {
  kind: WeekKind; coach: string; week: Week | null; today: string; weekStart: string; over: boolean; ideas: string[]
  onSend: (text: string) => void; onOpenChat?: () => void
}) {
  const tone = TONES[kind]
  const name = firstName(coach)
  const states = dayStates(week, today)
  return (
    <div className="flex min-h-full flex-col items-center pb-2 text-center">
      {/* The coach in the middle of the week: seven days come round them. */}
      <div className="wc-orbit relative mt-1 h-40 w-40">
        <span aria-hidden className="wc-orbit-track absolute inset-3 rounded-full" />
        <span aria-hidden className="wc-orbit-glow absolute inset-10 rounded-full" />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><CoachAvatar name={coach} shape="circle" className="h-16 w-16" /></span>
        {(week?.days ?? []).map((day, index) => {
          const angle = -90 + index * (360 / 7)
          return (
            <span key={day.date} className={cn("wc-orbit-day absolute left-1/2 top-1/2 grid h-8 w-8 place-items-center rounded-full border text-[10px] font-bold", `wc-orbit-${states[index]}`)}
              style={{ "--i": index, "--x": `${Math.cos((angle * Math.PI) / 180) * 64}px`, "--y": `${Math.sin((angle * Math.PI) / 180) * 64}px` } as CSSProperties}>
              {day.day_name.slice(0, 2)}
            </span>
          )
        })}
      </div>
      <h3 className="wc-rise mt-2 text-xl font-semibold tracking-tight text-white" style={{ "--i": 4 } as CSSProperties}>
        {over ? "This week is over" : `Re-plan this week with ${name}`}
      </h3>
      <p className="wc-rise mt-1.5 max-w-xs text-sm leading-6 text-slate-400" style={{ "--i": 5 } as CSSProperties}>
        {over ? "Its sessions stay as they were. Pick this week or a later one to change it."
          : "Say what should change: shorter, harder, another day, more kick, a swap. Every change shows on your week before anything is saved."}
      </p>
      {!over && <>
        {/* Two places to talk to the coach: this one changes this week; the coach chat is for everything else. */}
        <div className="mt-5 grid w-full gap-2 text-left">
          <div className="wc-mode wc-mode-here wc-rise relative overflow-hidden rounded-2xl p-3.5" style={{ "--i": 6 } as CSSProperties}>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10"><CalendarRange className={cn("h-4 w-4", tone.accent)} /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">You&apos;re here</p>
                <p className="text-sm font-semibold text-white">Re-plan this {tone.name.toLowerCase()}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-400">Changes {weekSpan(weekStart)} only. You see and apply every change.</p>
              </div>
            </div>
          </div>
          {onOpenChat && (
            <button type="button" onClick={onOpenChat} className="wc-mode wc-rise group relative flex items-start gap-3 overflow-hidden rounded-2xl text-left border border-white/[0.08] bg-white/[0.025] p-3.5 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.05]"
              style={{ "--i": 7 } as CSSProperties}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06]"><MessageCircle className="h-4 w-4 text-slate-300" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Anything else</span>
                <span className="block text-sm font-semibold text-white">Coach chat</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-400">Technique, racing, nutrition and questions, and plans for any day.</span>
              </span>
              <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
            </button>
          )}
        </div>
        <p className="wc-rise mt-5 self-start text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500" style={{ "--i": 8 } as CSSProperties}>Try</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          {ideas.map((idea, index) => (
            <button key={idea} type="button" onClick={() => onSend(idea)} style={{ "--i": index + 9 } as CSSProperties}
              className="wc-idea group flex w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left text-sm text-slate-200 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]">
              <Sparkles className={cn("h-4 w-4 shrink-0 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110", tone.accent)} />
              <span className="min-w-0 flex-1">{idea}</span>
              <ArrowRight className="h-4 w-4 shrink-0 -translate-x-1 text-slate-500 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </button>
          ))}
          <button type="button" onClick={() => onSend(weekStart > today ? FRESH_PLAN[kind].replace("the rest of this", "this whole").replace("the rest of my", "my whole") : FRESH_PLAN[kind])}
            style={{ "--i": ideas.length + 9 } as CSSProperties}
            className="wc-idea wc-fresh group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-4 py-3 text-left text-sm text-white transition-all hover:-translate-y-0.5">
            <RefreshCw className={cn("h-4 w-4 shrink-0 transition-transform duration-500 group-hover:rotate-180", tone.accent)} />
            <span className="min-w-0 flex-1"><span className="block font-semibold">A fresh plan for {weekStart > today ? "the whole" : "the rest of the"} week</span>
              <span className="block text-xs text-slate-400">What you&apos;ve ticked off or added stays</span></span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </>}
    </div>
  )
}

// ---------------------------------------------------------------- the coach's answer and its changes
function CoachReply({ message, kind, name, busy, today, week, onFocus, onToggle, onApply, onUndo, onRetry, onDiscard, onShow, onOpenChat }: {
  message: CoachMessage; kind: WeekKind; name: string; busy: boolean; today: string; week: Week | null
  onFocus: (date: string | null) => void; onToggle: (id: string) => void; onApply: () => void; onUndo: () => void; onRetry: () => void
  onDiscard: () => void; onShow: () => void; onOpenChat?: () => void
}) {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    if (message.phase !== "thinking") return
    const timer = window.setInterval(() => setStage((value) => value + 1), 1500)
    return () => window.clearInterval(timer)
  }, [message.phase])

  if (message.phase === "thinking") {
    const steps = THINKING[kind]
    return (
      <div className="wc-thinking inline-flex items-center gap-3 rounded-[18px] rounded-tl-md border border-white/[0.08] bg-white/[0.04] px-4 py-3">
        <span className="flex gap-1" aria-hidden><i className="wc-dot" /><i className="wc-dot" /><i className="wc-dot" /></span>
        <span key={stage} className="wc-step text-sm text-slate-300">{steps[Math.min(stage, steps.length - 1)]}…</span>
      </div>
    )
  }
  if (message.phase === "failed") {
    return (
      <div className="wc-rise rounded-[18px] rounded-tl-md border border-rose-300/20 bg-rose-500/[0.07] p-4 text-sm text-rose-100">
        <p>{message.error ?? `${name} couldn't answer just now.`}</p>
        <button type="button" onClick={onRetry} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rose-200/25 px-3 py-1.5 text-xs font-semibold text-rose-50 transition-colors hover:bg-rose-400/15 disabled:opacity-40">
          <RotateCcw className="h-3.5 w-3.5" />Ask again
        </button>
      </div>
    )
  }
  const writing = message.changes.some((change) => change.state === "writing")
  const chosen = message.changes.filter((change) => change.include && change.state === "ready")
  const outcome = message.outcome?.state
  const settled = outcome === "applied" || outcome === "undoing" || outcome === "undone" || outcome === "discarded"
  const fresh = message.changes.some((change) => change.action === "replan")
  return (
    <>
      <p className="wc-reveal whitespace-pre-wrap rounded-[18px] rounded-tl-md border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-slate-100">{message.text}</p>
      {message.elsewhere && onOpenChat && (
        <button type="button" onClick={onOpenChat} className="wc-rise group inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] py-2 pl-3 pr-3.5 text-xs font-semibold text-white transition-all hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.08]">
          <MessageCircle className="h-3.5 w-3.5 text-slate-300" />Ask this in the coach chat<ArrowUpRight className="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
      )}
      {message.changes.length > 0 && (
        <div className={cn("space-y-2 transition-opacity duration-500", outcome === "discarded" && "opacity-55")}>
          {message.changes.map((change, index) => change.action === "replan"
            ? <FreshPlanCard key={change.id} change={change} kind={kind} week={week} onFocus={onFocus} />
            : <ChangeCard key={change.id} change={change} index={index} today={today} selectable={message.changes.length > 1 && !settled && outcome !== "applying"}
              onToggle={() => onToggle(change.id)} onFocus={onFocus} />)}
        </div>
      )}
      {message.notes.map((note) => (
        <p key={note} className="wc-rise flex gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100/90"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />{note}</p>
      ))}
      {message.error && <p className="wc-rise rounded-2xl border border-rose-300/20 bg-rose-500/[0.07] p-3 text-xs leading-5 text-rose-100">{message.error}
        {message.changes.length > 0 && !settled && <button type="button" onClick={onRetry} disabled={busy} className="ml-1.5 font-semibold underline underline-offset-2 disabled:opacity-40">Ask again</button>}
      </p>}
      {message.changes.length > 0 && !settled && (
        message.changes.every((change) => change.state === "failed")
          ? <button type="button" onClick={onRetry} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />Ask again</button>
          : <div className="wc-rise flex flex-wrap items-center gap-2" style={{ "--i": message.changes.length } as CSSProperties}>
            <button type="button" onClick={onApply} disabled={busy || writing || !chosen.length || outcome === "applying"}
              className={cn("wc-apply relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-full px-5 text-sm font-semibold text-slate-950 transition-all duration-300 disabled:opacity-60", kind === "swim" ? "wc-apply-swim" : "wc-apply-gym")}>
              {outcome === "applying" ? <><Loader2 className="h-4 w-4 animate-spin" />{fresh ? "Re-planning your week…" : "Saving to your week…"}</>
                : writing ? <><Loader2 className="h-4 w-4 animate-spin" />Writing the changes…</>
                  : fresh ? <><RefreshCw className="h-4 w-4" />Re-plan the week</>
                    : <><Check className="h-4 w-4" />{chosen.length === 1 ? "Apply change" : `Apply ${chosen.length === message.changes.length ? "all " : ""}${chosen.length} changes`}</>}
              {!writing && outcome !== "applying" && chosen.length > 0 && <span aria-hidden className="wc-apply-sheen" />}
            </button>
            {outcome !== "applying" && <button type="button" onClick={onDiscard} className="h-10 rounded-full px-3.5 text-sm text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">Not now</button>}
          </div>
      )}
      {(outcome === "applied" || outcome === "undoing") && (
        <div className="wc-applied flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.08] py-2 pl-3 pr-2">
          <span className="wc-tick grid h-6 w-6 place-items-center rounded-full bg-emerald-400 text-slate-950"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
          <span className="flex-1 whitespace-nowrap text-sm font-medium text-emerald-50">{fresh ? "Fresh week ready" : "In your week"}</span>
          {!fresh && <button type="button" onClick={onShow} className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-300/15"><MapPin className="h-3.5 w-3.5" />Show me</button>}
          {message.outcome?.undo && <button type="button" onClick={onUndo} disabled={busy || outcome === "undoing"}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-white/10 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50">
            {outcome === "undoing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}Undo
          </button>}
        </div>
      )}
      {outcome === "undone" && <p className="wc-rise flex items-center gap-2 text-xs text-slate-400"><Undo2 className="h-3.5 w-3.5" />Undone: your week is as it was.</p>}
      {outcome === "discarded" && <p className="wc-rise flex items-center gap-2 text-xs text-slate-500"><X className="h-3.5 w-3.5" />Not applied.</p>}
    </>
  )
}

/** A fresh plan for the rest of the week: what's written again, and what stays. */
function FreshPlanCard({ change, kind, week, onFocus }: { change: Draft; kind: WeekKind; week: Week | null; onFocus: (date: string | null) => void }) {
  const days = week?.days ?? []
  return (
    <div data-change-id={change.id} onMouseEnter={() => onFocus(change.date)} onMouseLeave={() => onFocus(null)}
      className="wc-card wc-fresh relative overflow-hidden rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="wc-fresh-icon grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-950"><RefreshCw className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Re-plan · {dayLabel(change.date)} to Sun</p>
          <p className="mt-0.5 text-sm font-semibold text-white">{change.label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{FRESH_PLAN_KEEPS[kind](change.date === days[0]?.date)}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1" aria-hidden>
        {days.map((day, index) => (
          <span key={day.date} style={{ "--i": index } as CSSProperties}
            className={cn("rounded-lg py-1 text-center text-[9px] font-bold uppercase tracking-wider", day.date >= change.date ? "wc-fresh-day text-white" : "bg-white/[0.03] text-slate-600")}>
            {day.day_name.slice(0, 2)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The figures of a session before and after a change: metres or minutes, and its parts. */
function figures(change: Draft) {
  if (change.kind === "swim") {
    const before = parseSwim(change.before)
    const after = change.action === "edit" || change.action === "add" ? parseSwim(change.workout) : before
    return { before, after, from: before && swimMeters(before), to: after && swimMeters(after), unit: "m",
      minutesFrom: before?.estimated_duration_minutes, minutesTo: after?.estimated_duration_minutes, title: after?.title ?? before?.title }
  }
  if (change.kind === "mobility") {
    const before = parseMobility(change.before)
    const after = change.action === "edit" || change.action === "add" ? parseMobility(change.mobility) : before
    const minutes = (items: Mobility[] | null) => items?.reduce((sum, item) => sum + item.duration_minutes, 0)
    return { before, after, from: before?.length, to: after?.length, unit: "exercises", minutesFrom: minutes(before), minutesTo: minutes(after), title: undefined }
  }
  const before = parseGym(change.before)
  const after = change.action === "edit" || change.action === "add" ? parseGym(change.workout) : before
  const count = (workout: GymWorkoutData | null) => workout && (workout.sections?.length ? workout.sections.reduce((sum, section) => sum + section.exercises.length, 0) : workout.exercises.length)
  return { before, after, from: count(before), to: count(after), unit: "exercises", minutesFrom: before?.estimated_duration_minutes, minutesTo: after?.estimated_duration_minutes, title: after?.title ?? before?.title }
}

function Delta({ from, to, unit }: { from?: number | null; to?: number | null; unit: string }) {
  if (from == null && to == null) return null
  const format = (value: number) => (unit === "m" ? value.toLocaleString() : String(value))
  const label = unit === "min" ? "min" : unit
  if (from == null || to == null || from === to) {
    return <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-300">{format((to ?? from)!)} {label}</span>
  }
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", to < from ? "bg-sky-400/12 text-sky-200" : "bg-emerald-400/12 text-emerald-200")}>
      <span className="text-slate-400 line-through decoration-slate-500/70">{format(from)}</span><ArrowRight className="h-3 w-3" />{format(to)} {label}
    </span>
  )
}

function ChangeCard({ change, index, today, selectable, onToggle, onFocus }: {
  change: Draft; index: number; today: string; selectable: boolean; onToggle: () => void
  /** Show the day it changes on the week while it's looked at. */
  onFocus: (date: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const action = ACTIONS[change.action]
  const facts = figures(change)
  const ready = change.state === "ready"
  const day = change.to ? <>{dayLabel(change.date)}<ArrowRight className="mx-0.5 inline h-3 w-3" />{dayLabel(change.to)}</> : dayLabel(change.date)
  const KindIcon = change.kind === "swim" ? Waves : change.kind === "mobility" ? Heart : Dumbbell
  const detailed = ready && (change.action === "edit" || change.action === "add")
  return (
    <div data-change-id={change.id} onMouseEnter={() => onFocus(change.to ?? change.date)} onMouseLeave={() => onFocus(null)}
      className={cn("wc-card relative overflow-hidden rounded-2xl border bg-white/[0.03] transition-all duration-300",
      change.state === "failed" ? "border-rose-300/20" : change.include ? "border-white/[0.09]" : "border-white/[0.05] opacity-55",
      change.state === "writing" && "wc-writing")} style={{ "--i": index } as CSSProperties}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", change.state === "failed" ? "bg-rose-400/60" : action.bar)} />
      <div className="flex items-start gap-3 py-3 pl-4 pr-3">
        <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl", action.chip)}><action.icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
            <span>{action.word}</span><span aria-hidden>·</span><span className="inline-flex items-center normal-case tracking-normal text-slate-400"><KindIcon className="mr-1 h-3 w-3" />{day}</span>
            {change.date === today && <span className="rounded-full bg-white/10 px-1.5 py-px normal-case tracking-normal text-slate-300">today</span>}
          </p>
          <p className="mt-1 text-sm font-semibold leading-5 text-white">{change.label}</p>
          {facts.title && facts.title !== change.label && <p className="truncate text-xs text-slate-400">{facts.title}</p>}
          {change.state === "writing" && <p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><span className="wc-shimmer h-1.5 w-24 rounded-full" />{change.action === "add" ? "Writing it" : "Rewriting it"}…</p>}
          {change.state === "failed" && <p className="mt-1.5 text-xs leading-5 text-rose-200/90">{change.detail ?? "This change couldn't be written."} It's left out.</p>}
          {ready && change.action !== "remove" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Delta from={change.action === "add" ? null : facts.from} to={facts.to} unit={facts.unit} />
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-slate-500" /><Delta from={change.action === "add" ? null : facts.minutesFrom} to={facts.minutesTo} unit="min" /></span>
            </div>
          )}
          {ready && change.action === "remove" && <p className="mt-1.5 text-xs text-slate-400">Comes off {weekday(change.date)}{facts.from ? ` (${facts.from.toLocaleString()} ${facts.unit === "m" ? "m" : facts.unit})` : ""}.</p>}
          {ready && change.action === "move" && <p className="mt-1.5 text-xs text-slate-400">The same session, on {weekday(change.to ?? change.date)} instead.</p>}
          {ready && change.action === "copy" && <p className="mt-1.5 text-xs text-slate-400">An exact copy on {weekday(change.to ?? change.date)}; {weekday(change.date)} keeps its session.</p>}
          {detailed && (
            <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-300 transition-colors hover:text-white">
              {open ? "Hide the details" : change.action === "add" ? "See the session" : "See what changes"}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", open && "rotate-180")} />
            </button>
          )}
        </div>
        {selectable && change.state !== "failed" && (
          <button type="button" role="checkbox" aria-checked={change.include} aria-label={`Include “${change.label}”`} onClick={onToggle} disabled={!ready}
            className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border transition-all duration-300 disabled:opacity-40",
              change.include ? "border-emerald-300/60 bg-emerald-400 text-slate-950" : "border-white/20 bg-transparent text-transparent hover:border-white/40")}>
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </button>
        )}
      </div>
      {detailed && open && <div className="wc-details border-t border-white/[0.06] px-3 py-2.5"><ChangeDetails change={change} /></div>}
    </div>
  )
}

const ROW_STYLE = {
  same: "text-slate-400",
  added: "bg-emerald-400/[0.07] text-emerald-50",
  removed: "bg-rose-500/[0.07] text-rose-100/80",
  changed: "bg-amber-300/[0.07] text-amber-50",
} as const
const ROW_MARK = { same: "", added: "+", removed: "−", changed: "~" } as const
const MARK_STYLE = { same: "", added: "bg-emerald-400 text-slate-950", removed: "bg-rose-400 text-slate-950", changed: "bg-amber-300 text-slate-950" } as const

function DiffLines<T>({ rows, title, detail }: { rows: DiffRow<T>[]; title: (item: T) => string; detail: (item: T) => string }) {
  // Runs of parts kept as they were fold into one line.
  const blocks: ({ kept: number } | DiffRow<T>)[] = []
  for (const row of rows) {
    const last = blocks[blocks.length - 1]
    if (row.state === "same") {
      if (last && "kept" in last) last.kept++
      else blocks.push({ kept: 1 })
    } else blocks.push(row)
  }
  return (
    <ul className="space-y-1">
      {blocks.map((block, index) => "kept" in block ? (
        <li key={index} className="flex items-center gap-2 px-2 py-1 text-[11px] text-slate-500"><span className="h-px flex-1 bg-white/[0.07]" />{block.kept} as {block.kept === 1 ? "it was" : "they were"}<span className="h-px flex-1 bg-white/[0.07]" /></li>
      ) : (
        <li key={index} className={cn("wc-row flex gap-2.5 rounded-xl px-2.5 py-2 text-xs leading-5", ROW_STYLE[block.state])} style={{ "--i": index } as CSSProperties}>
          <span aria-hidden className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[11px] font-bold leading-none", MARK_STYLE[block.state])}>{ROW_MARK[block.state]}</span>
          <span className="sr-only">{block.state}: </span>
          <span className="min-w-0 flex-1">
            <span className={cn("block font-semibold", block.state === "removed" && "line-through decoration-rose-300/60")}>{title(block.item)}</span>
            <span className={cn("block text-slate-400", block.state === "removed" && "line-through decoration-rose-300/40")}>{detail(block.item)}</span>
            {block.was && detail(block.was) !== detail(block.item) && <span className="block text-slate-500 line-through decoration-slate-500/60">{detail(block.was)}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

const setTitle = (item: SwimWorkout["sets"][number]) => item.name
const setDetail = (item: SwimWorkout["sets"][number]) =>
  `${item.rounds > 1 ? `${item.rounds} rounds of ` : ""}${item.repetitions > 1 ? `${item.repetitions} × ` : ""}${item.distance_meters} m ${item.stroke} · ${item.interval} · ${item.training_zone}${item.target_time ? ` · ${item.target_time}` : ""}`
const exerciseDetail = (item: GymWorkoutData["exercises"][number]) => `${item.sets} × ${item.repetitions} · ${item.load} · ${item.rest_seconds}s rest${item.tempo ? ` · ${item.tempo}` : ""}`
const sectionDetail = (section: BuilderSection) => section.exercises.length
  ? section.exercises.map((row) => `${row.name} ${row.sets} × ${row.reps || "—"}`).join(" · ")
  : section.notes.split("\n").filter(Boolean).join(" · ")

function ChangeDetails({ change }: { change: Draft }) {
  if (change.kind === "swim") {
    const after = parseSwim(change.workout)
    if (!after) return null
    const before = change.action === "edit" ? parseSwim(change.before) : null
    return <DiffLines rows={diffList(before?.sets ?? [], after.sets, (item) => sameName(item.name))} title={setTitle} detail={setDetail} />
  }
  if (change.kind === "mobility") {
    const after = parseMobility(change.mobility)
    if (!after) return null
    const before = change.action === "edit" ? parseMobility(change.before) : null
    return <DiffLines rows={diffList(before ?? [], after, (item) => sameName(item.exercise))} title={(item) => item.exercise} detail={(item) => `${item.category} · ${item.duration_minutes} min`} />
  }
  const after = parseGym(change.workout)
  if (!after) return null
  const before = change.action === "edit" ? parseGym(change.before) : null
  if (after.sections?.length) {
    const sections = parseSections(after.sections) ?? []
    return <DiffLines rows={diffList(parseSections(before?.sections) ?? [], sections, (section) => sameName(section.title))} title={(section) => section.title} detail={sectionDetail} />
  }
  const lists: ReactNode[] = []
  if (before && JSON.stringify(before.warm_up) !== JSON.stringify(after.warm_up)) {
    lists.push(<DiffLines key="warm" rows={[{ state: "changed", item: after.warm_up, was: before.warm_up }]} title={() => "Warm-up"} detail={(items) => items.join(" · ")} />)
  }
  lists.push(<DiffLines key="main" rows={diffList(before?.exercises ?? [], after.exercises, (item) => sameName(item.exercise))} title={(item) => item.exercise} detail={exerciseDetail} />)
  if (before && JSON.stringify(before.cool_down) !== JSON.stringify(after.cool_down)) {
    lists.push(<DiffLines key="cool" rows={[{ state: "changed", item: after.cool_down, was: before.cool_down }]} title={() => "Cool-down"} detail={(items) => items.join(" · ")} />)
  }
  return <div className="space-y-1">{lists}</div>
}

