"use client"

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle, ArrowRight, CalendarCheck2, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Coins, Copy, Dumbbell,
  Flag, Info, Loader2, RotateCcw, Sparkles, Waves, X,
} from "lucide-react"
import { CoachAvatar } from "@/components/coach-avatar"
import { DoseChip, GymWorkoutDetails } from "@/components/gym-workout"
import { SwimWorkoutDetails } from "@/components/swim-workout"
import { ZoneChip, shortDate, todayISO } from "@/components/training-ui"
import { compactMeters } from "@/components/calendar-day"
import { mondayISO, shiftWeek } from "@/lib/training"
import { TokensNeeded, openTokenStore, tokensChanged } from "@/lib/token-events"
import { tokenCount } from "@/lib/tokens"
import {
  addCoachPlan, alreadyIn, asGymItem, dayProblem, hintedDate, loadWeek, placeSessions, placedWeekdays, startingWeek, swimMeters,
  type AddedSession, type CoachPlan, type DayLoad, type PlanKind, type PlanSession, type TrainingTarget, type WeekLoad,
} from "@/lib/coach-plan"
import { cn } from "@/lib/utils"

/** How far ahead a plan can go (weeks after this one). */
const WEEKS_AHEAD = 12
const BURST = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

const KINDS = {
  swim: {
    label: "Swim", week: "Swim week", icon: Waves, eyebrow: "text-cyan-200", badge: "bg-accent/15 text-cyan-100 ring-1 ring-accent/30",
    stripe: "from-cyan-300 via-sky-400 to-cyan-500", token: "bg-gradient-to-br from-cyan-200 to-sky-400 text-slate-950",
    picked: "border-cyan-200/70 bg-[linear-gradient(180deg,rgba(103,232,249,0.32),rgba(14,165,233,0.16))] text-white shadow-[0_10px_26px_-10px_rgba(87,229,234,0.85)]",
  },
  gym: {
    label: "Gym", week: "Gym week", icon: Dumbbell, eyebrow: "text-violet-200", badge: "bg-violet-400/15 text-violet-100 ring-1 ring-violet-300/30",
    stripe: "from-violet-300 via-fuchsia-400 to-violet-500", token: "bg-gradient-to-br from-violet-200 to-fuchsia-300 text-slate-950",
    picked: "border-violet-200/70 bg-[linear-gradient(180deg,rgba(196,181,253,0.32),rgba(192,38,211,0.14))] text-white shadow-[0_10px_26px_-10px_rgba(167,139,250,0.85)]",
  },
} as const

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const weeksFor = (kinds: Iterable<"swim" | "gym">) => {
  const set = new Set(kinds)
  return set.size === 2 ? "Swim & Gym weeks" : set.has("gym") ? "Gym week" : "Swim week"
}
const longDay = (iso: string) => shortDate(iso, { weekday: "long", day: "numeric", month: "short" })

/**
 * Under a coach's reply that prescribes sessions: the way to add them to the athlete's weeks (or, once added, a note that
 * they were, with a way to add them again).
 */
