"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react"
import Link from "next/link"
import { ArrowRight, Check, Crown, MousePointer2, Sparkles } from "lucide-react"
import { CoachAvatar } from "@/components/coach-avatar"
import { useInView } from "@/components/landing/use-in-view"
import { cn } from "@/lib/utils"

/*
 * Landing-page coach matcher. A compact mirror of the backend coach catalog and its ranking rules
 * (backend/app/context.py select_coaches): same main events, swimmer-type fit and weekly session orders,
 * so the team a visitor sees here is the team onboarding would recommend.
 */

type Coach = {
  key: string; name: string; title: string; tone: string; glow: string
  main: string[]; supporting: string[]; types: string[]; adjacent: string[]; week: string[]
}

const COACHES: Coach[] = [
  { key: "brad", name: "Coach Brad", title: "50 & 100 stroke sprint", tone: "#22d3ee", glow: "rgba(34,211,238,0.35)",
    main: ["50 Free", "50 Back", "50 Breast", "50 Fly", "100 Free", "100 Back", "100 Breast", "100 Fly"], supporting: [], types: ["sprinter"], adjacent: [],
    week: ["Power", "50 Race Pace", "Aerobic/Recovery", "Resistance", "100 Race Pace", "Aerobic/Recovery"] },
  { key: "pete", name: "Coach Pete", title: "USRPT race-pace sprint", tone: "#fbbf24", glow: "rgba(251,191,36,0.32)",
    main: ["50 Free", "50 Back", "50 Breast", "50 Fly", "100 Free", "100 Back", "100 Breast", "100 Fly"],
    supporting: ["200 Free", "200 Back", "200 Breast", "200 Fly"], types: ["sprinter"], adjacent: [],
    week: ["Overspeed", "50 Pace", "100 Pace", "200 Pace", "Overspeed", "50 Pace"] },
  { key: "timothy", name: "Coach Timothy", title: "Pure 50 m speed + gym", tone: "#f472b6", glow: "rgba(244,114,182,0.32)",
    main: ["50 Free", "50 Back", "50 Breast", "50 Fly"], supporting: [], types: ["sprinter"], adjacent: [],
    week: ["Top End Speed", "Gym", "Assisted Speed", "Hybrid Gym & Swim", "Speed Work", "Gym"] },
  { key: "robert", name: "Coach Robert", title: "IM & 200 specialist", tone: "#a78bfa", glow: "rgba(167,139,250,0.35)",
    main: ["200 IM", "400 IM", "200 Fly", "200 Back", "400 Free", "200 Free", "200 Breast"], supporting: [], types: ["mid", "specialist"], adjacent: ["distance"],
    week: ["Power", "Threshold", "Active Rest", "Threshold/Aerobic", "Kick", "VO2 Max"] },
  { key: "tony", name: "Coach Tony", title: "Distance freestyle", tone: "#34d399", glow: "rgba(52,211,153,0.32)",
    main: ["400 Free", "800 Free", "1500 Free", "400 IM"], supporting: [], types: ["distance"], adjacent: ["mid", "specialist"],
    week: ["Low Level Aerobic", "Threshold", "Recovery", "IM", "Active Rest", "Lactate/Race-Pace"] },
]
const ORDER = COACHES.map((coach) => coach.key)

const EVENT_GROUPS = [
  { stroke: "Free", events: ["50 Free", "100 Free", "200 Free", "400 Free", "800 Free", "1500 Free"] },
  { stroke: "Fly", events: ["50 Fly", "100 Fly", "200 Fly"] },
  { stroke: "Back", events: ["50 Back", "100 Back", "200 Back"] },
  { stroke: "Breast", events: ["50 Breast", "100 Breast", "200 Breast"] },
  { stroke: "IM", events: ["200 IM", "400 IM"] },
]
const PRESETS = [
  { label: "Sprinter", events: ["50 Free", "100 Free"] },
  { label: "200 flyer", events: ["100 Fly", "200 Fly"] },
  { label: "IM swimmer", events: ["200 IM", "400 IM"] },
  { label: "Distance", events: ["800 Free", "1500 Free"] },
  { label: "Pure 50", events: ["50 Free"] },
]
const TYPE_LABEL: Record<string, string> = { sprinter: "Sprinter", mid: "Mid-distance", specialist: "IM specialist", distance: "Distance" }

