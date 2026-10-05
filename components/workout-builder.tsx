"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowDown, ArrowLeft, ArrowUp, CalendarDays, Check, ChevronDown, Clock, Copy, Download, Dumbbell, Eraser, FileText, Layers,
  ListChecks, Loader2, MapPin, MoreHorizontal, Plus, Save, Tag, Trash2, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCountUp } from "@/components/dashboard-ui"
import { Segmented, inputClass, shortDate } from "@/components/training-ui"
import { cn } from "@/lib/utils"
import { downloadGymPdf, gymSavedSchema, gymWeekSchema, trainingRequest, type BuilderExercise, type BuilderSection, type GymWeek } from "@/lib/training"
import {
  QUICK_ADD, SECTION_KINDS, TEMPLATES, docPayload, docSummary, exercise as newExercise, isBlank, placeholderFor, section as newSection,
  sectionStats, type BuilderDoc,
} from "@/lib/workout-builder"

type Status = "draft" | "unsaved" | "saving" | "saved" | "error"
const LABELS = ["AM", "PM", "Gym", "Home", "Recovery"]
const KIND_TONES: Record<string, string> = {
  warmup: "bg-orange-300", activation: "bg-amber-300", main: "bg-violet-400", power: "bg-fuchsia-400", accessory: "bg-sky-300",
  core: "bg-emerald-400", conditioning: "bg-rose-400", mobility: "bg-teal-300", cooldown: "bg-cyan-300", custom: "bg-slate-400",
}
const fieldLabel = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"
const cellInput = "h-9 rounded-lg border-white/10 bg-black/20 px-2.5 text-sm transition-colors hover:border-white/20 focus-visible:border-violet-300/60 focus-visible:ring-violet-300/20"

function Stat({ label, value, unit, big }: { label: string; value: number; unit?: string; big?: boolean }) {
  const shown = useCountUp(value, 500)
  return (
    <div className={cn(big && "text-right")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={cn("font-bold tabular-nums tracking-tight text-white", big ? "text-4xl sm:text-5xl" : "text-2xl")}>{shown}{unit && <span className="ml-1 text-sm font-medium text-slate-400">{unit}</span>}</p>
    </div>
  )
}

export function AutoTextarea({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = "0px"
    element.style.height = `${Math.max(44, element.scrollHeight)}px`
  }, [value])
  return <Textarea ref={ref} aria-label={label} rows={1} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)}
    className="min-h-11 resize-none overflow-hidden rounded-xl border-white/[0.06] bg-black/15 text-[15px] leading-6 transition-colors placeholder:text-slate-600 hover:border-white/15 focus-visible:border-violet-300/50 focus-visible:ring-violet-300/20" />
}

