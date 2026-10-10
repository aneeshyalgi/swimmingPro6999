"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import {
  Apple, Banana, BatteryCharging, BeanOff, Carrot, ChefHat, Cookie, Droplet, Droplets, Dumbbell, EggOff, Fish, FishOff, Flame,
  GlassWater, Leaf, MilkOff, NutOff, Salad, Scale, Shuffle, Sprout, Sun, Sunrise, Sunset, Target, ThumbsUp, Timer, Utensils,
  UtensilsCrossed, Wheat, WheatOff, Zap, type LucideIcon,
} from "lucide-react"
import { Field, UnitInput } from "@/components/onboarding-fields"
import { ToggleChip } from "@/components/training-ui"
import { Choices, FlowBuilding, FlowIntro, Pills, Question, QuestionFlow, useFlow, type FlowOption, type FlowStep } from "@/components/question-flow"
import { cn } from "@/lib/utils"
import type { NutritionAnswers, NutritionDefaults } from "@/lib/nutrition"

type Goal = NutritionAnswers["goal"]
type Draft = {
  goal: Goal | null
  sex: NutritionAnswers["sex"] | null
  age: string
  height: string
  weight: string
  swim_time: NutritionAnswers["swim_time"] | null
  meals_per_day: number | null
  pre_training: NutritionAnswers["pre_training"] | null
  water: NutritionAnswers["water"] | null
  diet: NutritionAnswers["diet"] | null
  avoid: NutritionAnswers["avoid"]
  challenge: NutritionAnswers["challenge"] | null
}

const goals: FlowOption<Goal>[] = [
  { value: "perform", label: "Fuel my training", detail: "Energy for every session and race", icon: Zap },
  { value: "build", label: "Build lean muscle", detail: "Get stronger and more powerful", icon: Dumbbell },
  { value: "lean", label: "Get leaner", detail: "Lose a little fat, keep the speed", icon: Flame },
  { value: "recover", label: "Recover faster", detail: "Feel fresher between sessions", icon: BatteryCharging },
]
const swimTimes: FlowOption<NonNullable<Draft["swim_time"]>>[] = [
  { value: "early", label: "Early morning", detail: "Before 8am", icon: Sunrise },
  { value: "midday", label: "Midday", detail: "Around lunch", icon: Sun },
  { value: "afternoon", label: "Afternoon", detail: "After school or work", icon: Sun },
  { value: "evening", label: "Evening", detail: "After 6pm", icon: Sunset },
  { value: "varies", label: "It varies", detail: "Different every day", icon: Shuffle },
]
const waterLevels: { value: NonNullable<Draft["water"]>; label: string; level: number }[] = [
  { value: "under_1", label: "Under 1 L", level: 0.22 },
  { value: "1_2", label: "1–2 L", level: 0.45 },
  { value: "2_3", label: "2–3 L", level: 0.7 },
  { value: "over_3", label: "3 L+", level: 0.94 },
]
const diets: FlowOption<NonNullable<Draft["diet"]>>[] = [
  { value: "any", label: "I eat everything", detail: "No restrictions", icon: UtensilsCrossed },
  { value: "vegetarian", label: "Vegetarian", detail: "No meat or fish", icon: Leaf },
  { value: "vegan", label: "Vegan", detail: "Only plant foods", icon: Sprout },
  { value: "pescatarian", label: "Pescatarian", detail: "Fish, no meat", icon: Fish },
]
const avoids: { value: NutritionAnswers["avoid"][number]; label: string; icon: LucideIcon }[] = [
  { value: "dairy", label: "Dairy", icon: MilkOff },
  { value: "gluten", label: "Gluten", icon: WheatOff },
  { value: "nuts", label: "Nuts", icon: NutOff },
  { value: "eggs", label: "Eggs", icon: EggOff },
  { value: "seafood", label: "Seafood", icon: FishOff },
  { value: "soy", label: "Soy", icon: BeanOff },
]
const challenges: FlowOption<NonNullable<Draft["challenge"]>>[] = [
  { value: "eating_enough", label: "Eating enough", detail: "I'm often still hungry or tired", icon: Utensils },
  { value: "cravings", label: "Snacks and cravings", detail: "Sweets after training", icon: Cookie },
  { value: "time", label: "Time to cook", detail: "Busy days, quick food", icon: ChefHat },
  { value: "energy", label: "Energy in sessions", detail: "I fade in hard sets", icon: Zap },
  { value: "hydration", label: "Drinking enough", detail: "I forget my water", icon: GlassWater },
  { value: "none", label: "Nothing major", detail: "Just want to fine-tune", icon: ThumbsUp },
]

