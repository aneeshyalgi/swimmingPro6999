"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import {
  Annoyed, Brain, Check, ExternalLink, Eye, Flag, Frown, HeartHandshake, Laugh, Meh, MessageCircle, Moon, NotebookPen, Pencil,
  Play, RotateCcw, Shield, Smile, Sparkles, Square, Sunrise, Target, TrendingUp, Trophy, Users, Waves, Wind, Zap, type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Reveal, StepTimeline, Tile, TileHeader } from "@/components/dashboard-ui"
import { LEVEL_COLORS } from "@/components/mental/mind-quiz"
import { cn } from "@/lib/utils"
import type { MindAnswers, MindPlan, MoodWeek, Skill } from "@/lib/mental"

const HELPLINES = "https://findahelpline.com"
const SHORT_LABELS: Record<Skill, string> = { confidence: "Confidence", focus: "Focus", calm: "Calm", motivation: "Motivation", resilience: "Bounce-back" }
const MOODS: { value: number; label: string; icon: LucideIcon; message: string }[] = [
  { value: 1, label: "Rough", icon: Frown, message: "Sorry today's rough. Try the 1-minute reset, and talk to someone you trust if it keeps going." },
  { value: 2, label: "Low", icon: Annoyed, message: "Low days happen. Be kind to yourself and keep today simple." },
  { value: 3, label: "Okay", icon: Meh, message: "Steady is fine. Pick one small win for today." },
  { value: 4, label: "Good", icon: Smile, message: "Good day to train well. Enjoy it." },
  { value: 5, label: "Great", icon: Laugh, message: "Love it. Bring that energy to the pool." },
]
const TOOL_ICONS: Record<string, LucideIcon> = {
  message: MessageCircle, eye: Eye, rotate: RotateCcw, notebook: NotebookPen, target: Target, shield: Shield, moon: Moon, zap: Zap, users: Users,
}
const TONE_DOT = { good: "bg-emerald-400", fair: "bg-amber-300", low: "bg-rose-400" }
const PRE_RACE: Record<MindAnswers["pre_race"], string> = {
  calm: "Calm before races", excited: "Excited nerves", anxious: "Nervous before races", flat: "Flat before races",
}