// Real lines from the encoded coach programs (backend/app/coach_sessions.py).
const SETS = [
  { coach: "Coach Brad", type: "Power", line: "6x15 Free MAX EFFORT w/big parachute @1:15" },
  { coach: "Coach Pete", type: "Overspeed", line: "8x25 MS #1 from a dive @2:00" },
  { coach: "Coach Robert", type: "Active Rest", line: "4x(100 pull PINK @1:25, 50 pull RED @0:50)" },
  { coach: "Coach Tony", type: "Threshold", line: "4x200 Free PINK @2:40" },
  { coach: "Coach Timothy", type: "Speed Work", line: "20 dive MAX w/drag socks" },
  { coach: "Coach Pete", type: "50 Pace", line: "12x12.5 MS #1 from a push @0:40" },
  { coach: "Coach Brad", type: "50 Race Pace", line: "2x20 push w/small parachute MAX" },
  { coach: "Coach Tony", type: "Low Level Aerobic", line: "8x100 Free PINK @1:30" },
  { coach: "Coach Robert", type: "Power", line: "2x15 Free MAX Speed w/ paddles and chute" },
  { coach: "Coach Timothy", type: "Assisted Speed", line: "4x25 Assisted w/Stretch cord" },
]
const STATS = [
  { value: 5, suffix: "", label: "elite coaching systems" },
  { value: 91, suffix: "", label: "real sessions, written set by set" },
  { value: 356, suffix: " km", label: "of coach-written sets" },
  { value: 0, suffix: "", label: "generic templates" },
]
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function swimmerType(events: string[]) {
  if (events.some((event) => /^(800|1500) /.test(event))) return "distance"
  if (events.some((event) => event.endsWith("IM"))) return "specialist"
  if (events.some((event) => /^(200|400) /.test(event))) return "mid"
  return "sprinter"
}

function rankTeam(events: string[]) {
  const type = swimmerType(events)
  const fit = Object.fromEntries(COACHES.map((coach) => {
    const matched = events.filter((event) => coach.main.includes(event))
    const supporting = events.filter((event) => coach.supporting.includes(event) && !matched.includes(event))
    const affinity = coach.types.includes(type) ? 2 : coach.adjacent.includes(type) ? 1 : 0
    return [coach.key, { matched, supporting, affinity, specificity: matched.length / coach.main.length }]
  }))
  const lead = (key: string) => [fit[key].matched.length, fit[key].affinity, fit[key].supporting.length, fit[key].specificity, -ORDER.indexOf(key)]
  const compare = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0 }
  const pairRank = ([a, b]: string[]) => {
    const covered = events.filter((event) => COACHES.find((c) => c.key === a)!.main.includes(event) || COACHES.find((c) => c.key === b)!.main.includes(event)).length
    return [covered, fit[a].matched.length + fit[b].matched.length, fit[a].affinity + fit[b].affinity, fit[a].supporting.length + fit[b].supporting.length,
      fit[a].specificity + fit[b].specificity, -(ORDER.indexOf(a) + ORDER.indexOf(b))]
  }
  const pairs = ORDER.flatMap((a, i) => ORDER.slice(i + 1).map((b) => [a, b]))
  const best = pairs.sort((x, y) => compare(pairRank(x), pairRank(y)))[0]
  const team = [...best].sort((a, b) => compare(lead(a), lead(b)))
  const rest = ORDER.filter((key) => !team.includes(key)).sort((a, b) => compare(lead(a), lead(b)))
  const percent = (key: string) => {
    if (!events.length) return 0
    const f = fit[key]
    return Math.max(6, Math.min(99, Math.round(((f.matched.length + 0.5 * f.supporting.length) / events.length) * 72 + f.affinity * 13.5)))
  }
  return { order: [...team, ...rest], fit, percent, type }
}

function useCount(target: number, ms = 700) {
  const [value, setValue] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = performance.now()
    const origin = from.current
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const next = Math.round(origin + (target - origin) * (1 - Math.pow(1 - t, 3)))
      setValue(next)
      from.current = next
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, ms])
  return value
}