const STEPS: FlowStep[] = [
  { key: "goal", title: "What should your food do for you?", hint: "Pick the one that matters most right now.", icon: Target, tone: "#57e5ea" },
  { key: "body", title: "Check your basics", hint: "From your profile. Change anything that's different now.", icon: Scale, tone: "#7dd3fc" },
  { key: "rhythm", title: "What does your day look like?", hint: "So the plan fits around your swims.", icon: Sunrise, tone: "#fcd34d" },
  { key: "fuel", title: "Before and during training", hint: "Most energy problems start here.", icon: Droplets, tone: "#38bdf8" },
  { key: "diet", title: "How do you eat?", hint: "Food ideas only use what you eat.", icon: Salad, tone: "#6ee7b7" },
  { key: "challenge", title: "What's hardest for you?", hint: "Your plan starts with this.", icon: Flame, tone: "#fda4af" },
]

const inRange = (value: string, min: number, max: number) => value.trim() !== "" && Number(value) >= min && Number(value) <= max

export function draftFrom(answers: Partial<NutritionAnswers> | null, defaults: NutritionDefaults): Draft {
  const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(Math.round(value * 10) / 10))
  return {
    goal: answers?.goal ?? null,
    sex: answers?.sex ?? defaults.sex,
    age: text(answers?.age ?? defaults.age),
    height: text(answers?.height_cm ?? defaults.height_cm),
    weight: text(answers?.weight_kg ?? defaults.weight_kg),
    swim_time: answers?.swim_time ?? null,
    meals_per_day: answers?.meals_per_day ?? null,
    pre_training: answers?.pre_training ?? null,
    water: answers?.water ?? null,
    diet: answers?.diet ?? null,
    avoid: answers?.avoid ?? [],
    challenge: answers?.challenge ?? null,
  }
}

function bodyErrors(draft: Draft) {
  return {
    sex: draft.sex ? undefined : "Select an option",
    age: inRange(draft.age, 8, 100) && Number.isInteger(Number(draft.age)) ? undefined : "Enter your age (8–100)",
    height: inRange(draft.height, 100, 250) ? undefined : "Enter a height between 100 and 250 cm",
    weight: inRange(draft.weight, 25, 250) ? undefined : "Enter a weight between 25 and 250 kg",
  }
}

function complete(draft: Draft, step: number): boolean {
  switch (STEPS[step].key) {
    case "goal": return draft.goal !== null
    case "body": return Object.values(bodyErrors(draft)).every((error) => !error)
    case "rhythm": return draft.swim_time !== null && draft.meals_per_day !== null
    case "fuel": return draft.pre_training !== null && draft.water !== null
    case "diet": return draft.diet !== null
    default: return draft.challenge !== null
  }
}

function toAnswers(draft: Draft): NutritionAnswers {
  // Only called once every step is complete.
  return {
    goal: draft.goal!, sex: draft.sex!, age: Number(draft.age), height_cm: Number(draft.height), weight_kg: Number(draft.weight),
    swim_time: draft.swim_time!, meals_per_day: draft.meals_per_day!, pre_training: draft.pre_training!, water: draft.water!,
    diet: draft.diet!, avoid: draft.avoid, challenge: draft.challenge!,
  }
}

