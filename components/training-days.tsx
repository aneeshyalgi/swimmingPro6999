"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { AlertTriangle, ArrowRight, CalendarDays, Check, Dumbbell, Heart, Loader2, Moon, Plus, RotateCcw, Waves } from "lucide-react"
import { Button } from "@/components/ui/button"
import { trainingDaysSchema, trainingRequest, type TrainingDays } from "@/lib/training"
import { cn } from "@/lib/utils"

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const SWIM_WORDS = ["no swim", "one swim", "two swims"]

type Draft = { swim: number[]; gym: boolean[]; mobility: boolean }
type Phase = "loading" | "failed" | "ready" | "saving"

const draftOf = (days: TrainingDays): Draft => ({ swim: [...days.swim], gym: [...days.gym], mobility: days.mobility })
const sameDraft = (a: Draft, b: Draft) => a.mobility === b.mobility && a.swim.every((count, day) => count === b.swim[day]) && a.gym.every((on, day) => on === b.gym[day])
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
/** Today's day of the week, Monday first. */
const weekday = () => (new Date().getDay() + 6) % 7

/** A day's training in a word or two ("Double + gym"); its tile's icon shows whether the mobility routine is on it. */
function dayTag(swims: number, strength: boolean) {
  const swim = swims === 2 ? "Double" : swims === 1 ? "Swim" : ""
  if (swim && strength) return `${swim} + gym`
  return swim || (strength ? "Gym" : "Rest")
}

/**
 * The days the athlete trains, on the dashboard: how many swims each day of the week (none, one or two), which days have
 * a strength session, and whether the coach's mobility routine goes on the other days. Saving sets the athlete's swims
 * and strength sessions a week to match; the weeks they generate or re-plan from then on are built on these days.
 */
