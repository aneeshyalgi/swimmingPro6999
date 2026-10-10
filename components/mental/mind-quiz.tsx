"use client"

import { useState, type CSSProperties, type ReactNode } from "react"
import {
  BatteryLow, Brain, CloudRain, Crosshair, Eye, Flag, Flame, Frown, Headphones, Heart, HeartPulse,
  Leaf, Meh, MessageCircle, Moon, NotebookPen, Rocket, RotateCcw, Scale, ShieldCheck, Smile, Sparkles, Target, Users, Wind, Zap, type LucideIcon,
} from "lucide-react"
import { ToggleChip } from "@/components/training-ui"
import { Choices, FlowBuilding, FlowIntro, Pills, Question, QuestionFlow, useFlow, type FlowOption, type FlowStep } from "@/components/question-flow"
import { cn } from "@/lib/utils"
import type { MindAnswers, Skill } from "@/lib/mental"

type Draft = {
  goal: MindAnswers["goal"] | null
  ratings: Record<Skill, number | null>
  pre_race: MindAnswers["pre_race"] | null
  routine: MindAnswers["routine"] | null
  setback: MindAnswers["setback"] | null
  sleep: MindAnswers["sleep"] | null
  stress: MindAnswers["stress"] | null
  mood: MindAnswers["mood"] | null
  tools: MindAnswers["tools"]
}

const goals: FlowOption<NonNullable<Draft["goal"]>>[] = [
  { value: "nerves", label: "Handle race nerves", detail: "Turn butterflies into speed", icon: Wind },
  { value: "confidence", label: "Race with confidence", detail: "Trust your training when it counts", icon: ShieldCheck },
  { value: "focus", label: "Stay focused", detail: "Lock in on your race, not the noise", icon: Crosshair },
  { value: "resilience", label: "Bounce back faster", detail: "Let bad swims go and reset", icon: RotateCcw },
  { value: "motivation", label: "Stay motivated", detail: "Keep the drive on early mornings", icon: Flame },
  { value: "balance", label: "Handle stress and balance", detail: "Swimming, school, work and life", icon: Scale },
]
const skills: { key: Skill; label: string; detail: string }[] = [
  { key: "confidence", label: "Confidence", detail: "Believing in yourself on race day" },
  { key: "focus", label: "Focus", detail: "Staying locked in during races and sets" },
  { key: "calm", label: "Calm under pressure", detail: "Keeping nerves useful, not in charge" },
  { key: "motivation", label: "Motivation", detail: "Wanting to train, even on hard days" },
  { key: "resilience", label: "Bouncing back", detail: "Moving on after a bad swim" },
]
const RATING_WORDS = ["", "Weak spot", "Shaky", "Okay", "Good", "Strength"]
export const LEVEL_COLORS = ["#fb7185", "#fb923c", "#fbbf24", "#38bdf8", "#34d399"]
const preRace: FlowOption<NonNullable<Draft["pre_race"]>>[] = [
  { value: "calm", label: "Calm and ready", detail: "I feel in control", icon: Leaf },
  { value: "excited", label: "Excited nerves", detail: "Butterflies, but they help", icon: Zap },
  { value: "anxious", label: "Anxious", detail: "Nerves get in the way of my race", icon: HeartPulse },
  { value: "flat", label: "Flat", detail: "Low energy, hard to get up for it", icon: BatteryLow },
]
const setbacks: FlowOption<NonNullable<Draft["setback"]>>[] = [
  { value: "move_on", label: "Move on quickly", detail: "Learn from it and let it go", icon: Rocket },
  { value: "replay", label: "Replay it in my head", detail: "For a day or two", icon: RotateCcw },
  { value: "doubt", label: "Start doubting myself", detail: "It knocks my confidence", icon: CloudRain },
  { value: "frustrated", label: "Get frustrated", detail: "Angry at myself or others", icon: Flame },
]
const moods: FlowOption<NonNullable<Draft["mood"]>>[] = [
  { value: "good", label: "Mostly good", detail: "Enjoying things", icon: Smile },
  { value: "mixed", label: "Up and down", detail: "Some good days, some not", icon: Meh },
  { value: "low", label: "Often low or worried", detail: "It's been a heavy stretch", icon: Frown },
]
const tools: { value: MindAnswers["tools"][number]; label: string; icon: LucideIcon }[] = [
  { value: "breathing", label: "Breathing", icon: Wind },
  { value: "visualisation", label: "Visualisation", icon: Eye },
  { value: "music", label: "Music", icon: Headphones },
  { value: "self_talk", label: "Self-talk", icon: MessageCircle },
  { value: "journaling", label: "Journaling", icon: NotebookPen },
  { value: "talking", label: "Talking it out", icon: Users },
]

