"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Check, Dumbbell, Info, Plus, RotateCcw, Sparkles, Star, Wand2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CoachAvatar } from "@/components/coach-avatar"
import { CoachCard, type CoachProfile } from "@/components/coach-card"
import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export type CoachAnswers = {
  main_events: string[]
  swimmer_type: string
  facilities: string[]
  gym_sessions_per_week: number
  swim_sessions_per_week: number
}

/** Each coach keeps one colour everywhere in the picker. */
const TONES: Record<string, { avatar: string; ring: string; glow: string; text: string }> = {
  brad: { avatar: "from-cyan-200 via-cyan-400 to-sky-600", ring: "ring-cyan-300/70", glow: "rgba(34,211,238,0.35)", text: "text-cyan-200" },
  pete: { avatar: "from-amber-100 via-amber-300 to-orange-500", ring: "ring-amber-300/70", glow: "rgba(251,191,36,0.32)", text: "text-amber-200" },
  timothy: { avatar: "from-rose-200 via-pink-400 to-fuchsia-600", ring: "ring-pink-300/70", glow: "rgba(244,114,182,0.32)", text: "text-pink-200" },
  robert: { avatar: "from-violet-200 via-violet-400 to-indigo-600", ring: "ring-violet-300/70", glow: "rgba(167,139,250,0.35)", text: "text-violet-200" },
  tony: { avatar: "from-emerald-100 via-emerald-300 to-teal-600", ring: "ring-emerald-300/70", glow: "rgba(52,211,153,0.32)", text: "text-emerald-200" },
}
const toneOf = (key: string) => TONES[key] ?? TONES.brad

function Avatar({ coach, size = "md", className }: { coach: Pick<CoachProfile, "key" | "name">; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "h-8 w-8", md: "h-12 w-12", lg: "h-14 w-14" }
  return <CoachAvatar name={coach.name} className={cn(sizes[size], className)} />
}

/**
 * Onboarding's coach step: every coach with how they fit the athlete's answers, the top match flagged, and a free
 * choice of one coach, who writes every session in the athlete's plan.
 */
export function CoachPicker({ answers, value, onChange, invalid }: {
  answers: CoachAnswers
  value: string
  onChange: (coach: string) => void
  invalid?: boolean
}) {
  const [coaches, setCoaches] = useState<CoachProfile[] | null>(null)
  const [recommended, setRecommended] = useState("")
  const [failed, setFailed] = useState(false)
  const [details, setDetails] = useState<CoachProfile | null>(null)
  const [attempt, setAttempt] = useState(0)
  const request = JSON.stringify(answers)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    fetch(`${API_URL}/api/coaches/options`, { method: "POST", headers: { "Content-Type": "application/json" }, body: request, signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() })
      .then((result: { coaches: CoachProfile[]; recommended: string }) => {
        setCoaches(result.coaches)
        setRecommended(result.recommended)
        // Drop a pick that isn't a coach any more (e.g. an old draft).
        if (valueRef.current && !result.coaches.some((coach) => coach.name === valueRef.current)) onChange("")
      })
      .catch((error) => { if (!controller.signal.aborted) { console.error("Coach options failed:", error); setFailed(true) } })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, attempt])

  if (failed) {
    return (
      <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-center text-sm text-rose-100">
        We couldn&apos;t load the coaches.
        <Button type="button" variant="outline" size="sm" className="ml-3" onClick={() => setAttempt((count) => count + 1)}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Try again
        </Button>
      </div>
    )
  }
  if (!coaches) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading coaches">
        <div className="h-28 animate-pulse rounded-3xl bg-white/[0.04]" />
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((index) => <div key={index} className="h-64 animate-pulse rounded-3xl bg-white/[0.035]" style={{ animationDelay: `${index * 120}ms` }} />)}
        </div>
      </div>
    )
  }

  const byName = (name: string) => coaches.find((coach) => coach.name === name)
  const chosen = value ? byName(value) : undefined
  const top = byName(recommended)
  const eventCount = answers.main_events.length

  const toggle = (name: string) => onChange(value === name ? "" : name)

  return (
    <div className="space-y-6">
      {/* Recommendation */}
      {top && (
        <section className="cp-reco relative overflow-hidden rounded-3xl border border-accent/25 p-5 sm:p-6">
          <span aria-hidden className="cp-reco-shine" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            <Avatar coach={top} size="lg" className="ring-4 ring-[#0f1a22]" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent"><Sparkles className="h-3.5 w-3.5" />Recommended for you</p>
              <p className="mt-1 text-lg font-semibold text-white">{top.name}</p>
              <p className="mt-0.5 text-sm text-slate-400">
                Best fit for {eventCount === 1 ? "your event" : `your ${eventCount} events`} and swimmer type. You&apos;re free to choose anyone.
              </p>
            </div>
            <Button type="button" onClick={() => onChange(top.name)} disabled={value === top.name}
              className={cn("shrink-0 rounded-full font-semibold", value === top.name ? "bg-emerald-400/15 text-emerald-200 disabled:opacity-100" : "bg-accent text-accent-foreground hover:bg-accent/90")}>
              {value === top.name ? <><Check className="mr-1.5 h-4 w-4" strokeWidth={3} />Selected</> : <><Wand2 className="mr-1.5 h-4 w-4" />Choose {top.name.replace(/^Coach\s+/i, "")}</>}
            </Button>
          </div>
        </section>
      )}

      {/* Your coach */}
      <section id="coach" tabIndex={-1} aria-label="Your coach"
        className={cn("rounded-3xl border p-3 outline-none", invalid ? "border-rose-400/50 bg-rose-500/[0.04]" : "border-white/10 bg-white/[0.02]")}>
        <CoachSlot coach={chosen} onRemove={() => onChange("")} onDetails={setDetails} />
      </section>
      {invalid && <p role="alert" className="-mt-3 text-xs font-medium text-rose-300">Choose your coach.</p>}

      {/* Every coach */}
      <div className="grid gap-4 md:grid-cols-2">
        {coaches.map((coach, index) => {
          const selected = coach.name === value
          const tone = toneOf(coach.key)
          return (
            <article key={coach.key} style={{ "--i": index, "--glow": tone.glow } as CSSProperties}
              className={cn("cp-card group relative flex flex-col overflow-hidden rounded-3xl border p-5 transition-all duration-300",
                selected ? cn("cp-selected border-transparent ring-2", tone.ring) : "border-white/10 hover:-translate-y-0.5 hover:border-white/20")}>
              <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-80", tone.avatar)} />
              {selected && (
                <span className="cp-pop absolute right-4 top-4 flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-950">
                  <Check className="h-3 w-3" strokeWidth={3.5} />Your coach
                </span>
              )}
              <div className={cn("flex items-start gap-3.5", selected && "pr-28")}>
                <Avatar coach={coach} />
                <div className="min-w-0">
                  <h3 className="text-lg font-bold leading-tight text-white">{coach.name}</h3>
                  <p className="text-sm text-slate-300">{coach.title}</p>
                  {coach.inspired_by && <p className="text-xs text-slate-500">Inspired by {coach.inspired_by}</p>}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {coach.recommended && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">
                    <Star className="h-3 w-3" fill="currentColor" />Top match
                  </span>
                )}
                <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  coach.covered_events.length ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-white/10 text-slate-400")}>
                  Covers {coach.covered_events.length} of your {eventCount} event{eventCount === 1 ? "" : "s"}
                </span>
                {coach.requires_gym && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300"><Dumbbell className="h-3 w-3" />Gym program</span>
                )}
              </div>

              <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-400">{coach.summary}</p>
              <ul className="mt-3 space-y-1.5">
                {coach.reasons.slice(0, 2).map((reason) => (
                  <li key={reason} className="flex gap-2 text-[13px] leading-5 text-slate-300">
                    <Sparkles className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone.text)} />{reason}
                  </li>
                ))}
              </ul>

              {/* Narrow cards (phones, and the two-column grid on tablets) wrap the choose button onto its own full-width row. */}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                <Button type="button" variant="ghost" onClick={() => setDetails(coach)} className="rounded-full text-slate-300 hover:bg-white/[0.06] hover:text-white">
                  <Info className="mr-1.5 h-4 w-4" />Details
                </Button>
                <Button type="button" onClick={() => toggle(coach.name)}
                  className={cn("max-w-full rounded-full font-semibold transition-all",
                    selected ? "ml-auto bg-white/10 text-white hover:bg-rose-500/20 hover:text-rose-100" : "grow bg-white text-slate-950 hover:bg-accent")}>
                  {selected ? <><X className="mr-1.5 h-4 w-4" />Remove</>
                    : <><Plus className="mr-1.5 h-4 w-4" /><span className="truncate">{value ? "Switch to this coach" : "Choose this coach"}</span></>}
                </Button>
              </div>
            </article>
          )
        })}
      </div>

      {details && (
        <CoachSheet coach={details} current={value} onToggle={() => toggle(details.name)} onClose={() => setDetails(null)} />
      )}
    </div>
  )
}

