"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, Check, ChevronsUpDown, Download, Gauge, Info, Loader2, Pencil, Plus, RotateCcw, Save, Search, Timer, Trash2, UserRound, Users, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Reveal, Tile, TileHeader } from "@/components/dashboard-ui"
import { Banner, EmptyState, Segmented, inputClass, labelClass, textareaClass, zoneTone } from "@/components/training-ui"
import { cn } from "@/lib/utils"
import {
  COURSES, STROKES, athletesSchema, cleanAthlete, downloadPacePdf, formatPace, formatRange, paceRequest, paceResultSchema, parseTime,
  type Athlete, type AthleteData, type AthleteList, type Course, type CssTest, type Display, type PaceResult, type PbEntry, type Stroke, type Suit,
} from "@/lib/pace-calculator"

const STROKE_LABELS: Record<Stroke, string> = { Freestyle: "Free", Backstroke: "Back", Breaststroke: "Breast", Butterfly: "Fly" }
const fieldLabel = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"
const toData = (athlete: Athlete): AthleteData => ({
  name: athlete.name, group: athlete.group, course: athlete.course, notes: athlete.notes,
  pbs: structuredClone(athlete.pbs), tests: structuredClone(athlete.tests),
})
const PLACEHOLDERS: Record<number, string> = { 50: "28.45", 100: "1:02.30", 200: "2:15.00", 400: "4:45.00", 500: "5:20.00", 800: "9:50.00", 1000: "10:50.00", 1500: "18:40.00", 1650: "18:10.00" }
const blankTest: CssTest = { t200: null, t400: null, tested_on: null }
type MetaDialog = { mode: "add" | "edit"; id?: string; name: string; group: string; course: Course; notes: string }

/** Two-option pill toggle used inside the PB rows. */
function MiniToggle<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-9 rounded-lg border border-white/10 bg-black/20 p-0.5">
      {options.map(([option, text]) => {
        const active = option === value
        return <button key={option} type="button" role="radio" aria-checked={active} onClick={() => onChange(option)}
          className={cn("rounded-md px-2.5 text-xs font-medium transition-all duration-300", active ? "bg-white/[0.12] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" : "text-slate-500 hover:text-slate-200")}>{text}</button>
      })}
    </div>
  )
}

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
const pbCount = (athlete: Athlete) => Object.values(athlete.pbs).reduce((sum, rows) => sum + rows.length, 0)

function AthleteAvatar({ athlete, size = "md" }: { athlete: Athlete; size?: "sm" | "md" }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full font-bold tracking-tight", size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-sm",
      athlete.is_self ? "bg-gradient-to-br from-cyan-300 to-sky-500 text-slate-950 shadow-[0_4px_14px_rgba(87,229,234,0.35)]" : "bg-violet-400/15 text-violet-100 ring-1 ring-inset ring-violet-300/25")}>
      {athlete.is_self ? <UserRound className={cn("text-slate-950", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} /> : initials(athlete.name)}
    </span>
  )
}