/** First visit only: what the questions are for, before the first one. */
export function FuelIntro({ firstName, onStart }: { firstName: string; onStart: () => void }) {
  return (
    <FlowIntro
      eyebrow="Nutrition"
      title={`Let's build your fuel plan${firstName ? `, ${firstName}` : ""}`}
      body="Six quick questions about how you eat. Your answers become simple daily targets for training and rest days."
      features={[
        { icon: Flame, title: "Calories and macros", body: "For training and rest days" },
        { icon: Droplets, title: "Hydration", body: "A water goal to fill up each day" },
        { icon: Timer, title: "Fuel timing", body: "What to eat around your swims" },
      ]}
      orbit={[
        { icon: Apple, tone: "text-rose-300" }, { icon: Wheat, tone: "text-amber-200" }, { icon: Droplet, tone: "text-cyan-300" },
        { icon: Carrot, tone: "text-orange-300" }, { icon: Fish, tone: "text-sky-300" }, { icon: Banana, tone: "text-yellow-200" },
      ]}
      emblem={Utensils}
      tint="bg-emerald-400/10"
      onStart={onStart}
    />
  )
}

/** The six questions, one screen each. `initial` prefills them (onboarding basics, or the saved answers when editing). */
export function FuelQuiz({ initial, editing, error, startAt = 0, onBack, onSubmit }: {
  initial: Draft
  editing: boolean
  error: string | null
  startAt?: number
  /** Leaves the questions: back to the intro on a first visit, back to the plan when editing. */
  onBack: () => void
  onSubmit: (answers: NutritionAnswers) => void
}) {
  const [draft, setDraft] = useState(initial)
  const { step, direction, tried, setTried, go } = useFlow(startAt)
  const current = STEPS[step]
  const valid = complete(draft, step)
  const youth = inRange(draft.age, 8, 17)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((previous) => ({ ...previous, [key]: value }))

  // Under-18s are never offered a calorie deficit.
  useEffect(() => {
    if (youth && draft.goal === "lean") setDraft((previous) => ({ ...previous, goal: null }))
  }, [youth, draft.goal])

  const next = () => {
    if (!valid) { setTried(true); return }
    if (step === STEPS.length - 1) onSubmit(toAnswers(draft))
    else go(step + 1)
  }
  const errors: Partial<ReturnType<typeof bodyErrors>> = tried ? bodyErrors(draft) : {}

  let content: ReactNode
  switch (current.key) {
    case "goal":
      content = <Choices label="Your goal" options={youth ? goals.filter((goal) => goal.value !== "lean") : goals} value={draft.goal} onChange={(value) => set("goal", value)} />
      break
    case "body":
      content = (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="qf-rise sm:col-span-2" style={{ "--i": 0 } as CSSProperties}>
            <Field label="Sex" error={errors.sex}>
              <Pills label="Sex" value={draft.sex} onChange={(value) => set("sex", value)}
                options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }]} />
            </Field>
          </div>
          <div className="qf-rise" style={{ "--i": 1 } as CSSProperties}>
            <Field label="Age" htmlFor="nu-age" error={errors.age}>
              <UnitInput id="nu-age" type="number" inputMode="numeric" min={8} max={100} unit="years" value={draft.age} onChange={(event) => set("age", event.target.value)} />
            </Field>
          </div>
          <div className="qf-rise" style={{ "--i": 2 } as CSSProperties}>
            <Field label="Height" htmlFor="nu-height" error={errors.height}>
              <UnitInput id="nu-height" type="number" inputMode="decimal" min={100} max={250} unit="cm" value={draft.height} onChange={(event) => set("height", event.target.value)} />
            </Field>
          </div>
          <div className="qf-rise sm:col-span-2" style={{ "--i": 3 } as CSSProperties}>
            <Field label="Weight" htmlFor="nu-weight" error={errors.weight} hint="Your weight today. It sets your protein and water targets.">
              <UnitInput id="nu-weight" type="number" inputMode="decimal" min={25} max={250} step="0.1" unit="kg" value={draft.weight} onChange={(event) => set("weight", event.target.value)} />
            </Field>
          </div>
        </div>
      )
      break
    case "rhythm":
      content = (
        <div className="space-y-7">
          <Question label="When do you usually swim?" index={0}>
            <Choices label="When you swim" options={swimTimes} value={draft.swim_time} onChange={(value) => set("swim_time", value)} columns="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
          </Question>
          <Question label="How many times do you eat in a day, snacks included?" index={5}>
            <Pills label="Meals a day" value={draft.meals_per_day} onChange={(value) => set("meals_per_day", value)} className="max-w-md"
              options={[{ value: 2, label: "2" }, { value: 3, label: "3" }, { value: 4, label: "4" }, { value: 5, label: "5+" }]} />
          </Question>
        </div>
      )
      break
    case "fuel":
      content = (
        <div className="space-y-7">
          <Question label="Do you eat something before training?" index={0}>
            <Pills label="Eating before training" value={draft.pre_training} onChange={(value) => set("pre_training", value)}
              className="max-w-md" options={[{ value: "always", label: "Always" }, { value: "sometimes", label: "Sometimes" }, { value: "rarely", label: "Rarely" }]} />
          </Question>
          <Question label="How much water do you drink on a training day?" index={2}>
            <div role="radiogroup" aria-label="Water on a training day" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {waterLevels.map((option, index) => {
                const selected = draft.water === option.value
                return (
                  <button key={option.value} type="button" role="radio" aria-checked={selected} onClick={() => set("water", option.value)}
                    style={{ "--i": index + 3 } as CSSProperties}
                    className={cn("qf-rise group flex flex-col items-center gap-3 rounded-2xl border px-3 pb-3.5 pt-4 transition-[border-color,background-color,box-shadow,transform] duration-300",
                      selected ? "border-sky-300/70 bg-sky-400/[0.08] shadow-[0_0_0_1px_rgba(125,211,252,0.25),0_12px_30px_rgba(56,189,248,0.12)]"
                        : "border-white/10 bg-white/[0.02] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.04]")}>
                    <span aria-hidden className="relative h-14 w-10 overflow-hidden rounded-b-xl rounded-t-md border-2 border-white/25 bg-white/[0.03]">
                      <span className={cn("absolute inset-x-0 bottom-0 bg-gradient-to-t from-sky-500/80 to-cyan-300/80 transition-[height] duration-700 ease-out", selected && "from-sky-400 to-cyan-200")}
                        style={{ height: `${option.level * 100}%` }}>
                        <span className="nu-sip absolute inset-x-0 -top-1 h-2 rounded-[50%] bg-cyan-100/60" />
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-white">{option.label}</span>
                  </button>
                )
              })}
            </div>
          </Question>
        </div>
      )
      break
    case "diet":
      content = (
        <div className="space-y-7">
          <Question label="Your diet" index={0}>
            <Choices label="Your diet" options={diets} value={draft.diet} onChange={(value) => set("diet", value)} />
          </Question>
          <Question label="Anything you avoid? Pick all that apply, or skip." index={5}>
            <div className="flex flex-wrap gap-2">
              {avoids.map((item) => (
                <ToggleChip key={item.value} active={draft.avoid.includes(item.value)}
                  onClick={() => set("avoid", draft.avoid.includes(item.value) ? draft.avoid.filter((value) => value !== item.value) : [...draft.avoid, item.value])}>
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </ToggleChip>
              ))}
            </div>
          </Question>
        </div>
      )
      break
    default:
      content = <Choices label="Your biggest challenge" options={challenges} value={draft.challenge} onChange={(value) => set("challenge", value)} />
  }

  return (
    <QuestionFlow steps={STEPS} step={step} direction={direction} eyebrow="Fuel plan" editing={editing} valid={valid}
      missing={tried && !valid && current.key !== "body"} error={error} finalLabel="Build my fuel plan"
      onBack={() => (step === 0 ? onBack() : go(step - 1))} onCancel={onBack} onNext={next}>
      {content}
    </QuestionFlow>
  )
}

/** Shown while the plan is saved. Finishes once `done` is true. */
export function FuelBuilding({ firstName, done, onFinished }: { firstName: string; done: boolean; onFinished: () => void }) {
  return (
    <FlowBuilding
      title="Building your fuel plan…"
      readyTitle={`Your fuel plan is ready${firstName ? `, ${firstName}` : ""}`}
      subtitle="Fitting it to your training, your body and how you eat."
      steps={["Reading your training week", "Setting calories for training and rest days", "Balancing protein, carbs and fat", "Planning food around your swims"]}
      rings={[["#fda4af", "#fb7185"], ["#fde68a", "#fbbf24"], ["#c4b5fd", "#a78bfa"]]}
      emblem={Utensils}
      done={done}
      onFinished={onFinished}
    />
  )
}
