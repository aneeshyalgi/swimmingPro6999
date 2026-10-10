"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** 200m freestyle in a 50m pool: today's PB splits vs the target SwimGPT plans the season toward. */
const TODAY = [28.4, 31.4, 31.8, 31.9]
const FUTURE = [27.9, 30.4, 30.6, 30.9]
const RACE_SECONDS = TODAY.reduce((sum, split) => sum + split, 0)
const WALL_SECONDS = 11 // real seconds for the slower swimmer to finish
const PAUSE_SECONDS = 2.8

const cumulative = (splits: number[]) => splits.map((_, index) => splits.slice(0, index + 1).reduce((sum, split) => sum + split, 0))
const TODAY_AT = cumulative(TODAY)
const FUTURE_AT = cumulative(FUTURE)

/** Where a swimmer is at race time `t`: 0 = start wall, 1 = far wall, plus direction and finished laps. */
function locate(splits: number[], at: number[], t: number) {
  for (let lap = 0; lap < splits.length; lap++) {
    if (t < at[lap]) {
      const raw = (t - (lap ? at[lap - 1] : 0)) / splits[lap]
      // Fast off the wall (dive / push + underwater), settling into stroke pace.
      const along = Math.min(1, raw + 0.06 * Math.sin(Math.PI * raw))
      return { x: lap % 2 === 0 ? along : 1 - along, dir: lap % 2 === 0 ? 1 : -1, laps: lap, done: false }
    }
  }
  return { x: splits.length % 2 === 0 ? 0 : 1, dir: 1, laps: splits.length, done: true }
}