/** Searchable athlete picker: avatar, group, course and PB count, with quick add / manage actions. */
function AthletePicker({ athletes, value, onSelect, onAdd, onManage }: {
  athletes: Athlete[]; value: string; onSelect: (athlete: Athlete) => void; onAdd: () => void; onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const current = athletes.find((athlete) => athlete.id === value) ?? athletes[0]
  const others = athletes.filter((athlete) => !athlete.is_self)
  const item = (athlete: Athlete) => {
    const active = athlete.id === value
    const count = pbCount(athlete)
    return (
      <CommandItem key={athlete.id} value={`${athlete.name} ${athlete.group} ${athlete.id}`} onSelect={() => { setOpen(false); if (!active) onSelect(athlete) }}
        className={cn("group gap-3 rounded-xl px-2.5 py-2 text-slate-200 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white", active && "bg-accent/[0.08]")}>
        <AthleteAvatar athlete={athlete} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{athlete.name}{athlete.is_self && <span className="ml-1.5 text-[10px] font-semibold text-accent">YOU</span>}</span>
          <span className="block truncate text-[11px] text-slate-500">{[athlete.group, `${count} PB${count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400">{athlete.course}</span>
        <Check className={cn("h-4 w-4 shrink-0 text-accent transition-opacity", active ? "opacity-100" : "opacity-0")} />
      </CommandItem>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button id="pace-athlete" type="button" role="combobox" aria-expanded={open} aria-label={`Athlete: ${current?.name ?? "none"}`}
          className={cn("group flex h-10 w-full items-center gap-2.5 rounded-xl border bg-white/[0.03] pl-1.5 pr-2.5 text-left transition-all duration-300",
            "hover:border-accent/40 hover:bg-accent/[0.05] focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25",
            open ? "border-accent/50 bg-accent/[0.06] shadow-[0_0_0_4px_rgba(87,229,234,0.08)]" : "border-white/10")}>
          {current && <AthleteAvatar athlete={current} size="sm" />}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold text-white">{current?.name}</span>
            <span className="block truncate text-[10px] text-slate-400">{current?.is_self ? "You" : current?.group || "Athlete"} · {current ? pbCount(current) : 0} PBs</span>
          </span>
          <ChevronsUpDown className={cn("h-4 w-4 shrink-0 text-slate-500 transition-all duration-300 group-hover:text-accent", open && "text-accent")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6}
        className="w-[max(var(--radix-popover-trigger-width),19rem)] overflow-hidden rounded-2xl border-white/10 bg-[#0d151c]/95 p-0 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <Command className="bg-transparent text-slate-200">
          <CommandInput placeholder="Search athletes…" className="h-11 text-sm placeholder:text-slate-500" />
          <CommandList className="max-h-72 p-1.5">
            <CommandEmpty className="py-6 text-center text-sm text-slate-500">No athletes found.</CommandEmpty>
            <CommandGroup heading="You" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-slate-500">
              {athletes.filter((athlete) => athlete.is_self).map(item)}
            </CommandGroup>
            {others.length > 0 && <CommandGroup heading={`Athletes · ${others.length}`} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-slate-500">
              {others.map(item)}
            </CommandGroup>}
          </CommandList>
          <CommandSeparator className="bg-white/[0.08]" />
          <div className="flex gap-1.5 p-1.5">
            <button type="button" onClick={() => { setOpen(false); onAdd() }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent/10 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-accent/20"><Plus className="h-3.5 w-3.5" />Add athlete</button>
            <button type="button" onClick={() => { setOpen(false); onManage() }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white"><Users className="h-3.5 w-3.5" />Manage athletes</button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-white">{value}{unit && <span className="ml-1 text-xs font-medium text-slate-400">{unit}</span>}</p>
    </div>
  )
}

/** Pace Calculator: athletes with PBs per stroke and course, and training paces for six zones. */
export function PaceCalculator() {
  const [tab, setTab] = useState<"calc" | "athletes">("calc")
  const [list, setList] = useState<AthleteList | null>(null)
  const [selectedId, setSelectedId] = useState("self")
  const [draft, setDraft] = useState<AthleteData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [stroke, setStroke] = useState<Stroke>("Freestyle")
  const [course, setCourse] = useState<Course>("SCM")
  const [suit, setSuit] = useState<Suit>("TRAINING_SUIT")
  const [display, setDisplay] = useState<Display>("BOTH")
  const [result, setResult] = useState<PaceResult | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [discard, setDiscard] = useState<null | (() => void)>(null)
  const [meta, setMeta] = useState<MetaDialog | null>(null)
  const [removing, setRemoving] = useState<Athlete | null>(null)
  const [query, setQuery] = useState("")
  const [showTest, setShowTest] = useState(false)

  const selected = list?.athletes.find((athlete) => athlete.id === selectedId) ?? null
  const key = `${course}:${stroke}`
  const unit = course === "SCY" ? "yd" : "m"
  const distances = list?.distances[course]?.[stroke] ?? []
  const entries = draft?.pbs[key] ?? []
  const test = draft?.tests[key] ?? blankTest

  const selectAthlete = useCallback((athlete: Athlete) => {
    setSelectedId(athlete.id)
    setDraft(toData(athlete))
    setDirty(false)
    setCourse(athlete.course)
    const firstStroke = STROKES.find((item) => athlete.pbs[`${athlete.course}:${item}`]?.length)
      ?? STROKES.find((item) => COURSES.some((other) => athlete.pbs[`${other}:${item}`]?.length))
    if (firstStroke) setStroke(firstStroke)
  }, [])

  useEffect(() => {
    paceRequest("/athletes", athletesSchema)
      .then((data) => { setList(data); selectAthlete(data.athletes[0]) })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Unable to load the pace calculator."))
      .finally(() => setLoading(false))
  }, [selectAthlete])

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("beforeunload", unload)
    return () => window.removeEventListener("beforeunload", unload)
  }, [dirty])

  // Live calculation of the current (possibly unsaved) PBs.
  const payload = useMemo(() => (draft ? { athlete: cleanAthlete(draft), stroke, course, suit } : null), [draft, stroke, course, suit])
  useEffect(() => {
    if (!payload) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCalculating(true)
      paceRequest("/calculate", paceResultSchema, { body: { ...payload, display: "BOTH" }, signal: controller.signal })
        .then((data) => { setResult(data); setCalcError(null) })
        .catch((failure: unknown) => { if (!controller.signal.aborted) setCalcError(failure instanceof Error ? failure.message : "Paces could not be calculated.") })
        .finally(() => { if (!controller.signal.aborted) setCalculating(false) })
    }, 300)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [payload])

  const guard = (action: () => void) => (dirty ? setDiscard(() => action) : action())
  const change = (update: (current: AthleteData) => AthleteData) => {
    setDraft((current) => (current ? update(current) : current))
    setDirty(true)
    setNotice(null)
  }
  const updateEntry = (distance: number, patch: Partial<PbEntry>) => change((current) => {
    const rows = current.pbs[key] ?? []
    const existing = rows.find((row) => row.distance === distance) ?? { distance, time: "", suit: "TECH" as const, start: "DIVE" as const, swum_on: null }
    const next = { ...existing, ...patch }
    const others = rows.filter((row) => row.distance !== distance)
    const updated = patch.time !== undefined && !patch.time.trim() ? others : [...others, next].sort((a, b) => a.distance - b.distance)
    return { ...current, pbs: { ...current.pbs, [key]: updated } }
  })
  const updateTest = (patch: Partial<CssTest>) => change((current) => ({ ...current, tests: { ...current.tests, [key]: { ...(current.tests[key] ?? blankTest), ...patch } } }))

  const invalidTimes = draft ? Object.values(draft.pbs).flat().filter((row) => row.time.trim() && parseTime(row.time) === null).length : 0
  const save = async () => {
    if (!draft) return
    if (invalidTimes) { setError("Fix the times marked in red before saving (for example 28.45 or 1:02.30)."); return }
    setSaving(true); setError(null); setNotice(null)
    try {
      const data = await paceRequest(`/athletes/${encodeURIComponent(selectedId)}`, athletesSchema, { method: "PUT", body: cleanAthlete(draft) })
      setList(data)
      const saved = data.athletes.find((athlete) => athlete.id === selectedId)
      if (saved) setDraft(toData(saved))
      setDirty(false)
      setNotice(`${draft.name} saved.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The athlete could not be saved.")
    } finally { setSaving(false) }
  }
  const exportPdf = async () => {
    if (!draft) return
    setExporting(true); setError(null)
    try {
      await downloadPacePdf({ athlete: cleanAthlete(draft), stroke, course, suit, display }, `${draft.name} ${stroke} ${course} paces`)
      setNotice("Pace PDF downloaded.")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The PDF could not be created.")
    } finally { setExporting(false) }
  }
  const saveMeta = async () => {
    if (!meta || !list) return
    setSaving(true); setError(null)
    try {
      const fields = { name: meta.name.trim(), group: meta.group.trim(), course: meta.course, notes: meta.notes.trim() }
      if (meta.mode === "add") {
        const data = await paceRequest("/athletes", athletesSchema, { body: { ...fields, pbs: {}, tests: {} } })
        setList(data)
        const created = data.athletes.find((athlete) => athlete.id === data.saved_id)
        if (created) { selectAthlete(created); setTab("calc") }
        setNotice(`${fields.name} added. Enter their PBs to see paces.`)
      } else {
        const athlete = list.athletes.find((item) => item.id === meta.id)
        if (!athlete) return
        const data = await paceRequest(`/athletes/${encodeURIComponent(athlete.id)}`, athletesSchema, { method: "PUT", body: { ...toData(athlete), ...fields } })
        setList(data)
        if (athlete.id === selectedId) setDraft((current) => (current ? { ...current, ...fields } : current))
        setNotice(`${fields.name} updated.`)
      }
      setMeta(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The athlete could not be saved.")
    } finally { setSaving(false) }
  }
  const remove = async () => {
    if (!removing) return
    const athlete = removing
    setRemoving(null); setError(null)
    try {
      const data = await paceRequest(`/athletes/${encodeURIComponent(athlete.id)}`, athletesSchema, { method: "DELETE" })
      setList(data)
      if (athlete.id === selectedId) selectAthlete(data.athletes.find((item) => item.id === athlete.id) ?? data.athletes[0])
      setNotice(athlete.is_self ? "Your PBs were reset to the ones recorded in your account." : `${athlete.name} deleted.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The athlete could not be deleted.")
    }
  }

  if (loading) {
    return <div className="space-y-4">{[0, 1, 2].map((index) => <div key={index} className="h-40 animate-pulse rounded-[22px] bg-white/[0.04]" />)}</div>
  }
  if (!list || !draft) {
    return <Banner tone="error">{error ?? "Unable to load the pace calculator."}</Banner>
  }

  const statusChip = saving ? { text: "Saving…", dot: "bg-cyan-300 animate-pulse" }
    : dirty ? { text: "Unsaved changes", dot: "bg-amber-300 animate-pulse" }
    : selected?.imported ? { text: "From your recorded PBs", dot: "bg-sky-300" }
    : { text: selected?.updated_at ? `Saved ${new Date(selected.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Saved", dot: "bg-emerald-400" }
  const filtered = list.athletes.filter((athlete) => `${athlete.name} ${athlete.group}`.toLowerCase().includes(query.trim().toLowerCase()))
  const warnings = result?.flags.filter((flag) => flag.level === "warning") ?? []
  const infos = result?.flags.filter((flag) => flag.level !== "warning") ?? []

  return (
    <div className="space-y-5">
      {error && <Banner tone="error" action={<button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="rounded-full p-1 text-rose-200/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>}>{error}</Banner>}
      {notice && <Banner tone="success" action={<button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded-full p-1 text-emerald-200/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>}>{notice}</Banner>}

      <div role="tablist" aria-label="Pace calculator" className="grid h-auto grid-cols-2 gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5 backdrop-blur-xl sm:inline-grid sm:w-auto">
        {([["calc", "Calculate pace", Gauge], ["athletes", "Athletes", Users]] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={cn("flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm transition-all duration-300",
              tab === value ? "border-accent/30 bg-[linear-gradient(135deg,rgba(87,229,234,0.18),rgba(87,229,234,0.04))] text-white shadow-[0_8px_24px_rgba(87,229,234,0.12)]" : "border-transparent text-slate-400 hover:text-slate-200")}>
            <Icon className={cn("h-4 w-4", tab === value && "text-accent")} />{label}
            {value === "athletes" && <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold tabular-nums">{list.athletes.length}</span>}
          </button>
        ))}
      </div>

      {tab === "calc" ? <>
        {/* Controls */}
        <Reveal index={0}>
          <Tile glow>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <span className={fieldLabel}>Athlete</span>
                <AthletePicker athletes={list.athletes} value={selectedId} onSelect={(athlete) => guard(() => selectAthlete(athlete))}
                  onAdd={() => setMeta({ mode: "add", name: "", group: "", course: list.default_course, notes: "" })} onManage={() => setTab("athletes")} />
              </div>
              <div><span className={fieldLabel}>Stroke</span><Segmented label="Stroke" value={stroke} onChange={setStroke} options={STROKES.map((value) => ({ value, label: STROKE_LABELS[value] }))} /></div>
              <div><span className={fieldLabel}>Course</span><Segmented label="Course" value={course} onChange={setCourse} options={COURSES.map((value) => ({ value, label: value }))} /></div>
              <div><span className={fieldLabel}>Current suit</span><Segmented label="Current suit" value={suit} onChange={setSuit} options={[{ value: "TRAINING_SUIT" as Suit, label: "Training" }, { value: "TECH" as Suit, label: "Tech" }]} /></div>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-72"><span className={fieldLabel}>Display</span><Segmented label="Display" value={display} onChange={setDisplay} options={[{ value: "BOTH" as Display, label: "Push + dive" }, { value: "PUSH" as Display, label: "Push" }, { value: "DIVE" as Display, label: "Dive" }]} /></div>
              <span className="flex-1" />
              <span role="status" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-slate-300">
                {saving ? <Loader2 className="h-3 w-3 animate-spin text-cyan-300" /> : <span className={cn("h-1.5 w-1.5 rounded-full", statusChip.dot)} />}{statusChip.text}
              </span>
              <Button variant="outline" disabled={exporting || !result?.zones.length} onClick={() => void exportPdf()} className="rounded-full border-white/15 bg-white/[0.04]">
                {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Export PDF
              </Button>
              <Button disabled={saving || !dirty} onClick={() => void save()} className="rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 font-semibold text-slate-950 shadow-[0_10px_30px_rgba(87,229,234,0.25)] transition-transform hover:-translate-y-0.5">
                <Save className="mr-1.5 h-4 w-4" />Save athlete
              </Button>
            </div>
          </Tile>
        </Reveal>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* PBs */}
          <Reveal index={1}>
            <Tile>
              <TileHeader icon={Timer} title="Personal bests" subtitle={`${stroke} · ${course} race times, with the suit and start they were swum in`} />
              {selected?.is_self && selected.imported && <p className="-mt-2 mb-4 flex gap-2 text-xs leading-5 text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />Pre-filled from the PBs recorded in your account (assumed tech suit, dive start). Edit anything, then save.</p>}
              <div className="hidden grid-cols-[3.75rem_minmax(0,1fr)_auto_auto] gap-2 px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 sm:grid">
                <span>Event</span><span>Time</span><span className="w-[7.75rem]">Suit</span><span className="w-[6.5rem]">Start</span>
              </div>
              <div className="space-y-2">
                {distances.map((distance) => {
                  const entry = entries.find((row) => row.distance === distance)
                  const invalid = !!entry?.time.trim() && parseTime(entry.time) === null
                  return (
                    <div key={`${key}:${distance}`} className={cn("grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-2 rounded-xl border p-2 transition-colors sm:grid-cols-[3.75rem_minmax(0,1fr)_auto_auto]",
                      entry && !invalid ? "border-accent/20 bg-accent/[0.04]" : "border-white/[0.06] bg-white/[0.02]")}>
                      <span className="pl-1 text-sm font-bold tabular-nums text-white">{distance}<span className="ml-0.5 text-[11px] font-medium text-slate-500">{unit}</span></span>
                      <Input aria-label={`${distance} ${stroke} time`} aria-invalid={invalid} inputMode="decimal" placeholder={PLACEHOLDERS[distance] ?? ""}
                        value={entry?.time ?? ""} onChange={(event) => updateEntry(distance, { time: event.target.value })}
                        className={cn("h-9 rounded-lg border-white/10 bg-black/20 font-mono text-sm tabular-nums", invalid && "border-rose-400/70 focus-visible:border-rose-400 focus-visible:ring-rose-400/20")} />
                      <div className={cn("col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:contents", !entry && "opacity-50")}>
                        <MiniToggle label={`${distance} suit`} value={entry?.suit ?? "TECH"} onChange={(value) => updateEntry(distance, { suit: value })} options={[["TRAINING_SUIT", "Training"], ["TECH", "Tech"]]} />
                        <MiniToggle label={`${distance} start`} value={entry?.start ?? "DIVE"} onChange={(value) => updateEntry(distance, { start: value })} options={[["DIVE", "Dive"], ["PUSH", "Push"]]} />
                      </div>
                      {invalid && <p className="col-span-full pl-1 text-[11px] text-rose-300">Use a time like 28.45 or 1:02.30.</p>}
                    </div>
                  )
                })}
              </div>
              <div className="mt-5 rounded-2xl border border-white/[0.06] bg-black/15">
                <button type="button" aria-expanded={showTest} onClick={() => setShowTest((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <span><span className="block text-sm font-semibold text-white">Threshold test <span className="font-normal text-slate-500">(optional)</span></span>
                    <span className="text-xs text-slate-400">Push-start 200 and 400 time trial in training. Sets your threshold exactly.</span></span>
                  <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px]", test.t200 && test.t400 ? "border-emerald-400/30 text-emerald-200" : "border-white/10 text-slate-400")}>{test.t200 && test.t400 ? "In use" : showTest ? "Hide" : "Add"}</span>
                </button>
                {showTest && <div className="dash-reveal space-y-2 border-t border-white/[0.06] p-3">
                  {(["t200", "t400"] as const).map((field) => {
                    const value = test[field] ?? ""
                    const invalid = !!value.trim() && parseTime(value) === null
                    return <div key={field} className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-2">
                      <span className="pl-1 text-sm font-bold tabular-nums text-white">{field.slice(1)}<span className="ml-0.5 text-[11px] font-medium text-slate-500">{unit}</span></span>
                      <Input aria-label={`Test ${field.slice(1)} time`} aria-invalid={invalid} inputMode="decimal" placeholder={field === "t200" ? "2:20.00" : "4:50.00"} value={value}
                        onChange={(event) => updateTest({ [field]: event.target.value || null })}
                        className={cn("h-9 rounded-lg border-white/10 bg-black/20 font-mono text-sm tabular-nums", invalid && "border-rose-400/70")} />
                    </div>
                  })}
                  <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-2">
                    <span className="pl-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date</span>
                    <Input type="date" aria-label="Test date" value={test.tested_on ?? ""} onChange={(event) => updateTest({ tested_on: event.target.value || null })} className="h-9 rounded-lg border-white/10 bg-black/20 text-sm" />
                  </div>
                </div>}
              </div>
            </Tile>
          </Reveal>

          {/* Summary */}
          <Reveal index={2}>
            <Tile glow>
              <TileHeader icon={Gauge} title="Threshold pace" subtitle="Critical swim speed: the anchor for your aerobic zones"
                action={calculating ? <Loader2 className="h-4 w-4 animate-spin text-accent" aria-label="Calculating" /> : undefined} />
              {result?.reference ? <>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                  <p className="text-5xl font-bold tracking-tight text-white tabular-nums">{formatPace(result.reference.css_per_100)}</p>
                  <p className="pb-1.5 text-sm text-slate-400">per 100 {result.unit} · push start</p>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-400">From {result.reference.css_basis}.</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Stat label="50 speed" value={formatPace(result.reference.pace_50)} unit="/100" />
                  <Stat label="200 pace" value={formatPace(result.reference.pace_200)} unit="/100" />
                  <Stat label="400 pace" value={formatPace(result.reference.pace_400)} unit="/100" />
                </div>
              </> : <EmptyState icon={Timer} title="Add a PB to start" body={`Enter at least one ${stroke.toLowerCase()} time on the left. Paces update as you type.`} />}
              {calcError && <p className="mt-4 text-sm text-rose-200">{calcError}</p>}
              {(warnings.length > 0 || infos.length > 0) && <ul className="mt-5 space-y-2">
                {[...warnings, ...infos].map((flag) => (
                  <li key={flag.text} className={cn("flex gap-2 rounded-r-xl border-l-[3px] py-1.5 pl-3 pr-2 text-xs leading-5",
                    flag.level === "warning" ? "border-amber-400 bg-amber-400/[0.06] text-amber-50/90" : "border-accent/60 bg-accent/[0.04] text-slate-300")}>
                    {flag.level === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}{flag.text}
                  </li>
                ))}
              </ul>}
            </Tile>
          </Reveal>
        </div>

        {/* Zones */}
        {result && result.zones.length > 0 && <div className={cn("grid gap-4 transition-opacity duration-300 md:grid-cols-2 xl:grid-cols-3", calculating && "opacity-70")}>
          {result.zones.map((zone, index) => {
            const tone = zoneTone(zone.zone)
            const showPush = display !== "DIVE" || !zone.dive_relevant
            const showDive = display !== "PUSH" && zone.dive_relevant
            return (
              <Reveal key={zone.zone} index={3 + index}>
                <section aria-label={`${zone.zone} paces`} className="relative h-full overflow-hidden rounded-[20px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-5 pl-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15">
                  <span className={cn("absolute inset-y-0 left-0 w-1.5", tone.solid)} />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-white">{zone.zone}</h3>
                    <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums", tone.chip)}>{formatRange(zone.per_100)} /100</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{zone.purpose}</p>
                  <table className="mt-4 w-full text-[13px] tabular-nums">
                    <thead><tr className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <th className="pb-1.5 font-semibold">Rep</th>{showPush && <th className="pb-1.5 font-semibold">Push</th>}{showDive && <th className="pb-1.5 font-semibold">Dive</th>}
                    </tr></thead>
                    <tbody>{zone.rows.map((row) => (
                      <tr key={row.label} className="border-t border-white/[0.06]">
                        <td className="py-2 pr-2 text-slate-300">{row.label}{row.note && <span className="block text-[10px] text-slate-500">{row.note}</span>}</td>
                        {showPush && <td className="whitespace-nowrap py-2 pr-2 font-semibold text-white">{formatRange(row.push)}</td>}
                        {showDive && <td className="whitespace-nowrap py-2 font-semibold text-white">{formatRange(row.dive)}</td>}
                      </tr>
                    ))}</tbody>
                  </table>
                  {!zone.dive_relevant && display === "DIVE" && <p className="mt-2 text-[11px] text-slate-500">Aerobic work starts from a push, so push times are shown.</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-slate-300">{zone.rest}</span>
                  </div>
                  <details className="group mt-3">
                    <summary className="cursor-pointer list-none text-xs font-medium text-accent hover:text-cyan-200">Why these paces <span className="inline-block transition-transform group-open:rotate-90">›</span></summary>
                    <p className="mt-1.5 text-[11px] leading-5 text-slate-400">{zone.why}</p>
                  </details>
                </section>
              </Reveal>
            )
          })}
        </div>}
      </> : (
        <Reveal index={0}>
          <Tile>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input aria-label="Search athletes" placeholder="Search athletes…" value={query} onChange={(event) => setQuery(event.target.value)} className={cn(inputClass, "pl-9")} />
              </div>
              <Button onClick={() => setMeta({ mode: "add", name: "", group: "", course: list.default_course, notes: "" })} className="rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 font-semibold text-slate-950">
                <Plus className="mr-1.5 h-4 w-4" />Add athlete
              </Button>
            </div>
            <div className="mt-5 hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_4.5rem_7rem_auto] gap-3 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:grid">
              <span>Name</span><span>Group</span><span>Course</span><span>Updated</span><span className="w-[9.5rem]" />
            </div>
            <ul className="mt-2 space-y-2">
              {filtered.map((athlete) => {
                const count = pbCount(athlete)
                return (
                  <li key={athlete.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-3 py-3 transition-colors md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_4.5rem_7rem_auto]",
                    athlete.id === selectedId ? "border-accent/30 bg-accent/[0.05]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/15")}>
                    <div className="flex min-w-0 items-center gap-3">
                      <AthleteAvatar athlete={athlete} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{athlete.name}{athlete.is_self && <span className="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">You</span>}</p>
                        <p className="truncate text-xs text-slate-500">{count} PB{count === 1 ? "" : "s"}<span className="md:hidden">{athlete.group && ` · ${athlete.group}`} · {athlete.course}</span></p>
                      </div>
                    </div>
                    <span className="hidden truncate text-sm text-slate-300 md:block">{athlete.group || "—"}</span>
                    <span className="hidden text-sm text-slate-300 md:block">{athlete.course}</span>
                    <span className="hidden text-sm text-slate-400 md:block">{athlete.updated_at ? new Date(athlete.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : athlete.imported ? "From PBs" : "—"}</span>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => guard(() => { selectAthlete(athlete); setTab("calc") })} className="h-8 rounded-full border-accent/30 bg-accent/10 px-3 text-xs text-cyan-100 hover:bg-accent/20">Open</Button>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${athlete.name}`} onClick={() => setMeta({ mode: "edit", id: athlete.id, name: athlete.name, group: athlete.group, course: athlete.course, notes: athlete.notes })} className="h-8 w-8 rounded-full text-slate-400 hover:text-white"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" disabled={athlete.is_self && athlete.imported} aria-label={athlete.is_self ? "Reset my PBs" : `Delete ${athlete.name}`} title={athlete.is_self ? "Reset to your recorded PBs" : "Delete"}
                        onClick={() => setRemoving(athlete)} className="h-8 w-8 rounded-full text-slate-400 hover:bg-rose-500/15 hover:text-rose-200">{athlete.is_self ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}</Button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {!filtered.length && <p className="mt-6 text-center text-sm text-slate-500">No athletes match “{query}”.</p>}
          </Tile>
        </Reveal>
      )}

      <Dialog open={!!meta} onOpenChange={(open) => { if (!open) setMeta(null) }}>
        <DialogContent className="border-white/10 bg-[#0d151c] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">{meta?.mode === "add" ? "Add athlete" : "Edit athlete"}</DialogTitle>
            <DialogDescription className="text-slate-400">{meta?.mode === "add" ? "Add a swimmer, then enter their PBs on the calculator." : "Name, group and default course. PBs are edited on the calculator."}</DialogDescription>
          </DialogHeader>
          {meta && <div className="space-y-3">
            <label className={labelClass}>Name<Input autoFocus maxLength={80} value={meta.name} onChange={(event) => setMeta({ ...meta, name: event.target.value })} className={inputClass} placeholder="Swimmer's name" /></label>
            <label className={labelClass}>Group<Input maxLength={60} value={meta.group} onChange={(event) => setMeta({ ...meta, group: event.target.value })} className={inputClass} placeholder="e.g. Sprint squad" /></label>
            <div className={labelClass}>Default course<Segmented label="Default course" value={meta.course} onChange={(value) => setMeta({ ...meta, course: value })} options={COURSES.map((value) => ({ value, label: value }))} /></div>
            <label className={labelClass}>Notes<Textarea maxLength={1000} rows={3} value={meta.notes} onChange={(event) => setMeta({ ...meta, notes: event.target.value })} className={textareaClass} placeholder="Optional" /></label>
          </div>}
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setMeta(null)}>Cancel</Button>
            <Button disabled={!meta?.name.trim() || saving} onClick={() => void saveMeta()} className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{meta?.mode === "add" ? "Add athlete" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null) }}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{removing?.is_self ? "Reset your PBs?" : `Delete ${removing?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">{removing?.is_self ? "Your saved calculator PBs will be replaced with the PBs recorded in your account." : "Their PBs and threshold tests will be removed. This can't be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-rose-500 text-white hover:bg-rose-400" onClick={() => void remove()}>{removing?.is_self ? "Reset" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!discard} onOpenChange={(open) => { if (!open) setDiscard(null) }}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Discard unsaved PBs?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">You changed {draft.name}'s PBs without saving. Switching athletes will drop those changes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep editing</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-rose-500 text-white hover:bg-rose-400" onClick={() => { const action = discard; setDiscard(null); action?.() }}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