const STEPS: FlowStep[] = [
  { key: "goal", title: "What do you want to work on?", hint: "Pick the one that would help your swimming most.", icon: Target, tone: "#a78bfa" },
  { key: "ratings", title: "Rate your mental game", hint: "Be honest, there are no wrong answers: 1 is a weak spot, 5 a real strength.", icon: Brain, tone: "#57e5ea" },
  { key: "race", title: "Race day", hint: "How you feel behind the blocks shapes your routine.", icon: Flag, tone: "#fcd34d" },
  { key: "setback", title: "After a bad swim, you usually…", hint: "Everyone has them. What matters is the next one.", icon: RotateCcw, tone: "#fda4af" },
  { key: "wellbeing", title: "How are you doing?", hint: "Feeling well comes before swimming well.", icon: Heart, tone: "#6ee7b7" },
  { key: "tools", title: "What already helps you?", hint: "Pick any you use, or none. Your plan builds on them.", icon: Sparkles, tone: "#7dd3fc" },
]

export function draftFrom(answers: MindAnswers | null): Draft {
  return {
    goal: answers?.goal ?? null,
    ratings: {
      confidence: answers?.confidence ?? null, focus: answers?.focus ?? null, calm: answers?.calm ?? null,
      motivation: answers?.motivation ?? null, resilience: answers?.resilience ?? null,
    },
    pre_race: answers?.pre_race ?? null,
    routine: answers?.routine ?? null,
    setback: answers?.setback ?? null,
    sleep: answers?.sleep ?? null,
    stress: answers?.stress ?? null,
    mood: answers?.mood ?? null,
    tools: answers?.tools ?? [],
  }
}

function complete(draft: Draft, step: number): boolean {
  switch (STEPS[step].key) {
    case "goal": return draft.goal !== null
    case "ratings": return Object.values(draft.ratings).every((value) => value !== null)
    case "race": return draft.pre_race !== null && draft.routine !== null
    case "setback": return draft.setback !== null
    case "wellbeing": return draft.sleep !== null && draft.stress !== null && draft.mood !== null
    default: return true
  }
}

function toAnswers(draft: Draft): MindAnswers {
  // Only called once every step is complete.
  const { ratings } = draft
  return {
    goal: draft.goal!, confidence: ratings.confidence!, focus: ratings.focus!, calm: ratings.calm!, motivation: ratings.motivation!,
    resilience: ratings.resilience!, pre_race: draft.pre_race!, routine: draft.routine!, setback: draft.setback!, sleep: draft.sleep!,
    stress: draft.stress!, mood: draft.mood!, tools: draft.tools,
  }
}