export const clock = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`
}

function Swimmer({ x, dir, done, tone, label }: { x: number; dir: number; done: boolean; tone: "slate" | "cyan"; label: string }) {
  return (
    <div className="absolute top-1/2 h-0 w-0" style={{ left: `calc(${4 + x * 92}%)` }} aria-hidden>
      {/* wake */}
      <span className={cn("absolute top-1/2 h-[7px] w-20 -translate-y-1/2 rounded-full blur-[1.5px] transition-opacity duration-500",
        dir > 0 ? "right-1 bg-gradient-to-l" : "left-1 bg-gradient-to-r",
        tone === "cyan" ? "from-cyan-200/70 via-cyan-300/25 to-transparent" : "from-slate-200/45 via-slate-300/15 to-transparent",
        done && "opacity-0")} />
      <span className={cn("absolute -left-[7px] -top-[7px] h-3.5 w-3.5 rounded-full ring-4",
        tone === "cyan" ? "bg-cyan-200 shadow-[0_0_18px_6px_rgba(87,229,234,0.55)] ring-cyan-300/25" : "bg-slate-200 shadow-[0_0_10px_3px_rgba(226,232,240,0.25)] ring-white/10")} />
      <span className={cn("absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-semibold tracking-wide",
        tone === "cyan" ? "bg-cyan-300 text-slate-950" : "bg-white/15 text-slate-200")}>{label}</span>
    </div>
  )
}

/** Animated top-down pool: the athlete today vs their SwimGPT-planned future self, split by split. */
export function RaceGhost() {
  const [t, setT] = useState(0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(RACE_SECONDS)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const cycle = WALL_SECONDS + PAUSE_SECONDS
      const elapsed = ((now - start) / 1000) % cycle
      setT(Math.min(RACE_SECONDS, (elapsed / WALL_SECONDS) * RACE_SECONDS))
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => { if (frame.current) cancelAnimationFrame(frame.current) }
  }, [])

  const today = locate(TODAY, TODAY_AT, t)
  const future = locate(FUTURE, FUTURE_AT, t)
  const futureTime = Math.min(t, FUTURE_AT[3])
  const finished = today.done
  const gap = finished ? TODAY_AT[3] - FUTURE_AT[3] : future.laps > 0 ? TODAY_AT[future.laps - 1] - FUTURE_AT[future.laps - 1] : 0

  return (
    <div className="relative">
      <div className="absolute -inset-10 rounded-full bg-accent/15 blur-3xl" />
      <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(160deg,rgba(20,34,44,0.94),rgba(8,13,19,0.97))] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" /></span>
              Race your future self
            </p>
            <p className="mt-1 text-lg font-semibold text-white">200m Freestyle · 50m pool</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-bold tabular-nums tracking-tight text-white" aria-label="Race clock">{clock(t)}</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{finished ? "Finished" : `Length ${Math.min(today.laps + 1, 4)} of 4`}</p>
          </div>
        </div>

        {/* Pool, seen from above */}
        <div className="relative mt-5 h-36 overflow-hidden rounded-2xl border border-cyan-200/10 bg-[linear-gradient(180deg,#0b5f73,#0a4a5c_45%,#083b4b)] sm:h-40">
          <div className="landing-pool-caustics absolute inset-0 opacity-70" />
          {/* lane ropes */}
          {[0, 50, 100].map((top) => (
            <span key={top} className="landing-lane-rope absolute left-0 right-0 h-[3px] -translate-y-1/2" style={{ top: `${top === 0 ? 2 : top === 100 ? 98 : top}%` }} />
          ))}
          {/* walls, 15m marks and floor lines */}
          <span className="absolute inset-y-0 left-[4%] w-px bg-white/25" />
          <span className="absolute inset-y-0 right-[4%] w-px bg-white/25" />
          {[0.3, 0.7].map((mark) => <span key={mark} className="absolute inset-y-[6%] w-px border-l border-dashed border-white/15" style={{ left: `${4 + mark * 92}%` }} />)}
          {[25, 75].map((top) => <span key={top} className="absolute left-[9%] right-[9%] h-[2px] -translate-y-1/2 rounded-full bg-slate-950/35" style={{ top: `${top}%` }} />)}
          <span className="absolute bottom-1 left-[4%] translate-x-1 text-[8px] font-semibold tracking-widest text-white/35">START</span>
          <span className="absolute bottom-1 left-[31.6%] -translate-x-1/2 text-[8px] tracking-widest text-white/30">15m</span>
          <span className="absolute bottom-1 left-[68.4%] -translate-x-1/2 text-[8px] tracking-widest text-white/30">35m</span>
          {/* swimmers */}
          <div className="absolute inset-x-0 top-0 h-1/2"><Swimmer {...today} tone="slate" label="You · today" /></div>
          <div className="absolute inset-x-0 bottom-0 h-1/2"><Swimmer {...future} tone="cyan" label="You · 12 weeks" /></div>
        </div>

        {/* Splits appear as each 50 is completed */}
        <div className="mt-5 grid grid-cols-[5.5rem_repeat(4,minmax(0,1fr))] gap-y-1.5 text-center font-mono text-xs tabular-nums">
          <span />
          {[50, 100, 150, 200].map((distance) => <span key={distance} className="text-[10px] uppercase tracking-wider text-slate-500">{distance}m</span>)}
          <span className="text-left font-sans text-[11px] text-slate-400">Today</span>
          {TODAY_AT.map((at, lap) => <span key={lap} className={cn("text-slate-300 transition-all duration-500", t >= at ? "opacity-100" : "translate-y-1 opacity-0")}>{clock(at)}</span>)}
          <span className="text-left font-sans text-[11px] font-semibold text-cyan-200">SwimGPT</span>
          {FUTURE_AT.map((at, lap) => <span key={lap} className={cn("font-semibold text-cyan-100 transition-all duration-500", t >= at ? "opacity-100" : "translate-y-1 opacity-0")}>{clock(at)}</span>)}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="max-w-[15rem] text-[11px] leading-4 text-slate-400">Paces, splits and taper built from your PBs and your elite coach&apos;s methods.</p>
          <div className="text-right">
            <p className={cn("font-mono text-2xl font-bold tabular-nums transition-colors duration-500", gap > 0 ? "text-emerald-300" : "text-slate-500")}>−{gap.toFixed(2)}s</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{finished ? `${clock(futureTime)} target` : "Gap so far"}</p>
          </div>
        </div>
      </div>

      {/* Floating stroke data */}
      {[
        { text: "Stroke rate 42 /min", className: "-left-12 -top-4", delay: "0s" },
        { text: "Underwater 11 m", className: "-right-6 top-[46%]", delay: "1.4s" },
        { text: "Turn 0.72 s", className: "-bottom-4 left-16", delay: "2.6s" },
      ].map((chip) => (
        <span key={chip.text} style={{ animationDelay: chip.delay }}
          className={cn("landing-float pointer-events-none absolute hidden rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-[11px] font-medium text-slate-200 shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md xl:block", chip.className)}>
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-300 align-middle" />{chip.text}
        </span>
      ))}
    </div>
  )
}
