"use client"

import type { CSSProperties, MouseEvent, ReactNode } from "react"
import { CalendarDays, Dumbbell, FileText, Gauge, MessageSquare, Trophy, Video } from "lucide-react"
import { cn } from "@/lib/utils"
import { useInView } from "@/components/landing/use-in-view"

/** Card with a soft spotlight that follows the cursor. */
function Tile({ className, children, icon: Icon, eyebrow, title, body }: {
  className?: string; children: ReactNode; icon: typeof Gauge; eyebrow: string; title: string; body: string
}) {
  const track = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty("--spot-x", `${event.clientX - rect.left}px`)
    event.currentTarget.style.setProperty("--spot-y", `${event.clientY - rect.top}px`)
  }
  return (
    <div onMouseMove={track}
      className={cn("group relative flex flex-col overflow-hidden rounded-[26px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.85),rgba(9,14,20,0.95))] p-6 transition-all duration-500 hover:-translate-y-1 hover:border-accent/30 hover:shadow-[0_24px_60px_rgba(0,0,0,0.45)]", className)}>
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: "radial-gradient(420px circle at var(--spot-x, 50%) var(--spot-y, 0%), rgba(87,229,234,0.12), transparent 60%)" } as CSSProperties} />
      <div className="relative flex-1">{children}</div>
      <div className="relative mt-6">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300"><Icon className="h-3.5 w-3.5" />{eyebrow}</p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">{title}</h3>
        <p className="mt-1.5 text-sm leading-6 text-slate-400">{body}</p>
      </div>
    </div>
  )
}

const WEEK = [
  { day: "Mon", items: ["Threshold 200s", "Mobility"], meters: "4.2k" },
  { day: "Tue", items: ["Race-pace 50s", "Pull strength"], meters: "3.1k" },
  { day: "Wed", items: ["Recovery swim"], meters: "2.0k" },
  { day: "Thu", items: ["VO2 100s", "Core"], meters: "3.8k" },
  { day: "Fri", items: ["Technique", "Mobility"], meters: "2.6k" },
  { day: "Sat", items: ["Race-pace 100s", "Power circuit"], meters: "3.4k" },
  { day: "Sun", items: ["Rest & recovery"], meters: "—" },
]
const WEEK_ZONES = [
  { width: 18, color: "bg-sky-300" }, { width: 38, color: "bg-cyan-400" }, { width: 20, color: "bg-emerald-400" },
  { width: 12, color: "bg-amber-300" }, { width: 8, color: "bg-orange-400" }, { width: 4, color: "bg-fuchsia-400" },
]
const ZONES = [
  { zone: "Recovery", pace: "1:28", width: 38, color: "bg-sky-300" },
  { zone: "Aerobic", pace: "1:17", width: 55, color: "bg-cyan-400" },
  { zone: "Threshold", pace: "1:11", width: 68, color: "bg-emerald-400" },
  { zone: "VO2", pace: "1:05", width: 80, color: "bg-amber-300" },
  { zone: "Race pace", pace: "0:58", width: 92, color: "bg-orange-400" },
  { zone: "Sprint", pace: "0:53", width: 100, color: "bg-fuchsia-400" },
]
const SPLITS = [
  { split: "50", target: 27.9, width: 92 },
  { split: "100", target: 30.4, width: 84 },
  { split: "150", target: 30.6, width: 83 },
  { split: "200", target: 30.9, width: 82 },
]