/** The five self-ratings on a pentagon: the shape grows out from the middle, then each point pops in. */
function Radar({ plan }: { plan: MindPlan }) {
  const size = 300
  const centre = size / 2
  const radius = 98
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / plan.skills.length
    return [centre + Math.cos(angle) * radius * (value / 5), centre + Math.sin(angle) * radius * (value / 5)] as const
  }
  const polygon = (value: (index: number) => number) => plan.skills.map((_, index) => point(index, value(index)).join(",")).join(" ")
  return (
    <div className="relative shrink-0" role="img"
      aria-label={plan.skills.map((skill) => `${skill.label} ${skill.value} out of 5`).join(", ")}>
      <span aria-hidden className="qf-glow absolute inset-12 rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.22),transparent_70%)]" />
      <svg viewBox={`-66 -8 ${size + 132} ${size - 6}`} className="relative h-auto w-[330px] max-w-full sm:w-[410px]" aria-hidden>
        <defs>
          <linearGradient id="mp-radar-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="mp-radar-line" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c4b5fd" />
            <stop offset="100%" stopColor="#67e8f9" />
          </linearGradient>
        </defs>
        {[1, 2, 3, 4, 5].map((level) => (
          <polygon key={level} points={polygon(() => level)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={level === 5 ? 1.5 : 1} />
        ))}
        {plan.skills.map((skill, index) => {
          const [x, y] = point(index, 5)
          return <line key={skill.key} x1={centre} y1={centre} x2={x} y2={y} stroke="rgba(255,255,255,0.07)" />
        })}
        <g className="mp-radar-shape" style={{ transformOrigin: `${centre}px ${centre}px` }}>
          <polygon points={polygon((index) => plan.skills[index].value)} fill="url(#mp-radar-fill)" stroke="url(#mp-radar-line)" strokeWidth="2.5" strokeLinejoin="round" />
        </g>
        {plan.skills.map((skill, index) => {
          const [x, y] = point(index, skill.value)
          const highlight = skill.key === plan.strength ? "#34d399" : skill.key === plan.working_on ? "#fbbf24" : "#e2e8f0"
          return (
            <circle key={skill.key} cx={x} cy={y} r="5" fill={highlight} stroke="#0b1218" strokeWidth="2"
              className="mp-radar-dot" style={{ "--i": index, transformOrigin: `${x}px ${y}px` } as CSSProperties} />
          )
        })}
        {plan.skills.map((skill, index) => {
          const [x, y] = point(index, 6.2)
          const anchor = Math.abs(x - centre) < 8 ? "middle" : x > centre ? "start" : "end"
          const tone = skill.key === plan.strength ? "#6ee7b7" : skill.key === plan.working_on ? "#fcd34d" : "#cbd5e1"
          // The top label sits wholly above its point; the others are centred on theirs.
          const top = y < centre - radius
          return (
            <text key={skill.key} x={x} y={top ? y - 16 : y - 7} textAnchor={anchor} className="mp-radar-label" style={{ "--i": index } as CSSProperties}>
              <tspan x={x} fill={tone} fontSize="15" fontWeight="600">{SHORT_LABELS[skill.key]}</tspan>
              <tspan x={x} dy="17" fill="#94a3b8" fontSize="13">{skill.value}/5</tspan>
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function Hero({ plan, answers, onEdit }: { plan: MindPlan; answers: MindAnswers; onEdit: () => void }) {
  const label = (key: Skill | null) => plan.skills.find((skill) => skill.key === key)?.label
  const chips: { icon: LucideIcon; label: string; className: string }[] = [
    ...(plan.strength ? [{ icon: Trophy, label: `Strength: ${label(plan.strength)}`, className: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" }] : []),
    { icon: TrendingUp, label: `Working on: ${label(plan.working_on)}`, className: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
    { icon: Flag, label: PRE_RACE[answers.pre_race], className: "border-white/10 bg-white/[0.06] text-slate-200" },
  ]
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(125deg,rgba(167,139,250,0.16),rgba(12,20,28,0.94)_45%,rgba(87,229,234,0.12))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-violet-400/12 blur-3xl" />
      <div aria-hidden className="mp-aurora pointer-events-none absolute -bottom-32 right-10 h-72 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">
            <Brain className="h-3.5 w-3.5" />
            Your mental game
          </p>
          <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">{plan.goal.title}</h2>
          <p className="mt-3 text-base leading-7 text-slate-300">{plan.goal.approach}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span key={chip.label} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-md", chip.className)}>
                <chip.icon className="h-3.5 w-3.5" />
                {chip.label}
              </span>
            ))}
          </div>
          <Button variant="outline" onClick={onEdit}
            className="mt-7 h-11 rounded-full border-white/15 bg-white/[0.04] px-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300/40 hover:bg-violet-400/10 hover:text-white">
            <Pencil className="h-4 w-4" />
            Edit answers
          </Button>
        </div>
        <div className="flex justify-center">
          <Radar plan={plan} />
        </div>
      </div>
    </section>
  )
}

function SupportCard() {
  return (
    <section className="relative overflow-hidden rounded-[22px] border border-rose-300/20 bg-[linear-gradient(135deg,rgba(251,113,133,0.12),rgba(12,20,28,0.94)_55%,rgba(167,139,250,0.1))] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-rose-300/25 bg-rose-400/10">
          <HeartHandshake className="h-6 w-6 text-rose-200" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-white">You don&apos;t have to carry it alone</h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            It sounds like things have been heavy lately. Talking helps: a parent, a friend, your coach, a teacher, or a doctor or
            counsellor. If you ever feel unsafe, call your local emergency number.
          </p>
        </div>
        <Button asChild className="h-11 shrink-0 rounded-full bg-rose-200 px-5 font-semibold text-slate-950 hover:bg-rose-100">
          <a href={HELPLINES} target="_blank" rel="noreferrer">
            Find a free helpline
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>
    </section>
  )
}

function CheckInCard({ plan, week, saving, error, onCheckIn }: {
  plan: MindPlan; week: MoodWeek; saving: boolean; error: string | null; onCheckIn: (mood: number) => void
}) {
  const today = week[week.length - 1]
  const chosen = MOODS.find((mood) => mood.value === today?.mood)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <Tile className="h-full">
      <TileHeader icon={Smile} title="Daily check-in" subtitle="How do you feel today? One tap." />
      <div role="radiogroup" aria-label="How you feel today" className="grid grid-cols-5 gap-2">
        {MOODS.map((mood) => {
          const selected = today?.mood === mood.value
          const color = LEVEL_COLORS[mood.value - 1]
          return (
            <button key={mood.value} type="button" role="radio" aria-checked={selected} disabled={saving && !selected}
              onClick={() => { if (!selected) onCheckIn(mood.value) }}
              className="group flex flex-col items-center gap-1.5 rounded-2xl py-2 transition-transform duration-300 hover:-translate-y-1 disabled:opacity-60">
              <span key={String(selected)}
                className={cn("grid h-12 w-12 place-items-center rounded-full border transition-all duration-300 sm:h-14 sm:w-14",
                  selected ? "qf-pick border-transparent text-slate-950" : "border-white/10 bg-white/[0.03] text-slate-300 group-hover:border-white/25 group-hover:text-white")}
                style={selected ? { background: color, boxShadow: `0 0 0 4px ${color}26, 0 10px 30px ${color}55` } : undefined}>
                <mood.icon className="h-6 w-6" />
              </span>
              <span className={cn("text-xs font-medium transition-colors", selected ? "text-white" : "text-slate-400")}>{mood.label}</span>
            </button>
          )
        })}
      </div>
      <p key={chosen?.value ?? 0} aria-live="polite" className={cn("mt-4 min-h-[3rem] rounded-xl border px-3.5 py-2.5 text-sm leading-6",
        chosen ? "qf-rise border-white/10 bg-white/[0.03] text-slate-200" : "border-dashed border-white/10 text-slate-500")}>
        {chosen ? chosen.message : "Check in once a day. Over time you'll see how your week is going."}
      </p>
      {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-300">{error}</p>}
      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">This week</p>
        <div className="mt-2 grid h-20 grid-cols-7 items-end gap-2">
          {week.map((day, index) => {
            const isToday = index === week.length - 1
            const height = day.mood ? 18 + day.mood * 11 : 6
            return (
              <div key={day.date} className="flex h-full flex-col items-center justify-end gap-1.5" title={day.mood ? `${day.date}: ${MOODS[day.mood - 1].label}` : `${day.date}: no check-in`}>
                <span className="w-full max-w-7 rounded-md transition-[height,background-color] duration-700 ease-out"
                  style={{ height: drawn ? height : 4, transitionDelay: `${index * 60}ms`,
                    background: day.mood ? LEVEL_COLORS[day.mood - 1] : "rgba(255,255,255,0.08)", opacity: day.mood ? 0.9 : 1 }} />
                <span className={cn("text-[10px] font-semibold", isToday ? "text-white" : "text-slate-500")}>
                  {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
        {plan.wellbeing.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300">
            <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[item.tone])} />
            {item.label}
          </span>
        ))}
      </div>
    </Tile>
  )
}

const PHASES = [
  { label: "Breathe in", scale: 1 },
  { label: "Hold", scale: 1 },
  { label: "Breathe out", scale: 0.56 },
  { label: "Hold", scale: 0.56 },
]
const PHASE_SECONDS = 4
const ROUNDS = 4

/** Guided box breathing: the orb grows as you breathe in, holds, shrinks as you breathe out, holds; four rounds. */
function ResetCard({ plan }: { plan: MindPlan }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle")
  const [tick, setTick] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const total = PHASES.length * PHASE_SECONDS * ROUNDS
  const phaseIndex = Math.floor(tick / PHASE_SECONDS) % PHASES.length
  const phase = PHASES[phaseIndex]
  const round = Math.floor(tick / (PHASE_SECONDS * PHASES.length)) + 1
  const count = PHASE_SECONDS - (tick % PHASE_SECONDS)

  useEffect(() => () => window.clearInterval(timer.current), [])

  const start = () => {
    window.clearInterval(timer.current)
    setTick(0)
    setState("running")
    timer.current = window.setInterval(() => {
      setTick((value) => {
        if (value + 1 >= total) {
          window.clearInterval(timer.current)
          setState("done")
          return value
        }
        return value + 1
      })
    }, 1000)
  }
  const stop = () => {
    window.clearInterval(timer.current)
    setState("idle")
    setTick(0)
  }

  const running = state === "running"
  const scale = running ? phase.scale : state === "done" ? 0.8 : 0.7
  const progress = running ? (tick + 1) / total : state === "done" ? 1 : 0
  const ring = 2 * Math.PI * 104
  return (
    <Tile className="h-full">
      <TileHeader icon={Wind} title="1-minute reset" subtitle={`Box breathing · ${ROUNDS} rounds of ${PHASE_SECONDS}-${PHASE_SECONDS}-${PHASE_SECONDS}-${PHASE_SECONDS}`} />
      <div className="flex flex-col items-center">
        <div className="relative grid h-[232px] w-[232px] place-items-center">
          <svg viewBox="0 0 232 232" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="116" cy="116" r="104" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
            <circle cx="116" cy="116" r="104" fill="none" stroke="url(#mp-reset-ring)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={ring} strokeDashoffset={ring * (1 - progress)} className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none" />
            <defs>
              <linearGradient id="mp-reset-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#c4b5fd" />
                <stop offset="100%" stopColor="#67e8f9" />
              </linearGradient>
            </defs>
          </svg>
          <span aria-hidden className={cn("mp-orb absolute h-44 w-44 rounded-full", !running && "mp-orb-idle")}
            style={{ transform: `scale(${scale})`, transitionDuration: running ? `${PHASE_SECONDS}s` : "900ms" }} />
          <div className="relative text-center" aria-live="polite">
            {state === "done" ? (
              <>
                <span className="qf-pick mx-auto grid h-11 w-11 place-items-center rounded-full bg-white/90 text-slate-950"><Check className="h-6 w-6" strokeWidth={3} /></span>
                <p className="mt-2 text-sm font-semibold text-white">Nice work</p>
              </>
            ) : running ? (
              <>
                <p key={`${phaseIndex}-${round}`} className="qf-rise text-lg font-bold text-white">{phase.label}</p>
                <p className="mt-0.5 text-3xl font-bold tabular-nums text-white/90">{count}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">Round {round} of {ROUNDS}</p>
              </>
            ) : (
              <>
                <Wind className="mx-auto h-6 w-6 text-white/80" />
                <p className="mt-1.5 text-sm font-semibold text-white">Ready when you are</p>
              </>
            )}
          </div>
        </div>
        <p className="mt-4 max-w-sm text-center text-sm leading-6 text-slate-400">
          {state === "done" ? "Notice how you feel now. Use it behind the blocks, before tests, or any time you need it." :
            plan.reset.uses ? `You already use breathing. ${plan.reset.text}` : plan.reset.text}
        </p>
        <div className="mt-4">
          {running ? (
            <Button variant="outline" onClick={stop} className="h-11 rounded-full border-white/15 bg-white/[0.04] px-5 hover:bg-white/[0.08] hover:text-white">
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button onClick={start} className="qf-cta h-11 rounded-full bg-violet-300 px-6 font-semibold text-slate-950 shadow-[0_10px_30px_rgba(167,139,250,0.3)] hover:bg-violet-200">
              {state === "done" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {state === "done" ? "Again" : "Start"}
            </Button>
          )}
        </div>
      </div>
    </Tile>
  )
}

function Routine({ plan }: { plan: MindPlan }) {
  const styles: Record<string, { icon: LucideIcon; tone: string; ring: string }> = {
    night: { icon: Moon, tone: "text-indigo-200", ring: "border-indigo-300/35 bg-indigo-300/10" },
    warmup: { icon: Waves, tone: "text-cyan-200", ring: "border-cyan-300/35 bg-cyan-300/10" },
    blocks: { icon: Target, tone: "text-violet-200", ring: "border-violet-300/35 bg-violet-300/10" },
    after: { icon: Sunrise, tone: "text-emerald-200", ring: "border-emerald-300/35 bg-emerald-300/10" },
  }
  return (
    <Tile>
      <TileHeader icon={Flag} title="Your race-day routine" subtitle={plan.routine.note} />
      <StepTimeline line="from-indigo-300/60 via-violet-300/60 to-emerald-300/60" steps={plan.routine.steps.map((step) => {
        const style = styles[step.key] ?? styles.blocks
        return { key: step.key, icon: style.icon, tone: style.tone, ring: style.ring, when: step.when, title: step.title, text: step.text }
      })} />
    </Tile>
  )
}

function Toolkit({ plan }: { plan: MindPlan }) {
  return (
    <Tile>
      <TileHeader icon={Sparkles} title="Your mental skills" subtitle="Three skills picked for you. Practise them in training so they're there on race day." />
      <ol className="grid gap-3 md:grid-cols-3">
        {plan.toolkit.map((tool, index) => {
          const Icon = TOOL_ICONS[tool.icon] ?? Sparkles
          return (
            <li key={tool.key} className="qf-stagger group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300/30 hover:bg-white/[0.04]"
              style={{ "--i": index } as CSSProperties}>
              <div className="flex items-center justify-between gap-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-violet-300/25 bg-violet-400/10 text-violet-200 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                  <Icon className="h-5 w-5" />
                </span>
                {tool.uses && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                    <Check className="h-3 w-3" strokeWidth={3} />
                    You do this already
                  </span>
                )}
              </div>
              <h4 className="mt-3 font-semibold text-white">{tool.title}</h4>
              <p className="mt-1 text-sm leading-6 text-slate-400">{tool.why}</p>
              <ol className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                {tool.steps.map((step, stepIndex) => (
                  <li key={step} className="flex gap-2.5 text-sm leading-5 text-slate-300">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-slate-400">{stepIndex + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </li>
          )
        })}
      </ol>
    </Tile>
  )
}

/** The athlete's mental performance plan, with today's check-in. */
export function MindDashboard({ plan, answers, week, support, saving, checkInError, onCheckIn, onEdit }: {
  plan: MindPlan
  answers: MindAnswers
  week: MoodWeek
  support: boolean
  saving: boolean
  checkInError: string | null
  onCheckIn: (mood: number) => void
  onEdit: () => void
}) {
  return (
    <div className="space-y-6">
      <Reveal index={0}>
        <Hero plan={plan} answers={answers} onEdit={onEdit} />
      </Reveal>
      {support && (
        <Reveal index={1}>
          <SupportCard />
        </Reveal>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal index={2} className="h-full">
          <CheckInCard plan={plan} week={week} saving={saving} error={checkInError} onCheckIn={onCheckIn} />
        </Reveal>
        <Reveal index={3} className="h-full">
          <ResetCard plan={plan} />
        </Reveal>
      </div>
      <Reveal index={4}>
        <Routine plan={plan} />
      </Reveal>
      <Reveal index={5}>
        <Toolkit plan={plan} />
      </Reveal>
      <p className="px-1 text-xs leading-5 text-slate-500">
        This is about performance, not a diagnosis. If something is weighing on you, talk to someone you trust, or find a free,
        confidential helpline at{" "}
        <a href={HELPLINES} target="_blank" rel="noreferrer" className="text-slate-300 underline decoration-white/20 underline-offset-2 hover:text-white">findahelpline.com</a>.
      </p>
    </div>
  )
}
