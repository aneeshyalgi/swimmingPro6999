"use client"

import { useState, type ReactNode } from "react"
import {
  Activity, CalendarDays, Check, Loader2, MapPin, Medal, Plus, Save, Sparkles, Star, Target, Timer, Trash2, TrendingUp, Trophy,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Competition, RaceResultData } from "@/lib/training"
import { cn } from "@/lib/utils"

export const fieldClass = "h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm font-normal text-slate-100 transition-colors hover:border-white/20 focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/20 disabled:opacity-50 [&>option]:bg-[#0d151c]"
function IconField({ id, label, icon: Icon, className, children }: { id?: string; label: string; icon: LucideIcon; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-slate-400">{label}</Label>
      <div className="group/field relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within/field:text-accent" />
        {children}
      </div>
    </div>
  )
}

function Suffix({ children }: { children: ReactNode }) {
  return <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500">{children}</span>
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-300",
      checked ? "border-accent bg-accent text-accent-foreground shadow-[0_0_12px_rgba(87,229,234,0.45)]" : "border-white/20 bg-white/[0.03]")}>
      <Check className={cn("h-3.5 w-3.5 transition-transform duration-300", checked ? "scale-100" : "scale-0")} strokeWidth={3} />
    </span>
  )
}

const priorities = [
  { value: "A", label: "Main target", detail: "Your key meet of the season", icon: Trophy, active: "border-amber-300/60 bg-[linear-gradient(140deg,rgba(251,191,36,0.2),rgba(251,191,36,0.04))] shadow-[0_10px_30px_rgba(251,191,36,0.15)]", iconTone: "bg-amber-300/20 text-amber-200" },
  { value: "B", label: "Development", detail: "Tune-up race to sharpen skills", icon: TrendingUp, active: "border-accent/60 bg-[linear-gradient(140deg,rgba(87,229,234,0.18),rgba(87,229,234,0.03))] shadow-[0_10px_30px_rgba(87,229,234,0.15)]", iconTone: "bg-accent/20 text-accent" },
  { value: "C", label: "Practice", detail: "Race experience, train through", icon: Target, active: "border-violet-300/50 bg-[linear-gradient(140deg,rgba(167,139,250,0.18),rgba(167,139,250,0.03))] shadow-[0_10px_30px_rgba(167,139,250,0.12)]", iconTone: "bg-violet-400/20 text-violet-200" },
]

const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"
const premiumInput = "h-11 rounded-xl border-white/10 bg-white/[0.03] transition-colors hover:border-white/20 focus-visible:border-accent/50 focus-visible:ring-accent/20"
const primaryButton = "h-11 rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 px-6 font-semibold text-slate-950 shadow-[0_10px_30px_rgba(87,229,234,0.3)] transition-all hover:-translate-y-0.5 hover:from-cyan-200 hover:to-sky-300 disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"

