"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { AlertTriangle, CheckCircle2, Dumbbell, RotateCcw, Sparkles, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ClipSummary } from "@/components/video-lab/pose-engine"

export type AnalysisResult = {
  headline: string
  stroke_phase: string
  confidence: number
  strengths: string[]
  improvements: string[]
  findings: { label: string; value: string; detail: string }[]
  drills: { name: string; why: string }[]
  coach_note: string
}

const rise = (index: number) => ({ "--reveal-delay": `${index * 90}ms` }) as CSSProperties

function useCount(target: number, ms = 1400) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / ms)
      setValue(Math.round(target * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, ms])
  return value
}

function Measured({ summary }: { summary: ClipSummary }) {
  const stats = [
    { label: "Stroke rate", value: summary.stroke_rate_per_min, unit: "/min", note: "from the hand's cycle" },
    { label: "Catch elbow", value: summary.elbow_catch_deg, unit: "°", note: "most-bent 15% of frames" },
    { label: "Body line", value: summary.body_tilt_deg, unit: "°", note: "shoulders to ankles, 0° = flat" },
    { label: "Kick depth", value: summary.kick_depth_percent, unit: "%", note: "of body length" },
    { label: "Swimming frames", value: summary.swimming_frames, unit: `/${summary.frames}`, note: "clear, horizontal swimmer" },
    { label: "Tracking", value: summary.tracking_percent, unit: "%", note: `of ${summary.frames} frames scanned` },
  ]
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {stats.map((stat, index) => (
        <div key={stat.label} className="dash-reveal rounded-2xl border border-white/[0.08] bg-black/20 p-3" style={rise(4 + index)}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-white">{stat.value ?? "—"}<span className="ml-0.5 text-xs text-slate-500">{stat.value === null ? "" : stat.unit}</span></p>
          <p className="text-[10px] text-slate-500">{stat.value === null ? "not enough clear frames" : stat.note}</p>
        </div>
      ))}
    </div>
  )
}

/** The coach's read of the clip, revealed in sequence. */
export function CoachBrief({ result, summary, stroke, onReset }: { result: AnalysisResult; summary: ClipSummary | null; stroke: string; onReset: () => void }) {
  const confidence = useCount(Math.max(0, Math.min(100, Math.round(result.confidence))))
  const ring = 2 * Math.PI * 52
  const tracked = summary && summary.swimming_frames >= 5
  return (
    <section aria-label="Coach brief" className="space-y-5">
      <div className="dash-reveal relative overflow-hidden rounded-[28px] border border-cyan-300/25 bg-[linear-gradient(135deg,rgba(87,229,234,0.14),rgba(10,18,26,0.96)_45%,rgba(167,139,250,0.12))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:p-8" style={rise(0)}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300"><Sparkles className="h-3.5 w-3.5" />Coach brief · {stroke}</p>
            <div className="mt-5 flex items-center gap-5">
              <div className="relative h-32 w-32 shrink-0">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
                  <circle cx="60" cy="60" r="52" fill="none" stroke="url(#brief-ring)" strokeWidth="9" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - confidence / 100)} />
                  <defs><linearGradient id="brief-ring" x1="0" x2="1"><stop offset="0" stopColor="#67e8f9" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-3xl font-bold tabular-nums text-white">{confidence}%</span>
                  <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">confidence</span>
                </div>
              </div>
              <div className="min-w-0">
                <span className="inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-100">{result.stroke_phase}</span>
                <h2 className="mt-2 text-balance text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl">{result.headline}</h2>
              </div>
            </div>
            <p className="mt-6 text-[15px] leading-7 text-slate-200">{result.coach_note}</p>
            {!tracked && <p className="mt-4 flex gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-3 py-2 text-xs leading-5 text-amber-50/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />We couldn&apos;t track a swimmer clearly in this clip, so this brief is based on the stroke and camera angle only. A side-on clip with one swimmer in frame gives measured results.
            </p>}
          </div>
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Measured from your clip</p>
            {summary ? <Measured summary={summary} /> : <p className="text-sm text-slate-400">No measurements.</p>}
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {[
          { title: "What's working", items: result.strengths, icon: CheckCircle2, tone: "emerald" },
          { title: "Where speed leaks", items: result.improvements, icon: Zap, tone: "amber" },
        ].map((column, columnIndex) => (
          <div key={column.title} className={cn("dash-reveal rounded-[24px] border p-5 sm:p-6",
            column.tone === "emerald" ? "border-emerald-300/20 bg-[linear-gradient(160deg,rgba(52,211,153,0.10),rgba(10,16,22,0.94))]" : "border-amber-300/20 bg-[linear-gradient(160deg,rgba(251,191,36,0.10),rgba(10,16,22,0.94))]")} style={rise(10 + columnIndex)}>
            <p className={cn("flex items-center gap-2 text-sm font-semibold", column.tone === "emerald" ? "text-emerald-200" : "text-amber-200")}><column.icon className="h-4 w-4" />{column.title}</p>
            <ul className="mt-4 space-y-2.5">
              {column.items.map((item, index) => (
                <li key={item} className="dash-reveal flex gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-sm leading-6 text-slate-200" style={rise(12 + index + columnIndex * 3)}>
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", column.tone === "emerald" ? "bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.8)]" : "bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.8)]")} />{item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {result.findings.map((finding, index) => (
          <div key={finding.label} className="dash-reveal group relative overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.85),rgba(9,14,20,0.95))] p-5 transition-all duration-500 hover:-translate-y-1 hover:border-cyan-300/30" style={rise(18 + index)}>
            <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/0 blur-2xl transition-colors duration-500 group-hover:bg-accent/15" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{finding.label}</p>
            <p className="mt-2 text-xl font-bold text-white">{finding.value}</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">{finding.detail}</p>
          </div>
        ))}
      </div>

      <div className="dash-reveal rounded-[24px] border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6" style={rise(22)}>
        <p className="flex items-center gap-2 text-sm font-semibold text-cyan-200"><Dumbbell className="h-4 w-4" />Your next drills</p>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {result.drills.map((drill, index) => (
            <li key={drill.name} className="dash-reveal relative rounded-2xl border border-white/[0.07] bg-black/20 p-4" style={rise(23 + index)}>
              <span className="bg-gradient-to-br from-cyan-200 to-violet-300 bg-clip-text font-mono text-4xl font-black text-transparent">0{index + 1}</span>
              <p className="mt-2 font-semibold text-white">{drill.name}</p>
              <p className="mt-1.5 text-sm leading-6 text-slate-400">{drill.why}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="dash-reveal flex flex-wrap items-center justify-center gap-3 pt-2" style={rise(27)}>
        <button type="button" onClick={onReset} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.08]">
          <RotateCcw className="h-4 w-4" />Analyze another clip
        </button>
      </div>
    </section>
  )
}
