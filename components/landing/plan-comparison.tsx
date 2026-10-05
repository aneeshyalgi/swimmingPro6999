"use client"

import { Check, FileText, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCycle, useInView } from "@/components/landing/use-in-view"

const GENERIC_WEEKS = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]
const FAILS = [
  "The same paces for a 13-year-old and a national finalist",
  "Never knows what you actually swam yesterday",
  "Ignores your pool, your gym and your events",
  "No race plan, no splits, no taper logic",
]
const WINS = [
  "Six training zones paced from your own PBs",
  "Rebuilds the week around what you tick off",
  "Strength sessions written for the equipment you have",
  "Race plans and target splits for every event you enter",
]
// Session load per day for three successive adaptations of the same week (0-100).
const WEEKS = [
  [72, 40, 88, 30, 64, 92, 18],
  [72, 52, 58, 46, 70, 80, 26],
  [64, 46, 90, 22, 76, 68, 34],
]
const REASONS = ["Built from your PBs and events", "Eased Wednesday after a missed session", "Race-pace block moved before your meet"]
const DAYS = ["M", "T", "W", "T", "F", "S", "S"]
const COVERAGE = [
  { label: "Paces from your PBs", generic: 12 },
  { label: "Adapts to what you complete", generic: 4 },
  { label: "Strength for your equipment", generic: 18 },
  { label: "Race plans & splits", generic: 10 },
  { label: "Technique feedback", generic: 6 },
  { label: "Elite coach methods", generic: 22 },
]

/** "Why generic plans fail": a frozen PDF plan against a live, adapting SwimGPT week. */
export function PlanComparison() {
  const step = useCycle(WEEKS.length, 2600)
  const { ref, inView } = useInView<HTMLDivElement>(0.3)

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* Generic plan: static, grey, the same for everyone */}
        <div className="relative overflow-hidden rounded-[28px] border border-white/[0.07] bg-[linear-gradient(160deg,rgba(30,34,40,0.7),rgba(14,16,20,0.85))] p-6 grayscale sm:p-7">
          <div className="landing-noise pointer-events-none absolute inset-0 opacity-[0.06]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Generic plan</p>
          <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-300">One size. Fits no one.</h3>
          <div className="relative mt-6 rounded-2xl border border-white/[0.06] bg-black/30 p-4">
            <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3 text-xs text-slate-500">
              <FileText className="h-4 w-4" />12-week-swim-plan.pdf<span className="ml-auto">Page 1 of 1</span>
            </div>
            <ul className="mt-3 space-y-2 font-mono text-[12px] text-slate-500">
              {GENERIC_WEEKS.map((week) => (
                <li key={week} className="flex items-center justify-between gap-3">
                  <span>{week}</span><span className="text-slate-400">10 × 100 free @ 1:45</span><span className="text-slate-600">same</span>
                </li>
              ))}
            </ul>
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 -rotate-12 rounded-lg border-2 border-rose-400/40 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-rose-300/60">
              Same for everyone
            </span>
          </div>
          <ul className="mt-6 space-y-3">
            {FAILS.map((text) => (
              <li key={text} className="flex gap-3 text-sm text-slate-400">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-300/80"><X className="h-3 w-3" /></span>{text}
              </li>
            ))}
          </ul>
        </div>

        {/* VS */}
        <div className="flex items-center justify-center">
          <div className="relative flex h-16 w-16 items-center justify-center lg:h-20 lg:w-20">
            <span className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent,rgba(87,229,234,0.9),transparent_60%)] [animation-duration:3.5s]" />
            <span className="absolute inset-[2px] rounded-full bg-background" />
            <span className="relative text-sm font-black tracking-widest text-white">VS</span>
          </div>
        </div>

        {/* SwimGPT: live, adapting */}
        <div className="relative overflow-hidden rounded-[28px] border border-accent/30 bg-[linear-gradient(160deg,rgba(87,229,234,0.13),rgba(12,22,30,0.95)_45%,rgba(167,139,250,0.12))] p-6 shadow-[0_24px_70px_rgba(87,229,234,0.12)] sm:p-7">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
          <p className="relative flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300"><Sparkles className="h-3.5 w-3.5" />SwimGPT</p>
          <h3 className="relative mt-2 text-2xl font-bold tracking-tight text-white">A plan that thinks every day.</h3>
          <div className="relative mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
              <span className="text-xs font-medium text-slate-300">Your swim week</span>
              <span key={step} className="chip-pop truncate rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 text-[11px] text-cyan-100">{REASONS[step]}</span>
            </div>
            <div className="mt-4 grid h-28 grid-cols-7 items-end gap-2">
              {WEEKS[step].map((load, day) => (
                <div key={day} className="flex h-full flex-col items-center justify-end gap-1.5">
                  <div className="relative w-full overflow-hidden rounded-lg bg-white/[0.04]" style={{ height: "100%" }}>
                    <div className="absolute inset-x-0 bottom-0 rounded-lg bg-gradient-to-t from-sky-500/80 via-cyan-300/80 to-cyan-100 shadow-[0_0_18px_rgba(87,229,234,0.35)] transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{ height: `${load}%` }} />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500">{DAYS[day]}</span>
                </div>
              ))}
            </div>
          </div>
          <ul className="relative mt-6 space-y-3">
            {WINS.map((text) => (
              <li key={text} className="flex gap-3 text-sm text-slate-200">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-[0_0_12px_rgba(87,229,234,0.5)]"><Check className="h-3 w-3" /></span>{text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Coverage */}
      <div ref={ref} className="rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white">What each one actually covers</p>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-500" />Generic plan</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-300" />SwimGPT</span>
          </div>
        </div>
        <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          {COVERAGE.map((row, index) => (
            <div key={row.label}>
              <p className="mb-2 text-sm text-slate-300">{row.label}</p>
              <div className="space-y-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-full bg-slate-500 transition-[width] duration-1000 ease-out" style={{ width: inView ? `${row.generic}%` : "0%", transitionDelay: `${index * 90}ms` }} />
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-violet-300 shadow-[0_0_12px_rgba(87,229,234,0.5)] transition-[width] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ width: inView ? "100%" : "0%", transitionDelay: `${200 + index * 90}ms` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