export function TrainingDaysEditor({ onSaved, onOpenTraining }: {
  /** Saved: the athlete's swims and strength sessions a week now. */
  onSaved: (week: { swims: number; strength: number }) => void
  onOpenTraining: () => void
}) {
  const [saved, setSaved] = useState<TrainingDays | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(0)        // bumps on each save: replays the sweep across the week
  const [fresh, setFresh] = useState(false)            // saved, and not changed since: the week shows it was saved
  const [nudge, setNudge] = useState<{ day: number; count: number } | null>(null)   // the last swim, kept (count replays the shake)
  const [pulse, setPulse] = useState<Record<string, number>>({})  // "swim3" / "gym3" → when it last changed (replays its animation)
  const [today] = useState(weekday)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    setPhase("loading")
    trainingRequest("/days", trainingDaysSchema, { signal: controller.signal }).then((days) => {
      setSaved(days)
      setDraft(draftOf(days))
      setError(null)
      setPhase("ready")
    }, (failure: unknown) => {
      if (controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : "Your training days couldn't be loaded.")
      setPhase("failed")
    })
    return () => { mounted.current = false; controller.abort() }
  }, [attempt])

  const touch = (key: string) => {
    setPulse((current) => ({ ...current, [key]: Date.now() }))
    setFresh(false)
  }

  const cycleSwim = (day: number) => {
    if (!draft || phase === "saving") return
    const next = (draft.swim[day] + 1) % 3
    const total = draft.swim.reduce((sum, count) => sum + count, 0)
    if (next === 0 && total - draft.swim[day] === 0) {
      setNudge((current) => ({ day, count: (current?.count ?? 0) + 1 }))        // the week keeps at least one swim
      return
    }
    setNudge(null)
    setError(null)
    setDraft({ ...draft, swim: draft.swim.map((count, index) => (index === day ? next : count)) })
    touch(`swim${day}`)
  }

  const toggleGym = (day: number) => {
    if (!draft || phase === "saving") return
    setError(null)
    setDraft({ ...draft, gym: draft.gym.map((on, index) => (index === day ? !on : on)) })
    touch(`gym${day}`)
  }

  const toggleMobility = () => {
    if (!draft || phase === "saving") return
    setError(null)
    setFresh(false)
    setDraft({ ...draft, mobility: !draft.mobility })
  }

  const save = async () => {
    if (!draft || phase === "saving" || !draft.swim.some(Boolean)) return
    setPhase("saving")
    setError(null)
    try {
      const days = await trainingRequest("/days", trainingDaysSchema, { method: "PUT", body: draft })
      if (!mounted.current) return
      setSaved(days)
      setDraft(draftOf(days))
      setJustSaved((count) => count + 1)
      setFresh(true)
      onSaved({ swims: days.swim.reduce((sum, count) => sum + count, 0), strength: days.gym.filter(Boolean).length })
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Your training days weren't saved. Please try again.")
    } finally {
      if (mounted.current) setPhase("ready")
    }
  }

  const undo = () => {
    if (!saved) return
    setDraft(draftOf(saved))
    setNudge(null)
    setError(null)
  }

  if (phase === "loading" || phase === "failed" || !draft || !saved) {
    return (
      <section aria-labelledby="training-days-title" aria-busy={phase === "loading"} className="td-card relative overflow-hidden rounded-[26px] border border-white/[0.08] p-5 sm:p-6">
        <Header chosen={null} />
        {phase === "failed" ? (
          <div className="relative mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-300/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-100">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />{error}</span>
            <Button size="sm" variant="outline" className="rounded-full border-rose-300/30 bg-transparent" onClick={() => setAttempt((count) => count + 1)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Try again
            </Button>
          </div>
        ) : (
          <div aria-hidden className="relative mt-6 grid grid-cols-7 gap-1.5 sm:gap-3">
            {DAY_NAMES.map((name, day) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <span className="td-skeleton h-3 w-7 rounded-full" />
                <span className="td-skeleton h-[104px] w-full rounded-[18px] sm:h-[132px]" style={{ "--i": day } as CSSProperties} />
                <span className="td-skeleton h-12 w-full rounded-2xl sm:h-14" style={{ "--i": day } as CSSProperties} />
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }

  const swims = draft.swim.reduce((sum, count) => sum + count, 0)
  const strength = draft.gym.filter(Boolean).length
  const restDays = draft.swim.filter((count, day) => !count && !draft.gym[day]).length
  const mobilityDays = draft.mobility ? 7 - strength : 0
  const savedSwims = saved.swim.reduce((sum, count) => sum + count, 0)
  const savedStrength = saved.gym.filter(Boolean).length
  const dirty = !sameDraft(draft, draftOf(saved))
  const numbersChange = swims !== savedSwims || strength !== savedStrength
  const bigDays = DAY_NAMES.filter((_, day) => draft.swim[day] === 2 && draft.gym[day])
  const chosen = saved.chosen.swim || saved.chosen.gym
  const stats = [
    { key: "swims", value: swims, label: swims === 1 ? "swim" : "swims", icon: Waves, tone: "text-cyan-200 bg-cyan-300/10 border-cyan-300/20" },
    { key: "strength", value: strength, label: "strength", icon: Dumbbell, tone: "text-violet-200 bg-violet-300/10 border-violet-300/20" },
    { key: "mobility", value: mobilityDays, label: mobilityDays === 1 ? "mobility day" : "mobility days", icon: Heart, tone: "text-emerald-200 bg-emerald-300/10 border-emerald-300/20" },
    { key: "rest", value: restDays, label: restDays === 1 ? "rest day" : "rest days", icon: Moon, tone: "text-amber-100 bg-amber-200/10 border-amber-200/20" },
  ]

  return (
    <section aria-labelledby="training-days-title" className={cn("td-card relative overflow-hidden rounded-[26px] border border-white/[0.08] p-5 sm:p-6", dirty && "td-card-dirty")}>
      <div aria-hidden className="td-aurora pointer-events-none absolute inset-0" />
      <Header chosen={chosen} />

      <div className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="td-key td-key-swim" />Tap a pool: one swim, two, or none</span>
        <span className="flex items-center gap-1.5"><span className="td-key td-key-gym" />Tap below it for a strength session</span>
      </div>

      {/* The week */}
      <div className="relative mt-4">
        {fresh && !dirty && <span key={justSaved} aria-hidden className="td-sweep pointer-events-none absolute -inset-x-2 -inset-y-1 z-20 rounded-3xl" />}
        <div className={cn("grid grid-cols-7 gap-1.5 sm:gap-3", fresh && !dirty && (justSaved % 2 ? "td-saved-a" : "td-saved-b"))}>
          {DAY_NAMES.map((name, day) => {
            const count = draft.swim[day]
            const on = draft.gym[day]
            const isToday = day === today
            const swimPulse = pulse[`swim${day}`]
            const gymPulse = pulse[`gym${day}`]
            const shaking = nudge !== null && nudge.day === day
            return (
              <div key={name} className={cn("td-col flex min-w-0 flex-col items-center gap-2", isToday && "td-today")} style={{ "--i": day } as CSSProperties}>
                <span className={cn("flex h-4 items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] sm:text-[11px]", isToday ? "text-accent" : "text-slate-400")}>
                  {isToday && <span aria-hidden className="td-today-dot h-1.5 w-1.5 rounded-full bg-accent" />}
                  {name.slice(0, 3)}
                </span>

                {/* The day's swims: a pool that fills */}
                <button type="button" onClick={() => cycleSwim(day)} disabled={phase === "saving"}
                  aria-label={`${name}: ${SWIM_WORDS[count]}. Change to ${SWIM_WORDS[(count + 1) % 3]}.`}
                  className={cn("td-swim group relative h-[104px] w-full overflow-hidden rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 sm:h-[132px]",
                    count > 0 && "td-swim-on", shaking && (nudge.count % 2 ? "td-shake-a" : "td-shake-b"))}>
                  <span aria-hidden data-empty={count === 0 || undefined} className="td-water absolute inset-x-0 bottom-0" style={{ height: count === 0 ? "0%" : count === 1 ? "52%" : "100%" }}>
                    <svg className="gs-wave absolute -top-2.5 left-0 h-3 w-[200%] text-cyan-300/70" viewBox="0 0 400 16" preserveAspectRatio="none">
                      <path d="M0 8 Q 25 0 50 8 T 100 8 T 150 8 T 200 8 T 250 8 T 300 8 T 350 8 T 400 8 V16 H0 Z" fill="currentColor" />
                    </svg>
                    <svg className="gs-wave gs-wave-back absolute -top-2 left-0 h-3 w-[200%]" viewBox="0 0 400 16" preserveAspectRatio="none">
                      <path d="M0 8 Q 25 16 50 8 T 100 8 T 150 8 T 200 8 T 250 8 T 300 8 T 350 8 T 400 8 V16 H0 Z" fill="currentColor" />
                    </svg>
                    {count > 0 && [0, 1, 2].map((bubble) => <span key={bubble} className="td-bubble" style={{ "--b": bubble } as CSSProperties} />)}
                  </span>
                  {swimPulse && <span key={swimPulse} aria-hidden className="td-splash pointer-events-none absolute inset-0" />}
                  <span aria-hidden className="relative z-10 flex h-full flex-col items-center justify-center gap-1">
                    {count === 0 ? (
                      <Plus className="td-plus h-4 w-4 text-slate-500 transition-colors group-hover:text-cyan-200" />
                    ) : (
                      <>
                        <span key={`n${count}-${swimPulse ?? 0}`} className="td-count text-xl font-bold tabular-nums leading-none text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.55)] sm:text-2xl">{count}</span>
                        <Waves className="h-3.5 w-3.5 text-white/80" />
                      </>
                    )}
                  </span>
                </button>

                {/* Strength that day, or the mobility routine / rest */}
                <button type="button" onClick={() => toggleGym(day)} disabled={phase === "saving"} aria-pressed={on}
                  aria-label={`${name}: strength session${on ? "" : " (off)"}`}
                  className={cn("td-gym relative grid h-12 w-full place-items-center overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-violet-200/70 sm:h-14",
                    on && "td-gym-on")}>
                  {gymPulse && on && <span key={gymPulse} aria-hidden className="td-gym-burst pointer-events-none absolute inset-0" />}
                  {on ? (
                    <Dumbbell key={`lift-${gymPulse ?? 0}`} aria-hidden className="td-lift relative h-5 w-5 text-white" />
                  ) : draft.mobility ? (
                    <Heart aria-hidden className="h-4 w-4 text-emerald-300/45" />
                  ) : (
                    <Moon aria-hidden className="h-4 w-4 text-slate-500/70" />
                  )}
                </button>

                <span className={cn("td-tag w-full truncate text-center text-[9px] font-medium sm:text-[11px]", count || on ? "text-slate-200" : "text-slate-500")}
                  key={`${count}${on}`}>
                  {dayTag(count, on)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* The week in numbers */}
      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {stats.map((stat) => (
            <span key={stat.key} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs", stat.tone)}>
              <stat.icon aria-hidden className="h-3.5 w-3.5" />
              <span key={stat.value} className="td-tick font-bold tabular-nums">{stat.value}</span>
              {stat.label}
            </span>
          ))}
        </div>
        <button type="button" role="switch" aria-checked={draft.mobility} onClick={toggleMobility} disabled={phase === "saving"}
          className="group flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-3 pr-1.5 text-xs text-slate-300 outline-none transition-colors hover:border-emerald-300/30 focus-visible:ring-2 focus-visible:ring-emerald-200/60">
          <Heart aria-hidden className={cn("h-3.5 w-3.5 transition-colors", draft.mobility ? "text-emerald-300" : "text-slate-500")} />
          Mobility routine on non-gym days
          <span className={cn("td-switch relative h-5 w-9 rounded-full", draft.mobility && "td-switch-on")}><span className="td-thumb absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white" /></span>
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{`${plural(swims, "swim")} and ${plural(strength, "strength session")} a week, ${plural(restDays, "rest day")}.`}</p>

      {/* Notes on the week as it stands */}
      {(nudge || !swims || !restDays || bigDays.length > 0) && (
        <div className="relative mt-4 space-y-2">
          {nudge && <p key={nudge.count} className="td-note flex items-center gap-2 text-xs text-cyan-100"><Waves className="h-3.5 w-3.5 shrink-0 text-cyan-300" />Your week keeps at least one swim.</p>}
          {!swims && <p className="td-note flex items-center gap-2 text-xs text-cyan-100"><Waves className="h-3.5 w-3.5 shrink-0 text-cyan-300" />Add at least one swim to save your days.</p>}
          {!restDays && <p className="td-note flex items-center gap-2 text-xs text-amber-100/90"><Moon className="h-3.5 w-3.5 shrink-0 text-amber-200" />Every day has training. A full rest day helps you absorb the work.</p>}
          {bigDays.length > 0 && <p className="td-note flex items-center gap-2 text-xs text-slate-300"><Dumbbell className="h-3.5 w-3.5 shrink-0 text-violet-300" />{bigDays.join(" and ")} {bigDays.length === 1 ? "has" : "have"} two swims and a strength session.</p>}
        </div>
      )}

      {/* Saving */}
      {dirty || phase === "saving" ? (
        <div className="td-bar relative mt-5 flex flex-col gap-3 rounded-2xl border border-cyan-300/20 bg-[linear-gradient(120deg,rgba(87,229,234,0.10),rgba(12,20,28,0.6)_55%,rgba(167,139,250,0.10))] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-white">{numbersChange ? `${plural(swims, "swim")} and ${plural(strength, "strength session")} a week` : "Same sessions, new days"}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-400">
              {numbersChange
                ? `Your plan is ${plural(savedSwims, "swim")} and ${plural(savedStrength, "strength session")} a week now. Saving updates it, and your nutrition and coach follow.`
                : "Your weekly numbers stay as they are."} Weeks already planned keep their sessions.
            </p>
            {error && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-200"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={undo} disabled={phase === "saving"} className="rounded-full text-slate-300 hover:text-white">Undo</Button>
            <Button type="button" onClick={save} disabled={phase === "saving" || !swims}
              className="td-save rounded-full px-5 font-semibold text-slate-950 shadow-[0_10px_30px_rgba(87,229,234,0.28)] hover:-translate-y-0.5">
              {phase === "saving" ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Saving</> : <><Check className="mr-1.5 h-4 w-4" />Save my days</>}
            </Button>
          </div>
        </div>
      ) : fresh ? (
        <div key={justSaved} className="td-bar relative mt-5 flex flex-col gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-emerald-50">
            <span className="td-done grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-300 text-slate-950"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
            <span>Saved. The weeks you generate or re-plan from now on follow these days; weeks already planned keep their sessions.</span>
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={onOpenTraining} className="shrink-0 rounded-full text-emerald-100 hover:bg-emerald-300/10 hover:text-white">
            Open Training<ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/** `chosen`: whether the athlete chose their days (null while that isn't known yet). */
function Header({ chosen }: { chosen: boolean | null }) {
  return (
    <header className="relative flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="td-badge relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white">
          <CalendarDays className="relative h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Training days</p>
          <h3 id="training-days-title" className="mt-0.5 text-lg font-semibold text-white sm:text-xl">Your week, your days</h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">Choose when you swim and lift. Every week you generate or re-plan is built on these days.</p>
        </div>
      </div>
      {chosen !== null && <span key={String(chosen)} className={cn("td-note inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
        chosen ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-400")}>
        <span className={cn("h-1.5 w-1.5 rounded-full", chosen ? "bg-emerald-300" : "bg-slate-500")} />
        {chosen ? "Your days" : "Evenly spread by SwimGPT"}
      </span>}
    </header>
  )
}
