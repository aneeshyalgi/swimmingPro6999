"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, Dumbbell, ListChecks, Maximize2, MoreHorizontal, Plus, RotateCcw,
  Sparkles, Timer, Trash2, Trophy, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Reveal, Tile, useCountUp } from "@/components/dashboard-ui"
import type { GuideEvent } from "@/components/dashboard-guide"
import { DoseChip, GymWorkoutBody, GymWorkoutCard } from "@/components/gym-workout"
import { DayFocus, WorkoutFocus, tileCentre } from "@/components/day-focus"
import { CalendarDay } from "@/components/calendar-day"
import { WorkoutBuilder } from "@/components/workout-builder"
import { Banner, CompletionRow, DayTileSkeleton, ExportWeekButton, GenerationProgress, LoadingLane, TwoColumnFlow, WeekSkeleton, inputClass, shortDate, todayISO } from "@/components/training-ui"
import { cn } from "@/lib/utils"
import { blankDoc, docFromItem, type BuilderDoc } from "@/lib/workout-builder"
import { downloadGymPdf, downloadWeekPdf, gymSavedSchema, gymWeekSchema, mondayISO, shiftWeek, trainingRequest, type GymItem, type GymWeek } from "@/lib/training"

const planSteps = ["Reading your onboarding, meets and check-ins", "Choosing your coach's sessions for this training block", "Matching every movement to your level and equipment", "Personalising warm-ups and mobility", "Adding them to your gym week"]

function Stat({ icon: Icon, label, value, unit, tone }: { icon: typeof Dumbbell; label: string; value: number; unit?: string; tone: string }) {
  const shown = useCountUp(value)
  return (
    <div className="rounded-[20px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone)}><Icon className="h-4 w-4" /></span>
      <p className="mt-4 text-2xl font-bold tabular-nums tracking-tight text-white sm:text-3xl">{shown.toLocaleString()}{unit && <span className="ml-1 text-sm font-medium text-slate-400">{unit}</span>}</p>
      <p className="mt-1 text-xs text-slate-400">{label}</p>
    </div>
  )
}

type Editing = { doc: BuilderDoc; key: string | null; isNew: boolean; token: number }
type DateAction = { mode: "move" | "duplicate"; item: GymItem; date: string }

/**
 * The Workout Library: a strength & dryland calendar that is independent of swim training.
 * `openBuilder`: the dashboard asked for a new workout (its Workout Builder shortcut); `onBuilderOpened` confirms it.
 */
