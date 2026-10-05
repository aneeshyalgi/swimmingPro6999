"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, Clock, Copy, Download, Dumbbell, Heart, Loader2, MoreHorizontal, Plus, Save,
  Trash2, Waves, type LucideIcon,
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
import { useCountUp } from "@/components/dashboard-ui"
import { AutoTextarea, IconButton } from "@/components/workout-builder"
import { ZoneStack, inputClass, shortDate, zoneTone } from "@/components/training-ui"
import { cn } from "@/lib/utils"
import { trainingRequest, weekSchema, type SwimWorkout, type TrainingWeek } from "@/lib/training"

type Strength = NonNullable<TrainingWeek["days"][number]["strength"]>
type Mobility = TrainingWeek["days"][number]["mobility"][number]

/** A Training Week item opened in the editor. */
export type EditTarget =
  | { kind: "swim"; key: string; date: string; workout: SwimWorkout }
  | { kind: "strength"; date: string; strength: Strength }
  | { kind: "mobility"; date: string; dayName: string; mobility: Mobility[] }

type Handlers = {
  onClose: () => void
  onSaved: () => void
  onExport: () => Promise<void>
  onDuplicate: () => void
  onDelete: () => void
}

const fieldLabel = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"
const cellInput = "h-9 rounded-lg border-white/10 bg-black/20 px-2.5 text-sm font-normal normal-case tracking-normal text-slate-100 transition-colors hover:border-white/20 focus-visible:border-accent/60 focus-visible:ring-accent/20"
const uid = () => Math.random().toString(36).slice(2, 10)
const commaList = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean)
const lineList = (text: string) => text.split("\n").map((item) => item.trim()).filter(Boolean)
const number = (value: string) => (value === "" ? 0 : Number(value))
const move = <T,>(items: T[], index: number, direction: number) => {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function Stat({ label, value, unit, big }: { label: string; value: number; unit?: string; big?: boolean }) {
  const shown = useCountUp(value, 500)
  return (
    <div className={cn(big && "text-right")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={cn("font-bold tabular-nums tracking-tight text-white", big ? "text-4xl sm:text-5xl" : "text-2xl")}>{shown.toLocaleString()}{unit && <span className="ml-1 text-sm font-medium text-slate-400">{unit}</span>}</p>
    </div>
  )
}

/** Toolbar, document frame, validation and the unsaved-changes guard shared by the three editors. */
function EditorShell({ icon: Icon, label, tone, date, dirty, issues, save, handlers, title, stats, children }: {
  icon: LucideIcon; label: string; tone: string; date: string; dirty: boolean; issues: string[]
  save: () => Promise<unknown>; handlers: Handlers; title: ReactNode; stats: ReactNode; children: ReactNode
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showIssues, setShowIssues] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [discard, setDiscard] = useState<null | (() => void)>(null)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const run = async (): Promise<boolean> => {
    if (issues.length) { setShowIssues(true); window.scrollTo({ top: 0, behavior: "smooth" }); return false }
    setSaving(true); setError(null)
    try {
      await save()
      dirtyRef.current = false
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your changes could not be saved.")
      return false
    } finally { setSaving(false) }
  }
  const saveAndClose = async () => { if (!dirty) return handlers.onClose(); if (await run()) handlers.onSaved() }
  /** Leave the editor; unsaved changes are only dropped after the athlete confirms. */
  const leave = (action: () => void) => (dirtyRef.current ? setDiscard(() => action) : action())
  const exportPdf = async () => {
    setExporting(true)
    try {
      if (dirty && !(await run())) return
      await handlers.onExport()
    } finally { setExporting(false) }
  }
  const saveRef = useRef(saveAndClose)
  saveRef.current = saveAndClose

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveRef.current() }
    }
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("keydown", keys)
    window.addEventListener("beforeunload", unload)
    return () => { window.removeEventListener("keydown", keys); window.removeEventListener("beforeunload", unload) }
  }, [])
  useEffect(() => { if (!issues.length) setShowIssues(false) }, [issues.length])

  return (
    <div className="dash-reveal space-y-5">
      <div className="sticky top-[124px] z-30 lg:top-[72px]">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0b1218]/85 px-3 py-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-4">
          <Button variant="ghost" onClick={() => leave(handlers.onClose)} className="h-9 rounded-full px-3 text-slate-300 hover:text-white"><ArrowLeft className="mr-1.5 h-4 w-4" />Swim week</Button>
          <span className="hidden h-5 w-px bg-white/10 sm:block" />
          <p className="flex items-center gap-2 text-sm font-semibold text-white"><Icon className={cn("h-4 w-4", tone)} /><span className="hidden sm:inline">{label}</span></p>
          <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
            {saving ? <Loader2 className="h-3 w-3 animate-spin text-cyan-300" /> : <span className={cn("h-1.5 w-1.5 rounded-full", dirty ? "animate-pulse bg-amber-300" : "bg-emerald-400")} />}
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "No changes"}
          </span>
          <span className="hidden text-[11px] text-slate-500 md:inline">{shortDate(date, { weekday: "long", day: "numeric", month: "short" })}</span>
          <span className="flex-1" />
          <Button onClick={() => void saveAndClose()} disabled={saving} title="Save and return to the swim week (Ctrl+S)" className="h-9 rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 px-4 font-semibold text-slate-950">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : dirty ? <Save className="mr-1.5 h-4 w-4" /> : <Check className="mr-1.5 h-4 w-4" />}Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="More actions" className="h-9 w-9 rounded-full"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 border-white/10 bg-[#0d151c]">
              <DropdownMenuItem disabled={exporting} onSelect={() => void exportPdf()}><Download className="mr-2 h-4 w-4" />Export PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => leave(handlers.onDuplicate)}><Copy className="mr-2 h-4 w-4" />Duplicate to…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-rose-300 focus:text-rose-200" onSelect={() => leave(handlers.onDelete)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error && <p role="alert" className="mt-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p>}
        {showIssues && issues.length > 0 && <div role="alert" className="mt-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-50">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-300" />Fix these to save:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6 text-amber-50/85">{issues.slice(0, 6).map((issue) => <li key={issue}>{issue}</li>)}{issues.length > 6 && <li>…and {issues.length - 6} more</li>}</ul>
        </div>}
      </div>

      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(170deg,rgba(22,30,40,0.92),rgba(9,13,18,0.96))] shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative space-y-7 p-5 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0 flex-1 basis-80">{title}</div>
            <div className="flex items-end gap-6">{stats}</div>
          </div>
          {children}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.08] pt-6">
            <Button variant="ghost" className="rounded-full" onClick={() => leave(handlers.onClose)}>Cancel</Button>
            <Button onClick={() => void saveAndClose()} disabled={saving} className="rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 font-semibold text-slate-950">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Save changes
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={!!discard} onOpenChange={(open) => { if (!open) setDiscard(null) }}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">You have edits that haven't been saved. They will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep editing</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-rose-500 text-white hover:bg-rose-400" onClick={() => { const action = discard; setDiscard(null); dirtyRef.current = false; action?.() }}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Card frame for one set, exercise or drill: colour stripe, number, name, controls. */
function ItemCard({ index, count, stripe, name, onName, placeholder, badge, onMove, onCopy, onRemove, canRemove, canCopy, children }: {
  index: number; count: number; stripe: string; name: string; onName: (value: string) => void; placeholder: string; badge?: ReactNode
  onMove: (direction: number) => void; onCopy: () => void; onRemove: () => void; canRemove: boolean; canCopy: boolean; children: ReactNode
}) {
  const [armed, setArmed] = useState(false)
  return (
    <section aria-label={name || placeholder} className="dash-reveal group/item relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition-colors duration-300 focus-within:border-white/15 hover:border-white/15">
      <span className={cn("absolute inset-y-0 left-0 w-1 transition-colors duration-500", stripe)} />
      <div className="flex items-center gap-2 py-2.5 pl-4 pr-2 sm:pl-5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-bold text-slate-200">{index + 1}</span>
        <input aria-label={`${placeholder} ${index + 1} name`} value={name} maxLength={150} placeholder={placeholder} onChange={(event) => onName(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-bold uppercase tracking-[0.1em] text-cyan-100 outline-none placeholder:text-slate-600 sm:text-base" />
        {badge}
        <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/item:opacity-100 sm:group-hover/item:opacity-100">
          <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></IconButton>
          <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></IconButton>
          <IconButton label="Duplicate" disabled={!canCopy} onClick={onCopy}><Copy className="h-4 w-4" /></IconButton>
          <IconButton label={armed ? "Tap again to remove" : "Remove"} danger disabled={!canRemove} onClick={() => {
            if (armed) { onRemove(); setArmed(false) } else { setArmed(true); window.setTimeout(() => setArmed(false), 2500) }
          }}>{armed ? <Check className="h-4 w-4 text-rose-300" /> : <Trash2 className="h-4 w-4" />}</IconButton>
        </div>
      </div>
      <div className="space-y-3 px-4 pb-4 sm:px-5">{children}</div>
    </section>
  )
}

function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-4 text-sm font-medium text-slate-300 transition-all duration-300 hover:border-accent/50 hover:bg-accent/[0.06] hover:text-white disabled:pointer-events-none disabled:opacity-40">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-cyan-100 transition-transform duration-300 group-hover:rotate-90"><Plus className="h-4 w-4" /></span>{children}
    </button>
  )
}