export function CompetitionForm({ events, mainEvents, poolLength, busy, onSave }: {
  events: string[]; mainEvents: string[]; poolLength: number | null; busy: boolean
  onSave: (payload: { name: string; date: string; location: string; pool_length: number; events: string[]; priority: string }) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [day, setDay] = useState("")
  const [location, setLocation] = useState("")
  const [pool, setPool] = useState(String(poolLength || 25))
  const [entered, setEntered] = useState(() => mainEvents.filter((event) => poolLength !== 50 || event !== "100m IM"))
  const [priority, setPriority] = useState("B")
  const available = events.filter((event) => pool === "25" || event !== "100m IM")
  const choosePool = (value: string) => { setPool(value); if (value === "50") setEntered((current) => current.filter((event) => event !== "100m IM")) }
  return (
    <form className="space-y-7" onSubmit={async (e) => { e.preventDefault(); await onSave({ name, date: day, location, pool_length: Number(pool), events: entered, priority }) }}>
      <section className="space-y-4">
        <p className={sectionLabel}>Meet details</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <IconField id="meet-name" label="Competition name" icon={Trophy} className="sm:col-span-2">
            <Input id="meet-name" required maxLength={150} className={cn(premiumInput, "pl-10 text-base")} placeholder="e.g. National Championships" value={name} onChange={(e) => setName(e.target.value)} />
          </IconField>
          <IconField id="meet-date" label="Date" icon={CalendarDays}>
            <Input id="meet-date" required type="date" className={cn(premiumInput, "pl-10")} value={day} onChange={(e) => setDay(e.target.value)} />
          </IconField>
          <IconField id="meet-location" label="Location" icon={MapPin}>
            <Input id="meet-location" required maxLength={200} className={cn(premiumInput, "pl-10")} placeholder="Pool / city" value={location} onChange={(e) => setLocation(e.target.value)} />
          </IconField>
        </div>
      </section>

      <section className="space-y-3">
        <p id="meet-pool" className={sectionLabel}>Pool format</p>
        <div role="radiogroup" aria-labelledby="meet-pool" className="grid gap-3 sm:grid-cols-2">
          {[["25", "Short course", "SCM · 25m pool"], ["50", "Long course", "LCM · 50m pool"]].map(([value, title, detail]) => {
            const active = pool === value
            return (
              <button key={value} type="button" role="radio" aria-checked={active} onClick={() => choosePool(value)}
                className={cn("group relative flex items-center gap-4 overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 hover:-translate-y-0.5",
                  active ? "border-accent/60 bg-[linear-gradient(140deg,rgba(87,229,234,0.16),rgba(87,229,234,0.03))] shadow-[0_10px_30px_rgba(87,229,234,0.14)]" : "border-white/10 bg-white/[0.02] hover:border-white/25")}>
                <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors", active ? "bg-accent text-accent-foreground" : "bg-white/[0.06] text-slate-300")}>{value}m</span>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-white">{title}</span><span className="block text-xs text-slate-400">{detail}</span></span>
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors", active ? "border-accent" : "border-white/25")}><span className={cn("h-2.5 w-2.5 rounded-full bg-accent transition-transform duration-300", active ? "scale-100" : "scale-0")} /></span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <p id="meet-priority" className={sectionLabel}>Priority</p>
        <div role="radiogroup" aria-labelledby="meet-priority" className="grid gap-3 sm:grid-cols-3">
          {priorities.map((item) => {
            const active = priority === item.value
            return (
              <button key={item.value} type="button" role="radio" aria-checked={active} aria-label={`${item.value} · ${item.label}`} onClick={() => setPriority(item.value)}
                className={cn("relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 hover:-translate-y-0.5", active ? item.active : "border-white/10 bg-white/[0.02] hover:border-white/25")}>
                <span className="flex items-center justify-between">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl transition-colors", active ? item.iconTone : "bg-white/[0.06] text-slate-400")}><item.icon className="h-4 w-4" /></span>
                  <span className={cn("text-2xl font-black tracking-tight transition-colors", active ? "text-white" : "text-white/20")}>{item.value}</span>
                </span>
                <span className="mt-3 block font-semibold text-white">{item.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-400">{item.detail}</span>
              </button>
            )
          })}
        </div>
      </section>

      <fieldset className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <legend className={sectionLabel}>Entered events · onboarding events preselected</legend>
          <div className="flex items-center gap-1 text-xs">
            <span className="mr-1 rounded-full bg-accent/15 px-2.5 py-0.5 font-semibold tabular-nums text-cyan-100">{entered.length} selected</span>
            <button type="button" className="rounded-full px-2.5 py-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white" onClick={() => setEntered(available)}>Select all</button>
            <button type="button" className="rounded-full px-2.5 py-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white" onClick={() => setEntered([])}>Clear</button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {available.map((event) => {
            const checked = entered.includes(event)
            return (
              <label key={event} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition-all duration-300 hover:border-white/25 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40",
                checked ? "border-accent/40 bg-accent/[0.08] text-white" : "border-white/[0.08] bg-white/[0.02] text-slate-300")}>
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => setEntered((current) => current.includes(event) ? current.filter((value) => value !== event) : [...current, event])} />
                <CheckMark checked={checked} />
                <span className="min-w-0 flex-1 truncate font-medium">{event}</span>
                {mainEvents.includes(event) && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-300/80 text-amber-300" aria-label="Main event" />}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-5">
        <p className="text-xs text-slate-500">{entered.length ? "Race plans can be generated for each entered event once saved." : "Choose at least one event to save this meet."}</p>
        <Button disabled={busy || !entered.length} type="submit" className={primaryButton}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Competition</Button>
      </div>
    </form>
  )
}

export function RaceResultForm({ meet, event, busy, onSave }: {
  meet: Competition; event: string; busy: boolean; onSave: (result: RaceResultData) => Promise<void>
}) {
  const existing = meet.results.find((item) => item.result.event === event)?.result
  const [finalTime, setFinalTime] = useState(existing?.final_time || "")
  const [ranking, setRanking] = useState(existing?.ranking ? String(existing.ranking) : "")
  const [strokeRate, setStrokeRate] = useState(existing?.stroke_rate ? String(existing.stroke_rate) : "")
  const [underwaters, setUnderwaters] = useState(existing?.underwaters || "")
  const [feedback, setFeedback] = useState(existing?.feedback || "")
  const [splits, setSplits] = useState(existing?.splits || [])
  const splitTotal = splits.reduce((sum, split) => sum + (split.seconds || 0), 0)
  const splitDistance = splits.reduce((sum, split) => sum + (split.distance_meters || 0), 0)
  return (
    <form className="space-y-6" onSubmit={async (e) => {
      e.preventDefault()
      await onSave({ event, final_time: finalTime, ranking: ranking ? Number(ranking) : null,
        stroke_rate: strokeRate ? Number(strokeRate) : null, underwaters, feedback, splits })
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <IconField id={`result-time-${meet.id}-${event}`} label="Final time" icon={Timer}>
          <Input id={`result-time-${meet.id}-${event}`} required className={cn(premiumInput, "pl-10 font-semibold tabular-nums")} value={finalTime} onChange={(e) => setFinalTime(e.target.value)} placeholder="MM:SS.xx or seconds" />
        </IconField>
        <IconField id={`result-rank-${meet.id}-${event}`} label="Ranking (optional)" icon={Medal}>
          <Input id={`result-rank-${meet.id}-${event}`} type="number" min={1} className={cn(premiumInput, "pl-10")} value={ranking} onChange={(e) => setRanking(e.target.value)} placeholder="Place" />
        </IconField>
        <IconField id={`result-rate-${meet.id}-${event}`} label="Stroke rate (cycles/min)" icon={Activity}>
          <Input id={`result-rate-${meet.id}-${event}`} type="number" step="0.1" min="0.1" max={150} className={cn(premiumInput, "pl-10")} value={strokeRate} onChange={(e) => setStrokeRate(e.target.value)} placeholder="Optional" />
        </IconField>
      </div>
      <fieldset className="space-y-3 rounded-2xl border border-white/[0.07] bg-black/15 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className={sectionLabel}>Actual segment splits · seconds, not cumulative</legend>
          {splits.length > 0 && <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs tabular-nums text-slate-300">{splitDistance}m · {splitTotal.toFixed(2)}s total</span>}
        </div>
        {splits.map((split, index) => <div key={index} className="dash-reveal flex items-end gap-2">
          <span className="mb-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">{index + 1}</span>
          <label className="min-w-0 flex-1 space-y-1.5 text-xs text-slate-400">Segment distance (m)<span className="relative block"><Input type="number" min={25} max={1500} required className={cn(premiumInput, "pr-9")} value={split.distance_meters} onChange={(e) => setSplits((current) => current.map((item, i) => i === index ? { ...item, distance_meters: Number(e.target.value) } : item))} /><Suffix>m</Suffix></span></label>
          <label className="min-w-0 flex-1 space-y-1.5 text-xs text-slate-400">Segment time (sec)<span className="relative block"><Input type="number" min="0.01" max={7200} step="0.01" required className={cn(premiumInput, "pr-9 tabular-nums")} value={split.seconds || ""} onChange={(e) => setSplits((current) => current.map((item, i) => i === index ? { ...item, seconds: Number(e.target.value) } : item))} /><Suffix>s</Suffix></span></label>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove split ${index + 1}`} className="mb-0.5 h-10 w-10 shrink-0 rounded-full text-slate-400 hover:bg-rose-500/15 hover:text-rose-200" onClick={() => setSplits((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <button type="button" onClick={() => setSplits((current) => [...current, { distance_meters: 50, seconds: 0 }])}
          className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-3 text-sm font-medium text-slate-300 transition-all duration-300 hover:border-accent/50 hover:bg-accent/[0.06] hover:text-white">
          <Plus className="h-4 w-4 text-accent transition-transform duration-300 group-hover:rotate-90" />Add split
        </button>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-xs font-medium text-slate-400">Underwaters / breakout observations<Textarea maxLength={1000} className="rounded-xl border-white/10 bg-white/[0.03] focus-visible:border-accent/50 focus-visible:ring-accent/20" value={underwaters} onChange={(e) => setUnderwaters(e.target.value)} placeholder="e.g. 5 kicks off each wall, breakout at 7m" /></label>
        <label className="block space-y-1.5 text-xs font-medium text-slate-400">Athlete feedback<Textarea maxLength={2000} className="rounded-xl border-white/10 bg-white/[0.03] focus-visible:border-accent/50 focus-visible:ring-accent/20" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="How did the race feel?" /></label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy} className={primaryButton}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{existing ? "Update Result & Analysis" : "Save Result & Analyse"}</Button>
      </div>
    </form>
  )
}