/** "Everything you need to excel": each tile is a small live preview of the real feature. */
export function FeatureBento() {
  const { ref, inView } = useInView<HTMLDivElement>(0.15)
  return (
    <div ref={ref} className="grid grid-flow-dense gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Swim Week */}
      <Tile className="md:col-span-2 lg:row-span-2" icon={CalendarDays} eyebrow="Swim Week" title="A week that rebuilds itself"
        body="Swims, strength and mobility planned around your availability, pool and events. Tick sessions off; the plan reacts.">
        <div className="space-y-2.5">
          {WEEK.map((day, index) => (
            <div key={day.day} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
              <span className="w-9 text-xs font-semibold uppercase tracking-wider text-slate-500">{day.day}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {day.items.map((item, itemIndex) => (
                  <span key={item} className={cn("truncate rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    itemIndex === 0 ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-violet-300/20 bg-violet-400/10 text-violet-100")}>{item}</span>
                ))}
              </div>
              <span className="hidden text-xs tabular-nums text-slate-400 sm:block">{day.meters}</span>
              <span className="landing-tick flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15" style={{ "--tick-delay": `${index * 0.75}s` } as CSSProperties}>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-950"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">This week</p>
            <p className="font-mono text-sm tabular-nums text-white">19.1 km · 9 sessions</p>
          </div>
          <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {WEEK_ZONES.map((zone, index) => (
              <span key={index} className={cn("h-full rounded-full transition-[flex-grow] duration-1000 ease-out", zone.color)}
                style={{ flexGrow: inView ? zone.width : 0, flexBasis: 0, transitionDelay: `${index * 90}ms` }} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Aerobic-heavy build week · race pace saved for Saturday</p>
        </div>
      </Tile>

      {/* Pace Calculator */}
      <Tile className="md:col-span-2" icon={Gauge} eyebrow="Pace Calculator" title="Six zones, from your times"
        body="Push and dive targets for every rep distance, adjusted for suit, course and start, for you and your athletes.">
        <div className="space-y-2">
          {ZONES.map((zone, index) => (
            <div key={zone.zone} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs">
              <span className="text-slate-400">{zone.zone}</span>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <div className={cn("h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]", zone.color)}
                  style={{ width: inView ? `${zone.width}%` : "0%", transitionDelay: `${index * 80}ms` }} />
              </div>
              <span className="text-right font-mono tabular-nums text-white">{zone.pace}</span>
            </div>
          ))}
        </div>
      </Tile>

      {/* Gym Week */}
      <Tile icon={Dumbbell} eyebrow="Gym Week" title="Strength for your kit"
        body="A workout every day, written for your gym, or build your own.">
        <div className="space-y-3">
          {[["Band row", 4], ["Bulgarian split squat", 3], ["Dead bug", 3]].map(([name, sets], row) => (
            <div key={name as string} className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-slate-300">{name}</span>
              <span className="flex gap-1">
                {Array.from({ length: sets as number }, (_, set) => (
                  <span key={set} className="landing-set h-3.5 w-3.5 rounded-full border border-violet-300/40" style={{ "--set-delay": `${row * 1.1 + set * 0.35}s` } as CSSProperties} />
                ))}
              </span>
            </div>
          ))}
        </div>
      </Tile>

      {/* Coach chat */}
      <Tile icon={MessageSquare} eyebrow="Coach chat" title="Your elite coach, on call"
        body="Answers grounded in your coach's methods and your own profile.">
        <div className="space-y-2 text-xs">
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-accent-foreground">How should I pace my 200 back?</p>
          <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.05] px-3 py-2 text-slate-200">Build the third 50. Hold 1:06 pace, then…</p>
          <p className="flex w-fit gap-1 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.05] px-3 py-2.5" aria-label="Coach is typing">
            {[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" style={{ animationDelay: `${dot * 0.15}s` }} />)}
          </p>
        </div>
      </Tile>

      {/* Race plans */}
      <Tile icon={Trophy} eyebrow="Competitions" title="Race plans & splits"
        body="Target splits for every event, then real results analysed against the plan.">
        <div className="space-y-2">
          {SPLITS.map((split, index) => (
            <div key={split.split} className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-[11px]">
              <span className="text-slate-500">{split.split}m</span>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400 transition-[width] duration-1000"
                  style={{ width: inView ? `${split.width}%` : "0%", transitionDelay: `${300 + index * 120}ms` }} />
              </div>
              <span className="text-right font-mono tabular-nums text-white">{split.target.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </Tile>

      {/* Video analysis */}
      <Tile className="md:col-span-2" icon={Video} eyebrow="Video analysis" title="See what your stroke is really doing"
        body="Upload a clip and get stroke-phase notes, the speed leaks to fix and the drills that fix them.">
        <div className="relative h-36 overflow-hidden rounded-2xl border border-white/[0.06] bg-[linear-gradient(180deg,#0b4c5e,#072e3a)]">
          <div className="landing-pool-caustics absolute inset-0 opacity-60" />
          <svg viewBox="0 0 400 140" className="absolute inset-0 h-full w-full" aria-hidden>
            <line x1="0" y1="62" x2="400" y2="62" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 6" />
            <g className="landing-stroke" stroke="#e2f8fb" strokeWidth="5" strokeLinecap="round" fill="none">
              <line x1="120" y1="70" x2="250" y2="66" />
              <line x1="250" y1="66" x2="300" y2="88" />
              <line x1="300" y1="88" x2="350" y2="72" />
              <line x1="120" y1="70" x2="60" y2="80" />
              <line x1="120" y1="70" x2="58" y2="60" opacity="0.75" />
            </g>
            <path d="M352 70 C 335 100, 300 112, 240 104" stroke="rgba(87,229,234,0.55)" strokeWidth="2" strokeDasharray="3 5" fill="none" />
            <circle cx="262" cy="60" r="10" fill="#e2f8fb" />
            <path d="M300 88 A 28 28 0 0 0 275 76" stroke="#57e5ea" strokeWidth="2.5" fill="none" />
            <text x="312" y="110" fill="#57e5ea" fontSize="13" fontFamily="monospace">elbow 108°</text>
          </svg>
          <span className="absolute left-3 top-3 rounded-full bg-slate-950/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">Catch · mid-pull</span>
          <span className="absolute bottom-3 right-3 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">High elbow ✓</span>
        </div>
      </Tile>

      {/* PDFs */}
      <Tile icon={FileText} eyebrow="Branded PDFs" title="Take it to the pool deck"
        body="Export any workout or a whole week, ready to print.">
        <div className="relative mx-auto h-28 w-32">
          {[0, 1, 2].map((page) => (
            <div key={page} className="absolute inset-0 rounded-xl border border-white/10 bg-[linear-gradient(180deg,#0b1218_0_28%,#f1f5f9_28%)] shadow-[0_12px_30px_rgba(0,0,0,0.4)] transition-transform duration-500"
              style={{ transform: `rotate(${(page - 1) * 7}deg) translateX(${(page - 1) * 10}px)`, zIndex: page }}>
              <span className="absolute left-2 top-2 h-2 w-8 rounded-full bg-cyan-300/80" />
              <span className="absolute inset-x-2 top-12 h-1.5 rounded-full bg-slate-300" />
              <span className="absolute left-2 right-6 top-16 h-1.5 rounded-full bg-slate-300" />
              <span className="absolute left-2 right-10 top-20 h-1.5 rounded-full bg-slate-300" />
            </div>
          ))}
        </div>
      </Tile>

    </div>
  )
}