export function PlanCallout({ kind, added, cost = null, onOpen }: {
  kind: PlanKind
  /** What was added: how many sessions, and of which kinds (where they went). */
  added?: { count: number; kinds?: ("swim" | "gym")[] } | null
  /** Tokens a session costs to add to the athlete's weeks, at first or again (lib/tokens.ts); null when the athlete doesn't
   *  use tokens. */
  cost?: number | null
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const where = added?.kinds?.length ? weeksFor(added.kinds) : kind === "both" ? "Swim & Gym weeks" : kind === "gym" ? "Gym week" : "Swim week"
  if (added) {
    return (
      <div className="cp-added mt-3 flex items-center gap-3 rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-400/20 text-emerald-200"><CalendarCheck2 className="h-[18px] w-[18px]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/90">In your training</span>
          <span className="block truncate text-sm font-medium text-emerald-50">{plural(added.count, "session")} added to your {where}</span>
        </span>
        <button type="button" onClick={onOpen} title={cost ? `${tokenCount(cost)} a session` : undefined}
          className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white">
          {/* On a phone the price is left to the sheet's add button, which shows it before anything is spent. */}
          Add again{cost ? <span className="hidden font-medium text-slate-400 sm:inline"> · {tokenCount(cost)} a session</span> : null}
        </button>
      </div>
    )
  }
  return (
    <button type="button" onClick={onOpen}
      className="cp-cta group relative mt-3 flex w-full items-center gap-3 overflow-hidden rounded-2xl p-3 pr-3.5 text-left">
      <span aria-hidden className="cp-cta-sheen" />
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-200 via-sky-300 to-violet-300 text-slate-950 shadow-[0_8px_24px_-6px_rgba(87,229,234,0.7)] transition-transform duration-300 group-hover:scale-105 group-hover:rotate-[-4deg]">
        <CalendarPlus className="h-5 w-5" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">
          Training plan{cost ? ` · ${tokenCount(cost)} a session` : ""}
        </span>
        <span className="block truncate text-sm font-semibold text-white">Add it to your {where}</span>
      </span>
      <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors group-hover:bg-white/[0.16]">
        Add<ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}

/**
 * The coach's sessions, added to the athlete's weeks, full screen over the chat. The reply is read into sessions in the
 * weeks' own formats (`cached` when it was read before), then the athlete picks a week and a day for each, with that
 * week's training beside them, and adds them: the days a session can't go on (over, or full of swims) can't be picked.
 */
export function CoachPlanSheet({ coach, coachName, read, cached, cost = null, swimsPerWeek, onRead, onAdded, onOpenTraining, onClose }: {
  coach: string
  coachName: string
  /** The reply read into sessions: a new read, or one already under way (this was opened before). */
  read: () => Promise<CoachPlan>
  cached: CoachPlan | null
  /** Tokens a session costs to add: adding sessions again (lib/tokens.ts). null when reading them paid for adding them, or
   *  the athlete doesn't use tokens. */
  cost?: number | null
  /** The athlete's swims a week: generating a week waits until it has no more swims than this. */
  swimsPerWeek: number
  onRead: (plan: CoachPlan) => void
  onAdded: (added: AddedSession[]) => void
  onOpenTraining: (target: TrainingTarget) => void
  onClose: () => void
}) {
  const today = todayISO()
  const thisWeek = mondayISO()
  const lastWeek = shiftWeek(thisWeek, WEEKS_AHEAD)
  const first = coachName.replace(/^Coach\s+/i, "")
  const [plan, setPlan] = useState<CoachPlan | null>(cached)
  const [readError, setReadError] = useState<string | null>(null)
  // The read was refused for want of tokens (reading a plan costs tokens for each session): the way on is the token store.
  const [outOfTokens, setOutOfTokens] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [step, setStep] = useState(0)
  const [weekStart, setWeekStart] = useState<string | null>(() => (cached ? startingWeek(cached.sessions, today) : null))
  const [weeks, setWeeks] = useState<Record<string, WeekLoad>>({})
  const [weekError, setWeekError] = useState<string | null>(null)
  const [weekAttempt, setWeekAttempt] = useState(0)
  // The week the sessions were last given days in, and those days.
  const [placedFor, setPlacedFor] = useState<string | null>(null)
  const [placed, setPlaced] = useState<Record<string, string | null>>({})
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set())
  const [details, setDetails] = useState<string | null>(null)
  const [stage, setStage] = useState<"review" | "saving" | "done">("review")
  const [saveError, setSaveError] = useState<string | null>(null)
  // Adding them again was refused for want of tokens: the way on is the token store.
  const [saveOutOfTokens, setSaveOutOfTokens] = useState(false)
  const [added, setAdded] = useState<AddedSession[]>([])
  const [leaving, setLeaving] = useState(false)
  const weeksRef = useRef(weeks)
  weeksRef.current = weeks
  const shownWeek = useRef(weekStart)
  shownWeek.current = weekStart
  const loadingWeeks = useRef(new Set<string>())
  // Weekdays to keep when the plan moves to another week; whether it was moved on because this week had no room.
  const keep = useRef<Record<string, number | null> | null>(null)
  const movedOn = useRef(false)
  const panel = useRef<HTMLDivElement>(null)

  // The reply's sessions, read as this opens (it's kept going if this closes, so opening it again is instant).
  useEffect(() => {
    if (plan) return
    let live = true
    setReadError(null)
    setOutOfTokens(false)
    setStep(0)
    read().then((result) => {
      if (!live) return
      setPlan(result)
      setWeekStart(startingWeek(result.sessions, todayISO()))
      onRead(result)
    }).catch((failure: unknown) => {
      if (!live) return
      setOutOfTokens(failure instanceof TokensNeeded)
      setReadError(failure instanceof Error ? failure.message : `${first}'s plan couldn't be read just now. Please try again.`)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  useEffect(() => {
    if (plan || readError) return
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, 3)), 2600)
    return () => window.clearInterval(timer)
  }, [plan, readError, attempt])

  /** A week's training, read once (several can be on their way at once). */
  const fetchWeek = (start: string) => {
    if (weeksRef.current[start] || loadingWeeks.current.has(start)) return
    loadingWeeks.current.add(start)
    loadWeek(start, today)
      .then((loaded) => setWeeks((current) => ({ ...current, [start]: loaded })))
      .catch((failure: unknown) => {
        if (shownWeek.current === start) setWeekError(failure instanceof Error ? failure.message : "Your week couldn't be loaded.")
      })
      .finally(() => loadingWeeks.current.delete(start))
  }
  // This week and next are read straight away, beside the reply: a plan nearly always goes in one of them.
  useEffect(() => {
    fetchWeek(thisWeek)
    fetchWeek(shiftWeek(thisWeek, 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!weekStart) return
    setWeekError(null)
    fetchWeek(weekStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, weekAttempt])

  const week = weekStart ? weeks[weekStart] : undefined
  // A day for every session once its week is in (the weekdays they had, when the plan moved week).
  useEffect(() => {
    if (!plan || !week || placedFor === week.weekStart) return
    const next = placeSessions(plan.sessions, week, today, keep.current ?? {})
    // A plan that doesn't fit what's left of this week starts next week instead (once, before the athlete moves it).
    if (!keep.current && !movedOn.current && week.weekStart === thisWeek && plan.sessions.some((session) => !next[session.id])) {
      movedOn.current = true
      setWeekStart(shiftWeek(thisWeek, 1))
      return
    }
    setPlaced(next)
    setPlacedFor(week.weekStart)
  }, [plan, week, placedFor, today, thisWeek])

  const close = () => {
    if (stage === "saving" || leaving) return
    setLeaving(true)
    window.setTimeout(onClose, 260)
  }
  useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) close() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const chosen = plan?.sessions.filter((session) => !excluded.has(session.id)) ?? []
  const ready = !!week && placedFor === week.weekStart
  const others = (session: PlanSession, date: string) => chosen.filter((other) => other.id !== session.id && placed[other.id] === date)
  const problemFor = (session: PlanSession): string | null => {
    const date = placed[session.id]
    const day = week?.days.find((entry) => entry.date === date)
    if (day) return dayProblem(session, day, others(session, day.date))
    // Nowhere to put it this week (days over, or full of swims): say so, rather than ask for a day that can't be picked.
    const open = week?.days.some((entry) => !dayProblem(session, entry, others(session, entry.date)))
    return open || !week ? "Choose a day" : "No day this week has room for it: try the week after"
  }
  const blocked = chosen.some((session) => problemFor(session))
  const canAdd = ready && chosen.length > 0 && !blocked && stage === "review"

  const goToWeek = (target: string) => {
    if (stage !== "review" || target < thisWeek || target > lastWeek || target === weekStart) return
    keep.current = placedWeekdays(placed)
    setPlacedFor(null)
    setSaveError(null)
    setWeekStart(target)
  }
  const pick = (session: PlanSession, date: string) => {
    if (stage !== "review") return
    setSaveError(null)
    setPlaced((current) => ({ ...current, [session.id]: date }))
  }
  const toggle = (session: PlanSession) => {
    if (stage !== "review") return
    setSaveError(null)
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(session.id)) next.delete(session.id)
      else next.add(session.id)
      return next
    })
  }

  const add = async () => {
    if (!canAdd || !weekStart) return
    setStage("saving")
    setSaveError(null)
    setSaveOutOfTokens(false)
    try {
      const result = await addCoachPlan(chosen.map((session) => ({ session, date: placed[session.id] as string })))
      if (cost) tokensChanged()
      setAdded(result.added)
      setStage("done")
      onAdded(result.added)
    } catch (failure) {
      setSaveOutOfTokens(failure instanceof TokensNeeded)
      setSaveError(failure instanceof Error ? failure.message : "Your sessions couldn't be added just now. Please try again.")
      setStage("review")
      // The week may have changed meanwhile (a swim added elsewhere): read it again, keeping the days picked.
      setWeeks((current) => Object.fromEntries(Object.entries(current).filter(([start]) => start !== weekStart)))
      setWeekAttempt((value) => value + 1)
    }
  }

  const swims = chosen.filter((session) => session.kind === "swim")
  const gyms = chosen.filter((session) => session.kind === "gym")
  const meters = swims.reduce((sum, session) => sum + swimMeters(session), 0)
  const minutes = chosen.reduce((sum, session) => sum + session.workout.estimated_duration_minutes, 0)
  const weekEnd = weekStart ? shortDate(new Date(Date.parse(`${shiftWeek(weekStart, 1)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), { day: "numeric", month: "short", year: "numeric" }) : ""
  const targets: (TrainingTarget & { label: string })[] = []
  for (const item of added) {
    const tab = item.kind === "swim" ? "week" : "library"
    if (!targets.some((target) => target.tab === tab)) targets.push({ tab, weekStart: item.week_start, label: item.kind === "swim" ? "Open Swim week" : "Open Gym week" })
  }

  const title = stage === "done" ? "Added to your training" : plan?.title ?? "Add to your training"
  const steps = [`Finding each session in ${first}'s reply`, "Writing every set the way your swim week does", "Laying out each workout for your gym week", `Checking it all matches what ${first} wrote`]

  if (typeof document === "undefined") return null
  return createPortal(
    <div className={cn("cp-root fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6", leaving && "cp-leaving")}>
      <button type="button" tabIndex={-1} aria-label="Close" onClick={close} className="cp-backdrop absolute inset-0 cursor-default" />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cp-title"
        className="cp-panel relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[linear-gradient(165deg,rgba(14,25,34,0.98),rgba(6,10,15,0.99))] outline-none sm:h-auto sm:max-h-[min(900px,94dvh)] sm:max-w-4xl sm:rounded-[30px] sm:border sm:border-white/10 sm:shadow-[0_40px_120px_-20px_rgba(0,0,0,0.85)]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
        <span aria-hidden className="cp-glow cp-glow-a" />
        <span aria-hidden className="cp-glow cp-glow-b" />

        <header className="relative z-10 flex items-center gap-3 border-b border-white/[0.07] px-4 pb-3.5 pt-4 sm:px-7 sm:pt-5" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
          <span className="relative shrink-0">
            <CoachAvatar name={coach} shape="circle" className="h-11 w-11 ring-2 ring-white/10" />
            <span className={cn("absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full ring-2 ring-[#0c1720]",
              stage === "done" ? "bg-emerald-300 text-slate-950" : "bg-gradient-to-br from-cyan-200 to-violet-300 text-slate-950")}>
              {stage === "done" ? <Check className="h-3 w-3" strokeWidth={3.5} /> : <CalendarPlus className="h-3 w-3" />}
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[10px] font-semibold uppercase tracking-[0.22em]", stage === "done" ? "text-emerald-300" : "text-cyan-200/90")}>
              {stage === "done" ? `${plural(added.length, "session")} added` : `From ${coachName}`}
            </p>
            <h2 id="cp-title" key={title} className="cp-title truncate text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
          </div>
          <button type="button" onClick={close} disabled={stage === "saving"} aria-label="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto overscroll-contain">
          {!plan && !readError && (
            <div role="status" aria-live="polite" className="flex flex-col items-center px-6 pb-12 pt-10 text-center sm:pt-14">
              <div className="relative grid h-32 w-32 place-items-center">
                <span aria-hidden className="cp-orbit absolute inset-0 rounded-full" />
                <span aria-hidden className="cp-orbit cp-orbit-back absolute inset-4 rounded-full" />
                <span aria-hidden className="cp-pulse absolute inset-7 rounded-full" />
                <CoachAvatar name={coach} shape="circle" className="relative h-16 w-16" />
                <span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-cyan-200 to-violet-300 text-slate-950 shadow-[0_0_24px_rgba(87,229,234,0.6)]">
                  <Sparkles className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-6 text-xl font-bold tracking-tight text-white sm:text-2xl">Reading {first}&apos;s plan</p>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-400">Every set and exercise goes into your training exactly as {first} wrote it.</p>
              <ol className="mt-7 w-full max-w-sm space-y-2 text-left">
                {steps.map((label, index) => (
                  <li key={label} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all duration-500",
                    index < step ? "border-emerald-300/20 bg-emerald-400/[0.06] text-emerald-100"
                      : index === step ? "border-cyan-200/30 bg-cyan-300/[0.07] text-white" : "border-white/[0.06] text-slate-500")}>
                    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full",
                      index < step ? "bg-emerald-300 text-slate-950" : index === step ? "bg-cyan-300/20 text-cyan-100" : "bg-white/[0.05]")}>
                      {index < step ? <Check className="check-pop h-3 w-3" strokeWidth={3.5} /> : index === step ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    </span>
                    <span className={cn(index === step && "thinking-shimmer font-medium")}>{label}</span>
                  </li>
                ))}
              </ol>
              <div aria-hidden className="mt-9 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
                {[0, 1].map((card) => (
                  <div key={card} className="cp-scan relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4" style={{ "--i": card } as CSSProperties}>
                    <span className="block h-2.5 w-16 rounded-full bg-white/10" />
                    <span className="mt-3 block h-3.5 w-44 rounded-full bg-white/[0.12]" />
                    <span className="mt-4 flex gap-1.5">{[0, 1, 2, 3, 4, 5, 6].map((chip) => <span key={chip} className="h-8 flex-1 rounded-lg bg-white/[0.05]" />)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {readError && (
            <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10">
                {outOfTokens ? <Coins className="h-7 w-7 text-amber-200" /> : <AlertTriangle className="h-7 w-7 text-amber-200" />}
              </span>
              <p className="mt-4 text-lg font-semibold text-white">{outOfTokens ? "Not enough tokens for this plan" : "This plan couldn't be added"}</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">{readError}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {outOfTokens ? (
                  <button type="button" onClick={openTokenStore}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-100">
                    <Coins className="h-4 w-4" />Get tokens
                  </button>
                ) : (
                  <button type="button" onClick={() => { setReadError(null); setAttempt((value) => value + 1) }}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-100">
                    <RotateCcw className="h-4 w-4" />Try again
                  </button>
                )}
                <button type="button" onClick={close} className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06]">
                  Back to chat
                </button>
              </div>
            </div>
          )}

          {plan && (
            <div className="space-y-5 px-4 pb-8 pt-5 sm:px-7">
              {stage === "done" && <Landed added={added} first={first} />}

              {stage !== "done" && (
                <div className="cp-rise flex flex-wrap items-center gap-2 text-xs">
                  {swims.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 font-semibold text-cyan-100"><Waves className="h-3.5 w-3.5" />{plural(swims.length, "swim")}</span>}
                  {gyms.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 font-semibold text-violet-100"><Dumbbell className="h-3.5 w-3.5" />{plural(gyms.length, "gym session")}</span>}
                  {meters > 0 && <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-semibold tabular-nums text-slate-200">{meters.toLocaleString()} m</span>}
                  {minutes > 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-semibold tabular-nums text-slate-200"><Clock className="h-3.5 w-3.5" />{minutes} min</span>}
                  {!chosen.length && <span className="text-slate-400">Pick at least one session to add.</span>}
                </div>
              )}

              {/* The week */}
              <section className="cp-rise rounded-[22px] border border-white/[0.08] bg-black/20 p-3 sm:p-4" style={{ "--i": 1 } as CSSProperties} aria-label="Your week">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{stage === "done" ? "On your calendar" : "Your week"}</p>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                      {weekStart ? `${shortDate(weekStart)} – ${weekEnd}` : ""}
                      {weekStart === thisWeek && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-100">This week</span>}
                      {weekStart === shiftWeek(thisWeek, 1) && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-200">Next week</span>}
                    </p>
                  </div>
                  {stage !== "done" && weekStart && (
                    <div className="flex items-center rounded-full border border-white/10 bg-black/30 p-1">
                      <button type="button" aria-label="Week before" title="Week before" disabled={weekStart <= thisWeek || stage !== "review"} onClick={() => goToWeek(shiftWeek(weekStart, -1))}
                        className="grid h-8 w-8 place-items-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {[["This week", thisWeek], ["Next week", shiftWeek(thisWeek, 1)]].map(([label, start]) => (
                        <button key={start} type="button" disabled={stage !== "review"} onClick={() => goToWeek(start)} aria-pressed={weekStart === start}
                          className={cn("h-8 rounded-full px-3 text-xs font-semibold transition-colors", weekStart === start ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white")}>
                          {label}
                        </button>
                      ))}
                      <button type="button" aria-label="Week after" title="Week after" disabled={weekStart >= lastWeek || stage !== "review"} onClick={() => goToWeek(shiftWeek(weekStart, 1))}
                        className="grid h-8 w-8 place-items-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                {week ? <WeekStrip key={week.weekStart} week={week} sessions={chosen} placed={ready ? placed : {}} today={today} landed={stage === "done"} />
                  : weekError ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-300/20 bg-rose-500/[0.06] p-4 text-sm text-rose-100">
                      <span>{weekError}</span>
                      <button type="button" onClick={() => setWeekAttempt((value) => value + 1)} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15">
                        <RotateCcw className="h-3.5 w-3.5" />Try again
                      </button>
                    </div>
                  ) : <WeekStripSkeleton />}
                {stage !== "done" && week && (
                  <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300/80" />Swimming already planned</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-violet-300/80" />Gym already planned</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" />The day {first} named</span>
                  </p>
                )}
              </section>

              {stage !== "done" && (["named", "unreadable"] as const).map((reason) => {
                const items = plan.skipped?.filter((item) => (item.reason ?? "named") === reason) ?? []
                if (!items.length) return null
                const them = items.length === 1 ? "it" : "them"
                return (
                  <p key={reason} className="cp-rise flex gap-2.5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-3.5 text-xs leading-5 text-amber-100/90" style={{ "--i": 2 } as CSSProperties}>
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                    <span>
                      Left out: {items.map((item) => `${item.day && item.day !== "today" && item.day !== "tomorrow" ? `${item.day}'s ` : ""}${item.kind} session (“${item.title}”)`).join(", ")}.
                      {" "}{reason === "named"
                        ? <>{first} named {them} without the {items.some((item) => item.kind === "gym") ? "exercises" : "sets"}, so there&apos;s nothing to add yet. Ask {first} to write {them} out in chat.</>
                        : <>{items.length === 1 ? "It" : "They"} couldn&apos;t be read just now. Close this and add the plan again to try {them} again.</>}
                    </span>
                  </p>
                )
              })}
              {stage !== "done" && week && !week.generated && (() => {
                // Generating a week waits until it has no more swims than the athlete's week holds.
                const adding = swims.filter((session) => placed[session.id]).length
                if (!adding) return null
                const total = week.days.reduce((sum, day) => sum + day.swims, 0) + adding
                const over = swimsPerWeek > 0 && total > swimsPerWeek
                return (
                  <p className={cn("cp-rise flex gap-2.5 rounded-2xl border p-3.5 text-xs leading-5", over ? "border-amber-300/20 bg-amber-300/[0.05] text-amber-100/90" : "border-white/[0.07] bg-white/[0.025] text-slate-400")} style={{ "--i": 2 } as CSSProperties}>
                    <Info className={cn("mt-0.5 h-4 w-4 shrink-0", over ? "text-amber-200" : "text-accent")} />
                    {over
                      ? <span>That makes {total} swims this week, and your plan has {swimsPerWeek} a week. They&apos;ll all be on your calendar, but Generate Swim Week can&apos;t plan this week until it has {swimsPerWeek} or fewer.</span>
                      : <span>This swim week isn&apos;t generated yet. When you generate it, your coach plans the rest of the week around these swims.</span>}
                  </p>
                )
              })()}

              {/* The sessions */}
              {stage !== "done" && (
                <div className="space-y-3">
                  {plan.sessions.map((session, index) => (
                    <SessionCard key={session.id} session={session} index={index} week={ready ? week ?? null : null} today={today} first={first}
                      date={placed[session.id] ?? null} included={!excluded.has(session.id)} problem={!excluded.has(session.id) && ready ? problemFor(session) : null}
                      dayProblemFor={(day) => dayProblem(session, day, others(session, day.date))}
                      locked={stage !== "review"} open={details === session.id}
                      onToggle={() => toggle(session)} onPick={(date) => pick(session, date)}
                      onDetails={() => setDetails((current) => (current === session.id ? null : session.id))} />
                  ))}
                </div>
              )}

              {saveError && (saveOutOfTokens ? (
                <div role="alert" className="flex flex-wrap items-center gap-x-2.5 gap-y-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] p-3.5 text-sm leading-6 text-amber-50">
                  <Coins className="h-4 w-4 shrink-0 text-amber-200" />
                  <span className="min-w-0 flex-1">{saveError}</span>
                  <button type="button" onClick={openTokenStore}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-100">
                    <Coins className="h-3.5 w-3.5" />Get tokens
                  </button>
                </div>
              ) : (
                <p role="alert" className="flex gap-2.5 rounded-2xl border border-rose-300/25 bg-rose-500/[0.08] p-3.5 text-sm leading-6 text-rose-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />{saveError}
                </p>
              ))}
            </div>
          )}
        </div>

        {plan && stage !== "done" && (
          <footer className="relative z-10 flex flex-wrap items-center gap-3 border-t border-white/[0.07] bg-[#070b10]/85 px-4 pt-3.5 backdrop-blur-xl sm:px-7 sm:py-4" style={{ paddingBottom: "max(0.875rem, env(safe-area-inset-bottom))" }}>
            <p className="min-w-0 flex-1 text-xs leading-5 text-slate-400">
              {chosen.length ? <>{plural(chosen.length, "session")} <ArrowRight className="mx-0.5 inline h-3 w-3" /> your {weeksFor(chosen.map((session) => session.kind))}</> : "No sessions chosen"}
              {blocked && ready && chosen.length > 0 && <span className="block text-amber-200/90">Choose a day for every session to add them.</span>}
            </p>
            <button type="button" onClick={() => void add()} disabled={!canAdd}
              className="cp-add group relative inline-flex h-12 items-center gap-2 overflow-hidden rounded-full px-6 text-sm font-bold text-slate-950 transition-all duration-300 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40 max-sm:flex-1 max-sm:justify-center">
              <span aria-hidden className="cp-cta-sheen" />
              {stage === "saving" ? <Loader2 className="relative h-4 w-4 animate-spin" /> : <CalendarPlus className="relative h-4 w-4" />}
              <span className="relative">
                {stage === "saving" ? "Adding to your training…" : chosen.length ? `Add ${plural(chosen.length, "session")}${cost ? ` · ${tokenCount(cost * chosen.length)}` : ""}` : "Add sessions"}
              </span>
            </button>
          </footer>
        )}

        {stage === "done" && (
          <footer className="relative z-10 flex flex-col-reverse gap-2 border-t border-white/[0.07] bg-[#070b10]/85 px-4 pt-3.5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-end sm:px-7 sm:py-4" style={{ paddingBottom: "max(0.875rem, env(safe-area-inset-bottom))" }}>
            <button type="button" onClick={close} className="h-11 rounded-full border border-white/15 px-5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06]">
              Back to chat
            </button>
            {targets.map((target) => (
              <button key={target.tab} type="button" onClick={() => onOpenTraining({ tab: target.tab, weekStart: target.weekStart })}
                className={cn("group inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-bold text-slate-950 transition-transform hover:-translate-y-0.5",
                  target.tab === "week" ? "bg-gradient-to-r from-cyan-200 to-sky-400" : "bg-gradient-to-r from-violet-200 to-fuchsia-300")}>
                {target.tab === "week" ? <Waves className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />}{target.label}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** The chosen week: what each day already holds, and the coach's sessions on the days picked for them. */
function WeekStrip({ week, sessions, placed, today, landed }: {
  week: WeekLoad; sessions: PlanSession[]; placed: Record<string, string | null>; today: string; landed: boolean
}) {
  const most = Math.max(4000, ...week.days.map((day) => day.meters))
  const longest = Math.max(60, ...week.days.map((day) => day.minutes))
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {week.days.map((day, index) => {
        const here = sessions.filter((session) => placed[session.id] === day.date)
        return (
          <div key={day.date} style={{ "--i": index } as CSSProperties}
            className={cn("cp-day relative flex min-h-[124px] flex-col overflow-hidden rounded-2xl border px-1 pb-1.5 pt-2 sm:min-h-[140px] sm:px-1.5",
              day.past ? "cp-past border-white/[0.04] bg-white/[0.01]" : here.length ? "border-white/20 bg-white/[0.05]" : "border-white/[0.07] bg-white/[0.025]",
              day.date === today && "ring-1 ring-inset ring-accent/50", landed && here.length > 0 && "cp-day-hit")}>
            <p className={cn("text-center text-[9px] font-semibold uppercase tracking-[0.12em] sm:text-[10px]", day.date === today ? "text-accent" : "text-slate-500")}>{day.dayName.slice(0, 3)}</p>
            <p className={cn("text-center text-base font-bold leading-tight tabular-nums sm:text-lg", day.past ? "text-slate-500" : "text-white")}>{Number(day.date.slice(8))}</p>
            <div className="mt-1.5 flex flex-1 flex-col gap-1">
              {here.map((session) => {
                const kind = KINDS[session.kind]
                return (
                  <span key={`${session.id}:${day.date}`} title={session.title}
                    className={cn("cp-drop flex items-center justify-center gap-1 rounded-lg px-0.5 py-1 text-[10px] font-bold", kind.token)}>
                    {landed ? <Check className="h-3 w-3" strokeWidth={3.5} /> : <kind.icon className="h-3 w-3" />}
                    <span className="hidden lg:inline">{kind.label}</span>
                  </span>
                )
              })}
            </div>
            <div className="mt-1 space-y-1" title={[day.swims && `${plural(day.swims, "swim")}, ${day.meters.toLocaleString()} m`, day.gyms && `${plural(day.gyms, "gym workout")}, ${day.minutes} min`, ...day.meets].filter(Boolean).join(" · ") || undefined}>
              {day.meets.length > 0 && <Flag className="mx-auto h-3 w-3 text-amber-300" />}
              {day.meters > 0 && (
                <span className="block">
                  <span className="block text-center text-[9px] font-semibold tabular-nums text-cyan-200/80">{compactMeters(day.meters)}</span>
                  <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-cyan-300/70" style={{ width: `${Math.max(12, (day.meters / most) * 100)}%` }} /></span>
                </span>
              )}
              {day.minutes > 0 && (
                <span className="block">
                  <span className="block text-center text-[9px] font-semibold tabular-nums text-violet-200/80">{day.minutes}′</span>
                  <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-violet-300/70" style={{ width: `${Math.max(12, (day.minutes / longest) * 100)}%` }} /></span>
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekStripSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-7 gap-1 sm:gap-2">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="cp-scan relative min-h-[124px] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] sm:min-h-[140px]" style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  )
}

/** One of the coach's sessions: what it is, whether it's added, the day it goes on, and its full prescription. */
function SessionCard({ session, index, week, today, first, date, included, problem, dayProblemFor, locked, open, onToggle, onPick, onDetails }: {
  session: PlanSession
  index: number
  week: WeekLoad | null
  today: string
  first: string
  date: string | null
  included: boolean
  problem: string | null
  dayProblemFor: (day: DayLoad) => string | null
  locked: boolean
  open: boolean
  onToggle: () => void
  onPick: (date: string) => void
  onDetails: () => void
}) {
  const kind = KINDS[session.kind]
  const hinted = week ? hintedDate(session, week.weekStart, today) : null
  // Added before (the same session is already in this week): adding it again makes a second copy.
  const twin = week ? alreadyIn(session, week) : null
  const stats = session.kind === "swim"
    ? [`${swimMeters(session).toLocaleString()} m`, `${session.workout.estimated_duration_minutes} min`, plural(session.workout.sets.length, "set")]
    : [plural(session.workout.exercises.length, "exercise"), plural(session.workout.exercises.reduce((sum, item) => sum + item.sets, 0), "set"), `${session.workout.estimated_duration_minutes} min`]
  return (
    <article style={{ "--i": index + 2 } as CSSProperties}
      className={cn("cp-card relative overflow-hidden rounded-[22px] border bg-[linear-gradient(160deg,rgba(22,32,42,0.86),rgba(10,15,21,0.94))] transition-[opacity,border-color] duration-300",
        included ? "border-white/[0.09]" : "border-white/[0.05] opacity-55")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1 bg-gradient-to-b", kind.stripe, !included && "opacity-30")} />
      <div className="p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", kind.badge)}><kind.icon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", kind.eyebrow)}>
              {kind.label}<span className="max-sm:hidden"> · goes in your {kind.week}</span>
              {session.day && <span className="ml-1.5 normal-case tracking-normal text-amber-200/90">· {first} said {session.day}</span>}
            </p>
            <h3 className="mt-0.5 text-base font-semibold leading-snug text-white sm:text-lg">{session.title}</h3>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-slate-400">
              {stats.map((item, position) => <span key={item} className="inline-flex items-center gap-2">{position > 0 && <span className="h-1 w-1 rounded-full bg-slate-600" />}{item}</span>)}
              {session.kind === "swim" ? session.workout.main_training_zones.slice(0, 2).map((zone) => <ZoneChip key={zone} zone={zone} />)
                : <DoseChip dose={session.doc.intensity} />}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={included} aria-label={`${included ? "Leave out" : "Add"} ${session.title}`} onClick={onToggle} disabled={locked}
            className={cn("relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors duration-300 disabled:opacity-50",
              included ? "border-emerald-300/50 bg-emerald-400/80" : "border-white/15 bg-white/[0.06]")}>
            <span className={cn("absolute top-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-white shadow transition-transform duration-300",
              included ? "translate-x-[22px]" : "translate-x-0.5")}>
              {included && <Check className="h-3 w-3 text-emerald-600" strokeWidth={3.5} />}
            </span>
          </button>
        </div>

        {included && (
          <div className="mt-4">
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="radiogroup" aria-label={`Day for ${session.title}`}>
              {week ? week.days.map((day) => {
                const selected = date === day.date
                const reason = selected ? null : dayProblemFor(day)
                return (
                  <button key={day.date} type="button" role="radio" aria-checked={selected} disabled={!!reason || locked} onClick={() => onPick(day.date)}
                    title={reason ?? longDay(day.date)} aria-label={`${longDay(day.date)}${reason ? `: ${reason}` : ""}`}
                    className={cn("relative flex flex-col items-center rounded-xl border py-1.5 transition-all duration-200",
                      selected ? kind.picked
                        : reason ? cn("cursor-not-allowed border-white/[0.04] text-slate-600", day.past && "cp-past")
                          : "border-white/[0.08] bg-white/[0.025] text-slate-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06] hover:text-white")}>
                    <span className="text-[9px] font-semibold uppercase tracking-wider">{day.dayName.slice(0, 3)}</span>
                    <span className="text-sm font-bold tabular-nums">{Number(day.date.slice(8))}</span>
                    {hinted === day.date && <span aria-hidden className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.8)]" />}
                    {selected && <span aria-hidden className="check-pop absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-white text-slate-950 shadow"><Check className="h-2.5 w-2.5" strokeWidth={4} /></span>}
                  </button>
                )
              }) : Array.from({ length: 7 }, (_, day) => <span key={day} className="h-[46px] animate-pulse rounded-xl bg-white/[0.04]" />)}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              {problem ? <span className="inline-flex items-center gap-1.5 text-amber-200"><AlertTriangle className="h-3.5 w-3.5" />{problem}</span>
                : date ? <span key={date} className="cp-rise inline-flex items-center gap-1.5 text-slate-300"><ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                  {kind.week} · <span className="font-semibold text-white">{longDay(date)}</span></span>
                  : <span className="text-slate-500">Finding a day…</span>}
              <button type="button" onClick={onDetails} aria-expanded={open}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white">
                {open ? "Hide" : session.kind === "swim" ? "See every set" : "See every exercise"}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", open && "rotate-180")} />
              </button>
            </div>
            {twin && (
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-200/90">
                <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Already in this week on {longDay(twin.date)}: adding it again makes a second copy.
              </p>
            )}
          </div>
        )}
        {!included && <p className="mt-3 text-xs text-slate-500">Left out: it won&apos;t be added.</p>}
        {open && included && (
          <div className="cp-rise mt-4 border-t border-white/[0.07] pt-4">
            {session.kind === "swim" ? <SwimWorkoutDetails workout={session.workout} /> : <GymWorkoutDetails item={asGymItem(session)} />}
          </div>
        )}
      </div>
    </article>
  )
}

/** The moment the sessions land: a burst, and where each one went. */
function Landed({ added, first }: { added: AddedSession[]; first: string }) {
  return (
    <div className="flex flex-col items-center pt-2 text-center">
      <div className="relative grid h-32 w-32 place-items-center">
        <span aria-hidden className="cp-burst">{BURST.map((angle) => <i key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />)}</span>
        <svg aria-hidden className="cp-ring absolute inset-1" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" /></svg>
        <span className="cp-done-check grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-emerald-200 via-emerald-300 to-teal-400 text-slate-950 shadow-[0_0_50px_rgba(52,211,153,0.55)]">
          <CalendarCheck2 className="h-9 w-9" strokeWidth={2.2} />
        </span>
      </div>
      <h3 className="cp-rise mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl" style={{ "--i": 2 } as CSSProperties}>It&apos;s in your training</h3>
      <p className="cp-rise mt-2 max-w-md text-sm leading-6 text-slate-400" style={{ "--i": 3 } as CSSProperties}>
        {first}&apos;s {added.length === 1 ? "session is" : "sessions are"} on your calendar. Tick {added.length === 1 ? "it" : "them"} off as you go, and edit, move or delete {added.length === 1 ? "it" : "them"} like any other session.
      </p>
      <ul className="mt-5 w-full max-w-lg space-y-2 text-left">
        {added.map((item, index) => {
          const kind = KINDS[item.kind]
          return (
            <li key={`${item.kind}:${item.date}:${index}`} style={{ "--i": 4 + index } as CSSProperties}
              className="cp-rise flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", kind.badge)}><kind.icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{item.title}</span>
                <span className="block text-xs text-slate-400">{longDay(item.date)} · {kind.week}</span>
              </span>
              <Check className="h-4 w-4 shrink-0 text-emerald-300" strokeWidth={3} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
