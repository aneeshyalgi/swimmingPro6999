"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const FINISH_MS = 900       // swim the last metres once the plan is ready
const CELEBRATE_MS = 1700   // touch, splash, then hand over to the results
const TAU_MS = 16000        // how quickly the swimmer approaches the wall while waiting

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const clock = (ms: number) => {
  const total = Math.max(0, ms) / 1000
  return `${Math.floor(total / 60)}:${(total % 60).toFixed(2).padStart(5, "0")}`
}

/**
 * The plan-generation wait as a race: the athlete swims a 50 m lane (top-down) chasing their PB and target pace,
 * each generation stage is a split, and they touch the wall the moment the plan is ready.
 * Progress is time-based while waiting (it never reaches the wall on its own) and finishes when `done` turns true.
 */
export function PlanLoader({ firstName, coach, done, onFinished }: {
  firstName: string
  coach: string
  done: boolean
  onFinished: () => void
}) {
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [touched, setTouched] = useState(false)
  const [splits, setSplits] = useState<number[]>([])
  const doneAt = useRef<{ at: number; from: number } | null>(null)
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  const name = coach.replace(/^Coach\s+/i, "")
  const stages = [
    { at: 0, label: "Reading your PBs and target times" },
    { at: 0.13, label: "Setting your pace zones" },
    { at: 0.29, label: name ? `Loading Coach ${name}'s program` : "Loading your coach's program" },
    { at: 0.46, label: name ? `Fitting Coach ${name}'s sessions to your week` : "Fitting the sessions to your week" },
    { at: 0.63, label: "Writing your season plan" },
    { at: 0.8, label: "Checking every number against your goals" },
  ]

  useEffect(() => {
    const started = performance.now()
    let frame = 0
    let touchedAt = 0
    const tick = (now: number) => {
      const waited = now - started
      let value = 0.94 * (1 - Math.exp(-waited / TAU_MS))
      const finish = doneAt.current
      if (finish) {
        const t = Math.min(1, (now - finish.at) / FINISH_MS)
        value = finish.from + (1 - finish.from) * easeOut(t)
        if (t >= 1 && !touchedAt) {
          touchedAt = now
          setTouched(true)
          setElapsed(finish.at - started + FINISH_MS)
        }
      }
      setProgress(value)
      if (!touchedAt) setElapsed(waited)
      if (touchedAt && now - touchedAt > CELEBRATE_MS) return finishedRef.current()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (done && !doneAt.current) doneAt.current = { at: performance.now(), from: progress }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  // Record each split as the swimmer passes it.
  const reached = stages.filter((stage) => progress >= stage.at).length
  useEffect(() => {
    setSplits((current) => {
      const want = touched ? stages.length : reached - 1
      return want > current.length ? [...current, ...Array<number>(want - current.length).fill(elapsed)] : current
    })
  }, [reached, elapsed, touched, stages.length])

  const allDone = touched
  const metres = Math.round(progress * 50)
  const lane = (value: number) => `calc(${4 + value * 86}%)`
  const pb = Math.min(progress * 0.93, 0.93)
  const target = Math.min(progress * 0.985 + (done ? 0 : 0.02 * Math.sin(elapsed / 900)), 0.975)

  return (
    <div className="pl-root mx-auto w-full max-w-4xl" role="status" aria-live="polite"
      aria-label={allDone ? "Your program is ready" : `Building your program: ${stages[Math.max(0, reached - 1)].label}`}>
      {/* Scoreboard */}
      <div className="pl-board flex items-center justify-between gap-3 rounded-t-[26px] border border-b-0 border-white/10 px-4 py-3 sm:px-6">
        <div className="hidden min-w-0 sm:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">SwimGPT Aquatic Centre</p>
          <p className="truncate text-xs text-slate-300">50 m · Plan build{name ? ` · Coach ${name}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-accent/15 px-2 py-1 font-mono text-[11px] font-bold text-accent">LANE 4</span>
          <span className="max-w-[9rem] truncate text-sm font-semibold uppercase tracking-wider text-white">{firstName || "You"}</span>
        </div>
        <div className={cn("pl-clock font-mono text-2xl font-bold tabular-nums sm:text-3xl", allDone ? "text-emerald-300" : "text-amber-200")}>
          {clock(elapsed)}
        </div>
      </div>

      {/* Pool */}
      <div className="pl-pool relative aspect-[4/3] overflow-hidden rounded-b-[26px] border border-white/10 sm:aspect-[16/7]">
        <div aria-hidden className="pl-water absolute inset-0" />
        <div aria-hidden className="pl-caustics absolute inset-0" />
        <div aria-hidden className="pl-caustics pl-caustics-b absolute inset-0" />

        {/* Lane floor lines with T-ends, lane ropes and backstroke flags */}
        {[1 / 6, 3 / 6, 5 / 6].map((y) => (
          <div key={y} aria-hidden className="pl-floor-line absolute left-[5%] right-[5%] h-[6px] -translate-y-1/2" style={{ top: `${y * 100}%` }} />
        ))}
        {[1 / 3, 2 / 3].map((y, index) => (
          <div key={y} aria-hidden className="pl-rope absolute inset-x-0 h-[9px] -translate-y-1/2" style={{ top: `${y * 100}%`, animationDelay: `${index * -0.8}s` }} />
        ))}
        {["9%", "91%"].map((x) => <div key={x} aria-hidden className="pl-flags absolute inset-y-0 w-px" style={{ left: x }} />)}
        <div aria-hidden className={cn("pl-pad absolute inset-y-[3%] right-0 w-[1.6%] rounded-l-sm", allDone && "pl-pad-hit")} />
        <div aria-hidden className="absolute inset-y-0 left-0 w-[1.2%] bg-gradient-to-r from-slate-200/30 to-transparent" />

        {/* Lane labels */}
        {[
          { y: 1 / 6, label: "PB pace" },
          { y: 3 / 6, label: firstName || "You", you: true },
          { y: 5 / 6, label: "Target pace" },
        ].map((item) => (
          <span key={item.label} className={cn("absolute left-[2.4%] hidden -translate-y-1/2 text-[10px] sm:block font-semibold uppercase tracking-[0.16em]",
            item.you ? "text-white/80" : "text-white/35")} style={{ top: `${item.y * 100 - 11}%` }}>
            {item.label}
          </span>
        ))}

        {/* Swimmers */}
        <Swimmer ghost style={{ left: lane(pb), top: `${100 / 6}%` }} />
        <Swimmer style={{ left: lane(progress), top: "50%" }} breathing={!allDone} />
        <Swimmer ghost tone="gold" style={{ left: lane(target), top: `${500 / 6}%` }} />

        {/* Distance */}
        <div className="absolute bottom-[3%] left-[5%] right-[5%] flex justify-between font-mono text-[9px] text-white/30" aria-hidden>
          {[0, 10, 20, 30, 40, 50].map((mark) => <span key={mark}>{mark}m</span>)}
        </div>

        {allDone && (
          <div aria-hidden className="absolute right-[1%] top-1/2 -translate-y-1/2">
            {[0, 1, 2].map((ring) => <span key={ring} className="pl-splash-ring" style={{ "--r": ring } as CSSProperties} />)}
            {Array.from({ length: 12 }, (_, index) => <span key={index} className="pl-drop" style={{ "--a": `${index * 30}deg`, "--d": `${28 + (index % 3) * 12}px` } as CSSProperties} />)}
          </div>
        )}
        {allDone && (
          <div className="pl-touch absolute inset-0 grid place-items-center">
            <span className="rounded-full bg-white/95 px-5 py-2 text-sm font-bold uppercase tracking-[0.2em] text-slate-950 shadow-[0_10px_40px_rgba(255,255,255,0.35)]">
              Touch · Program ready
            </span>
          </div>
        )}
      </div>

      {/* Heading and distance */}
      <div className="mt-8 text-center">
        <h2 className="text-balance text-3xl font-bold tracking-tight text-white">
          {allDone ? `Your program is ready${firstName ? `, ${firstName}` : ""}` : `Building your program${firstName ? `, ${firstName}` : ""}`}
        </h2>
        <p className="mt-2 text-slate-400">{allDone ? "Meet your coach…" :"This usually takes under a minute. Keep this tab open."}</p>
        <div className="mx-auto mt-5 flex max-w-md items-center gap-3">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <span className="pl-bar absolute inset-y-0 left-0 rounded-full" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="w-12 text-right font-mono text-sm tabular-nums text-slate-300">{metres}m</span>
        </div>
      </div>

      {/* Splits */}
      <ol className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {stages.map((stage, index) => {
          const finished = index < splits.length
          const active = !finished && index === reached - 1
          const split = finished ? splits[index] - (index ? splits[index - 1] : 0) : null
          return (
            <li key={stage.label} style={{ "--i": index } as CSSProperties}
              className={cn("pl-split flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-all duration-500",
                active ? "border-accent/40 bg-accent/[0.08] text-white" : finished ? "border-white/8 bg-white/[0.025] text-slate-300" : "border-white/[0.04] text-slate-600")}>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                finished ? "bg-accent text-accent-foreground" : active ? "pl-active-dot bg-accent/20 text-accent" : "bg-white/[0.05] text-slate-600")}>
                {finished ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} /> : index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{stage.label}</span>
              {split !== null && <span className="font-mono text-xs tabular-nums text-slate-500">{clock(split)}</span>}
              {active && <span className="pl-wave-dots flex gap-0.5" aria-hidden><i /><i /><i /></span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** A top-down freestyle swimmer, facing right: windmill arms (pull underwater, recover over the top), flutter kick, breathing head. */
function Swimmer({ style, ghost, tone, breathing = true }: { style: CSSProperties; ghost?: boolean; tone?: "gold"; breathing?: boolean }) {
  const cap = ghost ? (tone === "gold" ? "#fcd34d" : "#cbd5e1") : "url(#pl-cap)"
  const skin = ghost ? "rgba(255,255,255,0.55)" : "#f6dcc8"
  return (
    <div className={cn("pl-swimmer absolute -translate-x-1/2 -translate-y-1/2", ghost && "pl-ghost")} style={style} aria-hidden>
      <svg viewBox="0 0 120 44" className="h-auto w-[clamp(64px,11vw,124px)] overflow-visible">
        <defs>
          <linearGradient id="pl-cap" x1="0" x2="1">
            <stop offset="0" stopColor="#67e8f9" />
            <stop offset="1" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        {/* wake */}
        {!ghost && [0, 1, 2, 3, 4, 5].map((index) => (
          <circle key={index} className="pl-bubble" cx="14" cy={16 + (index % 3) * 6} r={1.6 + (index % 2)} style={{ animationDelay: `${index * 0.17}s` }} />
        ))}
        <path className="pl-wake" d="M38 22 C 24 10, 8 12, -18 16 M38 22 C 24 34, 8 32, -18 28" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" strokeLinecap="round" />
        {/* legs */}
        <g className="pl-leg pl-leg-a"><rect x="10" y="15" width="30" height="5.5" rx="2.75" fill={skin} /></g>
        <g className="pl-leg pl-leg-b"><rect x="10" y="23.5" width="30" height="5.5" rx="2.75" fill={skin} /></g>
        {/* arms: the top one pulls clockwise, the bottom one counter-clockwise, half a stroke apart */}
        <g className="pl-arm pl-arm-top" style={{ transformOrigin: "70px 13px" }}><rect x="70" y="10.5" width="32" height="5" rx="2.5" fill={skin} /></g>
        <g className="pl-arm pl-arm-bottom" style={{ transformOrigin: "70px 31px" }}><rect x="70" y="28.5" width="32" height="5" rx="2.5" fill={skin} /></g>
        {/* body and suit */}
        <ellipse cx="56" cy="22" rx="21" ry="10" fill={skin} />
        <rect x="35" y="14" width="16" height="16" rx="6" fill={ghost ? "rgba(255,255,255,0.4)" : "#0b4f6c"} />
        {/* head */}
        <g className={cn(breathing && "pl-head")} style={{ transformOrigin: "76px 22px" }}>
          <circle cx="83" cy="22" r="7.5" fill={cap} />
          {!ghost && <path d="M86 16.5 a 7.5 7.5 0 0 1 0 11" fill="none" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />}
        </g>
      </svg>
    </div>
  )
}
