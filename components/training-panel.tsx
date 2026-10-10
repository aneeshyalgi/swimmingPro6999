"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { z } from "zod"
import {
  Activity, BookMarked, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Download, Dumbbell, MoreHorizontal, Pencil, Trash2,
  Flag, Heart, Layers, LibraryBig, MapPin, Maximize2, Moon, RotateCcw, Sparkles, Star,
  Target, Timer, Trophy, Waves, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SwimWorkoutDetails } from "@/components/swim-workout"
import { CompetitionForm, RaceResultForm } from "@/components/training-forms"
import { GrowBar, Reveal, Tile, TileHeader, useCountUp } from "@/components/dashboard-ui"
import {
  Banner, CompetitionSkeleton, CompletionRow, DayTileSkeleton, EmptyState, ExportWeekButton, Expander, GenerationProgress, LoadingLane, TwoColumnFlow, WeekSkeleton, ZoneChip, ZoneStack, daysUntil, inputClass, labelClass, shortDate,
  todayISO, zoneTone,
} from "@/components/training-ui"
import { WorkoutCalendar } from "@/components/workout-calendar"
import { DayFocus, WorkoutFocus, tileCentre } from "@/components/day-focus"
import { CalendarDay, compactMeters } from "@/components/calendar-day"
import { GUIDE_SUBTAB, type GuideEvent, type GuideTarget } from "@/components/dashboard-guide"
import { TrainingItemEditor, type EditTarget } from "@/components/training-item-editor"
import { cn } from "@/lib/utils"
import {
  competitionSchema, competitionsSchema, downloadSwimPdf, downloadWeekItemPdf, downloadWeekPdf, mondayISO, shiftWeek, timeText, workoutSchema,
  trainingRequest, weekSchema, type Competition, type TrainingWeek, type Workout,
} from "@/lib/training"

type CompetitionData = z.infer<typeof competitionsSchema>
/** A Training Week item that can be duplicated, moved, exported or deleted. */
type WeekItem = { completed: boolean; date: string; title: string } & ({ kind: "swim"; key: string } | { kind: "strength" | "mobility" })

/** Rough height of a Training Week day card, used to balance the two columns. */
const dayWeight = (day: TrainingWeek["days"][number]) => 2.4
  + day.workouts.length * 1.15 + (day.strength ? 1 : 0) + (day.mobility.length ? 1 : 0) + day.competitions.length * 1.1
  + (day.recovery.length ? 0.9 + (day.recovery.join("").length > 60 ? 0.4 : 0) : 0)
  + (day.rest && !day.workouts.length && !day.strength ? 0.7 : 0) + (day.objective.length > 80 ? 0.3 : 0)

const zoneEntries = (zones: Record<string, number>) => Object.entries(zones).map(([label, meters]) => ({ label, meters }))

function StatCard({ icon: Icon, label, value, unit, tone, className }: {
  icon: typeof Waves; label: string; value: number; unit?: string; tone: string; className?: string
}) {
  const shown = useCountUp(value)
  return (
    <div className={cn("group relative overflow-hidden rounded-[20px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15", className)}>
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/0 blur-2xl transition-colors duration-500 group-hover:bg-accent/15" />
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone)}><Icon className="h-4 w-4" /></span>
      <p className="mt-4 text-2xl font-bold tabular-nums tracking-tight text-white sm:text-3xl">
        {shown.toLocaleString()}{unit && <span className="ml-1 text-sm font-medium text-slate-400">{unit}</span>}
      </p>
      <p className="mt-1 text-xs text-slate-400">{label}</p>
    </div>
  )
}

const subTabs = [
  { value: "week", label: "Swim Week", short: "Swim", icon: CalendarDays },
  { value: "library", label: "Gym Week", short: "Gym", icon: LibraryBig },
  { value: "competitions", label: "Competitions", short: "Meets", icon: Trophy },
] as const

/** `guide`: where the dashboard guide is pointing; opens the matching sub-tab so the spotlight can find its button. */
/** `onGuideEvent`: tells the guided setup when the user starts or finishes a step it is walking them through. */
/** `builderRequest`: set when the sidebar's Workout Builder is chosen; opens a new workout in the Gym week, then
 *  `onBuilderOpened` lets the dashboard clear it. */
