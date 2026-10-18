"use client"

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react"
import Link from "next/link"
import {
  AlertTriangle, Apple, ArrowLeft, ArrowRight, Bell, BookOpen, Bot, Brain, Bug, CalendarClock, CalendarDays, CalendarPlus, ChartLine,
  Clapperboard, Dumbbell, Flame, Gauge, Heart, Hourglass, Languages, LayoutGrid, Lightbulb, LoaderCircle, Lock, Medal, Megaphone,
  MessageSquare, Minus, MousePointerClick, Palette, PencilRuler, Phone, Puzzle, Rocket, RotateCcw, ScanLine, Send, Shuffle,
  SlidersHorizontal, Smartphone, Star, Target, ThumbsUp, TrendingDown, TrendingUp, Trophy, Users, Wallet, Watch, Waves, WifiOff, Wrench,
  Zap, type LucideIcon,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { ChoiceGroup, LEVEL_TONES, Note, OptionCard, Picks, RATING_WORDS, ScoreScale, StarRating, type Option } from "@/components/survey/survey-inputs"
import { BackToDashboard, Counter, SurveyScreen, Words } from "@/components/survey/survey-scene"
import { cn } from "@/lib/utils"
import {
  COMMENT_LENGTH, FEATURES, MOST_PICKS, NOTE_LENGTH, emptyDraft, type Feature, type Frequency, type Impact, type Improvement, type Like,
  type SurveyAnswers, type SurveyDraft, type SurveyProgress, type Wish,
} from "@/lib/survey"

const FEATURE_OPTIONS: Option<Feature>[] = [
  { value: "swim_week", label: "Swim week", detail: "Your AI swim sessions", icon: Waves },
  { value: "gym_week", label: "Gym week", detail: "Strength and mobility", icon: Dumbbell },
  { value: "workout_builder", label: "Workout Builder", detail: "Build your own sessions", icon: PencilRuler },
  { value: "competitions", label: "Competitions", detail: "Meets, race plans and results", icon: Trophy },
  { value: "coach_chat", label: "Coach chat", detail: "Ask your coach anything", icon: MessageSquare },
  { value: "voice_calls", label: "Voice calls", detail: "Talk to your coach live", icon: Phone },
  { value: "nutrition", label: "Nutrition", detail: "Your daily fuel plan", icon: Apple },
  { value: "mental", label: "Mental Performance", detail: "Confidence, focus and calm", icon: Brain },
  { value: "video_analysis", label: "Video Analysis", detail: "The AI stroke lab", icon: ScanLine },
  { value: "pace_calculator", label: "Pace Calculator", detail: "Paces for every zone", icon: Gauge },
  { value: "training_plans", label: "Training Plans", detail: "Plan books from the store", icon: BookOpen },
]
const FREQUENCY_OPTIONS: Option<Frequency>[] = [
  { value: "daily", label: "Every day", detail: "Or most days", icon: Flame },
  { value: "few_weekly", label: "A few times a week", detail: "Around my sessions", icon: CalendarDays },
  { value: "weekly", label: "About once a week", detail: "To plan my week", icon: CalendarClock },
  { value: "rarely", label: "Less often", detail: "Now and then", icon: Hourglass },
]
const IMPACT_OPTIONS: Option<Impact>[] = [
  { value: "much_better", label: "Much better", detail: "It's changed how I train", icon: Rocket },
  { value: "better", label: "A bit better", detail: "Some real improvements", icon: TrendingUp },
  { value: "same", label: "About the same", detail: "No real change yet", icon: Minus },
  { value: "worse", label: "Worse", detail: "It hasn't worked for me", icon: TrendingDown },
]
const LIKE_OPTIONS: Option<Like>[] = [
  { value: "personalised", label: "Plans built around me", icon: Target },
  { value: "coach", label: "My AI coach", icon: Bot },
  { value: "workouts", label: "The workouts themselves", icon: Waves },
  { value: "variety", label: "Variety of sessions", icon: Shuffle },
  { value: "ease", label: "Easy to use", icon: MousePointerClick },
  { value: "design", label: "The look and feel", icon: Palette },
  { value: "progress", label: "Seeing my progress", icon: TrendingUp },
  { value: "all_in_one", label: "Everything in one place", icon: LayoutGrid },
  { value: "value", label: "Value for money", icon: Wallet },
]
const IMPROVE_OPTIONS: Option<Improvement>[] = [
  { value: "workout_fit", label: "Workouts that fit me better", icon: Target },
  { value: "coach_answers", label: "Better coach answers", icon: MessageSquare },
  { value: "ease", label: "Easier to use", icon: MousePointerClick },
  { value: "speed", label: "Faster loading", icon: Zap },
  { value: "bugs", label: "Fewer bugs", icon: Bug },
  { value: "phone", label: "Better on my phone", icon: Smartphone },
  { value: "features", label: "More features", icon: Puzzle },
  { value: "price", label: "A lower price", icon: Wallet },
  { value: "nothing", label: "Nothing, it's great", icon: ThumbsUp },
]
const WISH_OPTIONS: Option<Wish>[] = [
  { value: "watch_sync", label: "Garmin or Apple Watch sync", icon: Watch },
  { value: "progress_charts", label: "Progress charts", icon: ChartLine },
  { value: "drill_videos", label: "Technique and drill videos", icon: Clapperboard },
  { value: "teams", label: "Club and team accounts", icon: Users },
  { value: "offline", label: "Offline workouts at the pool", icon: WifiOff },
  { value: "reminders", label: "Training reminders", icon: Bell },
  { value: "calendar_sync", label: "Calendar sync", icon: CalendarPlus },
  { value: "community", label: "Challenges with other swimmers", icon: Medal },
  { value: "languages", label: "More languages", icon: Languages },
]

const RATING_REPLIES = [
  "Sorry to hear that. The next questions show us what to fix.",
  "Thanks for being honest. Tell us what's missing.",
  "Good to know. Let's find what would make it great.",
  "Great to hear! Let's see what would make it a 5.",
  "Amazing, thank you! Tell us what you love.",
]
const INTRO_TONE = "#fcd34d"
const DONE_TONE = "#34d399"

type StepKey = "rating" | "usage" | "features" | "feature_ratings" | "liked" | "improve" | "wishlist" | "recommend"
/** `tone` is the page's colour while the question shows; `missing` says what Continue still needs. */
const STEPS: { key: StepKey; title: string; hint: string; icon: LucideIcon; tone: string; missing?: string }[] = [
  { key: "rating", title: "How would you rate SwimGPT?", hint: "Overall, from 1 (poor) to 5 (excellent).", icon: Star, tone: "#fcd34d",
    missing: "Choose a rating to continue." },
  { key: "usage", title: "How do you use SwimGPT?", hint: "So we can read your answers in context.", icon: CalendarClock, tone: "#57e5ea",
    missing: "Answer both questions to continue." },
  { key: "features", title: "Which features do you use?", hint: "Pick every one you've used, even once.", icon: LayoutGrid, tone: "#7dd3fc",
    missing: "Pick at least one feature to continue." },
  { key: "feature_ratings", title: "How good is each one?", hint: "Rate each feature you use, from 1 (poor) to 5 (excellent).",
    icon: SlidersHorizontal, tone: "#a78bfa", missing: "Rate each feature to continue." },
  { key: "liked", title: "What do you like most?", hint: `Pick up to ${MOST_PICKS}.`, icon: Heart, tone: "#fda4af",
    missing: "Pick at least one to continue." },
  { key: "improve", title: "What should we improve?", hint: "Pick any that apply. The more you tell us, the more we can fix.",
    icon: Wrench, tone: "#fdba74", missing: "Pick at least one to continue, or Nothing, it's great." },
  { key: "wishlist", title: "What should we build next?", hint: `Pick up to ${MOST_PICKS}, or suggest your own. Optional.`,
    icon: Lightbulb, tone: "#6ee7b7" },
  { key: "recommend", title: "Would you recommend SwimGPT?", hint: "How likely are you to recommend it to a teammate or a friend?",
    icon: Megaphone, tone: "#57e5ea", missing: "Choose a number to continue." },
]
export const SURVEY_STEPS = STEPS.length

function complete(answers: SurveyDraft, key: StepKey): boolean {
  switch (key) {
    case "rating": return answers.rating !== null
    case "usage": return answers.usage_frequency !== null && answers.training_impact !== null
    case "features": return answers.features_used.length > 0
    case "feature_ratings": return answers.features_used.every((feature) => answers.feature_ratings[feature] !== undefined)
    case "liked": return answers.liked.length > 0
    case "improve": return answers.improve.length > 0
    case "wishlist": return true
    case "recommend": return answers.recommend !== null
  }
}

/** Where to pick a saved survey back up: its question, or the first one before it still to answer. */
export function resumeAt(progress: SurveyProgress): number {
  const open = STEPS.findIndex((step) => !complete(progress.answers, step.key))
  return Math.min(progress.step, open === -1 ? STEPS.length - 1 : open, STEPS.length - 1)
}

function toAnswers(answers: SurveyDraft): SurveyAnswers {
  // Only called once every question is answered.
  return {
    ...answers, rating: answers.rating!, usage_frequency: answers.usage_frequency!, training_impact: answers.training_impact!,
    recommend: answers.recommend!,
    feature_ratings: Object.fromEntries(answers.features_used.map((feature) => [feature, answers.feature_ratings[feature]!])),
  }
}

/** A choice added to or taken from `list`: with `most`, a full list takes nothing more (null); `only` is chosen alone. */
function toggled<T extends string>(list: T[], value: T, { most, only }: { most?: number; only?: T } = {}): T[] | null {
  if (list.includes(value)) return list.filter((item) => item !== value)
  if (value === only) return [value]
  const rest = only === undefined ? list : list.filter((item) => item !== only)
  if (most !== undefined && rest.length >= most) return null
  return [...rest, value]
}

function PrivacyNote({ index }: { index: number }) {
  return (
    <p className="sv-rise flex items-start justify-center gap-2 text-xs leading-5 text-slate-500" style={{ "--i": index } as CSSProperties}>
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Your answers are saved with your account and used only to improve SwimGPT.{" "}
        <Link href="/privacy#survey" target="_blank" rel="noreferrer" className="text-slate-300 underline decoration-white/25 underline-offset-2 hover:text-white">
          Privacy Policy
        </Link>
      </span>
    </p>
  )
}

const ORBIT = [0, 72, 144, 216, 288]
const HIGHLIGHTS = [
  { icon: Star, label: "Rate SwimGPT" },
  { icon: LayoutGrid, label: "The features you use" },
  { icon: Lightbulb, label: "What we build next" },
]

/** Before the first question: what the survey is (or, coming back, where they left off), with a glowing emblem. */
function Intro({ firstName, resume, onStart, onRestart, ref }: {
  firstName: string
  /** The question they stopped at, when they're coming back. */
  resume: number | null
  onStart: () => void
  onRestart: () => void
  ref: Ref<HTMLHeadingElement>
}) {
  const name = firstName ? `, ${firstName}` : ""
  const title = resume ? `Welcome back${name}` : `How is SwimGPT working for you${name}?`
  return (
    <section className="relative mx-auto flex max-w-3xl flex-col items-center overflow-x-clip px-5 pb-16 pt-8 text-center sm:pt-14">
      <div aria-hidden className="relative grid h-44 w-44 place-items-center sm:h-52 sm:w-52">
        <span className="sv-sonar" />
        <span className="sv-sonar" style={{ animationDelay: "1.2s" }} />
        <span className="sv-sonar" style={{ animationDelay: "2.4s" }} />
        <span className="sv-halo absolute inset-[14%]" />
        <span className="sv-orbit absolute inset-0">
          {ORBIT.map((angle) => <i key={angle} style={{ "--a": `${angle}deg` } as CSSProperties}><Star className="h-3.5 w-3.5 fill-amber-200 text-amber-200" /></i>)}
        </span>
        <span className="sv-core relative grid h-[42%] w-[42%] place-items-center rounded-full">
          <Star className="h-1/2 w-1/2 fill-white text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]" />
        </span>
      </div>
      <p className="sv-rise mt-8 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100"
        style={{ "--i": 0 } as CSSProperties}>
        {resume ? `Saved at question ${resume} of ${SURVEY_STEPS}` : "Your feedback · about 2 minutes"}
      </p>
      <h2 ref={ref} tabIndex={-1} className="sv-hero-title mt-6 outline-none"><Words text={title} from={2} /></h2>
      <p className="sv-rise mx-auto mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8" style={{ "--i": 7 } as CSSProperties}>
        {resume ? "Your answers so far are saved on this device. Pick up right where you left off."
          : "Eight quick questions on what you use, what you love and what we should build next. Every answer goes straight to the team building SwimGPT."}
      </p>
      {!resume && (
        <ul className="mt-8 flex flex-wrap justify-center gap-2.5">
          {HIGHLIGHTS.map((item, index) => (
            <li key={item.label} className="sv-in flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-3.5 text-sm text-slate-200"
              style={{ "--i": index + 6 } as CSSProperties}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-300/15"><item.icon className="h-3.5 w-3.5 text-amber-200" /></span>
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-10 flex flex-col items-center gap-4">
        <button type="button" onClick={onStart} className="sv-cta sv-rise group h-14 px-9 text-base" style={{ "--i": 10 } as CSSProperties}>
          {resume ? "Carry on" : "Start the survey"}
          <ArrowRight className="sv-arrow h-5 w-5" />
        </button>
        {resume ? (
          <button type="button" onClick={onRestart}
            className="sv-rise inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-white" style={{ "--i": 11 } as CSSProperties}>
            <RotateCcw className="h-3.5 w-3.5" />
            Start over
          </button>
        ) : (
          <p aria-hidden className="sv-rise hidden items-center gap-1.5 text-xs text-slate-500 md:flex" style={{ "--i": 11 } as CSSProperties}>
            or press <kbd className="sv-kbd">Enter ↵</kbd>
          </p>
        )}
      </div>
      <div className="mt-12 max-w-md"><PrivacyNote index={12} /></div>
    </section>
  )
}

const BURST = Array.from({ length: 18 }, (_, index) => ({
  angle: `${index * 20}deg`, color: ["#34d399", "#fcd34d", "#57e5ea", "#c4b5fd"][index % 4], size: `${5 + (index % 3) * 3}px`, distance: `${92 + (index % 4) * 20}px`,
}))

/** After sending: a tick that draws itself in a burst of light, a thank-you, and the rating they gave. */
function Thanks({ firstName, rating, ref }: { firstName: string; rating: number; ref: Ref<HTMLHeadingElement> }) {
  const reply = rating >= 4 ? "We're so glad SwimGPT is working for you." : rating === 3 ? "Thanks for telling us what would make it better."
    : "Sorry it isn't there yet. Your answers show us where to start."
  return (
    <section className="relative mx-auto flex max-w-2xl flex-col items-center overflow-x-clip px-6 pb-16 pt-10 text-center sm:pt-16">
      <div aria-hidden className="relative grid h-48 w-48 place-items-center sm:h-56 sm:w-56">
        <span className="sv-sonar" />
        <span className="sv-sonar" style={{ animationDelay: "1.2s" }} />
        <span className="sv-sonar" style={{ animationDelay: "2.4s" }} />
        <span className="sv-burst absolute inset-0">
          {BURST.map((spark) => (
            <i key={spark.angle} style={{ "--a": spark.angle, "--c": spark.color, "--s": spark.size, "--d": spark.distance } as CSSProperties} />
          ))}
        </span>
        <span className="sv-medal-core grid h-28 w-28 place-items-center rounded-full sm:h-32 sm:w-32">
          <svg viewBox="0 0 52 52" className="h-16 w-16 sm:h-20 sm:w-20">
            <circle cx="26" cy="26" r="24" className="sv-tick-circle" />
            <path d="M15 27 l7 7 l15 -15" className="sv-tick-path" />
          </svg>
        </span>
      </div>
      <h2 ref={ref} tabIndex={-1} className="sv-hero-title mt-6 outline-none"><Words text={`Thank you${firstName ? `, ${firstName}` : ""}!`} from={10} /></h2>
      <p className="sv-rise mx-auto mt-5 max-w-lg text-base leading-7 text-slate-300 sm:text-lg sm:leading-8" style={{ "--i": 16 } as CSSProperties}>
        {reply} Your answers go straight to the team building SwimGPT, and we read every one.
      </p>
      <div role="img" aria-label={`You rated SwimGPT ${rating} out of 5`}
        className="sv-rise mt-8 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5" style={{ "--i": 18 } as CSSProperties}>
        {[1, 2, 3, 4, 5].map((level) => level <= rating ? (
          <span key={level} className="sv-star-glow h-6 w-6">
            <Star strokeWidth={1.4} style={{ "--i": level + 18 } as CSSProperties} className="sv-star-on h-full w-full fill-amber-300 text-amber-300" />
          </span>
        ) : <Star key={level} strokeWidth={1.4} className="h-6 w-6 fill-transparent text-slate-600" />)}
        <span className="ml-2 text-sm font-bold" style={{ color: LEVEL_TONES[rating - 1] }}>{RATING_WORDS[rating - 1]}</span>
      </div>
    </section>
  )
}

/**
 * The survey: an intro, the questions one at a time, then a thank-you. The answers (`progress`) belong to the page,
 * which keeps them on the device until they're sent, so leaving and coming back carries on where the athlete left off.
 */
export function SurveyFlow({ firstName, progress, onProgress, onSend }: {
  firstName: string
  progress: SurveyProgress
  onProgress: (progress: SurveyProgress) => void
  /** Sends the answers: resolves once they're saved, rejects with why they weren't. */
  onSend: (answers: SurveyAnswers) => Promise<void>
}) {
  const { step, answers } = progress
  const current = STEPS[step]
  const valid = complete(answers, current.key)
  const last = step === STEPS.length - 1
  const started = step > 0 || answers.rating !== null
  const [phase, setPhase] = useState<"intro" | "questions">("intro")
  const [direction, setDirection] = useState<1 | -1>(1)
  const [tried, setTried] = useState(false)
  // Bumped by each Continue that's missing an answer, so the reminder shakes again.
  const [nudge, setNudge] = useState(0)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The rating sent, once the answers are saved: the thank-you shows.
  const [sent, setSent] = useState<number | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const shown = useRef<string | null>(null)

  // The intro, each question and the thank-you get their heading focused for screen readers; a new one starts at the top.
  useEffect(() => {
    const now = `${phase}:${step}:${sent}`
    if (shown.current === now) return
    const first = shown.current === null
    shown.current = now
    if (!first) window.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [phase, step, sent])

  const set = <K extends keyof SurveyDraft>(key: K, value: SurveyDraft[K]) => onProgress({ step, answers: { ...answers, [key]: value } })
  const go = (to: number) => {
    setDirection(to > step ? 1 : -1)
    setTried(false)
    setError(null)
    onProgress({ step: to, answers })
  }
  const toggleFeature = (feature: Feature) => {
    const on = answers.features_used.includes(feature)
    const ratings = { ...answers.feature_ratings }
    if (on) delete ratings[feature]
    // Kept in the order the features are listed.
    const used = FEATURES.filter((item) => (item === feature ? !on : answers.features_used.includes(item)))
    onProgress({ step, answers: { ...answers, features_used: used, feature_ratings: ratings } })
  }
  const pick = <K extends "liked" | "improve" | "wishlist">(key: K, value: SurveyDraft[K][number], rules?: { most?: number; only?: string }) => {
    const next = toggled<string>(answers[key], value, rules)
    if (next) set(key, next as SurveyDraft[K])
  }
  const startOver = () => {
    setDirection(1)
    onProgress({ step: 0, answers: emptyDraft() })
    setPhase("questions")
  }

  const next = () => {
    if (sending) return
    if (!valid) { setTried(true); setNudge((count) => count + 1); return }
    if (!last) { go(step + 1); return }
    const rating = answers.rating!
    setSending(true)
    setError(null)
    onSend(toAnswers(answers))
      .then(() => setSent(rating))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Your answers couldn't be sent. Please try again."))
      .finally(() => setSending(false))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (sent !== null || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    if ((event.target as HTMLElement).closest("button, a, textarea, input")) return
    event.preventDefault()
    if (phase === "intro") setPhase("questions")
    else next()
  }

  if (sent !== null) {
    return (
      <SurveyScreen tone={DONE_TONE} status={<span className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Sent</span>}
        progress={{ step, total: STEPS.length, done: true }} celebrate footer={<><span /><BackToDashboard primary /></>}>
        <Thanks ref={heading} firstName={firstName} rating={sent} />
      </SurveyScreen>
    )
  }

  if (phase === "intro") {
    return (
      <SurveyScreen tone={INTRO_TONE} progress={{ step: started ? step : 0, total: STEPS.length, done: false }} onKeyDown={onKeyDown}>
        <Intro ref={heading} firstName={firstName} resume={started ? step + 1 : null} onStart={() => setPhase("questions")} onRestart={startOver} />
      </SurveyScreen>
    )
  }

  const tone = current.key === "rating" && answers.rating ? LEVEL_TONES[answers.rating - 1] : current.tone
  let content: ReactNode
  switch (current.key) {
    case "rating":
      content = (
        <div className="flex flex-col items-center py-4 text-center sm:py-8">
          <div className="sv-in" style={{ "--i": 2 } as CSSProperties}>
            <StarRating size="lg" label="Your rating of SwimGPT" value={answers.rating} onChange={(value) => set("rating", value)} />
          </div>
          <p key={answers.rating ?? 0} className={cn("mt-7 text-3xl font-extrabold tracking-tight sm:text-4xl", answers.rating ? "sv-flip sv-rating-word" : "sv-rise text-slate-500")}
            style={answers.rating ? { color: LEVEL_TONES[answers.rating - 1] } : ({ "--i": 6 } as CSSProperties)}>
            {answers.rating ? RATING_WORDS[answers.rating - 1] : "Tap a star"}
          </p>
          {answers.rating && <p key={`reply-${answers.rating}`} className="sv-rise mt-3 max-w-sm text-sm text-slate-300 sm:text-base">{RATING_REPLIES[answers.rating - 1]}</p>}
        </div>
      )
      break
    case "usage":
      content = (
        <div className="space-y-9">
          <div>
            <p className="sv-rise mb-3.5 text-sm font-semibold text-slate-200" style={{ "--i": 3 } as CSSProperties}>How often do you use it?</p>
            <ChoiceGroup label="How often you use SwimGPT" options={FREQUENCY_OPTIONS} value={answers.usage_frequency} onChange={(value) => set("usage_frequency", value)} />
          </div>
          <div>
            <p className="sv-rise mb-3.5 text-sm font-semibold text-slate-200" style={{ "--i": 7 } as CSSProperties}>Since you started, your training is…</p>
            <ChoiceGroup label="How your training has changed" options={IMPACT_OPTIONS} value={answers.training_impact} offset={5}
              onChange={(value) => set("training_impact", value)} />
          </div>
        </div>
      )
      break
    case "features":
      content = (
        <div role="group" aria-label="Features you use" className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
          {FEATURE_OPTIONS.map((option, index) => (
            <OptionCard key={option.value} role="checkbox" layout="tile" option={option} index={index} checked={answers.features_used.includes(option.value)}
              onSelect={() => toggleFeature(option.value)} />
          ))}
        </div>
      )
      break
    case "feature_ratings":
      content = (
        <div className="grid gap-2.5">
          {FEATURE_OPTIONS.filter((option) => answers.features_used.includes(option.value)).map((option, index) => {
            const value = answers.feature_ratings[option.value] ?? null
            return (
              <div key={option.value} style={{ "--i": index } as CSSProperties}
                className={cn("sv-option sv-in flex items-center gap-3 px-3.5 py-3 sm:px-4", value !== null && "is-on")}>
                <span className="sv-option-icon grid h-10 w-10 shrink-0 place-items-center rounded-xl max-sm:hidden">
                  <option.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5 text-white">{option.label}</span>
                  <span key={value ?? 0} className={cn("block text-xs", value ? "sv-flip font-semibold" : "text-slate-500")}
                    style={value ? { color: LEVEL_TONES[value - 1] } : undefined}>
                    {value ? RATING_WORDS[value - 1] : "Not rated yet"}
                  </span>
                </span>
                <StarRating size="sm" label={`Your rating of ${option.label}`} value={value}
                  onChange={(stars) => set("feature_ratings", { ...answers.feature_ratings, [option.value]: stars })} />
              </div>
            )
          })}
        </div>
      )
      break
    case "liked":
      content = (
        <div className="space-y-9">
          <Picks label="What you like most" options={LIKE_OPTIONS} value={answers.liked} most={MOST_PICKS}
            onToggle={(value) => pick("liked", value, { most: MOST_PICKS })} />
          <Note label="Anything you'd like to add?" placeholder="What do you love about SwimGPT?" value={answers.liked_note} max={NOTE_LENGTH}
            onChange={(value) => set("liked_note", value)} index={9} />
        </div>
      )
      break
    case "improve":
      content = (
        <div className="space-y-9">
          <Picks label="What to improve" options={IMPROVE_OPTIONS} value={answers.improve} onToggle={(value) => pick("improve", value, { only: "nothing" })} />
          <Note label="Tell us more" placeholder="What got in your way? The more specific, the better." value={answers.improve_note} max={NOTE_LENGTH}
            onChange={(value) => set("improve_note", value)} index={9} />
        </div>
      )
      break
    case "wishlist":
      content = (
        <div className="space-y-9">
          <Picks label="What to build next" options={WISH_OPTIONS} value={answers.wishlist} most={MOST_PICKS}
            onToggle={(value) => pick("wishlist", value, { most: MOST_PICKS })} />
          <Note label="Your own idea" placeholder="Describe a feature you'd love to have" value={answers.wishlist_note} max={NOTE_LENGTH}
            onChange={(value) => set("wishlist_note", value)} index={9} />
        </div>
      )
      break
    case "recommend":
      content = (
        <div className="space-y-9">
          <ScoreScale value={answers.recommend} onChange={(value) => set("recommend", value)} />
          <Note label="Anything else you'd like to tell us?" placeholder="Ideas, problems, praise: it all helps." value={answers.comments} max={COMMENT_LENGTH}
            onChange={(value) => set("comments", value)} index={12} />
          <label className="sv-toggle-row sv-rise flex cursor-pointer items-start gap-3.5 rounded-2xl p-4" style={{ "--i": 13 } as CSSProperties}>
            <Switch checked={answers.contact_ok} onCheckedChange={(checked) => set("contact_ok", checked)}
              className="mt-0.5 data-[state=checked]:bg-[var(--sv-tone)] data-[state=unchecked]:bg-white/15" />
            <span>
              <span className="block text-sm font-semibold text-white">You can email me about my answers</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-400">Only about this feedback, at your account&apos;s email address.</span>
            </span>
          </label>
          <PrivacyNote index={14} />
        </div>
      )
      break
  }

  return (
    <SurveyScreen tone={tone} status={<Counter value={step + 1} total={STEPS.length} />} progress={{ step, total: STEPS.length, done: false }} onKeyDown={onKeyDown}
      sweep={{ key: step, direction }}
      footer={<>
        {step > 0 ? (
          <button type="button" onClick={() => go(step - 1)} disabled={sending}
            className="group inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50">
            <ArrowLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
            Back
          </button>
        ) : <span />}
        <span aria-hidden className={cn("hidden items-center gap-1.5 text-xs text-slate-500 transition-opacity duration-300 md:flex", !valid && "opacity-0")}>
          Press <kbd className="sv-kbd">Enter ↵</kbd>
        </span>
        <button type="button" onClick={next} aria-disabled={!valid || sending} aria-busy={sending || undefined} className="sv-cta group h-12 px-7 text-sm">
          {!last ? (
            <>
              Continue
              <ArrowRight className="sv-arrow h-4 w-4" />
            </>
          ) : sending ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className={cn("h-4 w-4", valid && "sv-arrow")} />
              Send feedback
            </>
          )}
        </button>
      </>}>
      {/* Clipped sideways: words, sparks and cards sliding in never widen the page (on a phone it would pan sideways). */}
      <section key={step} data-direction={direction} className="relative mx-auto max-w-3xl overflow-x-clip px-4 pb-16 pt-8 sm:px-6 sm:pt-14">
        <span aria-hidden className="sv-bignum">{String(step + 1).padStart(2, "0")}</span>
        <div className="relative">
          <p className="sv-kicker flex w-fit items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
            <span className="sv-kicker-icon grid h-8 w-8 place-items-center rounded-xl"><current.icon className="h-4 w-4" /></span>
            Question {step + 1} of {STEPS.length}
          </p>
          <h2 ref={heading} tabIndex={-1} className="mt-5 max-w-2xl text-balance text-[1.75rem] font-extrabold leading-[1.12] tracking-tight text-white outline-none sm:text-[2.6rem]">
            <Words text={current.title} />
          </h2>
          <p className="sv-rise mt-3 max-w-xl text-sm text-slate-400 sm:text-base" style={{ "--i": 3 } as CSSProperties}>{current.hint}</p>
          {error && last && (
            <p role="alert" className="sv-nudge mt-6 flex items-start gap-2.5 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
              {error}
            </p>
          )}
          <div className="mt-8 sm:mt-10">{content}</div>
          {tried && !valid && current.missing && (
            <p key={nudge} role="alert" className="sv-nudge mt-6 flex items-center gap-2 text-sm font-semibold text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {current.missing}
            </p>
          )}
        </div>
      </section>
    </SurveyScreen>
  )
}
