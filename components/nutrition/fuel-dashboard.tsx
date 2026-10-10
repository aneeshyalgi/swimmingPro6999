"use client"

import { useEffect, useId, useRef, useState, type CSSProperties } from "react"
import {
  Apple, Ban, BatteryCharging, CalendarCheck, Carrot, Check, ChefHat, Droplet, Droplets, Dumbbell, Flame, GlassWater, HeartPulse,
  Leaf, Pencil, Plus, Salad, Shuffle, Sprout, Sun, Sunrise, Sunset, Target, Timer, Undo2, Utensils, Waves, Wheat, Zap, type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { GrowBar, Reveal, StepTimeline, useTween } from "@/components/dashboard-ui"
import { Segmented } from "@/components/training-ui"
import { WaterBubbles } from "@/components/water-bubbles"
import { cn } from "@/lib/utils"
import type { FuelDay, FuelPlan, NutritionAnswers } from "@/lib/nutrition"

type DayType = "training" | "rest"
const GLASS_ML = 250

const MACROS = {
  protein: { label: "Protein", icon: Dumbbell, colors: ["#fda4af", "#fb7185"], chip: "bg-rose-400/12 text-rose-300", bar: "from-rose-300 to-rose-400", glow: "bg-rose-400/25", dot: "bg-rose-300" },
  carbs: { label: "Carbs", icon: Zap, colors: ["#fde68a", "#fbbf24"], chip: "bg-amber-300/12 text-amber-200", bar: "from-amber-200 to-amber-400", glow: "bg-amber-300/25", dot: "bg-amber-300" },
  fat: { label: "Fat", icon: Droplet, colors: ["#c4b5fd", "#a78bfa"], chip: "bg-violet-400/12 text-violet-300", bar: "from-violet-300 to-violet-400", glow: "bg-violet-400/25", dot: "bg-violet-300" },
} as const
type Macro = keyof typeof MACROS

const SWIM_TIME: Record<NutritionAnswers["swim_time"], { label: string; icon: LucideIcon }> = {
  early: { label: "Early-morning swims", icon: Sunrise },
  midday: { label: "Midday swims", icon: Sun },
  afternoon: { label: "Afternoon swims", icon: Sun },
  evening: { label: "Evening swims", icon: Sunset },
  varies: { label: "Swim times vary", icon: Shuffle },
}
const DIET: Record<NutritionAnswers["diet"], string | null> = { any: null, vegetarian: "Vegetarian", vegan: "Vegan", pescatarian: "Pescatarian" }
const HABIT_ICONS: Record<string, LucideIcon> = {
  snack: Apple, plan: CalendarCheck, batch: ChefHat, energy: Zap, water: GlassWater, protein: Dumbbell, veg: Salad, recover: BatteryCharging,
  carbs: Wheat, growth: Sprout, sunrise: Sunrise, meals: Utensils, plant: Leaf, iron: HeartPulse, colour: Carrot,
}

/** 0 → "0", 0.75 → "0.75", 1.5 → "1.5". */
const litresText = (value: number) => value.toFixed(2).replace(/\.?0+$/, "")

/** Each macro's share of the day's calories, as whole percentages that add up to 100. */
function shares(day: FuelDay): Record<Macro, number> {
  const protein = Math.round((day.protein_g * 4 * 100) / day.calories)
  const fat = Math.round((day.fat_g * 9 * 100) / day.calories)
  return { protein, carbs: 100 - protein - fat, fat }
}

function MacroRing({ day, label }: { day: FuelDay; label: string }) {
  const id = useId()
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const calories = useTween(day.calories)
  const size = 236
  const stroke = 16
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const gap = 8
  const parts: [Macro, number][] = [["protein", day.protein_g * 4], ["carbs", day.carbs_g * 4], ["fat", day.fat_g * 9]]
  const total = parts.reduce((sum, [, kcal]) => sum + kcal, 0)
  let start = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img"
      aria-label={`${day.calories} kcal on a ${label}: ${day.protein_g} g protein, ${day.carbs_g} g carbs, ${day.fat_g} g fat`}>
      <span aria-hidden className="qf-spin-slow absolute -inset-3 rounded-full border border-dashed border-white/10" />
      <span aria-hidden className="qf-glow absolute inset-8 rounded-full bg-[radial-gradient(circle,rgba(87,229,234,0.18),transparent_70%)]" />
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          {parts.map(([macro]) => (
            <linearGradient key={macro} id={`${id}-${macro}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={MACROS[macro].colors[0]} />
              <stop offset="100%" stopColor={MACROS[macro].colors[1]} />
            </linearGradient>
          ))}
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        {parts.map(([macro, kcal]) => {
          const arc = (kcal / total) * circumference
          // Round caps reach half a stroke past each end, so the dash is shortened by a stroke plus the gap.
          const length = Math.max(0.01, arc - stroke - gap)
          const offset = start + (stroke + gap) / 2
          start += arc
          return (
            <circle key={macro} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`url(#${id}-${macro})`} strokeWidth={stroke}
              strokeLinecap="round" className="nu-arc" strokeDasharray={`${drawn ? length : 0.01} ${circumference}`} strokeDashoffset={-offset}
              style={{ opacity: drawn ? 1 : 0 }} />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <Flame className="h-5 w-5 text-amber-300" aria-hidden />
        <span className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-white">{Math.round(calories).toLocaleString()}</span>
        <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">kcal · {label}</span>
      </div>
    </div>
  )
}

function Hero({ plan, answers, day, dayType, todayType, onDayType, onEdit }: {
  plan: FuelPlan; answers: NutritionAnswers; day: FuelDay; dayType: DayType; todayType: DayType; onDayType: (value: DayType) => void; onEdit: () => void
}) {
  const percent = shares(day)
  const { swims, gyms } = plan.training
  const swimTime = SWIM_TIME[answers.swim_time]
  const chips: { icon: LucideIcon; label: string }[] = [
    { icon: Waves, label: `${swims} swim${swims === 1 ? "" : "s"}${gyms ? ` · ${gyms} gym` : ""} a week` },
    { icon: swimTime.icon, label: swimTime.label },
    ...(DIET[answers.diet] ? [{ icon: Leaf, label: DIET[answers.diet]! }] : []),
    ...(answers.avoid.length ? [{ icon: Ban, label: `No ${answers.avoid.join(", ")}` }] : []),
  ]
  const dayLabel = (value: DayType) => (
    <span className="inline-flex items-center gap-1.5">
      {value === "training" ? "Training day" : "Rest day"}
      {value === todayType && <span className="rounded-[5px] border border-current px-1 text-[9px] font-bold uppercase leading-[14px] tracking-wider opacity-80">Today</span>}
    </span>
  )
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(125deg,rgba(52,211,153,0.14),rgba(12,20,28,0.94)_45%,rgba(87,229,234,0.12))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-8">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <WaterBubbles />
      </div>
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
            <Target className="h-3.5 w-3.5" />
            Your nutrition goal
          </p>
          <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">{plan.goal.title}</h2>
          <p className="mt-3 text-base leading-7 text-slate-300">{plan.goal.approach}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span key={chip.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur-md">
                <chip.icon className="h-3.5 w-3.5 text-accent" />
                {chip.label}
              </span>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Segmented label="Show targets for" value={dayType} onChange={onDayType} className="h-11 w-full max-w-[19rem] backdrop-blur-md"
              options={[{ value: "training", label: dayLabel("training") }, { value: "rest", label: dayLabel("rest") }]} />
            <Button variant="outline" onClick={onEdit}
              className="h-11 rounded-full border-white/15 bg-white/[0.04] px-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/10 hover:text-white">
              <Pencil className="h-4 w-4" />
              Edit answers
            </Button>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-400">{plan.summary}</p>
        </div>
        <div className="flex flex-col items-center gap-5">
          <MacroRing day={day} label={dayType === "training" ? "training day" : "rest day"} />
          <ul className="flex items-center gap-4 text-xs text-slate-400" aria-label="Share of calories">
            {(Object.keys(MACROS) as Macro[]).map((macro) => (
              <li key={macro} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", MACROS[macro].dot)} />
                {MACROS[macro].label}
                <span className="tabular-nums text-slate-200">{percent[macro]}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function MacroCard({ macro, grams, weight, share, hint, foods }: { macro: Macro; grams: number; weight: number; share: number; hint: string; foods: string[] }) {
  const tone = MACROS[macro]
  const shown = useTween(grams)
  return (
    <div className="group relative h-full overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-[0_20px_50px_rgba(0,0,0,0.38)]">
      <div className={cn("pointer-events-none absolute -right-14 -top-14 h-36 w-36 rounded-full opacity-40 blur-3xl transition-opacity duration-500 group-hover:opacity-90", tone.glow)} />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <span className={cn("grid h-9 w-9 place-items-center rounded-xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110", tone.chip)}>
              <tone.icon className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-white">{tone.label}</span>
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-300">
            {(grams / weight).toFixed(1)} g/kg
          </span>
        </div>
        <p className="mt-4 text-4xl font-bold tabular-nums tracking-tight text-white">
          {Math.round(shown)}
          <span className="ml-1 text-lg font-medium text-slate-400">g</span>
        </p>
        <GrowBar percent={share} className="mt-3 h-1.5" barClassName={tone.bar} />
        <p className="mt-1.5 text-[11px] text-slate-500">{share}% of your calories</p>
        <p className="mt-3 text-sm leading-6 text-slate-300">{hint}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {foods.map((food) => (
            <span key={food} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">{food}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Bottle({ percent, splash }: { percent: number; splash: number }) {
  const height = 196
  return (
    <div aria-hidden className="relative shrink-0">
      <span className="mx-auto block h-3 w-10 rounded-t-lg border-2 border-b-0 border-white/20 bg-white/[0.06]" />
      <div className="relative w-[7.25rem] overflow-hidden rounded-[28px] border-2 border-white/20 bg-white/[0.03] shadow-[inset_0_0_30px_rgba(56,189,248,0.08)]" style={{ height }}>
        {[25, 50, 75].map((mark) => <span key={mark} className="absolute right-0 h-px w-3 bg-white/20" style={{ bottom: `${mark}%` }} />)}
        <div className="nu-water absolute inset-x-0 bottom-0" style={{ height: `${percent}%` }}>
          <div className="absolute inset-0 bg-gradient-to-t from-sky-600/90 via-sky-400/80 to-cyan-300/80" />
          {percent > 0 && percent < 100 && (
            <>
              <svg className="nu-wave nu-wave-b absolute -top-[9px] left-0 h-[10px] w-[200%]" viewBox="0 0 200 10" preserveAspectRatio="none">
                <path d="M0 5 Q 12.5 0 25 5 T 50 5 T 75 5 T 100 5 T 125 5 T 150 5 T 175 5 T 200 5 V10 H0 Z" fill="#a5f3fc" fillOpacity="0.45" />
              </svg>
              <svg className="nu-wave absolute -top-[8px] left-0 h-[9px] w-[200%]" viewBox="0 0 200 10" preserveAspectRatio="none">
                <path d="M0 5 Q 12.5 10 25 5 T 50 5 T 75 5 T 100 5 T 125 5 T 150 5 T 175 5 T 200 5 V10 H0 Z" fill="#67e8f9" fillOpacity="0.85" />
              </svg>
            </>
          )}
          {percent > 8 && [18, 42, 64, 82].map((left, index) => (
            <span key={left} className="nu-bubble" style={{ left: `${left}%`, width: 4 + (index % 2) * 3, height: 4 + (index % 2) * 3,
              "--t": `${3.2 + index * 0.7}s`, "--d": `${index * -0.9}s`, "--h": `${(height * percent) / 100}px` } as CSSProperties} />
          ))}
        </div>
        {splash > 0 && (
          <span key={splash} className="nu-drop absolute left-1/2 top-1 -ml-1.5 h-4 w-3 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-cyan-200"
            style={{ "--fall": `${Math.max(10, height * (1 - percent / 100) - 18)}px` } as CSSProperties} />
        )}
        <span className="pointer-events-none absolute inset-y-4 left-3 w-1.5 rounded-full bg-white/10" />
      </div>
    </div>
  )
}

function WaterCard({ plan, todayType, ml, onAdd, error }: { plan: FuelPlan; todayType: DayType; ml: number; onAdd: (delta: number) => void; error: string | null }) {
  const targetL = plan.days[todayType].water_l
  const target = targetL * 1000
  const percent = Math.min(100, (ml / target) * 100)
  const reached = ml >= target
  const litres = useTween(ml / 1000, 700)
  const [splash, setSplash] = useState(0)
  const [cheer, setCheer] = useState(0)
  const wasReached = useRef(reached)
  useEffect(() => {
    if (reached && !wasReached.current) setCheer((count) => count + 1)
    wasReached.current = reached
  }, [reached])
  const add = (delta: number) => {
    if (delta > 0) setSplash((count) => count + 1)
    onAdd(delta)
  }
  return (
    <div className="group relative h-full overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.28)] sm:p-6">
      <div className="pointer-events-none absolute -bottom-20 -right-16 h-52 w-52 rounded-full bg-sky-400/10 blur-3xl" />
      <div className="relative">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-300/25 bg-sky-400/10">
            <GlassWater className="h-5 w-5 text-sky-300" />
          </span>
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-white">Hydration</h3>
            <p className="mt-0.5 text-xs text-slate-400">Today · {todayType === "training" ? "training day" : "rest day"}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <Bottle percent={percent} splash={splash} />
          <div className="min-w-0">
            <p className="text-4xl font-bold tabular-nums tracking-tight text-white">
              {litresText(litres)}
              <span className="ml-1 text-lg font-medium text-slate-400">L</span>
            </p>
            <p className="mt-0.5 text-sm text-slate-400">of {targetL} L today</p>
            <p className="mt-1 text-xs tabular-nums text-slate-500" aria-live="polite">
              {ml > 0 ? `${Math.floor(ml / GLASS_ML)} of ${Math.round(target / GLASS_ML)} glasses` : `Tap Glass each time you finish one`}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={() => add(GLASS_ML)} disabled={ml >= 10000}
                className="h-10 rounded-full bg-sky-300 px-4 font-semibold text-slate-950 shadow-[0_8px_24px_rgba(56,189,248,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-sky-200 active:translate-y-0 active:scale-95">
                <Plus className="h-4 w-4" strokeWidth={3} />
                Glass
              </Button>
              <Button variant="ghost" size="icon" onClick={() => add(-GLASS_ML)} disabled={ml <= 0} aria-label="Remove a glass" title="Remove a glass"
                className="h-10 w-10 rounded-full border border-white/10 text-slate-300 hover:bg-white/[0.06] hover:text-white">
                <Undo2 className="h-4 w-4" />
              </Button>
            </div>
            {reached && (
              <p key={cheer} className="nu-goal relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                Goal reached
                {cheer > 0 && <span aria-hidden className="nu-sparks">{[0, 60, 120, 180, 240, 300].map((angle) => <i key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />)}</span>}
              </p>
            )}
          </div>
        </div>
        <p className="mt-5 border-t border-white/[0.06] pt-4 text-xs leading-5 text-slate-400">
          One glass is {GLASS_ML} ml. Aim for {plan.days.training.water_l} L on training days and {plan.days.rest.water_l} L on rest days, more when it&apos;s hot.
        </p>
        {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-300">{error}</p>}
      </div>
    </div>
  )
}

function Timeline({ plan, answers }: { plan: FuelPlan; answers: NutritionAnswers }) {
  const styles: Record<string, { icon: LucideIcon; tone: string; ring: string }> = {
    before: { icon: answers.swim_time === "early" ? Sunrise : Utensils, tone: "text-amber-200", ring: "border-amber-300/35 bg-amber-300/10" },
    during: { icon: Droplets, tone: "text-cyan-200", ring: "border-cyan-300/35 bg-cyan-300/10" },
    after: { icon: BatteryCharging, tone: "text-emerald-200", ring: "border-emerald-300/35 bg-emerald-300/10" },
  }
  return (
    <div className="relative h-full overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.28)] sm:p-6">
      <div className="mb-6 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10">
          <Timer className="h-5 w-5 text-accent" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-white">Fuel around your swims</h3>
          <p className="mt-0.5 text-xs text-slate-400">{plan.training.swim_minutes}-minute sessions · {SWIM_TIME[answers.swim_time].label.toLowerCase()}</p>
        </div>
      </div>
      <StepTimeline line="from-amber-300/60 via-cyan-300/60 to-emerald-300/60" steps={plan.timeline.map((step) => {
        const style = styles[step.key] ?? styles.during
        return { key: step.key, icon: style.icon, tone: style.tone, ring: style.ring, when: step.when, title: step.title, text: step.text, chips: step.ideas }
      })} />
    </div>
  )
}

function Habits({ plan }: { plan: FuelPlan }) {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.28)] sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10">
          <Target className="h-5 w-5 text-accent" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-white">Your focus</h3>
          <p className="mt-0.5 text-xs text-slate-400">Three habits that will make the biggest difference for you</p>
        </div>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {plan.habits.map((habit, index) => {
          const Icon = HABIT_ICONS[habit.icon] ?? Sprout
          return (
            <li key={habit.title} className="qf-stagger group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/30 hover:bg-white/[0.04]"
              style={{ "--i": index } as CSSProperties}>
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="font-mono text-xs text-slate-600">0{index + 1}</span>
              </div>
              <h4 className="mt-3 font-semibold text-white">{habit.title}</h4>
              <p className="mt-1 text-sm leading-6 text-slate-400">{habit.body}</p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The athlete's fuel plan. `trainingToday`: whether today has a swim or gym session, which sets the default day and today's water goal. */
export function FuelDashboard({ plan, answers, trainingToday, waterMl, waterError, onWater, onEdit }: {
  plan: FuelPlan
  answers: NutritionAnswers
  trainingToday: boolean
  waterMl: number
  waterError: string | null
  onWater: (delta: number) => void
  onEdit: () => void
}) {
  const todayType: DayType = trainingToday ? "training" : "rest"
  const [dayType, setDayType] = useState<DayType>(todayType)
  const day = plan.days[dayType]
  const percent = shares(day)
  const hints: Record<Macro, string> = {
    protein: `Repairs muscle after every session. About ${plan.protein_per_meal_g} g at each of ${plan.meals} meals and snacks.`,
    carbs: dayType === "training"
      ? "Your main fuel for hard sets. Eat most of it in the meals around your swims."
      : "Less than on training days, but enough to refill your muscles for tomorrow.",
    fat: "For hormones, joints and steady energy. Keep it light in the meal right before a swim.",
  }
  return (
    <div className="space-y-6">
      <Reveal index={0}>
        <Hero plan={plan} answers={answers} day={day} dayType={dayType} todayType={todayType} onDayType={setDayType} onEdit={onEdit} />
      </Reveal>
      <div className="grid gap-4 md:grid-cols-3">
        {(Object.keys(MACROS) as Macro[]).map((macro, index) => (
          <Reveal key={macro} index={index + 1} className="h-full">
            <MacroCard macro={macro} grams={day[`${macro}_g`]} weight={answers.weight_kg} share={percent[macro]} hint={hints[macro]} foods={plan.sources[macro]} />
          </Reveal>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Reveal index={4} className="h-full lg:col-span-3">
          <Timeline plan={plan} answers={answers} />
        </Reveal>
        <Reveal index={5} className="h-full lg:col-span-2">
          <WaterCard plan={plan} todayType={todayType} ml={waterMl} onAdd={onWater} error={waterError} />
        </Reveal>
      </div>
      <Reveal index={6}>
        <Habits plan={plan} />
      </Reveal>
      <p className="px-1 text-xs leading-5 text-slate-500">
        These are estimates to start from, based on your answers and your training. If your energy, weight or times move the wrong way, adjust,
        and if you have a medical condition, work with a sports dietitian.
      </p>
    </div>
  )
}