export function CoachShowcase() {
  const [events, setEvents] = useState<string[]>(PRESETS[0].events)
  const [userDriving, setUserDriving] = useState(false)
  const [cursor, setCursor] = useState<{ x: number; y: number; click: number } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const presetRefs = useRef<(HTMLButtonElement | null)[]>([])
  const { ref: headRef, inView: headIn } = useInView<HTMLDivElement>(0.4)
  const { ref: stageView, inView } = useInView<HTMLDivElement>(0.2)
  const { ref: proofRef, inView: proofIn } = useInView<HTMLDivElement>(0.3)
  const ranking = useMemo(() => rankTeam(events), [events])
  const [head, second] = ranking.order.map((key) => COACHES.find((coach) => coach.key === key)!)

  // A ghost cursor demos the matcher until the visitor takes over.
  useEffect(() => {
    if (!inView || userDriving) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let cancelled = false
    let index = 1
    const timers: number[] = []
    const wait = (ms: number) => new Promise<void>((resolve) => timers.push(window.setTimeout(resolve, ms)))
    const run = async () => {
      await wait(1400)
      while (!cancelled) {
        const button = presetRefs.current[index]
        const box = stage.current?.getBoundingClientRect()
        if (button && box) {
          const rect = button.getBoundingClientRect()
          setCursor((current) => ({ x: rect.left - box.left + rect.width * 0.6, y: rect.top - box.top + rect.height * 0.62, click: current?.click ?? 0 }))
          await wait(950)
          if (cancelled) return
          setCursor((current) => current && { ...current, click: current.click + 1 })
          setEvents(PRESETS[index].events)
        }
        index = (index + 1) % PRESETS.length
        await wait(4200)
      }
    }
    void run()
    return () => { cancelled = true; timers.forEach((timer) => window.clearTimeout(timer)) }
  }, [inView, userDriving])

  const takeOver = (event: React.PointerEvent) => {
    if (event.isTrusted && !userDriving) { setUserDriving(true); setCursor(null) }
  }
  const toggle = (event: string) => {
    setEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : current.length >= 3 ? [...current.slice(1), event] : [...current, event])
  }
  const spotlight = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`)
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`)
  }

  // Head coach's week with the second coach's sessions on days 2 and 5 (as the swim planner blends two programs).
  const week = head.week.map((session, index) => (index === 1 || index === 4)
    ? { coach: second, session: second.week[index === 1 ? 0 : 1] }
    : { coach: head, session })
  const weekKey = `${head.key}-${second.key}`

  return (
    <section id="coaches" className="relative overflow-hidden py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="cs-orb cs-orb-a" />
        <span className="cs-orb cs-orb-b" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div ref={headRef} className={cn("mx-auto max-w-3xl text-center", headIn && "cs-in")}>
          <div className="cs-reveal mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300">
            <Crown className="h-3.5 w-3.5" />Your coaching team
          </div>
          <h2 className="cs-reveal text-balance text-4xl font-bold tracking-tight text-white [--d:80ms] md:text-6xl">
            Five elite coaching systems.{" "}
            <span className="cs-shine relative inline-block">
              Two are yours.
              <svg aria-hidden viewBox="0 0 300 20" preserveAspectRatio="none" className="cs-underline absolute -bottom-2 left-0 h-3 w-full">
                <path d="M4 14 C 70 4, 150 4, 296 10" fill="none" stroke="url(#cs-ul)" strokeWidth="5" strokeLinecap="round" pathLength={1} />
                <defs><linearGradient id="cs-ul" x1="0" x2="1"><stop offset="0" stopColor="#67e8f9" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs>
              </svg>
            </span>
          </h2>
          <p className="cs-reveal mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-400 [--d:160ms]">
            Not an AI making sets up. Every session comes from a real elite program, written set by set, then fitted to your PBs, your pool and your week.{" "}
            <span className="text-slate-200">Pick your events and watch your team assemble.</span>
          </p>
        </div>

        {/* Matcher */}
        <div ref={(element) => { stage.current = element; stageView.current = element }} onPointerDown={takeOver} onMouseMove={spotlight}
          className={cn("cs-stage relative mt-14 overflow-hidden rounded-[36px] border border-white/10 p-5 sm:p-8", inView && "cs-in")}>
          <span aria-hidden className="cs-stage-spot" />
          <div className="relative grid gap-8 lg:grid-cols-[340px_1fr] lg:gap-10">
            {/* 1 · events */}
            <div className="cs-reveal [--d:200ms]">
              <StepLabel n={1} text="Your events" />
              <div className="mt-4 flex flex-wrap gap-2">
                {PRESETS.map((preset, index) => {
                  const active = preset.events.join() === events.join()
                  return (
                    <button key={preset.label} ref={(element) => { presetRefs.current[index] = element }} type="button" onClick={() => setEvents(preset.events)}
                      className={cn("rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-300",
                        active ? "border-transparent bg-white text-slate-950 shadow-[0_8px_24px_rgba(255,255,255,0.18)]" : "border-white/12 text-slate-300 hover:border-white/30 hover:text-white")}>
                      {preset.label}
                    </button>
                  )
                })}
              </div>
              <div className="mt-5 space-y-2.5 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
                {EVENT_GROUPS.map((group) => (
                  <div key={group.stroke} className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{group.stroke}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {group.events.map((event) => {
                        const selected = events.includes(event)
                        return (
                          <button key={event} type="button" onClick={() => toggle(event)} aria-pressed={selected}
                            className={cn("rounded-lg px-2.5 py-1 font-mono text-[11px] transition-all duration-300",
                              selected ? "cs-chip-on bg-cyan-300 text-slate-950" : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.09] hover:text-white")}>
                            {event.split(" ")[0]}{group.stroke === "IM" ? " IM" : ""}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-500">Up to three events</span>
                <span key={ranking.type} className="cs-pop rounded-full border border-white/10 px-2.5 py-1 font-medium text-slate-200">
                  Profile: <span className="text-cyan-300">{TYPE_LABEL[ranking.type]}</span>
                </span>
              </div>
            </div>

            {/* 2 · team */}
            <div className="cs-reveal min-w-0 [--d:300ms]">
              <StepLabel n={2} text="Your coaching team" />
              <div className="relative mt-4 h-[436px]">
                <div aria-hidden className="cs-team-frame absolute inset-x-0 top-0 h-[172px] rounded-3xl">
                  <span className="absolute -top-2.5 left-5 rounded-full bg-[#0a141b] px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Matched to you</span>
                </div>
                {COACHES.map((coach) => {
                  const rank = ranking.order.indexOf(coach.key)
                  return <CoachRow key={coach.key} coach={coach} rank={rank} percent={ranking.percent(coach.key)} matched={ranking.fit[coach.key].matched} />
                })}
              </div>
            </div>
          </div>

          {/* 3 · week */}
          <div className="cs-reveal relative mt-8 [--d:400ms]">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <StepLabel n={3} text="Your week, from their real programs" />
              <p className="flex items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: head.tone }} />{head.name}</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: second.tone }} />{second.name}</span>
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
              {DAYS.map((day, index) => {
                const item = week[index]
                return (
                  <div key={`${weekKey}-${index}`} className="cs-flip relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
                    style={{ "--i": index, ...(item ? { "--tone": item.coach.tone } : {}) } as CSSProperties}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{day}</p>
                    {item ? (
                      <>
                        <div className="mt-2.5 flex items-center gap-2">
                          <CoachAvatar name={item.coach.name} shape="circle" className="h-7 w-7" />
                          <span className="text-[10px] text-slate-400">{item.coach.name.replace("Coach ", "")}</span>
                        </div>
                        <p className="mt-2 min-h-[2.5rem] text-sm font-semibold leading-tight text-white">{item.session}</p>
                        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1" style={{ background: item.coach.tone }} />
                      </>
                    ) : (
                      <p className="mt-2.5 min-h-[4.75rem] text-sm text-slate-500">Rest & recover</p>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-7 flex flex-col items-center justify-between gap-4 border-t border-white/[0.07] pt-6 sm:flex-row">
              <p className="text-center text-sm text-slate-400 sm:text-left">
                Every set is paced from <span className="text-white">your</span> PBs and fitted to <span className="text-white">your</span> session length. Pick any coaches you like during setup.
              </p>
              <Link href="/auth?mode=signup"
                className="cs-cta group relative inline-flex shrink-0 items-center overflow-hidden rounded-full px-6 py-3 text-sm font-semibold text-slate-950">
                <span aria-hidden className="cs-cta-sheen" />
                <span className="relative flex items-center">Build my coaching team<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
              </Link>
            </div>
          </div>

          {/* Ghost cursor */}
          {cursor && !userDriving && (
            <span aria-hidden className="cs-cursor pointer-events-none absolute left-0 top-0 z-20" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
              <MousePointer2 className="h-6 w-6 fill-white text-slate-900 drop-shadow-[0_6px_10px_rgba(0,0,0,0.5)]" />
              <span key={cursor.click} className="cs-click absolute -left-3 -top-3 h-6 w-6 rounded-full border-2 border-white/80" />
            </span>
          )}
          {!userDriving && inView && (
            <p className="pointer-events-none absolute right-5 top-5 hidden items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] text-slate-400 backdrop-blur sm:flex">
              <Sparkles className="h-3 w-3 text-cyan-300" />Live demo · tap anything to try it
            </p>
          )}
        </div>

        {/* Real sets ticker */}
        <div ref={proofRef} className={cn("relative mt-16", proofIn && "cs-in")}>
          <p className="cs-reveal text-center text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 [--d:500ms]">Straight from the programs your sessions are built from</p>
          <div className="cs-marquee mt-6 space-y-3">
            {[SETS, [...SETS].reverse()].map((row, rowIndex) => (
              <div key={rowIndex} className="flex overflow-hidden">
                <div className={cn("cs-track flex shrink-0 gap-3 pr-3", rowIndex && "cs-track-reverse")}>
                  {[...row, ...row].map((set, index) => (
                    <span key={index} className="flex shrink-0 items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.03] py-1.5 pl-1.5 pr-4">
                      <CoachAvatar name={set.coach} shape="circle" className="h-7 w-7" />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{set.type}</span>
                      <span className="font-mono text-[13px] text-slate-200">{set.line}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Proof */}
        <dl className="mx-auto mt-16 grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.06] md:grid-cols-4">
          {STATS.map((stat, index) => <Stat key={stat.label} {...stat} start={proofIn} index={index} />)}
        </dl>
      </div>
    </section>
  )
}

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <p className="flex items-center gap-2.5 text-sm font-semibold text-white">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-cyan-300/15 font-mono text-[11px] text-cyan-300">{n}</span>{text}
    </p>
  )
}

function CoachRow({ coach, rank, percent, matched }: { coach: Coach; rank: number; percent: number; matched: string[] }) {
  const shown = useCount(percent)
  const onTeam = rank < 2
  return (
    <div className={cn("cs-row absolute inset-x-0 top-0 flex h-[76px] items-center gap-2.5 rounded-2xl border px-3 sm:gap-3.5 sm:px-4",
      onTeam ? "border-white/15 bg-white/[0.06]" : "border-white/[0.05] bg-white/[0.015] opacity-55")}
      style={{ transform: `translateY(${rank * 86 + (rank >= 2 ? 6 : 0) + 4}px) scale(${onTeam ? 1 : 0.97})`, "--glow": coach.glow, zIndex: 5 - rank } as CSSProperties}>
      {onTeam && <span aria-hidden className="cs-row-glow absolute inset-0 rounded-2xl" />}
      <CoachAvatar name={coach.name} className={cn("relative h-10 w-10 transition-transform duration-500 sm:h-12 sm:w-12", onTeam && "scale-105")} />
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-white">{coach.name}</p>
          {onTeam && (
            <span key={`${coach.key}-${rank}`} className="cs-pop shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-950" style={{ background: coach.tone }}>
              {rank === 0 ? <>Head<span className="hidden sm:inline"> coach</span></> : "Second"}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-slate-400">{coach.title}{matched.length > 0 && <span className="text-slate-300"> · {matched.join(", ")}</span>}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <span className="block h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${percent}%`, background: `linear-gradient(90deg, ${coach.tone}66, ${coach.tone})` }} />
        </div>
      </div>
      <div className="relative w-11 shrink-0 text-right sm:w-14">
        <p className="font-mono text-base font-bold tabular-nums text-white sm:text-lg">{shown}<span className="text-xs text-slate-500">%</span></p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">fit</p>
      </div>
      {onTeam && <Check aria-hidden className="relative hidden h-4 w-4 shrink-0 sm:block" style={{ color: coach.tone }} strokeWidth={3} />}
    </div>
  )
}

function Stat({ value, suffix, label, start, index }: { value: number; suffix: string; label: string; start: boolean; index: number }) {
  const shown = useCount(start ? value : 0, 1400 + index * 150)
  return (
    <div className="bg-[#070c11] px-6 py-7 text-center">
      <dd className="text-4xl font-bold tracking-tight text-white md:text-5xl">
        <span className="bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">{shown}</span>
        <span className="text-2xl text-cyan-300">{suffix}</span>
      </dd>
      <dt className="mt-2 text-sm text-slate-400">{label}</dt>
    </div>
  )
}