/** A 1-5 rating: the segments up to the choice light up one after another, in the colour of the level chosen. */
function Rating({ label, detail, value, onChange, index }: { label: string; detail: string; value: number | null; onChange: (value: number) => void; index: number }) {
  const color = value ? LEVEL_COLORS[value - 1] : undefined
  return (
    <div className="qf-rise rounded-2xl border border-white/10 bg-white/[0.02] p-4" style={{ "--i": index } as CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-0.5 text-xs text-slate-400">{detail}</p>
        </div>
        <span key={value ?? 0} className={cn("shrink-0 text-xs font-semibold", value && "qf-pick")} style={{ color: color ?? "rgb(100 116 139)" }}>
          {value ? RATING_WORDS[value] : "Not rated"}
        </span>
      </div>
      <div role="radiogroup" aria-label={label} className="mt-3 grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((level) => {
          const lit = value !== null && level <= value
          return (
            <button key={level} type="button" role="radio" aria-checked={value === level} aria-label={`${level}: ${RATING_WORDS[level]}`}
              onClick={() => onChange(level)}
              className={cn("h-9 rounded-lg border text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5",
                lit ? "border-transparent text-slate-950 shadow-[0_6px_18px_rgba(0,0,0,0.25)]" : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-white")}
              style={lit ? { background: color, transitionDelay: `${(level - 1) * 45}ms` } : undefined}>
              {level}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** First visit only: what the questions are for, before the first one. */
export function MindIntro({ firstName, onStart }: { firstName: string; onStart: () => void }) {
  return (
    <FlowIntro
      eyebrow="Mental Performance"
      title={`Let's train your mental game${firstName ? `, ${firstName}` : ""}`}
      body="Six quick questions about how you think and feel around swimming. Your answers become a simple plan for race day and every day."
      features={[
        { icon: Brain, title: "Your mental profile", body: "Your strengths and what to work on" },
        { icon: Wind, title: "1-minute reset", body: "Guided breathing for nerves" },
        { icon: Flag, title: "Race-day routine", body: "From the night before to the wall" },
      ]}
      orbit={[
        { icon: Heart, tone: "text-rose-300" }, { icon: Wind, tone: "text-cyan-300" }, { icon: Target, tone: "text-amber-200" },
        { icon: Zap, tone: "text-yellow-200" }, { icon: Moon, tone: "text-indigo-300" }, { icon: Smile, tone: "text-emerald-300" },
      ]}
      emblem={Brain}
      tint="bg-violet-400/12"
      onStart={onStart}
    />
  )
}

/** The six questions, one screen each, prefilled with the saved answers when editing. */
export function MindQuiz({ initial, editing, error, startAt = 0, onBack, onSubmit }: {
  initial: Draft
  editing: boolean
  error: string | null
  startAt?: number
  /** Leaves the questions: back to the intro on a first visit, back to the plan when editing. */
  onBack: () => void
  onSubmit: (answers: MindAnswers) => void
}) {
  const [draft, setDraft] = useState(initial)
  const { step, direction, tried, setTried, go } = useFlow(startAt)
  const current = STEPS[step]
  const valid = complete(draft, step)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((previous) => ({ ...previous, [key]: value }))

  const next = () => {
    if (!valid) { setTried(true); return }
    if (step === STEPS.length - 1) onSubmit(toAnswers(draft))
    else go(step + 1)
  }

  let content: ReactNode
  switch (current.key) {
    case "goal":
      content = <Choices label="What to work on" options={goals} value={draft.goal} onChange={(value) => set("goal", value)} />
      break
    case "ratings":
      content = (
        <div className="grid gap-3">
          {skills.map((skill, index) => (
            <Rating key={skill.key} label={skill.label} detail={skill.detail} value={draft.ratings[skill.key]} index={index}
              onChange={(value) => set("ratings", { ...draft.ratings, [skill.key]: value })} />
          ))}
        </div>
      )
      break
    case "race":
      content = (
        <div className="space-y-7">
          <Question label="Before a race, you usually feel…" index={0}>
            <Choices label="Before a race" options={preRace} value={draft.pre_race} onChange={(value) => set("pre_race", value)} />
          </Question>
          <Question label="Do you have a pre-race routine?" index={5}>
            <Pills label="Pre-race routine" value={draft.routine} onChange={(value) => set("routine", value)} className="max-w-md"
              options={[{ value: "set", label: "Yes, a set one" }, { value: "loose", label: "Sort of" }, { value: "none", label: "Not really" }]} />
          </Question>
        </div>
      )
      break
    case "setback":
      content = <Choices label="After a bad swim" options={setbacks} value={draft.setback} onChange={(value) => set("setback", value)} />
      break
    case "wellbeing":
      content = (
        <div className="space-y-7">
          <div className="grid gap-7 sm:grid-cols-2">
            <Question label="How do you usually sleep?" index={0}>
              <Pills label="Sleep" value={draft.sleep} onChange={(value) => set("sleep", value)}
                options={[{ value: "well", label: "Well" }, { value: "ok", label: "Okay" }, { value: "poorly", label: "Poorly" }]} />
            </Question>
            <Question label="Stress outside the pool?" index={1}>
              <Pills label="Stress outside the pool" value={draft.stress} onChange={(value) => set("stress", value)}
                options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
            </Question>
          </div>
          <Question label="Over the last two weeks, how have you been feeling?" index={2}>
            <Choices label="How you've been feeling" options={moods} value={draft.mood} onChange={(value) => set("mood", value)}
              columns="sm:grid-cols-3" offset={3} />
          </Question>
        </div>
      )
      break
    default:
      content = (
        <div className="qf-rise flex flex-wrap gap-2" style={{ "--i": 0 } as CSSProperties}>
          {tools.map((tool) => (
            <ToggleChip key={tool.value} active={draft.tools.includes(tool.value)}
              onClick={() => set("tools", draft.tools.includes(tool.value) ? draft.tools.filter((value) => value !== tool.value) : [...draft.tools, tool.value])}>
              <tool.icon className="h-3.5 w-3.5" />
              {tool.label}
            </ToggleChip>
          ))}
        </div>
      )
  }

  return (
    <QuestionFlow steps={STEPS} step={step} direction={direction} eyebrow="Mental game" editing={editing} valid={valid}
      missing={tried && !valid} error={error} finalLabel="Build my plan"
      onBack={() => (step === 0 ? onBack() : go(step - 1))} onCancel={onBack} onNext={next}>
      {content}
    </QuestionFlow>
  )
}

/** Shown while the answers are saved. Finishes once `done` is true. */
export function MindBuilding({ firstName, done, onFinished }: { firstName: string; done: boolean; onFinished: () => void }) {
  return (
    <FlowBuilding
      title="Building your mental game plan…"
      readyTitle={`Your plan is ready${firstName ? `, ${firstName}` : ""}`}
      subtitle="Fitting it to how you think, race and recover."
      steps={["Mapping your strengths", "Choosing what to work on", "Building your race-day routine", "Picking your mental skills"]}
      rings={[["#c4b5fd", "#a78bfa"], ["#67e8f9", "#38bdf8"], ["#6ee7b7", "#34d399"]]}
      emblem={Brain}
      done={done}
      onFinished={onFinished}
    />
  )
}