export function WorkoutCalendar({ onChanged, onGuideEvent, openBuilder: builderRequested, onBuilderOpened }: {
  onChanged: () => Promise<void>; onGuideEvent?: (event: GuideEvent) => void; openBuilder?: boolean; onBuilderOpened?: () => void
}) {
  const [weekStart, setWeekStart] = useState(() => mondayISO())
  const [week, setWeek] = useState<GymWeek | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const [armed, setArmed] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [dateAction, setDateAction] = useState<DateAction | null>(null)
  const [deleting, setDeleting] = useState<GymItem | null>(null)
  // The day open in the full-screen view, and the calendar tile it grew out of.
  const [focusDate, setFocusDate] = useState<string | null>(null)
  const [focusOrigin, setFocusOrigin] = useState<{ x: number; y: number } | null>(null)
  // The workout open in the full-screen workout view.
  const [focusSession, setFocusSession] = useState<string | null>(null)
  const inFlight = useRef(false)
  const activeWeek = useRef(weekStart)
  activeWeek.current = weekStart
  const today = todayISO()

  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await trainingRequest(`/gym/week?week_start=${weekStart}`, gymWeekSchema, { signal })
    if (!signal?.aborted && activeWeek.current === weekStart) setWeek(data)
  }, [weekStart])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null); setWeek(null)
    load(controller.signal)
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load workouts.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [load])

  const showWeek = useCallback((data: GymWeek) => { if (activeWeek.current === data.week_start) setWeek(data) }, [])
  /** `quiet`: the control that triggered the save shows its own progress, so skip the success banner. */
  const perform = async (operation: () => Promise<GymWeek | void>, message: string, options: { quiet?: boolean } = {}) => {
    if (inFlight.current) return false
    inFlight.current = true; setBusy(true); setError(null); setNotice(null)
    try {
      const result = await operation()
      if (result) showWeek(result)
      if (!options.quiet) setNotice(message)
      void onChanged()
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't work. Please try again.")
      return false
    } finally {
      inFlight.current = false; setBusy(false)
    }
  }

  const days = week?.days ?? []
  const dayMinutes = (item: GymWeek["days"][number]) => item.workouts.reduce((sum, workout) => sum + workout.workout.estimated_duration_minutes, 0)
  const maxDayMinutes = Math.max(1, ...days.map(dayMinutes))
  const openDays = days.filter((item) => item.date >= today)
  const aiPending = days.flatMap((item) => item.workouts).filter((item) => item.source === "ai" && !item.completed)
  const weekEndLabel = shortDate(new Date(Date.parse(`${shiftWeek(weekStart, 1)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), { day: "numeric", month: "short", year: "numeric" })

  const planWeek = async () => {
    if (aiPending.length && !armed) {
      setArmed(true)
      window.setTimeout(() => setArmed(false), 3500)
      return
    }
    setArmed(false); setPlanning(true)
    onGuideEvent?.("gym-started")
    const saved = await perform(() => trainingRequest("/gym/generate", gymWeekSchema, { body: { week_start: weekStart } }), "Your gym week is ready: strength sessions on spread-out days and mobility on the rest.")
    onGuideEvent?.(saved ? "gym-done" : "gym-failed")
    setPlanning(false)
  }
  const openBuilder = (doc: BuilderDoc, key: string | null, isNew: boolean) => {
    setFocusDate(null)
    setFocusSession(null)
    setEditing({ doc, key, isNew, token: Date.now() })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const newWorkout = (date?: string) => openBuilder(blankDoc(date ?? (openDays[0]?.date ?? weekStart)), null, true)
  // The sidebar's Workout Builder shortcut: once the week has loaded (so the date matches the New workout button), open
  // a new workout. A workout already open in the builder stays open rather than being replaced.
  useEffect(() => {
    if (!builderRequested || loading) return
    onBuilderOpened?.()
    if (!editing) newWorkout()
  })
  const toggle = (item: GymItem) => perform(() => trainingRequest(`/gym/${encodeURIComponent(item.key)}/complete`, gymWeekSchema, { method: item.completed ? "DELETE" : "POST" }),
    item.completed ? `“${item.workout.title}” unticked.` : `Nice work! “${item.workout.title}” is completed.`, { quiet: true })
  const exportPdf = (item: GymItem) => perform(() => downloadGymPdf(item.key, item.workout.title), "PDF downloaded.")
  const exportWeek = async () => {
    setError(null); setNotice(null)
    try {
      await downloadWeekPdf("workouts", weekStart)
      setNotice("Your gym week PDF is downloading.")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The PDF could not be created.")
    }
  }
  const runDateAction = async () => {
    if (!dateAction) return
    const { mode, item, date } = dateAction
    const ok = await perform(async () => mode === "move"
      ? trainingRequest(`/gym/${encodeURIComponent(item.key)}/move`, gymWeekSchema, { body: { date } })
      : (await trainingRequest(`/gym/${encodeURIComponent(item.key)}/duplicate`, gymSavedSchema, { body: { date } })).week,
    `${mode === "move" ? "Moved" : "Duplicated"} to ${shortDate(date, { weekday: "long", day: "numeric", month: "short" })}.`)
    if (ok) {
      setDateAction(null)
      if (date < weekStart || date >= shiftWeek(weekStart, 1)) void load()
    }
  }
  const remove = async () => {
    if (!deleting) return
    const item = deleting
    setDeleting(null)
    await perform(() => trainingRequest(`/gym/${encodeURIComponent(item.key)}`, gymWeekSchema, { method: "DELETE" }), "Workout deleted.")
  }

  if (editing) {
    return <WorkoutBuilder key={editing.token} initial={editing.doc} itemKey={editing.key} isNew={editing.isNew}
      onBack={(saved) => { setEditing(null); if (saved) setNotice("Workout saved."); void load() }}
      onSaved={(data) => { showWeek(data); void onChanged() }}
      onDeleted={(data) => { setEditing(null); showWeek(data); setNotice("Workout deleted."); void onChanged() }}
      onNotice={setNotice} />
  }

  const cardMenu = (item: GymItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Actions for ${item.workout.title}`} className="h-8 w-8 rounded-full"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 border-white/10 bg-[#0d151c]">
        <DropdownMenuItem onSelect={() => setDateAction({ mode: "duplicate", item, date: item.date })}><Copy className="mr-2 h-4 w-4" />Duplicate to…</DropdownMenuItem>
        <DropdownMenuItem disabled={item.completed} onSelect={() => setDateAction({ mode: "move", item, date: item.date })}><CalendarClock className="mr-2 h-4 w-4" />Move to another day</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportPdf(item)}><Download className="mr-2 h-4 w-4" />Export PDF</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={item.completed} className="text-rose-300 focus:text-rose-200" onSelect={() => setDeleting(item)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  type Day = GymWeek["days"][number]
  const dayProgress = (item: Day) => ({ total: item.workouts.length, done: item.workouts.filter((workout) => workout.completed).length })
  /** Open one workout full screen, growing out of the card that was clicked. */
  const openSession = (key: string, element: HTMLElement) => {
    setFocusOrigin(tileCentre(element))
    setFocusDate(null)
    setFocusSession(key)
  }
  /** A day's workouts. `expanded` opens every card and always offers to add another (the full-screen day view); on the
   *  page each card opens full screen instead. */
  const daySessions = (item: Day, expanded = false) => {
    const future = item.date > today
    return (
      <div className="space-y-3">
        {item.workouts.map((workout) => <CompletionRow key={workout.key} checked={workout.completed} locked={future} busy={busy} hint={future ? "You can tick this off on the day" : undefined}
          label={workout.workout.title} onToggle={() => void toggle(workout)}>
          <GymWorkoutCard item={workout} defaultOpen={expanded} onOpen={expanded ? undefined : (event) => openSession(workout.key, event.currentTarget)}
            onEdit={() => openBuilder(docFromItem(workout), workout.key, false)} actions={cardMenu(workout)} />
        </CompletionRow>)}
        {(expanded || !item.workouts.length) && <button type="button" disabled={busy} onClick={() => newWorkout(item.date)} className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-500 transition-all hover:border-violet-300/40 hover:text-violet-100 disabled:opacity-50">
          <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />{item.workouts.length ? `Add another workout for ${item.day_name}` : `Build a workout for ${item.day_name}`}
        </button>}
      </div>
    )
  }
  const focusDay = days.find((item) => item.date === focusDate) ?? null
  const weekSessions = days.flatMap((day) => day.workouts.map((workout) => ({ day, workout })))
  const openWorkout = weekSessions.find((entry) => entry.workout.key === focusSession) ?? null

  return (
    <div className="space-y-5">
      {error && <Banner tone="error" action={<Button size="sm" variant="outline" className="rounded-full border-rose-300/30 bg-transparent" disabled={busy} onClick={() => { setError(null); void load() }}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reload</Button>}>{error}</Banner>}
      {notice && <Banner tone="success" action={<button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded-full p-1 text-emerald-200/70 transition-colors hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>}>{notice}</Banner>}

      <Reveal index={0}>
        <section data-guide="gym-week" aria-busy={loading} className="relative overflow-hidden rounded-[26px] border border-white/[0.08] bg-[linear-gradient(125deg,rgba(167,139,250,0.16),rgba(12,20,28,0.95)_45%,rgba(87,229,234,0.1))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.3)] sm:p-6">
          {loading && <span aria-hidden className="tl-topbar tl-topbar-violet" />}
          <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-violet-400/15 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Gym week</p>
              <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-white sm:text-3xl">{shortDate(weekStart)} – {weekEndLabel}</h2>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                {week && <span className="max-w-full truncate rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-slate-300" title={week.equipment}>{week.equipment.split(":")[0]}</span>}
                {weekStart === mondayISO() && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300">Current week</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-full border border-white/10 bg-black/20 p-1 backdrop-blur-md">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Previous week" disabled={busy || loading} onClick={() => setWeekStart(shiftWeek(weekStart, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs" disabled={busy || loading} onClick={() => setWeekStart(mondayISO())}>This Week</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Next week" disabled={busy || loading} onClick={() => setWeekStart(shiftWeek(weekStart, 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <ExportWeekButton onExport={exportWeek} disabled={!week || loading || planning} />
              <Button variant="outline" disabled={busy || loading} onClick={() => newWorkout()} className="rounded-full border-white/15 bg-white/[0.04]"><Plus className="mr-1.5 h-4 w-4" />New workout</Button>
              <Button data-guide="gym-generate" disabled={busy || loading || !openDays.length} onClick={() => void planWeek()}
                className={cn("rounded-full font-semibold shadow-[0_10px_30px_rgba(167,139,250,0.3)] transition-all hover:-translate-y-0.5", armed ? "bg-amber-300 text-slate-950 hover:bg-amber-200" : "bg-gradient-to-r from-violet-300 to-cyan-300 text-slate-950")}>
                <Sparkles className="mr-2 h-4 w-4" />{armed ? "Tap again to replace AI workouts" : aiPending.length ? "Re-plan with AI" : "Plan my week with AI"}
              </Button>
            </div>
          </div>

          <div className="relative mt-6 grid grid-cols-7 gap-1.5 sm:gap-2">
            {(days.length ? days : Array.from({ length: 7 }, () => null)).map((item, index) => {
              if (!item) return <DayTileSkeleton key={index} index={index} />
              const minutes = dayMinutes(item)
              return (
                <CalendarDay key={item.date} tone="gym" index={index} date={item.date} dayName={item.day_name} isToday={item.date === today} past={item.date < today}
                  level={minutes / maxDayMinutes} amount={minutes ? String(minutes) : null} unit="min" {...dayProgress(item)} emptyLabel="Free"
                  onOpen={(event) => { setFocusOrigin(tileCentre(event.currentTarget)); setFocusDate(item.date) }}
                  icons={item.workouts.length > 0 && <>
                    <Dumbbell className="h-3 w-3 text-violet-200" />
                    {item.workouts.length > 1 && <span className="text-[9px] font-bold text-violet-100">×{item.workouts.length}</span>}
                  </>} />
              )
            })}
          </div>
          {week && <p className="relative mt-3 flex items-center gap-1.5 text-[11px] text-slate-400"><Maximize2 className="h-3 w-3" />Tap a day to open its workouts full screen</p>}
        </section>
      </Reveal>

      {planning && <GenerationProgress title="Planning your gym week" subtitle="Built on the SwimGPT Strength & Mobility System for your coach, level and equipment. Usually under 30 seconds." steps={planSteps} interval={6000} />}

      {loading && !week && <>
        <LoadingLane tone="gym" title="Loading your gym week" messages={["Fetching this week's workouts", "Checking completed sessions", "Matching your equipment"]} />
        <WeekSkeleton />
      </>}
      {week && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Dumbbell, label: "Workouts this week", value: week.summary.sessions, tone: "bg-violet-400/12 text-violet-300" },
          { icon: CheckCircle2, label: "Completed", value: week.summary.completed, tone: "bg-emerald-400/12 text-emerald-300" },
          { icon: Timer, label: "Planned minutes", value: week.summary.minutes, unit: "min", tone: "bg-amber-300/12 text-amber-200" },
          { icon: ListChecks, label: "Exercises", value: week.summary.exercises, tone: "bg-sky-400/12 text-sky-300" },
        ].map((stat, index) => <Reveal key={stat.label} index={1 + index}><Stat {...stat} /></Reveal>)}
      </div>}

      {week && <TwoColumnFlow weights={days.map((item) => 2 + Math.max(1, item.workouts.length) * 1.4)} items={days.map((item, index) => {
          const isToday = item.date === today
          const { total, done } = dayProgress(item)
          return <Reveal key={item.date} index={5 + index}>
            <div id={`gym-day-${item.date}`} className="scroll-mt-32">
              <Tile glow={isToday} className={cn(total > 0 && done === total && "border-emerald-400/30")}>
                <div className="mb-4 flex items-start gap-4">
                  <div className={cn("flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border", isToday ? "border-violet-300/40 bg-violet-400/15" : "border-white/10 bg-white/[0.04]")}>
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wider", isToday ? "text-violet-200" : "text-slate-500")}>{shortDate(item.date, { month: "short" })}</span>
                    <span className="text-xl font-bold leading-none text-white">{Number(item.date.slice(8))}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold tracking-tight text-white">{item.day_name}</h3>
                      {isToday && <span className="rounded-full bg-violet-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950">Today</span>}
                      {total > 0 && <span key={`${done}/${total}`} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-colors duration-500", done > 0 && "chip-pop",
                        done === total ? "border-emerald-300/50 bg-gradient-to-r from-emerald-400/25 to-teal-400/15 text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,0.3)]" : "border-white/10 bg-white/[0.04] text-slate-300")}>
                        {done === total ? <><Trophy className="h-3 w-3 text-amber-200" />Day complete</> : <><CheckCircle2 className="h-3 w-3" />{done}/{total} done</>}
                      </span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{total ? `${item.workouts.reduce((sum, workout) => sum + workout.workout.estimated_duration_minutes, 0)} min of strength work` : "No workout planned"}</p>
                  </div>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => newWorkout(item.date)} className="shrink-0 rounded-full text-slate-400 hover:bg-violet-400/10 hover:text-violet-100"><Plus className="mr-1 h-4 w-4" />Add</Button>
                </div>
                {daySessions(item)}
              </Tile>
            </div>
          </Reveal>
        })} />}

      <Dialog open={!!dateAction} onOpenChange={(open) => { if (!open) setDateAction(null) }}>
        <DialogContent className="border-white/10 bg-[#0d151c] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">{dateAction?.mode === "move" ? "Move to another day" : "Duplicate to…"}</DialogTitle>
            <DialogDescription className="text-slate-400">“{dateAction?.item.workout.title}”</DialogDescription>
          </DialogHeader>
          <Input type="date" aria-label="Date" className={inputClass} value={dateAction?.date ?? ""} onChange={(event) => setDateAction((current) => current && { ...current, date: event.target.value })} />
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setDateAction(null)}>Cancel</Button>
            <Button disabled={!dateAction?.date || busy} onClick={() => void runDateAction()} className="rounded-full bg-violet-300 text-slate-950 hover:bg-violet-200">{dateAction?.mode === "move" ? "Move" : "Duplicate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete this workout?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">“{deleting?.workout.title}” will be removed from your gym week. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-rose-500 text-white hover:bg-rose-400" onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DayFocus tone="gym" eyebrow="Gym week" date={focusDay ? focusDate : null} origin={focusOrigin}
        days={days.map((item) => ({ date: item.date, day_name: item.day_name, ...dayProgress(item) }))}
        onDate={setFocusDate} onClose={() => setFocusDate(null)}
        summary={focusDay && <>
          {focusDay.date === today && <span className="rounded-full bg-violet-300 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-950">Today</span>}
          {focusDay.workouts.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-xs font-semibold tabular-nums text-violet-100"><Timer className="h-3.5 w-3.5" />{focusDay.workouts.reduce((sum, workout) => sum + workout.workout.estimated_duration_minutes, 0)} min</span>}
          {(() => {
            const { total, done } = dayProgress(focusDay)
            if (!total) return null
            return <span key={`${done}/${total}`} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums", done > 0 && "chip-pop",
              done === total ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-300")}>
              {done === total ? <><Trophy className="h-3.5 w-3.5 text-amber-200" />Day complete</> : <><CheckCircle2 className="h-3.5 w-3.5" />{done}/{total} done</>}
            </span>
          })()}
        </>}>
        {focusDay && daySessions(focusDay, true)}
      </DayFocus>

      <WorkoutFocus tone="gym" id={openWorkout ? focusSession : null} origin={focusOrigin}
        sessions={weekSessions.map(({ day, workout }) => ({ id: workout.key, title: workout.workout.title,
          eyebrow: `${shortDate(day.date, { weekday: "short", day: "numeric", month: "short" })} · ${workout.source === "manual" ? "Your workout" : "AI workout"}` }))}
        onSelect={setFocusSession} onClose={() => setFocusSession(null)}
        summary={openWorkout && <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-xs font-semibold tabular-nums text-violet-100"><Timer className="h-3.5 w-3.5" />{openWorkout.workout.workout.estimated_duration_minutes} min</span>
          <DoseChip dose={openWorkout.workout.dose} className="px-3 py-1 text-xs" />
          {openWorkout.workout.completed
            ? <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-100"><CheckCircle2 className="h-3.5 w-3.5" />Completed</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-slate-500" />Not completed</span>}
        </>}>
        {openWorkout && <CompletionRow checked={openWorkout.workout.completed} locked={openWorkout.day.date > today} busy={busy}
          hint={openWorkout.day.date > today ? "You can tick this off on the day" : undefined} label={openWorkout.workout.workout.title} onToggle={() => void toggle(openWorkout.workout)}>
          <div className={cn("rounded-2xl border bg-white/[0.03] p-5 sm:p-6", openWorkout.workout.completed ? "border-emerald-400/25" : "border-violet-400/15")}>
            <GymWorkoutBody item={openWorkout.workout} onEdit={() => openBuilder(docFromItem(openWorkout.workout), openWorkout.workout.key, false)} actions={cardMenu(openWorkout.workout)} />
          </div>
        </CompletionRow>}
      </WorkoutFocus>
    </div>
  )
}