export function TrainingPanel({ onChanged, guide, onGuideEvent, builderRequest, onBuilderOpened }: {
  onChanged: () => Promise<void>; guide?: GuideTarget | null; onGuideEvent?: (event: GuideEvent) => void
  builderRequest?: number; onBuilderOpened?: () => void
}) {
  const [subTab, setSubTab] = useState<string>(() => (guide ? GUIDE_SUBTAB[guide] : builderRequest ? "library" : "week"))
  // The latest Workout Builder request the Gym week has not opened yet.
  const [pendingBuilder, setPendingBuilder] = useState(builderRequest ?? 0)
  const [seenBuilder, setSeenBuilder] = useState(builderRequest ?? 0)
  if (builderRequest && builderRequest !== seenBuilder) {
    setSeenBuilder(builderRequest)
    setPendingBuilder(builderRequest)
    setSubTab("library")
  }
  const [weekStart, setWeekStart] = useState(() => mondayISO())
  const [week, setWeek] = useState<TrainingWeek | null>(null)
  const [meets, setMeets] = useState<CompetitionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [createMeet, setCreateMeet] = useState(false)
  const [dateAction, setDateAction] = useState<{ mode: "move" | "duplicate"; item: WeekItem; date: string } | null>(null)
  const [deleting, setDeleting] = useState<WeekItem | null>(null)
  const [deletingMeet, setDeletingMeet] = useState<Competition | null>(null)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [quiet, setQuiet] = useState(false)
  // The day open in the full-screen view, and the calendar tile it grew out of.
  const [focusDate, setFocusDate] = useState<string | null>(null)
  const [focusOrigin, setFocusOrigin] = useState<{ x: number; y: number } | null>(null)
  // The workout open in the full-screen workout view.
  const [focusSession, setFocusSession] = useState<string | null>(null)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const activeWeek = useRef(weekStart)
  activeWeek.current = weekStart

  const load = useCallback(async (signal?: AbortSignal) => {
    const [weekData, competitionData] = await Promise.all([
      trainingRequest(`/week?week_start=${weekStart}`, weekSchema, { signal }),
      trainingRequest("/competitions", competitionsSchema, { signal }),
    ])
    if (!mounted.current || signal?.aborted || activeWeek.current !== weekStart) return
    setWeek(weekData); setMeets(competitionData)
  }, [weekStart])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    setLoading(true); setError(null); setWeek(null)
    load(controller.signal)
      .catch((failure: unknown) => { if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : "Unable to load training.") })
      .finally(() => { if (!controller.signal.aborted && mounted.current) setLoading(false) })
    return () => { mounted.current = false; controller.abort() }
  }, [load])

  useEffect(() => {
    if (!guide) return
    setSubTab(GUIDE_SUBTAB[guide])
    setEditing(null)
    if (guide !== "add-meet") setWeekStart(mondayISO())
  }, [guide])

  /** `quiet`: the control that triggered the save shows its own progress, so skip the page banners on success. */
  const perform = async (operation: () => Promise<void>, message: string, options: { quiet?: boolean } = {}): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true; setBusy(true); setQuiet(!!options.quiet); setError(null); setNotice(null)
    let saved = false
    try {
      await operation()
      saved = true
      await load()
      await onChanged()
      if (mounted.current && !options.quiet) setNotice(message)
    } catch (failure) {
      if (mounted.current) setError(`${saved ? "Saved, but refreshing failed. Reload to see the latest data. " : ""}${failure instanceof Error ? failure.message : "Unable to save training data."}`)
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
    return saved
  }

  const mutateState = (item: Workout, change: Partial<Pick<Workout, "favorite" | "template">>) => perform(async () => {
    await trainingRequest(`/library/${encodeURIComponent(item.key)}/state`, workoutSchema, {
      method: "PUT", body: { favorite: item.favorite, template: item.template, ...change },
    })
  }, "Workout preferences saved.")

  const workoutActions = (item: Workout) => (
    <div className="mt-5 space-y-4 border-t border-white/[0.07] pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy || item.completed} onClick={() => openEditor({ kind: "swim", key: item.key, date: item.date ?? "", title: item.workout.title, completed: item.completed })}
                            title={item.completed ? "Untick it to edit" : undefined} className="rounded-full border-accent/30 bg-accent/10 text-cyan-100 hover:bg-accent/20"><Pencil className="mr-1.5 h-4 w-4" />Edit swim</Button>
        <Button size="sm" variant="outline" disabled={busy} aria-pressed={item.favorite} onClick={() => mutateState(item, { favorite: !item.favorite })}
          className={cn("rounded-full border-white/10 bg-white/[0.03]", item.favorite && "border-amber-300/40 bg-amber-300/10 text-amber-100")}>
          <Star className={cn("mr-1.5 h-4 w-4 transition-transform duration-300", item.favorite && "scale-110 fill-amber-300 text-amber-300")} />{item.favorite ? "Favorited" : "Favorite"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} aria-pressed={item.template} onClick={() => mutateState(item, { template: !item.template })}
          className={cn("rounded-full border-white/10 bg-white/[0.03]", item.template && "border-accent/40 bg-accent/10 text-cyan-100")}>
          <BookMarked className="mr-1.5 h-4 w-4" />{item.template ? "Remove Template" : "Save as Template"}
        </Button>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", item.completed ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-slate-400")}>
          {item.completed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />}
          {item.completed ? "Completed as prescribed" : "Not completed"}
        </span>
      </div>
    </div>
  )

  const today = todayISO()
  const weekEnd = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)
  const dayMeters = week?.days.map((day) => day.workouts.reduce((sum, item) => sum + item.distance_meters, 0)) ?? []
  const maxDayMeters = Math.max(1, ...dayMeters)
  const toggleSwim = (item: Workout) => perform(async () => {
    await trainingRequest(`/library/${encodeURIComponent(item.key)}/complete`, workoutSchema, { method: item.completed ? "DELETE" : "POST" })
  }, item.completed ? `“${item.workout.title}” unticked.` : `Nice work! “${item.workout.title}” is completed.`, { quiet: true })
  const toggleMobility = (iso: string, completed: boolean) => perform(async () => {
    await trainingRequest(completed ? "/week/mobility/uncomplete" : "/week/mobility/complete", weekSchema, { body: { date: iso } })
  }, completed ? "Mobility unticked." : "Nice work! Mobility completed.", { quiet: true })
  const toggleLegacyStrength = (iso: string, completed: boolean) => perform(async () => {
    await trainingRequest(completed ? "/week/strength/uncomplete" : "/week/strength/complete", weekSchema, { body: { date: iso } })
  }, completed ? "Strength session unticked." : "Nice work! Strength session completed.", { quiet: true })

  const exportWeek = async () => {
    setError(null); setNotice(null)
    try {
      await downloadWeekPdf("training", weekStart)
      if (mounted.current) setNotice("Your swim week PDF is downloading.")
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "The PDF could not be created.")
    }
  }

  const dayLabel = (iso: string) => shortDate(iso, { weekday: "long", day: "numeric", month: "short" })
  const runDateAction = async () => {
    if (!dateAction) return
    const { mode, item, date } = dateAction
    setDateAction(null)
    if (mode === "move" && date === item.date) return
    await perform(async () => {
      if (item.kind === "swim") await trainingRequest(`/library/${encodeURIComponent(item.key)}/${mode}`, weekSchema, { body: { date } })
      else await trainingRequest(`/week/${item.kind}/${mode}`, weekSchema, { body: { date: item.date, target: date } })
    }, `${mode === "move" ? "Moved" : "Duplicated"} to ${dayLabel(date)}.`)
  }
  const removeItem = async () => {
    if (!deleting) return
    const item = deleting
    setDeleting(null)
    await perform(async () => {
      if (item.kind === "swim") await trainingRequest(`/library/${encodeURIComponent(item.key)}`, weekSchema, { method: "DELETE" })
      else await trainingRequest(`/week/${item.kind}?date=${item.date}`, weekSchema, { method: "DELETE" })
    }, `“${item.title}” deleted.`)
  }
  const removeMeet = async () => {
    if (!deletingMeet) return
    const meet = deletingMeet
    setDeletingMeet(null)
    if (resultKey?.startsWith(`${meet.id}:`)) setResultKey(null)
    await perform(async () => {
      await trainingRequest(`/competitions/${meet.id}`, z.object({ deleted: z.string() }), { method: "DELETE" })
    }, `“${meet.name}” deleted. Your calendar and countdown are updated.`)
  }
  const exportItem = async (item: WeekItem) => {
    setError(null); setNotice(null)
    try {
      if (item.kind === "swim") await downloadSwimPdf(item.key, item.title)
      else await downloadWeekItemPdf(item.kind, item.date, item.title)
      if (mounted.current) setNotice("PDF downloaded.")
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "The PDF could not be created.")
    }
  }
  /** Open a swim, strength session or day of mobility in the full-page editor. */
  const openEditor = (item: WeekItem) => {
    const day = week?.days.find((entry) => entry.date === item.date)
    if (!day || item.completed) return
    setFocusDate(null)
    setFocusSession(null)
    if (item.kind === "swim") {
      const swim = day.workouts.find((entry) => entry.key === item.key)
      if (swim) setEditing({ kind: "swim", key: swim.key, date: day.date, workout: swim.workout })
    } else if (item.kind === "strength" && day.strength) setEditing({ kind: "strength", date: day.date, strength: day.strength })
    else if (item.kind === "mobility" && day.mobility.length) setEditing({ kind: "mobility", date: day.date, dayName: day.day_name, mobility: day.mobility })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const editedItem = (target: EditTarget): WeekItem => target.kind === "swim"
    ? { kind: "swim", key: target.key, date: target.date, title: target.workout.title, completed: false }
    : { kind: target.kind, date: target.date, title: target.kind === "strength" ? target.strength.title : `${target.dayName} mobility`, completed: false }
  const itemMenu = (item: WeekItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" disabled={busy} aria-label={`Actions for ${item.title}`} className="h-8 w-8 rounded-full text-slate-400 hover:text-white"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 border-white/10 bg-[#0d151c]">
        <DropdownMenuItem disabled={item.completed} onSelect={() => openEditor(item)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDateAction({ mode: "duplicate", item, date: item.date })}><Copy className="mr-2 h-4 w-4" />Duplicate to…</DropdownMenuItem>
        <DropdownMenuItem disabled={item.completed} onSelect={() => setDateAction({ mode: "move", item, date: item.date })}><CalendarClock className="mr-2 h-4 w-4" />Move to another day</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportItem(item)}><Download className="mr-2 h-4 w-4" />Export PDF</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={item.completed} className="text-rose-300 focus:text-rose-200" onSelect={() => setDeleting(item)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  type Day = TrainingWeek["days"][number]
  /** Ticked-off progress for a day: each swim, the strength session and the day's mobility count once. */
  const dayProgress = (day: Day) => {
    const hasMobility = day.mobility.length > 0
    return {
      total: day.workouts.length + (day.strength ? 1 : 0) + (hasMobility ? 1 : 0),
      done: day.workouts.filter((item) => item.completed).length + (day.strength && day.strength_completed ? 1 : 0) + (hasMobility && day.mobility_completed ? 1 : 0),
    }
  }

  /** A swim, strength session or day of mobility: what its card, the day view and the workout view each show. */
  type Session = {
    id: string; date: string; label: string; title: string; completed: boolean; className?: string
    header: ReactNode; body: ReactNode; menu: ReactNode; chips: ReactNode; onToggle: () => void
  }
  const chip = (content: ReactNode, tone = "border-white/10 bg-white/[0.04] text-slate-300") =>
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums", tone)}>{content}</span>
  const doneChip = (completed: boolean) => completed
    ? chip(<><CheckCircle2 className="h-3.5 w-3.5" />Completed</>, "border-emerald-300/40 bg-emerald-400/15 text-emerald-100")
    : chip(<><span className="h-1.5 w-1.5 rounded-full bg-slate-500" />Not completed</>)
  const daySessionList = (day: Day): Session[] => {
    const sessions: Session[] = day.workouts.map((item, index) => {
      const label = index === 0 ? "First swim" : index === 1 ? "Second swim" : `Additional swim ${index + 1}`
      return {
        id: `swim:${item.key}`, date: day.date, label, title: item.workout.title, completed: item.completed,
        className: cn(item.completed && "border-emerald-400/25"),
        menu: itemMenu({ kind: "swim", key: item.key, date: day.date, title: item.workout.title, completed: item.completed }),
        onToggle: () => void toggleSwim(item),
        chips: <>{chip(<><Waves className="h-3.5 w-3.5" />{item.distance_meters.toLocaleString()} m</>, "border-accent/25 bg-accent/10 text-cyan-100")}{doneChip(item.completed)}</>,
        header: <div className="flex items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", item.completed ? "bg-emerald-400/15 text-emerald-300" : "bg-accent/12 text-accent")}>{item.completed ? <CheckCircle2 className="h-5 w-5" /> : <Waves className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}{item.completed && " · Completed"}</p>
            <p className="truncate font-semibold text-white">{item.workout.title}</p>
            <ZoneStack className="mt-2 h-1.5" entries={zoneEntries(item.zones)} />
          </div>
          <span className="shrink-0 text-right"><span className="block text-sm font-bold tabular-nums text-cyan-100">{item.distance_meters.toLocaleString()}</span><span className="text-[10px] text-slate-500">metres</span></span>
        </div>,
        body: <><ZoneStack className="mb-5 h-2" entries={zoneEntries(item.zones)} /><SwimWorkoutDetails workout={item.workout} />{workoutActions(item)}</>,
      }
    })
    if (day.strength) {
      const strength = day.strength
      sessions.push({
        id: `strength:${day.date}`, date: day.date, label: "Strength", title: strength.title, completed: day.strength_completed, className: "border-violet-400/15",
        menu: itemMenu({ kind: "strength", date: day.date, title: strength.title, completed: day.strength_completed }),
        onToggle: () => void toggleLegacyStrength(day.date, day.strength_completed),
        chips: <>{chip(<><Clock className="h-3.5 w-3.5" />{strength.estimated_duration_minutes} min</>, "border-violet-300/25 bg-violet-400/10 text-violet-100")}{doneChip(day.strength_completed)}</>,
        header: <div className="flex items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", day.strength_completed ? "bg-emerald-400/15 text-emerald-300" : "bg-violet-400/15 text-violet-300")}><Dumbbell className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Strength</p><p className="truncate font-semibold text-white">{strength.title}</p></div>
          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400"><Clock className="h-3.5 w-3.5" />{strength.estimated_duration_minutes} min</span>
        </div>,
        body: <>
          <p className="text-sm leading-6 text-slate-300">{strength.objective}</p>
          <div className="mt-4 grid gap-3">
            {strength.exercises.map((exercise, i) => <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-semibold text-white">{exercise.exercise}</h5><span className="rounded-full bg-violet-400/15 px-2.5 py-0.5 text-xs font-semibold text-violet-200">{exercise.sets} × {exercise.repetitions}</span></div>
              <p className="mt-2 text-slate-400">{exercise.load} · Rest {exercise.rest_seconds}s{exercise.tempo && ` · Tempo ${exercise.tempo}`}</p>
              <ol className="mt-3 space-y-1.5 text-slate-400">{exercise.demonstration.map((step, j) => <li key={j} className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-bold text-slate-300">{j + 1}</span>{step}</li>)}</ol>
            </div>)}
          </div>
          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <Button size="sm" variant="outline" disabled={busy || day.strength_completed} onClick={() => openEditor({ kind: "strength", date: day.date, title: strength.title, completed: day.strength_completed })}
              title={day.strength_completed ? "Untick it to edit" : undefined} className="rounded-full border-accent/30 bg-accent/10 text-cyan-100 hover:bg-accent/20"><Pencil className="mr-1.5 h-4 w-4" />Edit strength</Button>
          </div>
        </>,
      })
    }
    if (day.mobility.length) {
      const minutes = day.mobility.reduce((sum, item) => sum + item.duration_minutes, 0)
      const count = `${day.mobility.length} exercise${day.mobility.length === 1 ? "" : "s"}`
      sessions.push({
        id: `mobility:${day.date}`, date: day.date, label: "Mobility", title: `${day.day_name} mobility`, completed: day.mobility_completed,
        className: cn("border-emerald-400/15", day.mobility_completed && "border-emerald-400/30"),
        menu: itemMenu({ kind: "mobility", date: day.date, title: `${day.day_name} mobility`, completed: day.mobility_completed }),
        onToggle: () => void toggleMobility(day.date, day.mobility_completed),
        chips: <>{chip(<><Heart className="h-3.5 w-3.5" />{count}</>, "border-emerald-300/25 bg-emerald-400/10 text-emerald-100")}{chip(<><Clock className="h-3.5 w-3.5" />{minutes} min</>)}{doneChip(day.mobility_completed)}</>,
        header: <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">{day.mobility_completed ? <CheckCircle2 className="h-5 w-5" /> : <Heart className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Mobility{day.mobility_completed && " · Completed"}</p><p className="font-semibold text-white">{count}</p></div>
          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400"><Clock className="h-3.5 w-3.5" />{minutes} min</span>
        </div>,
        body: <>
          <div className="grid gap-3">{day.mobility.map((item, i) => <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 text-sm">
            <p className="font-medium text-white">{item.exercise}<span className="ml-2 text-xs font-normal text-slate-500">{item.category} · {item.duration_minutes} min</span></p>
            <ul className="mt-2 space-y-1 text-slate-400">{item.instructions.map((instruction, j) => <li key={j} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-300" />{instruction}</li>)}</ul>
          </div>)}</div>
          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <Button size="sm" variant="outline" disabled={busy || day.mobility_completed} onClick={() => openEditor({ kind: "mobility", date: day.date, title: `${day.day_name} mobility`, completed: day.mobility_completed })}
              title={day.mobility_completed ? "Untick it to edit" : undefined} className="rounded-full border-accent/30 bg-accent/10 text-cyan-100 hover:bg-accent/20"><Pencil className="mr-1.5 h-4 w-4" />Edit mobility</Button>
          </div>
        </>,
      })
    }
    return sessions
  }
  /** Open one workout full screen, growing out of the card that was clicked. */
  const openSession = (id: string, element: HTMLElement) => {
    setFocusOrigin(tileCentre(element))
    setFocusDate(null)
    setFocusSession(id)
  }
  const tickHint = (date: string) => (date > today ? "You can tick this off on the day" : undefined)
  /** `expanded`: the full-screen day view, where every card is open; on the page each card opens full screen instead. */
  const sessionRow = (session: Session, expanded: boolean) => (
    <CompletionRow key={session.id} checked={session.completed} locked={session.date > today} busy={busy} hint={tickHint(session.date)} label={session.title} onToggle={session.onToggle}>
      <Expander className={session.className} actions={session.menu} header={session.header}
        {...(expanded ? { defaultOpen: true } : { onOpen: (event) => openSession(session.id, event.currentTarget) })}>
        {session.body}
      </Expander>
    </CompletionRow>
  )
  /** A day's meets, swims, strength, mobility and recovery. `expanded` opens every card (the full-screen day view). */
  const daySessions = (day: Day, expanded = false) => (
    <div className="space-y-3">
      {day.competitions.map((meet) => <div key={meet.id} className="relative overflow-hidden rounded-2xl border border-amber-400/30 bg-[linear-gradient(135deg,rgba(251,191,36,0.14),rgba(251,191,36,0.03))] p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-amber-100"><Flag className="h-4 w-4 text-amber-300" />{meet.name}<span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">Priority {meet.priority}</span></p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-amber-100/70"><MapPin className="h-3.5 w-3.5" />{meet.location} · {meet.pool_length}m · {meet.events.join(", ")}</p>
      </div>)}
      {day.rest && !day.workouts.length && !day.strength && <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-slate-300"><Moon className="h-5 w-5 text-slate-400" />Rest / recovery day</div>}
      {daySessionList(day).map((session) => sessionRow(session, expanded))}
      {day.recovery.length > 0 && <div className="pt-1">
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recovery</h5>
        <ul className="flex flex-wrap gap-2">{day.recovery.map((item, i) => <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/15 bg-amber-200/[0.06] px-3 py-1 text-xs text-amber-50/80"><Moon className="h-3 w-3 text-amber-200" />{item}</li>)}</ul>
      </div>}
    </div>
  )
  const focusIndex = week?.days.findIndex((day) => day.date === focusDate) ?? -1
  const focusDay = focusIndex >= 0 ? week!.days[focusIndex] : null
  const weekSessions = week?.days.flatMap(daySessionList) ?? []
  const openWorkout = weekSessions.find((session) => session.id === focusSession) ?? null

  const generateWeek = async () => {
    setGenerating(true)
    onGuideEvent?.("swim-started")
    const saved = await perform(async () => {
      await trainingRequest("/week/generate", weekSchema, { body: { week_start: weekStart } })
    }, "Your personalised swim week is ready.")
    onGuideEvent?.(saved ? "swim-done" : "swim-failed")
    if (mounted.current) setGenerating(false)
  }

  return (
    <div className="space-y-6">
      {error && <Banner tone="error" action={<Button size="sm" variant="outline" className="rounded-full border-rose-300/30 bg-transparent" disabled={busy} onClick={() => perform(async () => {}, "Training refreshed.")}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reload</Button>}>{error}</Banner>}
      {notice && <Banner tone="success" action={<button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded-full p-1 text-emerald-200/70 transition-colors hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>}>{notice}</Banner>}
      {busy && !generating && !quiet && <Banner tone="busy">Saving your training data...</Banner>}
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="mb-6 grid h-auto w-full grid-cols-3 gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5 backdrop-blur-xl">
          {subTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}
              className="group h-auto gap-2 rounded-xl border border-transparent py-2.5 text-sm text-slate-400 transition-all duration-300 hover:text-slate-200 data-[state=active]:border-accent/30 data-[state=active]:bg-[linear-gradient(135deg,rgba(87,229,234,0.18),rgba(87,229,234,0.04))] data-[state=active]:text-white data-[state=active]:shadow-[0_8px_24px_rgba(87,229,234,0.12)]">
              <tab.icon className="hidden h-4 w-4 transition-colors group-data-[state=active]:text-accent sm:block" />
              <span className="sm:hidden">{tab.short}</span><span className="hidden sm:inline">{tab.label}</span>
              {tab.value === "competitions" && !!meets?.competitions.length && <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold tabular-nums">{meets.competitions.length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="week" className="mt-0 space-y-5">
          {editing ? <TrainingItemEditor key={editing.kind === "swim" ? editing.key : `${editing.kind}:${editing.date}`} target={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              void perform(async () => {}, "Changes saved.")
            }}
            onExport={() => exportItem(editedItem(editing))}
            onDuplicate={() => { const item = editedItem(editing); setEditing(null); setDateAction({ mode: "duplicate", item, date: item.date }) }}
            onDelete={() => { const item = editedItem(editing); setEditing(null); setDeleting(item) }} /> : <>
          <Reveal index={0}>
            <section data-guide="swim-week" aria-busy={loading} className="relative overflow-hidden rounded-[26px] border border-white/[0.08] bg-[linear-gradient(125deg,rgba(87,229,234,0.14),rgba(12,20,28,0.95)_45%,rgba(56,120,220,0.12))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.3)] sm:p-6">
              {loading && <span aria-hidden className="tl-topbar" />}
              <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-24 right-0 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Swim week</p>
                  <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    {shortDate(weekStart)} – {shortDate(weekEnd, { day: "numeric", month: "short", year: "numeric" })}
                  </h2>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                    {week?.phase && <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 font-medium text-cyan-100"><Layers className="h-3.5 w-3.5" />{week.phase}</span>}
                    {week && <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1", week.generated ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/[0.04] text-slate-400")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", week.generated ? "bg-emerald-300" : "bg-slate-500")} />{week.generated ? "AI week saved" : "Not generated yet"}
                    </span>}
                    {weekStart === mondayISO() && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300">Current week</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-full border border-white/10 bg-black/20 p-1 backdrop-blur-md">
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Previous week" disabled={busy || loading} onClick={() => setWeekStart(shiftWeek(weekStart, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs" disabled={busy || loading} onClick={() => setWeekStart(mondayISO())}>This Week</Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Next week" disabled={busy || loading} onClick={() => setWeekStart(shiftWeek(weekStart, 1))}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                  <ExportWeekButton onExport={exportWeek} disabled={!week || loading || generating} />
                  {!week?.generated && week && <Button data-guide="swim-generate" disabled={busy || loading} onClick={generateWeek} className="rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 font-semibold text-slate-950 shadow-[0_10px_30px_rgba(87,229,234,0.3)] transition-transform hover:-translate-y-0.5 hover:from-cyan-200 hover:to-sky-300"><Sparkles className="mr-2 h-4 w-4" />Generate Swim Week</Button>}
                </div>
              </div>

              <div className="relative mt-6 grid grid-cols-7 gap-1.5 sm:gap-2">
                {(week?.days ?? Array.from({ length: 7 }, () => null)).map((day, idx) => {
                  if (!day) return <DayTileSkeleton key={idx} index={idx} />
                  const meters = dayMeters[idx]
                  const isRest = day.rest && !day.workouts.length && !day.strength
                  return (
                    <CalendarDay key={day.date} tone="swim" index={idx} date={day.date} dayName={day.day_name} isToday={day.date === today} past={day.date < today}
                      level={meters / maxDayMeters} amount={meters ? compactMeters(meters) : null} unit="metres" {...dayProgress(day)}
                      emptyLabel={day.competitions.length ? "Meet" : day.strength ? "Gym" : day.mobility.length ? "Mobility" : isRest ? "Rest" : "Free"}
                      onOpen={(event) => { setFocusOrigin(tileCentre(event.currentTarget)); setFocusDate(day.date) }}
                      icons={<>
                        {day.competitions.length > 0 && <Flag className="h-3 w-3 text-amber-300" />}
                        {day.strength && <Dumbbell className={cn("h-3 w-3", day.strength_completed ? "text-emerald-300" : "text-violet-300")} />}
                        {day.mobility.length > 0 && <Heart className="hidden h-3 w-3 text-emerald-300 sm:block" />}
                        {isRest && <Moon className="h-3 w-3 text-slate-400" />}
                      </>} />
                  )
                })}
              </div>
              {week && <p className="relative mt-3 flex items-center gap-1.5 text-[11px] text-slate-400"><Maximize2 className="h-3 w-3" />Tap a day to open its sessions full screen</p>}
            </section>
          </Reveal>
          {generating && <GenerationProgress title="Your coach is building this week" subtitle="This usually takes 20–40 seconds. Every session is checked against your onboarding before it's saved." steps={generationSteps} />}
          <p className="px-1 text-xs text-slate-500">Monday-Sunday · Calendar dates use UTC · Totals are planned, not proof of completion. Saved sessions and scheduled workouts are preserved.</p>

          {loading && !week && <>
            <LoadingLane tone="swim" title="Loading your swim week" messages={["Fetching this week's sessions", "Syncing completed swims", "Lining up your competitions", "Adding up volume and zones"]} />
            <WeekSkeleton />
          </>}
          {week && <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { icon: Waves, label: "Weekly swim volume", value: week.summary.swim_volume_meters, unit: "m", tone: "bg-accent/12 text-accent", className: "" },
                { icon: Activity, label: "Swim sessions", value: week.summary.swim_sessions, tone: "bg-sky-400/12 text-sky-300" },
                { icon: Heart, label: "Mobility days", value: week.summary.mobility_sessions, tone: "bg-emerald-400/12 text-emerald-300" },
                { icon: Timer, label: "Planned duration", value: week.summary.duration_minutes, unit: "min", tone: "bg-amber-300/12 text-amber-200" },
              ].map((stat, idx) => <Reveal key={stat.label} index={idx + 1} className={stat.className}><StatCard {...stat} className="h-full" /></Reveal>)}
            </div>
            {!week.generated && <Reveal index={6}>
              <EmptyState icon={Sparkles} title="No AI week saved for these dates" body="Your existing sessions, manual workouts and competitions are shown below. Generate a week to fill the remaining onboarding availability."
                action={<Button disabled={busy || loading} onClick={generateWeek} className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90"><Sparkles className="mr-2 h-4 w-4" />Generate Swim Week</Button>} />
            </Reveal>}
            {week.coaching_note && <Reveal index={6}>
              <Tile glow>
                <div className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/30 to-sky-500/20 shadow-[0_0_24px_rgba(87,229,234,0.25)]"><Sparkles className="h-5 w-5 text-accent" /></span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">{week.phase || "Weekly coaching focus"}</p>
                    <p className="mt-2 text-sm leading-7 text-slate-200">{week.coaching_note}</p>
                  </div>
                </div>
              </Tile>
            </Reveal>}
            <div className="grid gap-5 lg:grid-cols-2">
              <Reveal index={7}>
                <Tile>
                  <TileHeader icon={Activity} title="Training-zone distribution" subtitle="Planned swim volume by intensity" />
                  {week.zones.length ? <div className="space-y-4">
                    <ZoneStack className="h-3" entries={week.zones.map((zone) => ({ label: zone.zone, meters: zone.meters }))} />
                    {week.zones.map((zone) => <div key={zone.zone}>
                      <div className="mb-1.5 flex justify-between gap-2 text-sm"><span className="flex items-center gap-2 font-medium text-slate-200"><span className={cn("h-2 w-2 rounded-full", zoneTone(zone.zone).solid)} />{zone.zone}</span><span className="text-slate-400">{zone.meters.toLocaleString()} m · <span className="font-semibold text-white">{zone.percentage}%</span></span></div>
                      <GrowBar percent={zone.percentage} barClassName={cn("bg-gradient-to-r", zoneTone(zone.zone).bar)} />
                    </div>)}
                  </div> : <p className="text-sm text-slate-500">No swim sets scheduled.</p>}
                </Tile>
              </Reveal>
              <Reveal index={8}>
                <Tile>
                  <TileHeader icon={Layers} title="Session composition" subtitle="Composition tags may overlap (for example, a race-pace kick set). Zone volume is counted once." />
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {week.composition.map((item) => {
                      const max = Math.max(1, ...week.composition.map((entry) => entry.meters))
                      return <div key={item.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 transition-colors hover:border-white/15">
                        <div className="flex items-baseline justify-between gap-2 text-sm"><span className="text-slate-300">{item.label}</span><span className="font-semibold tabular-nums text-cyan-100">{item.meters.toLocaleString()} m</span></div>
                        <GrowBar className="mt-2 h-1.5" percent={(item.meters / max) * 100} />
                      </div>
                    })}
                  </div>
                </Tile>
              </Reveal>
            </div>

            <p className="flex items-center gap-2 px-1 text-xs text-slate-500"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />Tick off each swim and strength workout as you finish it. Tap again to untick.</p>
            <TwoColumnFlow weights={week.days.map(dayWeight)} items={week.days.map((day, dayIndex) => {
                const isToday = day.date === today
                const { total, done } = dayProgress(day)
                return <Reveal key={day.date} index={9 + dayIndex}>
                  <div id={`day-${day.date}`} className="scroll-mt-32">
                    <Tile glow={isToday} className={cn(total > 0 && done === total && "border-emerald-400/30")}>
                      <div className="mb-4 flex items-start gap-4">
                        <div className={cn("flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border", isToday ? "border-accent/40 bg-accent/15" : "border-white/10 bg-white/[0.04]")}>
                          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", isToday ? "text-accent" : "text-slate-500")}>{shortDate(day.date, { month: "short" })}</span>
                          <span className="text-xl font-bold leading-none text-white">{Number(day.date.slice(8))}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold tracking-tight text-white">{day.day_name}</h3>
                            {isToday && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-foreground">Today</span>}
                            {dayMeters[dayIndex] > 0 && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">{dayMeters[dayIndex].toLocaleString()} m</span>}
                            {total > 0 && <span key={`${done}/${total}`} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-colors duration-500", done > 0 && "chip-pop",
                              done === total ? "border-emerald-300/50 bg-gradient-to-r from-emerald-400/25 to-teal-400/15 text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,0.3)]" : "border-white/10 bg-white/[0.04] text-slate-300")}>
                              {done === total ? <><Trophy className="h-3 w-3 text-amber-200" />Day complete</> : <><CheckCircle2 className="h-3 w-3" />{done}/{total} done</>}
                            </span>}
                          </div>
                          <p className="mt-1 text-sm leading-6 text-slate-400">{day.objective}</p>
                        </div>
                      </div>
                      {daySessions(day)}
                    </Tile>
                  </div>
                </Reveal>
              })} />
          </>}
          </>}
        </TabsContent>

        <TabsContent value="library" className="mt-0 space-y-5">
          <WorkoutCalendar onChanged={onChanged} onGuideEvent={onGuideEvent} openBuilder={pendingBuilder > 0} onBuilderOpened={() => { setPendingBuilder(0); onBuilderOpened?.() }} />
        </TabsContent>

        <TabsContent value="competitions" className="mt-0 space-y-5">
          <Reveal index={0}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl"><h3 className="text-xl font-semibold tracking-tight text-white">Competitions &amp; Race Analysis</h3><p className="mt-1.5 text-sm leading-6 text-slate-400">Enter your real meet schedule. Race plans use your matching-course onboarding goals and PBs; saved results distinguish actual performance from targets.</p></div>
              <Button data-guide="add-meet" disabled={busy || loading || !meets} onClick={() => { if (!createMeet) onGuideEvent?.("meet-form-opened"); setCreateMeet(!createMeet) }} className={cn("rounded-full font-semibold transition-transform hover:-translate-y-0.5", createMeet ? "border border-white/15 bg-white/[0.06] text-white hover:bg-white/10" : "bg-gradient-to-r from-amber-200 to-orange-300 text-slate-950 shadow-[0_10px_30px_rgba(251,191,36,0.25)]")}>
                {createMeet ? <X className="mr-2 h-4 w-4" /> : <CalendarDays className="mr-2 h-4 w-4" />}{createMeet ? "Close Form" : "Add Competition"}
              </Button>
            </div>
          </Reveal>
          {createMeet && meets && <div data-guide="meet-form" className="dash-reveal"><Tile glow><TileHeader icon={Trophy} title="Competition entry" subtitle="Your onboarding events are preselected" /><CompetitionForm events={meets.events} mainEvents={meets.main_events} poolLength={meets.default_pool_length} busy={busy} onSave={(payload) => perform(async () => {
            await trainingRequest("/competitions", competitionSchema, { body: payload })
            setCreateMeet(false)
          }, "Competition saved. Dashboard countdown and weekly calendar updated.").then((saved) => { if (saved) onGuideEvent?.("meet-saved") })} /></Tile></div>}
          {loading && !meets && <>
            <LoadingLane tone="meets" title="Loading your competitions" messages={["Opening your meet calendar", "Pulling race plans", "Checking results against targets"]} />
            <CompetitionSkeleton />
          </>}
          {meets?.competitions.map((meet, idx) => <Reveal key={meet.id} index={1 + idx}><CompetitionCard meet={meet} busy={busy} resultKey={resultKey} setResultKey={setResultKey} onDelete={() => setDeletingMeet(meet)} perform={async (operation, message) => { await perform(operation, message) }} /></Reveal>)}
          {!loading && !meets?.competitions.length && <EmptyState icon={Trophy} title="No competitions recorded" body="Add a meet to build race-specific plans and track planned versus actual results." />}
        </TabsContent>
      </Tabs>

      <Dialog open={!!dateAction} onOpenChange={(open) => { if (!open) setDateAction(null) }}>
        <DialogContent className="border-white/10 bg-[#0d151c] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">{dateAction?.mode === "move" ? "Move to another day" : "Duplicate to…"}</DialogTitle>
            <DialogDescription className="text-slate-400">
              “{dateAction?.item.title}”{dateAction && dateAction.item.kind !== "swim" && " · can go on any day of a generated swim week."}
            </DialogDescription>
          </DialogHeader>
          <Input type="date" aria-label="Date" className={inputClass} value={dateAction?.date ?? ""} onChange={(event) => setDateAction((current) => current && { ...current, date: event.target.value })} />
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setDateAction(null)}>Cancel</Button>
            <Button disabled={!dateAction?.date || busy} onClick={() => void runDateAction()} className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90">{dateAction?.mode === "move" ? "Move" : "Duplicate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete this {deleting?.kind === "swim" ? "swim" : deleting?.kind === "strength" ? "strength session" : "mobility work"}?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">“{deleting?.title}” will be removed from your swim week. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-rose-500 text-white hover:bg-rose-400" onClick={() => void removeItem()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingMeet} onOpenChange={(open) => { if (!open) setDeletingMeet(null) }}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete this competition?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-400">
                <p>“{deletingMeet?.name}” on {deletingMeet && shortDate(deletingMeet.date, { day: "numeric", month: "long", year: "numeric" })} will be removed from your competitions, calendar and countdown.</p>
                {!!deletingMeet && (deletingMeet.races.length > 0 || deletingMeet.results.length > 0) && (
                  <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-amber-100">
                    {(() => {
                      const results = deletingMeet.results.length
                      const plans = deletingMeet.races.length > 0 ? "Its race plans" : ""
                      if (!results) return "Its race plans are deleted too."
                      const recorded = results === 1 ? "the result you recorded there" : `the ${results} results you recorded there`
                      return `${plans ? `${plans} and ${recorded} are` : `${recorded.charAt(0).toUpperCase()}${recorded.slice(1)} ${results === 1 ? "is" : "are"}`} deleted too, so ${results === 1 ? "it leaves" : "they leave"} your race history and PBs.`
                    })()}
                  </p>
                )}
                <p>Swim weeks you&apos;ve already generated keep their sessions. This can&apos;t be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-rose-500 text-white hover:bg-rose-400" onClick={() => void removeMeet()}>Delete competition</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DayFocus tone="swim" eyebrow="Swim week" date={focusDay ? focusDate : null} origin={focusOrigin}
        days={(week?.days ?? []).map((day) => ({ date: day.date, day_name: day.day_name, ...dayProgress(day) }))}
        onDate={setFocusDate} onClose={() => setFocusDate(null)}
        summary={focusDay && <>
          {focusDay.date === today && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-accent-foreground">Today</span>}
          {dayMeters[focusIndex] > 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold tabular-nums text-cyan-100"><Waves className="h-3.5 w-3.5" />{dayMeters[focusIndex].toLocaleString()} m</span>}
          {(() => {
            const { total, done } = dayProgress(focusDay)
            if (!total) return null
            return <span key={`${done}/${total}`} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums", done > 0 && "chip-pop",
              done === total ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-300")}>
              {done === total ? <><Trophy className="h-3.5 w-3.5 text-amber-200" />Day complete</> : <><CheckCircle2 className="h-3.5 w-3.5" />{done}/{total} done</>}
            </span>
          })()}
        </>}>
        {focusDay && <>
          {focusDay.objective && <p className="mb-6 text-[15px] leading-7 text-slate-300">{focusDay.objective}</p>}
          {daySessions(focusDay, true)}
          {!focusDay.competitions.length && !focusDay.workouts.length && !focusDay.strength && !focusDay.mobility.length && !focusDay.rest && !focusDay.recovery.length &&
            <EmptyState icon={CalendarDays} title="Nothing planned for this day" body={week?.generated ? "This day has no sessions in your swim week." : "Generate your swim week to fill this day with sessions."} />}
        </>}
      </DayFocus>

      <WorkoutFocus tone="swim" id={openWorkout ? focusSession : null} origin={focusOrigin}
        sessions={weekSessions.map((session) => ({ id: session.id, title: session.title, eyebrow: `${shortDate(session.date, { weekday: "short", day: "numeric", month: "short" })} · ${session.label}` }))}
        onSelect={setFocusSession} onClose={() => setFocusSession(null)} summary={openWorkout?.chips}>
        {openWorkout && <CompletionRow checked={openWorkout.completed} locked={openWorkout.date > today} busy={busy} hint={tickHint(openWorkout.date)} label={openWorkout.title} onToggle={openWorkout.onToggle}>
          <div className={cn("rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6", openWorkout.className)}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{openWorkout.completed ? "Ticked off" : openWorkout.date > today ? "Tick it off on the day" : "Tick it off when you finish"}</p>
              {openWorkout.menu}
            </div>
            {openWorkout.body}
          </div>
        </CompletionRow>}
      </WorkoutFocus>
    </div>
  )
}

const generationSteps = [
  "Reading your onboarding profile and goals",
  "Applying your coach's methods",
  "Laying out the week around your availability",
  "Writing each swim session",
  "Building strength work for your equipment",
  "Checking volume, pool length and session timing",
]

const priorityTones: Record<string, string> = {
  A: "border-amber-300/40 bg-amber-300/15 text-amber-100",
  B: "border-accent/40 bg-accent/10 text-cyan-100",
  C: "border-white/15 bg-white/[0.05] text-slate-300",
}

function CompetitionCard({ meet, busy, resultKey, setResultKey, onDelete, perform }: {
  meet: Competition; busy: boolean; resultKey: string | null
  setResultKey: (key: string | null) => void
  onDelete: () => void
  perform: (operation: () => Promise<void>, message: string) => Promise<void>
}) {
  const past = meet.date < new Date().toISOString().slice(0, 10)
  const days = daysUntil(meet.date)
  return <div className={cn("relative overflow-hidden rounded-[24px] border bg-[linear-gradient(160deg,rgba(22,32,42,0.85),rgba(10,15,21,0.94))] shadow-[0_14px_40px_rgba(0,0,0,0.28)]", meet.priority === "A" && !past ? "border-amber-300/25" : "border-white/[0.08]")}>
    {!past && <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-amber-300/10 blur-3xl" />}
    <div className="relative flex flex-wrap items-start gap-4 border-b border-white/[0.06] p-5 sm:p-6">
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
        <span className={cn("w-full py-0.5 text-center text-[10px] font-bold uppercase tracking-wider", past ? "bg-white/10 text-slate-300" : "bg-amber-300/80 text-slate-950")}>{shortDate(meet.date, { month: "short" })}</span>
        <span className="flex-1 pt-1 text-2xl font-bold leading-none text-white">{Number(meet.date.slice(8))}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="text-xl font-semibold tracking-tight text-white">{meet.name}</h4>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-400"><MapPin className="h-3.5 w-3.5" />{meet.location} · {shortDate(meet.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium">
          <span className={cn("rounded-full border px-2.5 py-0.5", priorityTones[meet.priority] ?? priorityTones.C)}>Priority {meet.priority}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-slate-300">{meet.pool_length === 25 ? "SCM · 25m" : "LCM · 50m"}</span>
          <span className={cn("rounded-full border px-2.5 py-0.5", past ? "border-white/10 text-slate-400" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200")}>{past ? "Past competition" : "Upcoming / today"}</span>
        </div>
      </div>
      {!past && <div className="text-right"><p className="text-3xl font-bold tabular-nums text-white">{days <= 0 ? "Today" : days}</p>{days > 0 && <p className="text-xs text-slate-400">day{days === 1 ? "" : "s"} to go</p>}</div>}
      <button type="button" onClick={onDelete} disabled={busy} aria-label={`Delete ${meet.name}`} title="Delete competition"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-slate-400 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200 disabled:pointer-events-none disabled:opacity-40">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
    <div className="relative p-5 sm:p-6">
      {!meet.races.length && <Button size="sm" className="mb-5 rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 font-semibold text-slate-950" disabled={busy} onClick={() => perform(async () => {
        await trainingRequest(`/competitions/${meet.id}/plan`, competitionSchema, { method: "POST" })
      }, "Race plans saved from your onboarding data and your coach's methods.")}><Sparkles className="mr-1.5 h-4 w-4" />Generate Individual Race Plans</Button>}
      <TwoColumnFlow gap={4} weights={meet.events.map((event) => (meet.races.some((item) => item.event === event) ? 3 : 1) + (meet.results.some((item) => item.result.event === event) ? 2 : 0))}
        items={meet.events.map((event) => {
          const race = meet.races.find((item) => item.event === event)
          const result = meet.results.find((item) => item.result.event === event)
          const key = `${meet.id}:${event}`
          const delta = result?.analysis.delta_seconds ?? null
          return <div key={event} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h4 className="text-lg font-semibold text-cyan-100">{event}</h4>
              {race && <div className="text-right"><p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Recorded goal / PB target</p><p className="text-2xl font-bold tabular-nums text-white">{race.target_time || "Not recorded"}</p></div>}
            </div>
            {race ? <div className="mt-4 space-y-4 text-sm">
              {!!race.target_splits.length && <div><h5 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Planned segment splits</h5><div className="flex flex-wrap items-center gap-1.5">{race.target_splits.map((split, i) => <span key={i} className="flex items-center gap-1.5"><span className="rounded-xl border border-accent/20 bg-accent/[0.07] px-2.5 py-1 text-xs"><span className="text-slate-400">{split.distance_meters}m</span> <span className="font-semibold tabular-nums text-white">{timeText(split.seconds)}</span></span>{i < race.target_splits.length - 1 && <ChevronRight className="h-3 w-3 text-slate-600" />}</span>)}</div></div>}
              <div><h5 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Race strategy</h5><p className="mt-1.5 whitespace-pre-line leading-6 text-slate-300">{race.race_strategy}</p></div>
              <dl className="grid gap-2 sm:grid-cols-3">{[["Stroke rate", race.stroke_rate_target], ["Underwaters", race.underwater_target], ["Breakout", race.breakout_target]].map(([label, value]) => <div key={label} className="rounded-xl bg-black/20 p-3"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-1 leading-5 text-slate-200">{value || "Not measured / no numeric target"}</dd></div>)}</dl>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><h5 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Technical cues</h5><ul className="mt-2 space-y-1.5 text-slate-400">{race.technical_cues.map((cue, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{cue}</li>)}</ul></div>
                <div><h5 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Mental cues</h5><ul className="mt-2 space-y-1.5 text-slate-400">{race.mental_cues.map((cue, i) => <li key={i} className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />{cue}</li>)}</ul></div>
              </div>
            </div> : <p className="mt-3 text-sm text-slate-500">No saved race plan. Generate one above; results can be recorded independently.</p>}
            {result && <div className="dash-reveal mt-5 space-y-3 rounded-2xl border border-emerald-400/25 bg-[linear-gradient(135deg,rgba(52,211,153,0.12),rgba(52,211,153,0.02))] p-4 text-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h5 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Actual race result</h5><p className="text-3xl font-bold tabular-nums text-white">{result.result.final_time}</p></div>
                <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", delta === null ? "bg-white/10 text-slate-300" : delta <= 0 ? "bg-emerald-400/20 text-emerald-100" : "bg-rose-400/20 text-rose-100")}>
                  Versus planned target: {delta === null ? "No target recorded" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}s (actual - planned)`}
                </span>
              </div>
              <p className="font-medium text-slate-200">{result.analysis.pb_status}</p>
              {result.analysis.previous_best_seconds !== null && <p className="text-slate-400">Previous best: {timeText(result.analysis.previous_best_seconds)}</p>}
              <p className="text-slate-400">Ranking: {result.result.ranking ?? "Not recorded"} · Stroke rate: {result.result.stroke_rate === null ? "Not recorded" : `${result.result.stroke_rate} cycles/min`}</p>
              {!!result.result.splits.length && <p className="text-slate-400">Actual segments: {result.result.splits.map((split) => `${split.distance_meters}m ${timeText(split.seconds)}`).join(" · ")}</p>}
              {!!result.analysis.split_comparison.length && <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/20"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2.5 font-medium">Segment</th><th className="p-2.5 font-medium">Planned</th><th className="p-2.5 font-medium">Actual</th><th className="p-2.5 font-medium">Delta</th></tr></thead><tbody>{result.analysis.split_comparison.map((split, i) => <tr key={i} className="border-t border-white/[0.06] tabular-nums"><td className="p-2.5 text-slate-300">{split.distance_meters}m</td><td className="p-2.5 text-slate-300">{timeText(split.planned_seconds)}</td><td className="p-2.5 text-white">{timeText(split.actual_seconds)}</td><td className={cn("p-2.5 font-semibold", split.delta_seconds <= 0 ? "text-emerald-300" : "text-rose-300")}>{split.delta_seconds > 0 ? "+" : ""}{split.delta_seconds.toFixed(2)}s</td></tr>)}</tbody></table></div>}
              {result.result.underwaters && <p className="text-slate-400">Underwaters: {result.result.underwaters}</p>}
              {result.result.feedback && <p className="whitespace-pre-line text-slate-400">Feedback: {result.result.feedback}</p>}
              <h6 className="pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Training focus from this result</h6><ul className="space-y-1.5 text-slate-300">{result.analysis.training_focus.map((focus, i) => <li key={i} className="flex gap-2"><Target className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />{focus}</li>)}</ul>
              {!!result.analysis.warnings.length && <ul className="space-y-1 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-amber-100">{result.analysis.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
            </div>}
            {meet.date <= new Date().toISOString().slice(0, 10) ? <Button className="mt-4 rounded-full border-white/10 bg-white/[0.03]" size="sm" variant="outline" disabled={busy} onClick={() => setResultKey(resultKey === key ? null : key)}>{resultKey === key ? "Close Result Form" : result ? "Edit Actual Result" : "Record Actual Result"}</Button> : <p className="mt-4 text-xs text-slate-500">Actual results can be entered on or after race day.</p>}
            {resultKey === key && <div className="dash-reveal mt-4 border-t border-white/[0.07] pt-4"><RaceResultForm key={`${key}:${result?.result.final_time || "new"}`} meet={meet} event={event} busy={busy} onSave={(payload) => perform(async () => {
              await trainingRequest(`/competitions/${meet.id}/results`, competitionSchema, { body: payload })
              setResultKey(null)
            }, "Actual result and race comparison saved.")} /></div>}
          </div>
        })} />
    </div>
  </div>
}