function QuickChips({ items, onPick }: { items: string[]; onPick: (label: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {items.map((label) => <button key={label} type="button" onClick={() => onPick(label)}
        className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-slate-400 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:text-white">+ {label}</button>)}
    </div>
  )
}

// ---------------------------------------------------------------- swim
const ZONES = ["Recovery", "Aerobic", "Threshold", "VO2 / high aerobic", "Race pace", "Sprint"]
const STROKES = ["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "IM", "Choice", "Kick", "Pull", "Drill"]
type SetDraft = {
  id: string; name: string; rounds: number; repetitions: number; distance_meters: number; stroke: string; interval: string
  target_time: string; training_zone: string; equipment: string; description: string; technical_focus: string
}
const blankSet = (patch: Partial<SetDraft> = {}): SetDraft => ({
  id: uid(), name: "", rounds: 1, repetitions: 4, distance_meters: 100, stroke: "Freestyle", interval: "", target_time: "",
  training_zone: "Aerobic", equipment: "", description: "", technical_focus: "", ...patch,
})
const SET_PRESETS: Record<string, Partial<SetDraft>> = {
  "Warm-up": { name: "Warm-up", repetitions: 1, distance_meters: 400, stroke: "Choice", interval: "Easy, continuous", training_zone: "Recovery", description: "Easy swim, building smoothly through the distance." },
  Kick: { name: "Kick", repetitions: 8, distance_meters: 50, stroke: "Kick", interval: "@ 1:10", training_zone: "Aerobic", equipment: "Kickboard", description: "Steady kick with a tight streamline." },
  Pull: { name: "Pull", repetitions: 4, distance_meters: 200, stroke: "Freestyle", interval: "@ 3:20", training_zone: "Aerobic", equipment: "Pull buoy, Paddles", description: "Long, strong pulls; hold your stroke count." },
  Drill: { name: "Drill", repetitions: 8, distance_meters: 50, stroke: "Drill", interval: "@ 1:10", training_zone: "Aerobic", description: "25 drill / 25 swim, focus on one technical cue." },
  "Main set": { name: "Main set", repetitions: 8, distance_meters: 100, stroke: "Freestyle", interval: "@ 1:40", training_zone: "Threshold", description: "Strong, even pace; hold the same time on every repeat." },
  "Race pace": { name: "Race pace", repetitions: 8, distance_meters: 50, stroke: "Freestyle", interval: "@ 1:30", training_zone: "Race pace", description: "Race speed with full recovery between repeats." },
  Sprint: { name: "Sprint", repetitions: 8, distance_meters: 25, stroke: "Freestyle", interval: "@ 1:00", training_zone: "Sprint", description: "All-out effort from a push; easy recovery." },
  "Cool-down": { name: "Cool-down", repetitions: 1, distance_meters: 200, stroke: "Choice", interval: "Easy", training_zone: "Recovery", description: "Easy swim to bring the heart rate down." },
}
const setMeters = (item: SetDraft) => item.rounds * item.repetitions * item.distance_meters
const prescription = (item: SetDraft) => {
  const reps = item.repetitions > 1 ? `${item.repetitions} × ${item.distance_meters} m` : `${item.distance_meters} m`
  return item.rounds > 1 ? `${item.rounds} × (${reps})` : reps
}

function SwimEditor({ target, handlers }: { target: Extract<EditTarget, { kind: "swim" }>; handlers: Handlers }) {
  const source = target.workout
  const [draft, setDraft] = useState(() => ({
    title: source.title, objective: source.objective, event: source.event ?? "", notes: source.notes ?? "",
    estimated_duration_minutes: source.estimated_duration_minutes, equipment: source.equipment.join(", "),
    sets: source.sets.map((item) => ({ ...item, id: uid(), target_time: item.target_time ?? "", equipment: item.equipment.join(", "), technical_focus: item.technical_focus.join(", ") })),
  }))
  const [dirty, setDirty] = useState(false)
  const update = (patch: Partial<typeof draft>) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true) }
  const updateSet = (id: string, patch: Partial<SetDraft>) => update({ sets: draft.sets.map((item) => (item.id === id ? { ...item, ...patch } : item)) })
  const total = draft.sets.reduce((sum, item) => sum + setMeters(item), 0)
  const zones = Object.entries(draft.sets.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.training_zone || "Other"]: (acc[item.training_zone || "Other"] ?? 0) + setMeters(item) }), {}))
    .map(([label, meters]) => ({ label, meters }))

  const issues = [
    !draft.title.trim() && "Give the workout a title.",
    !draft.objective.trim() && "Add the workout goal.",
    (draft.estimated_duration_minutes < 10 || draft.estimated_duration_minutes > 180) && "Duration must be 10–180 minutes.",
    !draft.sets.length && "Add at least one set.",
    draft.sets.length > 15 && "A workout can have at most 15 sets.",
    total > 12000 && `The workout is ${total.toLocaleString()} m; the maximum is 12,000 m.`,
    ...draft.sets.flatMap((item, index) => {
      const at = `Set ${index + 1}`
      return [
        !item.name.trim() && `${at}: add a name.`,
        (item.rounds < 1 || item.rounds > 20) && `${at}: rounds must be 1–20.`,
        (item.repetitions < 1 || item.repetitions > 100) && `${at}: repeats must be 1–100.`,
        (item.distance_meters < 1 || item.distance_meters > 2000) && `${at}: distance must be 1–2,000 m.`,
        !item.stroke.trim() && `${at}: add a stroke.`,
        !item.interval.trim() && `${at}: add an interval or rest.`,
        !item.description.trim() && `${at}: add a short description.`,
      ]
    }),
  ].filter((issue): issue is string => Boolean(issue))

  const save = () => trainingRequest(`/library/${encodeURIComponent(target.key)}`, weekSchema, {
    method: "PUT",
    body: { workout: {
      title: draft.title.trim(), objective: draft.objective.trim(), event: draft.event.trim() || null, notes: draft.notes.trim(),
      estimated_duration_minutes: draft.estimated_duration_minutes, equipment: commaList(draft.equipment),
      main_training_zones: [...new Set(draft.sets.map((item) => item.training_zone.trim()).filter(Boolean))],
      sets: draft.sets.map(({ id: _id, ...item }) => ({
        ...item, name: item.name.trim(), stroke: item.stroke.trim(), interval: item.interval.trim(), training_zone: item.training_zone.trim() || "Aerobic",
        description: item.description.trim(), target_time: item.target_time.trim() || null, equipment: commaList(item.equipment), technical_focus: commaList(item.technical_focus),
      })),
    } },
  })

  return (
    <EditorShell icon={Waves} label="Swim editor" tone="text-accent" date={target.date} dirty={dirty} issues={issues} save={save} handlers={handlers}
      title={<>
        <label htmlFor="swim-title" className={fieldLabel}>Workout title</label>
        <input id="swim-title" value={draft.title} maxLength={150} onChange={(event) => update({ title: event.target.value })} placeholder="Name your swim…"
          className="w-full border-0 bg-transparent p-0 text-3xl font-bold tracking-tight text-white outline-none placeholder:text-slate-600 sm:text-4xl" />
      </>}
      stats={<><Stat label="Sets" value={draft.sets.length} /><Stat label="Distance" value={total} unit="m" big /></>}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.6fr)]">
        <div>
          <label htmlFor="swim-duration" className={fieldLabel}><Clock className="mr-1 inline h-3 w-3" />Duration (min)</label>
          <Input id="swim-duration" type="number" min={10} max={180} className={inputClass} value={draft.estimated_duration_minutes || ""} onChange={(event) => update({ estimated_duration_minutes: number(event.target.value) })} />
        </div>
        <div>
          <label htmlFor="swim-event" className={fieldLabel}>Event focus</label>
          <Input id="swim-event" maxLength={60} placeholder="e.g. 100m Backstroke" className={inputClass} value={draft.event} onChange={(event) => update({ event: event.target.value })} />
        </div>
        <div>
          <label htmlFor="swim-equipment" className={fieldLabel}>Equipment</label>
          <Input id="swim-equipment" maxLength={200} placeholder="Fins, Pull buoy, Paddles…" className={inputClass} value={draft.equipment} onChange={(event) => update({ equipment: event.target.value })} />
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Goal</span>
        <AutoTextarea label="Goal" value={draft.objective} onChange={(objective) => update({ objective })} placeholder="What is this swim for?" />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className={cn(fieldLabel, "mb-0")}>Intensity split</span>
          <span className="text-[11px] text-slate-500">{zones.map((zone) => `${zone.label} ${Math.round((zone.meters / Math.max(total, 1)) * 100)}%`).join(" · ")}</span>
        </div>
        <ZoneStack key={zones.map((zone) => zone.label).join()} className="h-2" entries={zones} />
      </div>

      <div className="space-y-4">
        {draft.sets.map((item, index) => {
          const tone = zoneTone(item.training_zone)
          return (
            <ItemCard key={item.id} index={index} count={draft.sets.length} stripe={tone.solid} name={item.name} placeholder="Set" onName={(name) => updateSet(item.id, { name })}
              badge={<span className="hidden shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-300 sm:inline">{prescription(item) === `${setMeters(item)} m` ? "" : `${prescription(item)} · `}{setMeters(item).toLocaleString()} m</span>}
              onMove={(direction) => update({ sets: move(draft.sets, index, direction) })}
              onCopy={() => { const next = [...draft.sets]; next.splice(index + 1, 0, { ...item, id: uid() }); update({ sets: next }) }}
              onRemove={() => update({ sets: draft.sets.filter((entry) => entry.id !== item.id) })}
              canRemove={draft.sets.length > 1} canCopy={draft.sets.length < 15}>
              <div className="grid grid-cols-6 gap-2 md:grid-cols-[4.5rem_4.5rem_6rem_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
                {([["Rounds", "rounds", 1, 20], ["Repeats", "repetitions", 1, 100], ["Distance (m)", "distance_meters", 1, 2000]] as const).map(([text, field, min, max]) => (
                  <label key={field} className="col-span-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:col-span-1">{text}
                    <Input type="number" min={min} max={max} value={item[field] || ""} onChange={(event) => updateSet(item.id, { [field]: number(event.target.value) })} className={cn(cellInput, "mt-1 tabular-nums")} />
                  </label>
                ))}
                <label className="col-span-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:col-span-1">Stroke
                  <Input list="swim-strokes" maxLength={60} value={item.stroke} onChange={(event) => updateSet(item.id, { stroke: event.target.value })} className={cn(cellInput, "mt-1")} />
                </label>
                <label className="col-span-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:col-span-1">Interval / rest
                  <Input maxLength={80} placeholder="@ 1:40" value={item.interval} onChange={(event) => updateSet(item.id, { interval: event.target.value })} className={cn(cellInput, "mt-1")} />
                </label>
                <label className="col-span-6 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:col-span-1">Target time
                  <Input maxLength={40} placeholder="Optional" value={item.target_time} onChange={(event) => updateSet(item.id, { target_time: event.target.value })} className={cn(cellInput, "mt-1")} />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Set ${index + 1} zone`}>
                {[...ZONES, ...(ZONES.includes(item.training_zone) || !item.training_zone ? [] : [item.training_zone])].map((zone) => {
                  const active = item.training_zone === zone
                  return <button key={zone} type="button" aria-pressed={active} onClick={() => updateSet(item.id, { training_zone: zone })}
                    className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-300", active ? zoneTone(zone).chip : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/25 hover:text-white")}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", zoneTone(zone).solid)} />{zone}
                  </button>
                })}
              </div>
              <AutoTextarea label={`Set ${index + 1} description`} value={item.description} onChange={(description) => updateSet(item.id, { description })} placeholder="How to swim it: pace, effort, technique…" />
              <div className="grid gap-2 md:grid-cols-2">
                <Input aria-label={`Set ${index + 1} equipment`} maxLength={200} placeholder="Equipment (comma separated)" value={item.equipment} onChange={(event) => updateSet(item.id, { equipment: event.target.value })} className={cn(cellInput, "h-8 text-xs")} />
                <Input aria-label={`Set ${index + 1} technical focus`} maxLength={300} placeholder="Technical focus (comma separated)" value={item.technical_focus} onChange={(event) => updateSet(item.id, { technical_focus: event.target.value })} className={cn(cellInput, "h-8 text-xs")} />
              </div>
            </ItemCard>
          )
        })}
        <datalist id="swim-strokes">{STROKES.map((stroke) => <option key={stroke} value={stroke} />)}</datalist>
        <AddButton disabled={draft.sets.length >= 15} onClick={() => update({ sets: [...draft.sets, blankSet()] })}>Add set</AddButton>
        {draft.sets.length < 15 && <QuickChips items={Object.keys(SET_PRESETS)} onPick={(label) => update({ sets: [...draft.sets, blankSet(SET_PRESETS[label])] })} />}
      </div>
      <div>
        <span className={fieldLabel}>Coach's notes</span>
        <AutoTextarea label="Coach's notes" value={draft.notes} onChange={(notes) => update({ notes })} placeholder="Anything to remember for this session?" />
      </div>
    </EditorShell>
  )
}

// ---------------------------------------------------------------- strength
type ExerciseDraft = { id: string; exercise: string; sets: number; repetitions: string; load: string; rest_seconds: number; tempo: string; demonstration: string }
const blankExercise = (exercise = ""): ExerciseDraft => ({ id: uid(), exercise, sets: 3, repetitions: "10", load: "Bodyweight", rest_seconds: 60, tempo: "", demonstration: "" })
const STRENGTH_QUICK = ["Push-up", "Band row", "Plank", "Glute bridge", "Dead bug", "Squat jump"]

function StrengthEditor({ target, handlers }: { target: Extract<EditTarget, { kind: "strength" }>; handlers: Handlers }) {
  const source = target.strength
  const [draft, setDraft] = useState(() => ({
    title: source.title, objective: source.objective, estimated_duration_minutes: source.estimated_duration_minutes,
    exercises: source.exercises.map((item) => ({ ...item, id: uid(), tempo: item.tempo ?? "", demonstration: item.demonstration.join("\n") })),
  }))
  const [dirty, setDirty] = useState(false)
  const update = (patch: Partial<typeof draft>) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true) }
  const updateExercise = (id: string, patch: Partial<ExerciseDraft>) => update({ exercises: draft.exercises.map((item) => (item.id === id ? { ...item, ...patch } : item)) })
  const sets = draft.exercises.reduce((sum, item) => sum + item.sets, 0)

  const issues = [
    !draft.title.trim() && "Give the session a title.",
    !draft.objective.trim() && "Add the session goal.",
    (draft.estimated_duration_minutes < 10 || draft.estimated_duration_minutes > 120) && "Duration must be 10–120 minutes.",
    !draft.exercises.length && "Add at least one exercise.",
    draft.exercises.length > 10 && "A session can have at most 10 exercises.",
    ...draft.exercises.flatMap((item, index) => {
      const at = `Exercise ${index + 1}`
      const cues = lineList(item.demonstration).length
      return [
        !item.exercise.trim() && `${at}: add a name.`,
        (item.sets < 1 || item.sets > 8) && `${at}: sets must be 1–8.`,
        !item.repetitions.trim() && `${at}: add reps or time.`,
        !item.load.trim() && `${at}: add a load (e.g. Bodyweight).`,
        (item.rest_seconds < 0 || item.rest_seconds > 600) && `${at}: rest must be 0–600 s.`,
        !cues && `${at}: add at least one coaching cue.`,
        cues > 8 && `${at}: use at most 8 cues.`,
      ]
    }),
  ].filter((issue): issue is string => Boolean(issue))

  const save = () => trainingRequest("/week/strength", weekSchema, {
    method: "PUT",
    body: { date: target.date, strength: {
      title: draft.title.trim(), objective: draft.objective.trim(), estimated_duration_minutes: draft.estimated_duration_minutes,
      exercises: draft.exercises.map(({ id: _id, ...item }) => ({
        ...item, exercise: item.exercise.trim(), repetitions: item.repetitions.trim(), load: item.load.trim(), tempo: item.tempo.trim() || null,
        demonstration: lineList(item.demonstration),
      })),
    } },
  })

  return (
    <EditorShell icon={Dumbbell} label="Strength editor" tone="text-violet-300" date={target.date} dirty={dirty} issues={issues} save={save} handlers={handlers}
      title={<>
        <label htmlFor="strength-title" className={fieldLabel}>Session title</label>
        <input id="strength-title" value={draft.title} maxLength={150} onChange={(event) => update({ title: event.target.value })} placeholder="Name your session…"
          className="w-full border-0 bg-transparent p-0 text-3xl font-bold tracking-tight text-white outline-none placeholder:text-slate-600 sm:text-4xl" />
      </>}
      stats={<><Stat label="Exercises" value={draft.exercises.length} /><Stat label="Total sets" value={sets} big /></>}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor="strength-duration" className={fieldLabel}><Clock className="mr-1 inline h-3 w-3" />Duration (min)</label>
          <Input id="strength-duration" type="number" min={10} max={120} className={inputClass} value={draft.estimated_duration_minutes || ""} onChange={(event) => update({ estimated_duration_minutes: number(event.target.value) })} />
        </div>
        <div>
          <span className={fieldLabel}>Goal</span>
          <AutoTextarea label="Goal" value={draft.objective} onChange={(objective) => update({ objective })} placeholder="What is this session for?" />
        </div>
      </div>
      <div className="space-y-4">
        {draft.exercises.map((item, index) => (
          <ItemCard key={item.id} index={index} count={draft.exercises.length} stripe="bg-violet-400" name={item.exercise} placeholder="Exercise" onName={(exercise) => updateExercise(item.id, { exercise })}
            badge={<span className="hidden shrink-0 rounded-full bg-violet-400/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-violet-200 sm:inline">{item.sets} × {item.repetitions || "—"}</span>}
            onMove={(direction) => update({ exercises: move(draft.exercises, index, direction) })}
            onCopy={() => { const next = [...draft.exercises]; next.splice(index + 1, 0, { ...item, id: uid() }); update({ exercises: next }) }}
            onRemove={() => update({ exercises: draft.exercises.filter((entry) => entry.id !== item.id) })}
            canRemove={draft.exercises.length > 1} canCopy={draft.exercises.length < 10}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1.5fr)_5.5rem_minmax(0,1fr)]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Sets
                <Input type="number" min={1} max={8} value={item.sets || ""} onChange={(event) => updateExercise(item.id, { sets: number(event.target.value) })} className={cn(cellInput, "mt-1 tabular-nums")} />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Reps
                <Input maxLength={60} placeholder="10 / 30 s" value={item.repetitions} onChange={(event) => updateExercise(item.id, { repetitions: event.target.value })} className={cn(cellInput, "mt-1")} />
              </label>
              <label className="col-span-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:col-span-1">Load
                <Input maxLength={150} placeholder="Bodyweight, RPE 7…" value={item.load} onChange={(event) => updateExercise(item.id, { load: event.target.value })} className={cn(cellInput, "mt-1")} />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Rest (s)
                <Input type="number" min={0} max={600} step={15} value={item.rest_seconds} onChange={(event) => updateExercise(item.id, { rest_seconds: number(event.target.value) })} className={cn(cellInput, "mt-1 tabular-nums")} />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Tempo
                <Input maxLength={40} placeholder="Optional" value={item.tempo} onChange={(event) => updateExercise(item.id, { tempo: event.target.value })} className={cn(cellInput, "mt-1")} />
              </label>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Coaching cues · one per line</span>
              <div className="mt-1"><AutoTextarea label={`Exercise ${index + 1} cues`} value={item.demonstration} onChange={(demonstration) => updateExercise(item.id, { demonstration })} placeholder={"Set up\nMove\nFinish"} /></div>
            </div>
          </ItemCard>
        ))}
        <AddButton disabled={draft.exercises.length >= 10} onClick={() => update({ exercises: [...draft.exercises, blankExercise()] })}>Add exercise</AddButton>
        {draft.exercises.length < 10 && <QuickChips items={STRENGTH_QUICK.filter((name) => !draft.exercises.some((item) => item.exercise === name))}
          onPick={(name) => update({ exercises: [...draft.exercises, { ...blankExercise(name), demonstration: "Controlled tempo\nFull range of motion" }] })} />}
      </div>
    </EditorShell>
  )
}

// ---------------------------------------------------------------- mobility
const CATEGORIES = ["Pre-swim activation", "Post-swim mobility", "Shoulder mobility", "Thoracic mobility", "Hip mobility", "Ankle mobility", "Recovery mobility"]
type DrillDraft = { id: string; category: string; exercise: string; duration_minutes: number; instructions: string }
const MOBILITY_QUICK: Record<string, Omit<DrillDraft, "id">> = {
  "Band pull-aparts": { category: "Pre-swim activation", exercise: "Band pull-aparts", duration_minutes: 5, instructions: "3 × 15 slow reps\nSqueeze the shoulder blades together" },
  "Thoracic rotations": { category: "Thoracic mobility", exercise: "Open-book thoracic rotations", duration_minutes: 5, instructions: "10 per side, lying on your side\nFollow the hand with your eyes" },
  "Hip flexor stretch": { category: "Hip mobility", exercise: "Half-kneeling hip flexor stretch", duration_minutes: 4, instructions: "45 s per side\nTuck the pelvis, squeeze the glute" },
  "Ankle circles": { category: "Ankle mobility", exercise: "Ankle circles and pointing", duration_minutes: 3, instructions: "15 circles each way, each foot\nFinish with 10 slow points" },
}

function MobilityEditor({ target, handlers }: { target: Extract<EditTarget, { kind: "mobility" }>; handlers: Handlers }) {
  const [drills, setDrills] = useState<DrillDraft[]>(() => target.mobility.map((item) => ({ ...item, id: uid(), instructions: item.instructions.join("\n") })))
  const [dirty, setDirty] = useState(false)
  const change = (next: DrillDraft[]) => { setDrills(next); setDirty(true) }
  const updateDrill = (id: string, patch: Partial<DrillDraft>) => change(drills.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const minutes = drills.reduce((sum, item) => sum + item.duration_minutes, 0)

  const issues = [
    !drills.length && "Add at least one drill (or delete the mobility work from the week instead).",
    drills.length > 7 && "A day can have at most 7 mobility drills.",
    ...drills.flatMap((item, index) => [
      !item.exercise.trim() && `Drill ${index + 1}: add a name.`,
      (item.duration_minutes < 1 || item.duration_minutes > 20) && `Drill ${index + 1}: duration must be 1–20 minutes.`,
      !lineList(item.instructions).length && `Drill ${index + 1}: add at least one instruction.`,
    ]),
  ].filter((issue): issue is string => Boolean(issue))

  const save = () => trainingRequest("/week/mobility", weekSchema, {
    method: "PUT",
    body: { date: target.date, mobility: drills.map(({ id: _id, ...item }) => ({ ...item, exercise: item.exercise.trim(), instructions: lineList(item.instructions) })) },
  })

  return (
    <EditorShell icon={Heart} label="Mobility editor" tone="text-emerald-300" date={target.date} dirty={dirty} issues={issues} save={save} handlers={handlers}
      title={<>
        <span className={fieldLabel}>Mobility</span>
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{target.dayName} mobility</h2>
      </>}
      stats={<><Stat label="Drills" value={drills.length} /><Stat label="Minutes" value={minutes} unit="min" big /></>}>
      <div className="space-y-4">
        {drills.map((item, index) => (
          <ItemCard key={item.id} index={index} count={drills.length} stripe="bg-emerald-400" name={item.exercise} placeholder="Drill" onName={(exercise) => updateDrill(item.id, { exercise })}
            badge={<span className="hidden shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-200 sm:inline">{item.duration_minutes} min</span>}
            onMove={(direction) => change(move(drills, index, direction))}
            onCopy={() => { const next = [...drills]; next.splice(index + 1, 0, { ...item, id: uid() }); change(next) }}
            onRemove={() => change(drills.filter((entry) => entry.id !== item.id))}
            canRemove={drills.length > 1} canCopy={drills.length < 7}>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Category
                <select value={item.category} onChange={(event) => updateDrill(item.id, { category: event.target.value })}
                  className={cn(cellInput, "mt-1 w-full border bg-[#0d151c] text-slate-100 outline-none focus-visible:ring-2")}>
                  {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Minutes
                <Input type="number" min={1} max={20} value={item.duration_minutes || ""} onChange={(event) => updateDrill(item.id, { duration_minutes: number(event.target.value) })} className={cn(cellInput, "mt-1 tabular-nums")} />
              </label>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Instructions · one per line</span>
              <div className="mt-1"><AutoTextarea label={`Drill ${index + 1} instructions`} value={item.instructions} onChange={(instructions) => updateDrill(item.id, { instructions })} placeholder={"How to do it\nHow long or how many"} /></div>
            </div>
          </ItemCard>
        ))}
        <AddButton disabled={drills.length >= 7} onClick={() => change([...drills, { id: uid(), category: "Shoulder mobility", exercise: "", duration_minutes: 5, instructions: "" }])}>Add drill</AddButton>
        {drills.length < 7 && <QuickChips items={Object.keys(MOBILITY_QUICK).filter((name) => !drills.some((item) => item.exercise === MOBILITY_QUICK[name].exercise))}
          onPick={(name) => change([...drills, { ...MOBILITY_QUICK[name], id: uid() }])} />}
      </div>
    </EditorShell>
  )
}

/** Full-page editor for a Training Week swim, strength session or day of mobility work. */
export function TrainingItemEditor({ target, ...handlers }: { target: EditTarget } & Handlers) {
  if (target.kind === "swim") return <SwimEditor target={target} handlers={handlers} />
  if (target.kind === "strength") return <StrengthEditor target={target} handlers={handlers} />
  return <MobilityEditor target={target} handlers={handlers} />
}