export function IconButton({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return <Button type="button" size="icon" variant="ghost" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={cn("h-8 w-8 rounded-full text-slate-400 hover:text-white", danger && "hover:bg-rose-500/15 hover:text-rose-200")}>{children}</Button>
}

/** The manual Workout Builder: sections of exercises, autosaved to the athlete's account. No AI. */
export function WorkoutBuilder({ initial, itemKey, isNew, onBack, onSaved, onDeleted, onNotice }: {
  initial: BuilderDoc
  itemKey: string | null
  isNew: boolean
  onBack: (saved: boolean) => void
  onSaved: (week: GymWeek) => void
  onDeleted: (week: GymWeek) => void
  onNotice: (message: string) => void
}) {
  const [doc, setDoc] = useState<BuilderDoc>(initial)
  const [key, setKey] = useState<string | null>(itemKey)
  const [status, setStatus] = useState<Status>(itemKey ? "saved" : "draft")
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focusRow, setFocusRow] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: string; run: () => void }>(null)
  const [duplicateDate, setDuplicateDate] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  const docRef = useRef(doc)
  const keyRef = useRef(key)
  const timer = useRef<number | null>(null)
  const saving = useRef<Promise<boolean> | null>(null)
  const dirty = useRef(false)
  docRef.current = doc
  keyRef.current = key
  const summary = docSummary(doc)

  const persist = useCallback(async (): Promise<boolean> => {
    if (timer.current) window.clearTimeout(timer.current)
    if (saving.current) await saving.current
    if (!dirty.current) return true
    const current = docRef.current
    if (!keyRef.current && isBlank(current)) return true
    dirty.current = false
    setStatus("saving"); setError(null)
    const job = (async () => {
      try {
        const payload = docPayload(current)
        const result = keyRef.current
          ? await trainingRequest(`/gym/${encodeURIComponent(keyRef.current)}`, gymSavedSchema, { method: "PUT", body: payload })
          : await trainingRequest("/gym", gymSavedSchema, { body: payload })
        setKey(result.item.key); keyRef.current = result.item.key
        setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
        setStatus(dirty.current ? "unsaved" : "saved")
        onSaved(result.week)
        return true
      } catch (failure) {
        dirty.current = true
        setStatus("error"); setError(failure instanceof Error ? failure.message : "Your changes could not be saved.")
        return false
      } finally {
        saving.current = null
      }
    })()
    saving.current = job
    return job
  }, [onSaved])

  const change = (next: BuilderDoc | ((current: BuilderDoc) => BuilderDoc)) => {
    setDoc(next)
    dirty.current = true
    setStatus("unsaved")
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void persist() }, 1000)
  }
  const update = (patch: Partial<BuilderDoc>) => change((current) => ({ ...current, ...patch }))
  const updateSection = (id: string, patch: Partial<BuilderSection> | ((entry: BuilderSection) => BuilderSection)) =>
    change((current) => ({ ...current, sections: current.sections.map((entry) => entry.id === id ? (typeof patch === "function" ? patch(entry) : { ...entry, ...patch }) : entry) }))
  const updateRow = (id: string, index: number, patch: Partial<BuilderExercise>) =>
    updateSection(id, (entry) => ({ ...entry, exercises: entry.exercises.map((row, i) => i === index ? { ...row, ...patch } : row) }))
  const addRow = (id: string, name = "") => {
    const entry = docRef.current.sections.find((item) => item.id === id)
    updateSection(id, (current) => ({ ...current, collapsed: false, exercises: [...current.exercises, newExercise(name)] }))
    if (!name) setFocusRow(`${id}:${entry?.exercises.length ?? 0}`)
  }
  const moveSection = (index: number, direction: number) => change((current) => {
    const next = [...current.sections]
    const target = index + direction
    if (target < 0 || target >= next.length) return current
    ;[next[index], next[target]] = [next[target], next[index]]
    return { ...current, sections: next }
  })

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void persist() }
    }
    const leave = (event: BeforeUnloadEvent) => { if (dirty.current || saving.current) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("keydown", keys)
    window.addEventListener("beforeunload", leave)
    return () => { window.removeEventListener("keydown", keys); window.removeEventListener("beforeunload", leave); if (timer.current) window.clearTimeout(timer.current) }
  }, [persist])

  /** Save any pending changes, then return to the calendar (used by Calendar, Save and Done). */
  const back = async () => { if (await persist()) onBack(!!keyRef.current) }
  const exportPdf = async () => {
    setExporting(true)
    try {
      if (!(await persist())) return
      if (!keyRef.current) { setError("Add a title or an exercise before exporting."); return }
      await downloadGymPdf(keyRef.current, docRef.current.title || "workout")
      onNotice("PDF downloaded.")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The PDF could not be created.")
    } finally { setExporting(false) }
  }
  const applyTemplate = (index: number) => {
    const apply = () => change((current) => ({ ...current, ...TEMPLATES[index].build(), title: current.title.trim() || TEMPLATES[index].build().title }))
    if (isBlank(docRef.current)) apply()
    else setConfirm({ title: "Replace your sections?", body: `“${TEMPLATES[index].name}” will replace the current sections. Your title, date and details stay.`, action: "Replace", run: apply })
  }
  const duplicate = async () => {
    if (!duplicateDate) return
    if (!(await persist()) || !keyRef.current) return
    try {
      const result = await trainingRequest(`/gym/${encodeURIComponent(keyRef.current)}/duplicate`, gymSavedSchema, { body: { date: duplicateDate } })
      onSaved(result.week)
      onNotice(`Duplicated to ${shortDate(duplicateDate, { weekday: "long", day: "numeric", month: "short" })}.`)
      setDuplicateDate(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The workout could not be duplicated.") }
  }
  const remove = async () => {
    if (timer.current) window.clearTimeout(timer.current)
    dirty.current = false
    if (!keyRef.current) { onBack(false); return }
    try {
      const week = await trainingRequest(`/gym/${encodeURIComponent(keyRef.current)}`, gymWeekSchema, { method: "DELETE" })
      onDeleted(week)
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The workout could not be deleted.") }
  }

  const statusView = {
    draft: { text: "Draft · not saved yet", dot: "bg-slate-500" },
    unsaved: { text: "Unsaved changes", dot: "bg-amber-300 animate-pulse" },
    saving: { text: "Saving…", dot: "bg-cyan-300 animate-pulse" },
    saved: { text: savedAt ? `Saved ${savedAt}` : "Saved", dot: "bg-emerald-400" },
    error: { text: "Not saved", dot: "bg-rose-400" },
  }[status]

  return (
    <div className="dash-reveal space-y-5">
      {/* Toolbar */}
      <div className="sticky top-[124px] z-30 lg:top-[72px]">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0b1218]/85 px-3 py-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-4">
          <Button variant="ghost" onClick={() => void back()} className="h-9 rounded-full px-3 text-slate-300 hover:text-white"><ArrowLeft className="mr-1.5 h-4 w-4" />Gym week</Button>
          <span className="hidden h-5 w-px bg-white/10 sm:block" />
          <p className="flex items-center gap-2 text-sm font-semibold text-white"><Dumbbell className="h-4 w-4 text-violet-300" /><span className="hidden sm:inline">Workout Builder</span></p>
          <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
            {status === "saving" ? <Loader2 className="h-3 w-3 animate-spin text-cyan-300" /> : <span className={cn("h-1.5 w-1.5 rounded-full", statusView.dot)} />}{statusView.text}
          </span>
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="h-9 rounded-full border-white/10 bg-white/[0.03]"><Layers className="mr-1.5 h-4 w-4 text-violet-300" />Templates</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 border-white/10 bg-[#0d151c]">
              <DropdownMenuLabel className="text-xs text-slate-400">Start from a template</DropdownMenuLabel>
              {TEMPLATES.map((template, index) => <DropdownMenuItem key={template.name} onSelect={() => applyTemplate(index)} className="flex flex-col items-start gap-0">
                <span className="font-medium text-white">{template.name}</span><span className="text-xs text-slate-400">{template.description}</span>
              </DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => void back()} disabled={status === "saving"} title="Save and return to the gym week" className="h-9 rounded-full bg-gradient-to-r from-violet-300 to-cyan-300 px-4 font-semibold text-slate-950">
            {status === "saved" ? <Check className="mr-1.5 h-4 w-4" /> : <Save className="mr-1.5 h-4 w-4" />}Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="More actions" className="h-9 w-9 rounded-full"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 border-white/10 bg-[#0d151c]">
              <DropdownMenuItem onSelect={() => void exportPdf()}><Download className="mr-2 h-4 w-4" />Export PDF</DropdownMenuItem>
              <DropdownMenuItem disabled={!key && isBlank(doc)} onSelect={() => setDuplicateDate(doc.date)}><Copy className="mr-2 h-4 w-4" />Duplicate to…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirm({ title: "Clear this workout?", body: "Every section's notes and exercises will be removed. Your title and details stay.", action: "Clear workout",
                run: () => change((current) => ({ ...current, sections: current.sections.map((entry) => ({ ...entry, notes: "", exercises: [] })) })) })}><Eraser className="mr-2 h-4 w-4" />Clear workout</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-rose-300 focus:text-rose-200" onSelect={() => setConfirm({ title: "Delete this workout?", body: "It will be removed from your gym week. This can't be undone.", action: "Delete", run: () => void remove() })}>
                <Trash2 className="mr-2 h-4 w-4" />Delete workout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error && <p role="alert" className="mt-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error} <button type="button" className="ml-2 underline" onClick={() => { dirty.current = true; void persist() }}>Try again</button></p>}
      </div>

      {/* Document */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(170deg,rgba(22,30,40,0.92),rgba(9,13,18,0.96))] shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative space-y-7 p-5 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0 flex-1 basis-80">
              <label htmlFor="builder-title" className={fieldLabel}>Workout title</label>
              <input id="builder-title" autoFocus={isNew} value={doc.title} maxLength={150} onChange={(event) => update({ title: event.target.value })} placeholder="Name your workout…"
                className="w-full border-0 bg-transparent p-0 text-3xl font-bold tracking-tight text-white outline-none placeholder:text-slate-600 sm:text-4xl" />
            </div>
            <div className="flex items-end gap-6">
              <Stat label="Exercises" value={summary.exercises} />
              <Stat label="Total sets" value={summary.sets} big />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <label htmlFor="builder-date" className={fieldLabel}><CalendarDays className="mr-1 inline h-3 w-3" />Date</label>
              <Input id="builder-date" type="date" className={inputClass} value={doc.date} onChange={(event) => event.target.value && update({ date: event.target.value })} />
            </div>
            <div>
              <span className={fieldLabel}><Clock className="mr-1 inline h-3 w-3" />Time</span>
              <div className="flex items-center gap-1.5">
                <Input aria-label="Start time" type="time" className={inputClass} value={doc.start_time ?? ""} onChange={(event) => update({ start_time: event.target.value || null })} />
                <span className="text-slate-600">–</span>
                <Input aria-label="End time" type="time" className={inputClass} value={doc.end_time ?? ""} onChange={(event) => update({ end_time: event.target.value || null })} />
              </div>
            </div>
            <div>
              <label htmlFor="builder-location" className={fieldLabel}><MapPin className="mr-1 inline h-3 w-3" />Location</label>
              <Input id="builder-location" className={inputClass} maxLength={150} placeholder="Gym, home, pool deck…" value={doc.location} onChange={(event) => update({ location: event.target.value })} />
            </div>
            <div>
              <span className={fieldLabel}><Zap className="mr-1 inline h-3 w-3" />Intensity</span>
              <Segmented label="Intensity" value={doc.intensity} onChange={(intensity) => update({ intensity })} options={(["Minimal", "Moderate", "Full"] as const).map((value) => ({ value, label: value }))} />
            </div>
          </div>
          <div>
            <span className={fieldLabel}><Tag className="mr-1 inline h-3 w-3" />Label</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {LABELS.map((label) => <button key={label} type="button" aria-pressed={doc.label === label} onClick={() => update({ label: doc.label === label ? "" : label })}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-all duration-300", doc.label === label ? "border-violet-300/60 bg-violet-400/20 text-white" : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-white")}>{label}</button>)}
              <Input aria-label="Custom label" placeholder="Custom…" maxLength={40} value={LABELS.includes(doc.label) ? "" : doc.label} onChange={(event) => update({ label: event.target.value })} className={cn(inputClass, "h-7 w-28 rounded-full text-xs")} />
            </div>
          </div>
          <div>
            <label htmlFor="builder-notes" className={fieldLabel}>Goal / notes</label>
            <AutoTextarea label="Goal / notes" value={doc.notes} onChange={(notes) => update({ notes })} placeholder="What is this workout for?" />
          </div>

          {/* Sections */}
          <div className="space-y-4">
            {doc.sections.map((entry, index) => {
              const stats = sectionStats(entry)
              return (
                <section key={entry.id} aria-label={entry.title} className="group/section relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition-colors duration-300 focus-within:border-white/15 hover:border-white/15">
                  <span className={cn("absolute inset-y-0 left-0 w-1", KIND_TONES[entry.kind] ?? KIND_TONES.custom)} />
                  <div className="flex items-center gap-2 py-2.5 pl-4 pr-2 sm:pl-5">
                    <button type="button" aria-label={entry.collapsed ? "Expand section" : "Collapse section"} aria-expanded={!entry.collapsed} onClick={() => updateSection(entry.id, { collapsed: !entry.collapsed })}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-all hover:bg-white/[0.06] hover:text-white">
                      <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", entry.collapsed && "-rotate-90")} />
                    </button>
                    <input aria-label="Section title" value={entry.title} maxLength={80} onChange={(event) => updateSection(entry.id, { title: event.target.value })}
                      className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-bold uppercase tracking-[0.12em] text-violet-200 outline-none sm:text-base" />
                    {stats.exercises > 0 && <span className="hidden shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-300 sm:inline">{stats.exercises} ex · {stats.sets} sets</span>}
                    <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/section:opacity-100 sm:group-hover/section:opacity-100">
                      <IconButton label="Move section up" disabled={index === 0} onClick={() => moveSection(index, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                      <IconButton label="Move section down" disabled={index === doc.sections.length - 1} onClick={() => moveSection(index, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                      <IconButton label="Duplicate section" onClick={() => change((current) => {
                        const copy = { ...entry, id: Math.random().toString(36).slice(2, 10), title: `${entry.title} (copy)`, exercises: entry.exercises.map((row) => ({ ...row })) }
                        const next = [...current.sections]; next.splice(index + 1, 0, copy); return { ...current, sections: next }
                      })}><Copy className="h-4 w-4" /></IconButton>
                      <IconButton label={deleteArmed === entry.id ? "Tap again to delete section" : "Delete section"} danger disabled={doc.sections.length <= 1} onClick={() => {
                        if (deleteArmed === entry.id) { change((current) => ({ ...current, sections: current.sections.filter((item) => item.id !== entry.id) })); setDeleteArmed(null) }
                        else { setDeleteArmed(entry.id); window.setTimeout(() => setDeleteArmed((current) => current === entry.id ? null : current), 2500) }
                      }}>{deleteArmed === entry.id ? <Check className="h-4 w-4 text-rose-300" /> : <Trash2 className="h-4 w-4" />}</IconButton>
                    </div>
                  </div>
                  <div inert={entry.collapsed} className={cn("grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", entry.collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]")}>
                    <div className="min-w-0 overflow-hidden">
                      <div className="space-y-3 px-4 pb-4 sm:px-5">
                        <AutoTextarea label={`${entry.title} notes`} value={entry.notes} onChange={(notes) => updateSection(entry.id, { notes })} placeholder={placeholderFor(entry.kind)} />
                        {entry.exercises.length > 0 && <div className="hidden grid-cols-[1.75rem_minmax(0,2.2fr)_4.5rem_5.5rem_minmax(0,1.5fr)_5rem_2.25rem] gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 md:grid">
                          <span>#</span><span>Exercise</span><span>Sets</span><span>Reps</span><span>Load</span><span>Rest (s)</span><span />
                        </div>}
                        {entry.exercises.map((row, rowIndex) => (
                          <div key={rowIndex} className="dash-reveal rounded-xl border border-white/[0.06] bg-black/10 p-2 md:border-0 md:bg-transparent md:p-0">
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.75rem_minmax(0,2.2fr)_4.5rem_5.5rem_minmax(0,1.5fr)_5rem_2.25rem] md:items-center">
                              <span className="hidden h-7 w-7 items-center justify-center rounded-full bg-violet-400/15 text-xs font-bold text-violet-200 md:flex">{rowIndex + 1}</span>
                              <Input aria-label={`${entry.title} exercise ${rowIndex + 1}`} autoFocus={focusRow === `${entry.id}:${rowIndex}`} placeholder="Exercise" maxLength={150} value={row.name}
                                onChange={(event) => updateRow(entry.id, rowIndex, { name: event.target.value })}
                                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRow(entry.id) } }}
                                className={cn(cellInput, "col-span-2 font-medium md:col-span-1")} />
                              <Input aria-label="Sets" type="number" min={1} max={20} value={row.sets || ""} onChange={(event) => updateRow(entry.id, rowIndex, { sets: Number(event.target.value) })} className={cn(cellInput, "tabular-nums")} />
                              <Input aria-label="Reps" placeholder="10 / 30 s" maxLength={60} value={row.reps} onChange={(event) => updateRow(entry.id, rowIndex, { reps: event.target.value })} className={cellInput} />
                              <Input aria-label="Load" placeholder="Bodyweight, RPE 7…" maxLength={150} value={row.load} onChange={(event) => updateRow(entry.id, rowIndex, { load: event.target.value })} className={cellInput} />
                              <Input aria-label="Rest seconds" type="number" min={0} max={900} step={15} value={row.rest_seconds} onChange={(event) => updateRow(entry.id, rowIndex, { rest_seconds: Number(event.target.value) })} className={cn(cellInput, "tabular-nums")} />
                              <div className="col-span-2 flex justify-end md:col-span-1">
                                <IconButton label={`Remove exercise ${rowIndex + 1}`} danger onClick={() => updateSection(entry.id, (current) => ({ ...current, exercises: current.exercises.filter((_, i) => i !== rowIndex) }))}><Trash2 className="h-4 w-4" /></IconButton>
                              </div>
                            </div>
                            <div className="mt-2 grid gap-2 md:ml-9 md:grid-cols-[8rem_minmax(0,1fr)]">
                              <Input aria-label="Tempo" placeholder="Tempo (e.g. 3-1-1)" maxLength={40} value={row.tempo} onChange={(event) => updateRow(entry.id, rowIndex, { tempo: event.target.value })} className={cn(cellInput, "h-8 text-xs")} />
                              <Input aria-label="Exercise notes" placeholder="Coaching cue or notes" maxLength={500} value={row.notes} onChange={(event) => updateRow(entry.id, rowIndex, { notes: event.target.value })} className={cn(cellInput, "h-8 text-xs")} />
                            </div>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <Button type="button" variant="outline" disabled={entry.exercises.length >= 30} onClick={() => addRow(entry.id)} className="h-8 rounded-full border-dashed border-white/20 bg-transparent px-3 text-xs hover:border-violet-300/50 hover:bg-violet-400/[0.08]">
                            <Plus className="mr-1 h-3.5 w-3.5 text-violet-300" />Add exercise
                          </Button>
                          {(QUICK_ADD[entry.kind] ?? QUICK_ADD.custom).filter((name) => !entry.exercises.some((row) => row.name === name)).slice(0, 4).map((name) => (
                            <button key={name} type="button" onClick={() => addRow(entry.id, name)}
                              className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-slate-400 transition-all hover:-translate-y-0.5 hover:border-violet-300/40 hover:text-white">+ {name}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )
            })}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={doc.sections.length >= 20} className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-4 text-sm font-medium text-slate-300 transition-all duration-300 hover:border-violet-300/50 hover:bg-violet-400/[0.06] hover:text-white disabled:opacity-40">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-400/15 text-violet-200 transition-transform duration-300 group-hover:rotate-90"><Plus className="h-4 w-4" /></span>Add section
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="max-h-80 w-56 overflow-y-auto border-white/10 bg-[#0d151c]">
                {SECTION_KINDS.map((kind) => <DropdownMenuItem key={kind.kind} onSelect={() => change((current) => ({ ...current, sections: [...current.sections, newSection(kind.kind)] }))}>
                  <span className={cn("mr-2 h-2 w-2 rounded-full", KIND_TONES[kind.kind])} />{kind.title}
                </DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div>
            <label htmlFor="builder-coach-notes" className={fieldLabel}>Coach's notes</label>
            <AutoTextarea label="Coach's notes" value={doc.coaching_notes} onChange={(coaching_notes) => update({ coaching_notes })} placeholder="How should it feel? When to stop?" />
          </div>

          {/* Summary */}
          <section aria-label="Workout summary" className="grid gap-5 border-t border-white/[0.08] pt-6 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Stat label="Exercises" value={summary.exercises} />
            <Stat label="Total sets" value={summary.sets} />
            <div>
              <Stat label={summary.scheduled ? "Session length" : "Estimated time"} value={summary.minutes} unit="min" />
              {!summary.scheduled && <p className="mt-0.5 text-[11px] text-slate-500">From sets and rest · add a start and end time to fix it</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={exporting} onClick={() => void exportPdf()} className="rounded-full border-white/15 bg-white/[0.04]">{exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}Export PDF</Button>
              <Button onClick={() => void back()} className="rounded-full bg-gradient-to-r from-violet-300 to-cyan-300 font-semibold text-slate-950"><ListChecks className="mr-1.5 h-4 w-4" />Done</Button>
            </div>
          </section>
        </div>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null) }}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction className={cn("rounded-full", confirm?.action === "Delete" ? "bg-rose-500 text-white hover:bg-rose-400" : "bg-violet-300 text-slate-950 hover:bg-violet-200")}
              onClick={() => { confirm?.run(); setConfirm(null) }}>{confirm?.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={duplicateDate !== null} onOpenChange={(open) => { if (!open) setDuplicateDate(null) }}>
        <DialogContent className="border-white/10 bg-[#0d151c] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Duplicate to…</DialogTitle>
            <DialogDescription className="text-slate-400">A copy of this workout will be added on the date you pick.</DialogDescription>
          </DialogHeader>
          <Input type="date" aria-label="Duplicate to date" className={inputClass} value={duplicateDate ?? ""} onChange={(event) => setDuplicateDate(event.target.value)} />
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setDuplicateDate(null)}>Cancel</Button>
            <Button disabled={!duplicateDate} onClick={() => void duplicate()} className="rounded-full bg-violet-300 text-slate-950 hover:bg-violet-200"><Copy className="mr-1.5 h-4 w-4" />Duplicate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
