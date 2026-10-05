"use client"

import { Activity, Radar } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FrameMetrics } from "@/components/video-lab/pose-engine"

/** Semicircle gauge (0..max) with a gradient arc and a needle. */
function Gauge({ label, value, max, unit, tone, hint }: { label: string; value: number | null; max: number; unit: string; tone: "cyan" | "violet" | "emerald" | "amber"; hint: string }) {
  const colors = { cyan: ["#a5f3fc", "#22d3ee"], violet: ["#ddd6fe", "#a78bfa"], emerald: ["#a7f3d0", "#34d399"], amber: ["#fde68a", "#f59e0b"] }[tone]
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value / max))
  const length = Math.PI * 40
  const angle = -90 + ratio * 180
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
      <svg viewBox="0 0 100 58" className="w-full" aria-hidden>
        <defs><linearGradient id={`gauge-${tone}-${label}`} x1="0" x2="1"><stop offset="0" stopColor={colors[0]} /><stop offset="1" stopColor={colors[1]} /></linearGradient></defs>
        <path d="M10 52 A40 40 0 0 1 90 52" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" strokeLinecap="round" />
        <path d="M10 52 A40 40 0 0 1 90 52" fill="none" stroke={`url(#gauge-${tone}-${label})`} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={length} strokeDashoffset={length * (1 - ratio)} className="transition-[stroke-dashoffset] duration-300 ease-out" />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "50px 52px", transition: "transform 300ms ease-out" }}>
          <line x1="50" y1="52" x2="50" y2="20" stroke="#ecfeff" strokeWidth="1.6" strokeLinecap="round" />
        </g>
        <circle cx="50" cy="52" r="3.2" fill="#ecfeff" />
      </svg>
      <p className="-mt-1 text-center font-mono text-xl font-bold tabular-nums text-white">{value === null ? "—" : Math.round(value)}<span className="ml-0.5 text-xs font-medium text-slate-500">{unit}</span></p>
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-center text-[10px] text-slate-500">{hint}</p>
    </div>
  )
}

/** Rolling line chart of recent samples. */
function Spark({ history }: { history: FrameMetrics[] }) {
  const series: { key: keyof FrameMetrics; color: string; max: number }[] = [
    { key: "elbowL", color: "#67e8f9", max: 180 }, { key: "elbowR", color: "#c4b5fd", max: 180 }, { key: "bodyTilt", color: "#facc15", max: 45 },
  ]
  const path = (key: keyof FrameMetrics, max: number) => {
    const points = history.map((sample, index) => ({ x: (index / Math.max(1, history.length - 1)) * 300, v: sample[key] as number | null }))
    let d = ""
    points.forEach((point) => {
      if (point.v === null) return
      const y = 70 - Math.min(1, point.v / max) * 64
      d += d ? ` L${point.x.toFixed(1)} ${y.toFixed(1)}` : `M${point.x.toFixed(1)} ${y.toFixed(1)}`
    })
    return d
  }
  return (
    <svg viewBox="0 0 300 74" className="h-24 w-full" preserveAspectRatio="none" aria-hidden>
      {[18, 36, 54].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="rgba(255,255,255,0.05)" />)}
      {series.map((item) => <path key={item.key} d={path(item.key, item.max)} fill="none" stroke={item.color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
    </svg>
  )
}

export function Telemetry({ live, history, tracking, fps }: { live: FrameMetrics | null; history: FrameMetrics[]; tracking: "idle" | "live" | "paused" | "lost"; fps: number }) {
  const quality = live ? Math.round(live.confidence * 100) : 0
  const ring = 2 * Math.PI * 26
  const knee = live ? [live.kneeL, live.kneeR].filter((v): v is number => v !== null) : []
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white"><Radar className="h-4 w-4 text-cyan-300" />Live telemetry</p>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
          tracking === "live" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200" : tracking === "lost" ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-slate-400")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", tracking === "live" ? "animate-pulse bg-emerald-300" : tracking === "lost" ? "bg-amber-300" : "bg-slate-500")} />
          {tracking === "live" ? (fps > 0 ? `Tracking · ${fps} fps` : "Tracking") : tracking === "lost" ? "Searching for swimmer" : tracking === "paused" ? "Paused" : "Play the clip"}
        </span>
      </div>
      <div className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
        <svg viewBox="0 0 64 64" className="h-20 w-20 shrink-0 -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="url(#quality)" strokeWidth="6" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - quality / 100)} className="transition-[stroke-dashoffset] duration-500" />
          <defs><linearGradient id="quality"><stop offset="0" stopColor="#67e8f9" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs>
        </svg>
        <div>
          <p className="font-mono text-3xl font-bold tabular-nums text-white">{live ? `${quality}%` : "—"}</p>
          <p className="text-xs text-slate-400">Tracking quality: how clearly the model sees your joints in this frame.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Gauge label="Left elbow" value={live?.elbowL ?? null} max={180} unit="°" tone="cyan" hint="Bent ~90–120° at the catch" />
        <Gauge label="Right elbow" value={live?.elbowR ?? null} max={180} unit="°" tone="violet" hint="Straight ≈ 180°" />
        <Gauge label="Knee bend" value={knee.length ? Math.min(...knee) : null} max={180} unit="°" tone="emerald" hint="Big bends = a bicycling kick" />
        <Gauge label="Body line" value={live?.bodyTilt ?? null} max={45} unit="°" tone="amber" hint="0° is perfectly flat" />
      </div>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <span className="flex items-center gap-1.5"><Activity className="h-3 w-3 text-cyan-300" />Last few seconds</span>
          <span className="flex gap-2.5 normal-case tracking-normal">
            <span className="text-cyan-200">— L elbow</span><span className="text-violet-200">— R elbow</span><span className="text-amber-200">— line</span>
          </span>
        </div>
        {history.length > 2 ? <Spark history={history} /> : <p className="flex h-24 items-center justify-center text-xs text-slate-500">Press play and the trace draws itself here.</p>}
      </div>
    </div>
  )
}