function CoachSlot({ coach, onRemove, onDetails }: { coach?: CoachProfile; onRemove: () => void; onDetails: (coach: CoachProfile) => void }) {
  return (
    <div className={cn("relative flex min-h-[92px] items-center gap-3 rounded-2xl p-3.5 transition-colors",
      coach ? "cp-slot-in bg-white/[0.05]" : "border border-dashed border-white/12")}>
      {coach ? (
        <>
          <Avatar coach={coach} />
          <button type="button" onClick={() => onDetails(coach)} className="min-w-0 flex-1 text-left">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Your coach</span>
            <span className="block truncate font-semibold text-white">{coach.name}</span>
            <span className="block truncate text-xs text-slate-400">{coach.title}</span>
          </button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${coach.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </>
      ) : (
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Your coach</span>
          <span className="mt-0.5 block text-sm text-slate-400">Choose one coach below. They write every session in your plan.</span>
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- full coach profile
function CoachSheet({ coach, current, onToggle, onClose }: {
  coach: CoachProfile; current: string; onToggle: () => void; onClose: () => void
}) {
  const selected = coach.name === current
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow }
  }, [onClose])
  if (typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-label={`${coach.name} profile`}>
      <button type="button" aria-label="Close" onClick={onClose} className="cp-sheet-backdrop absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div className="cp-sheet relative flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[#0b131a] shadow-[-30px_0_80px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3.5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Coach profile</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close coach profile"
            className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <CoachCard coach={coach} index={0} alwaysOpen
            label={coach.recommended ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">Top match for you</span> : "Coach"} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/8 bg-black/30 px-5 py-4">
          <p className="hidden text-sm text-slate-400 sm:block">
            {selected ? "Your coach" : current ? `Choosing ${coach.name} replaces ${current}.` : "One coach writes every session in your plan."}
          </p>
          <Button type="button" onClick={() => { onToggle(); if (!selected) onClose() }}
            className={cn("ml-auto rounded-full px-6 font-semibold", selected ? "bg-white/10 text-white hover:bg-rose-500/20" : "bg-accent text-accent-foreground hover:bg-accent/90")}>
            {selected ? <><X className="mr-1.5 h-4 w-4" />Remove</>
              : <><Plus className="mr-1.5 h-4 w-4" />{current ? "Switch to this coach" : "Choose this coach"}</>}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
