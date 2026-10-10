"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { WaterBubbles } from "@/components/water-bubbles"
import { CoachAvatar } from "@/components/coach-avatar"
import { CoachCard, type CoachProfile } from "@/components/coach-card"
import { CountrySelect } from "@/components/country-select"
import { CoachPicker } from "@/components/onboarding/coach-picker"
import { PlanLoader } from "@/components/onboarding/plan-loader"
import { ChoiceCards, Chip, CountControl, Field, Segmented, TimeInput, UnitInput } from "@/components/onboarding-fields"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Dumbbell,
  Gauge,
  Medal,
  Pencil,
  Route,
  Shuffle,
  Sparkles,
  Target,
  User,
  Users,
  Waves,
  Zap,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import {
  coerceTimeParts,
  emptyTime,
  formatSeconds,
  formatTime,
  isBlankTime,
  realismError,
  timeError,
  timeToSeconds,
  toStoredTime,
  type StoredSwimTime,
  type TimeParts,
} from "@/lib/swim-time"

type OnboardingData = {
  // Step 1: User Profile
  age: string
  gender: string
  country: string
  height: string
  weight: string
  swimExperience: string

  // Step 2: Swimming Background
  mainEvents: string[]
  pbsLCM: Record<string, TimeParts>
  pbsSCM: Record<string, TimeParts>
  swimmerType: string

  // Step 3: Training Environment
  swimSessionsPerWeek: number
  gymSessionsPerWeek: number
  sessionDuration: string
  facilities: string[]
  coachingSituation: string

  // Step 4: Goal Setting
  oneYearGoal: string
  oneYearGoalTimes: Record<string, TimeParts>

  // Step 5: Coach (the one coach who writes every session)
  coach: string
}

/** Why the coach suits the athlete, written with the season plan. */
type CoachMatch = { headline: string; rationale: string; evidence: string[]; training_impact: string }

const initialData: OnboardingData = {
  age: "",
  gender: "",
  country: "",
  height: "",
  weight: "",
  swimExperience: "",
  mainEvents: [],
  pbsLCM: {},
  pbsSCM: {},
  swimmerType: "",
  swimSessionsPerWeek: 4,
  gymSessionsPerWeek: 2,
  sessionDuration: "",
  facilities: [],
  coachingSituation: "",
  oneYearGoal: "",
  oneYearGoalTimes: {},
  coach: "",
}

const eventGroups = [
  { stroke: "Freestyle", events: ["50m Freestyle", "100m Freestyle", "200m Freestyle", "400m Freestyle", "800m Freestyle", "1500m Freestyle"] },
  { stroke: "Backstroke", events: ["50m Backstroke", "100m Backstroke", "200m Backstroke"] },
  { stroke: "Breaststroke", events: ["50m Breaststroke", "100m Breaststroke", "200m Breaststroke"] },
  { stroke: "Butterfly", events: ["50m Butterfly", "100m Butterfly", "200m Butterfly"] },
  { stroke: "Individual Medley", events: ["200m IM", "400m IM"] },
]

const steps = [
  { title: "Your profile", short: "Profile", description: "A few basics about you", icon: User },
  { title: "Swimming background", short: "Background", description: "Events and personal bests", icon: Waves },
  { title: "Training setup", short: "Training", description: "Volume, facilities, coaching", icon: Dumbbell },
  { title: "Goals", short: "Goals", description: "Your 1-year target times", icon: Target },
  { title: "Your coach", short: "Coach", description: "Choose who trains you", icon: Medal },
  { title: "Review", short: "Review", description: "Confirm and generate", icon: Sparkles },
]

const swimmerTypes = [
  { value: "sprinter", label: "Sprinter", detail: "50–100m events", icon: Zap },
  { value: "mid", label: "Mid-distance", detail: "200–400m events", icon: Gauge },
  { value: "distance", label: "Distance", detail: "800–1500m events", icon: Route },
  { value: "specialist", label: "IM specialist", detail: "Individual medley", icon: Shuffle },
]

const genders = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
]

const durations = [
  { value: "60", label: "60 min" },
  { value: "90", label: "90 min" },
  { value: "120", label: "120 min" },
  { value: "150", label: "150+ min" },
]

const facilityOptions = ["25m Pool", "50m Pool", "Full Gym Access", "Basic Gym", "Home Equipment", "No Gym Access"]
const gymFacilities = ["Full Gym Access", "Basic Gym"]

const coachingOptions = [
  { value: "team", label: "Team & coach", detail: "Training with a team and coach", icon: Users },
  { value: "club", label: "Club swimmer", detail: "Limited coaching support", icon: Building2 },
  { value: "solo", label: "Training solo", detail: "No regular coach", icon: User },
]

const DRAFT_KEY = "swimgpt_onboarding_draft"
// Only the selected events' filled-in times are sent; Supabase stores them as {minutes, seconds, hundredths}.
const storedTimes = (times: Record<string, TimeParts>, events: string[]) =>
  Object.fromEntries(
    events.filter((event) => !isBlankTime(times[event])).map((event) => [event, toStoredTime(times[event])]),
  ) as Record<string, StoredSwimTime>

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

/** Saved answers from the API in the form's shape (used to edit onboarding or finish an interrupted setup). */
const fromSavedAnswers = (answers: Record<string, unknown>): OnboardingData => {
  const text = (value: unknown) => (value === null || value === undefined ? "" : String(value))
  const times = (value: unknown) => Object.fromEntries(Object.entries((value as Record<string, unknown>) || {}).map(([event, time]) => [event, coerceTimeParts(time)]))
  return {
    ...initialData,
    age: text(answers.age), gender: text(answers.gender), country: text(answers.country), height: text(answers.height),
    weight: text(answers.weight), swimExperience: text(answers.swim_experience),
    mainEvents: Array.isArray(answers.main_events) ? (answers.main_events as string[]) : [],
    pbsLCM: times(answers.pbs_lcm), pbsSCM: times(answers.pbs_scm), swimmerType: text(answers.swimmer_type),
    swimSessionsPerWeek: Number(answers.swim_sessions_per_week) || initialData.swimSessionsPerWeek,
    gymSessionsPerWeek: answers.gym_sessions_per_week === null || answers.gym_sessions_per_week === undefined ? initialData.gymSessionsPerWeek : Number(answers.gym_sessions_per_week),
    sessionDuration: text(answers.session_duration),
    facilities: Array.isArray(answers.facilities) ? (answers.facilities as string[]) : [],
    coachingSituation: text(answers.coaching_situation), oneYearGoal: text(answers.one_year_goal),
    oneYearGoalTimes: times(answers.one_year_goal_times),
    coach: text(answers.coach),
  }
}

/** A coach from a saved draft; drafts saved before athletes had one coach hold a `coaches` list (head coach first). */
const draftCoach = (draft: Record<string, unknown>) =>
  typeof draft.coach === "string" ? draft.coach : Array.isArray(draft.coaches) && typeof draft.coaches[0] === "string" ? draft.coaches[0] : ""

const eventFieldId = (prefix: string, event: string) => `${prefix}-${event.toLowerCase().replace(/\s+/g, "-")}`

const labelFor = (options: { value: string; label: string }[], value: string) =>
  options.find((option) => option.value === value)?.label || "Not set"

const validateStep = (step: number, data: OnboardingData): Record<string, string> => {
  const errors: Record<string, string> = {}
  const inRange = (value: string, min: number, max: number) => {
    const number = Number(value)
    return value.trim() !== "" && Number.isFinite(number) && number >= min && number <= max
  }

  if (step === 1) {
    if (!inRange(data.age, 8, 100)) errors.age = data.age ? "Enter an age between 8 and 100" : "Enter your age"
    if (!data.gender) errors.gender = "Select an option"
    if (!data.country.trim()) errors.country = "Enter your country"
    if (data.height && !inRange(data.height, 100, 250)) errors.height = "Enter a height between 100 and 250 cm"
    if (!inRange(data.weight, 25, 250)) errors.weight = data.weight ? "Enter a weight between 25 and 250 kg" : "Enter your weight"
    if (!inRange(data.swimExperience, 0, 80)) errors.swimExperience = "Enter how many years you've been swimming"
  }

  if (step === 2) {
    if (!data.swimmerType) errors.swimmerType = "Choose the profile that fits you best"
    if (data.mainEvents.length === 0) errors.mainEvents = "Pick at least one event"
    data.mainEvents.forEach((event) => {
      const lcmError = timeError(data.pbsLCM[event], true, "Add your long course best") || realismError(event, data.pbsLCM[event])
      if (lcmError) errors[eventFieldId("lcm", event)] = lcmError
      const scmError = timeError(data.pbsSCM[event], false, "") || realismError(event, data.pbsSCM[event])
      if (scmError) errors[eventFieldId("scm", event)] = scmError
    })
  }

  if (step === 3) {
    if (!data.sessionDuration) errors.sessionDuration = "Select your typical session length"
    if (data.facilities.length === 0) errors.facilities = "Select at least one facility"
    else if (!data.facilities.some((facility) => facility.endsWith("Pool"))) errors.facilities = "Select the pool you train in (25m or 50m)"
    if (!data.coachingSituation) errors.coachingSituation = "Select your coaching situation"
  }

  if (step === 4) {
    if (data.oneYearGoal.length > 600) errors.oneYearGoal = "Keep it under 600 characters"
    data.mainEvents.forEach((event) => {
      const goalError = timeError(data.oneYearGoalTimes[event], true, "Add a target time") || realismError(event, data.oneYearGoalTimes[event])
      if (goalError) errors[eventFieldId("goal", event)] = goalError
    })
  }

  if (step === 5 && !data.coach) errors.coach = "Choose your coach"

  return errors
}

const focusField = (id: string) => {
  const element = document.getElementById(id)
  if (!element) return
  element.scrollIntoView({ behavior: "smooth", block: "center" })
  element.focus({ preventScroll: true })
}

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [maxStep, setMaxStep] = useState(1)
  const [attempted, setAttempted] = useState(false)
  const [draftUserId, setDraftUserId] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  // The plan is saved; the loader swims its last metres, then the coach screen opens.
  const [planReady, setPlanReady] = useState(false)
  const [showCoaches, setShowCoaches] = useState(false)
  // The athlete's coach, why they suit the athlete, and their full profile (from the backend coach catalog).
  const [coach, setCoach] = useState<string | null>(null)
  const [coachMatch, setCoachMatch] = useState<CoachMatch | null>(null)
  const [coachProfile, setCoachProfile] = useState<CoachProfile | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [fullName, setFullName] = useState("")
  const [prefilled, setPrefilled] = useState(false)
  // Whether the account has paid for its coaching plan (null until known). Paid athletes are never asked to pay again.
  const [paid, setPaid] = useState<boolean | null>(null)

  const [data, setData] = useState<OnboardingData>(initialData)

  useEffect(() => {
    const loadAccount = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        // Restore an in-progress draft, but only for the account that started it.
        let restoredDraft = false
        try {
          const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null")
          if (draft?.userId === user.id && draft.data) {
            const { coaches: _legacyCoaches, ...savedDraft } = draft.data
            const restored: OnboardingData = { ...initialData, ...savedDraft, coach: draftCoach(draft.data) }
            for (const field of ["pbsLCM", "pbsSCM", "oneYearGoalTimes"] as const) {
              restored[field] = Object.fromEntries(
                Object.entries(restored[field] || {}).map(([event, time]) => [event, coerceTimeParts(time)]),
              )
            }
            setData(restored)
            setCurrentStep(Math.min(Math.max(Number(draft.currentStep) || 1, 1), steps.length))
            setMaxStep(Math.min(Math.max(Number(draft.maxStep) || 1, 1), steps.length))
            restoredDraft = true
          }
        } catch {
          localStorage.removeItem(DRAFT_KEY)
        }
        // Answers already saved to the account: with no local draft they pre-fill the form (editing, or a setup that
        // didn't finish).
        let accountPaid = false
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const response = session ? await fetch(`${API_URL}/api/onboarding`, { headers: { Authorization: `Bearer ${session.access_token}` } }) : null
          if (response?.ok) {
            const saved = await response.json()
            accountPaid = Boolean(saved.paid)
            if (!restoredDraft) {
              setData(fromSavedAnswers(saved.answers || {}))
              setMaxStep(steps.length)
              setPrefilled(true)
            } else if (accountPaid && typeof saved.answers?.coach === "string") {
              // A paying athlete keeps their coach here (switching is done from the dashboard), whatever an old draft says.
              setData((current) => ({ ...current, coach: saved.answers.coach }))
            }
          }
        } catch {
          // Saved answers are a convenience; the form still works empty.
        }
        setPaid(accountPaid)
        setDraftUserId(user.id)
      } else {
        setPaid(false)
      }

      const accountName = user?.user_metadata?.full_name?.trim() || ""

      if (!accountName) {
        setGenerationError("Your account name could not be loaded. Please return to sign in and try again.")
        return
      }

      setFullName(accountName)
    }

    loadAccount()
  }, [])

  useEffect(() => {
    const pendingPayment = localStorage.getItem("swimgpt_pending_payment")
    if (!pendingPayment) return

    try {
      // Saved before athletes had one coach: `coaches` / `coachProfiles` lists, head coach first.
      const pending = JSON.parse(pendingPayment)
      setCoach(pending.coach || (Array.isArray(pending.coaches) ? pending.coaches[0] : null) || null)
      setCoachMatch(pending.coachMatch || null)
      setCoachProfile(pending.coachProfile || (Array.isArray(pending.coachProfiles) ? pending.coachProfiles[0] : null) || null)
      setShowCoaches(true)
    } catch {
      localStorage.removeItem("swimgpt_pending_payment")
    }
  }, [])

  useEffect(() => {
    if (!draftUserId || showCoaches) return
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ userId: draftUserId, data, currentStep, maxStep }))
  }, [data, currentStep, maxStep, draftUserId, showCoaches])

  const errors = useMemo(() => validateStep(currentStep, data), [currentStep, data])
  const visibleError = (key: string) => (attempted ? errors[key] : undefined)

  const updateData = <K extends keyof OnboardingData>(field: K, value: OnboardingData[K]) => {
    setData((prev) => ({ ...prev, [field]: value }))
  }

  const toggleArrayItem = (field: "mainEvents" | "facilities", item: string) => {
    setData((prev) => {
      const current = prev[field]
      return { ...prev, [field]: current.includes(item) ? current.filter((i) => i !== item) : [...current, item] }
    })
  }

  const toggleFacility = (facility: string) => {
    setData((prev) => {
      if (prev.facilities.includes(facility)) {
        return { ...prev, facilities: prev.facilities.filter((item) => item !== facility) }
      }
      // "No Gym Access" can't coexist with a gym option.
      const conflicting = facility === "No Gym Access" ? gymFacilities : gymFacilities.includes(facility) ? ["No Gym Access"] : []
      return { ...prev, facilities: [...prev.facilities.filter((item) => !conflicting.includes(item)), facility] }
    })
  }

  const updateTime = (field: "pbsLCM" | "pbsSCM" | "oneYearGoalTimes", event: string, time: TimeParts) => {
    setData((prev) => ({ ...prev, [field]: { ...prev[field], [event]: time } }))
  }

  const pacePer50 = (event: string, time?: TimeParts) => {
    const seconds = timeToSeconds(time)
    if (seconds === null) return null
    return formatSeconds((seconds / Number.parseInt(event)) * 50)
  }

  const goToStep = (step: number) => {
    setCurrentStep(step)
    setMaxStep((max) => Math.max(max, step))
    setAttempted(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleNext = () => {
    if (currentStep < steps.length) {
      const firstError = Object.keys(errors)[0]
      if (firstError) {
        setAttempted(true)
        focusField(firstError)
        return
      }
      goToStep(currentStep + 1)
      return
    }

    // Earlier steps may have been edited after they were completed; recheck before generating.
    for (let step = 1; step < steps.length; step++) {
      const stepErrors = validateStep(step, data)
      const firstError = Object.keys(stepErrors)[0]
      if (firstError) {
        setCurrentStep(step)
        setAttempted(true)
        window.setTimeout(() => focusField(firstError), 50)
        return
      }
    }
    handleGenerate()
  }

  const handleBack = () => {
    if (currentStep > 1) {
      goToStep(currentStep - 1)
    }
  }

  const handleGenerate = async () => {
    if (!fullName) {
      setGenerationError("Your account name could not be loaded. Please return to sign in and try again.")
      return
    }

    setIsGenerating(true)
    setPlanReady(false)
    setGenerationError(null)
    window.scrollTo({ top: 0, behavior: "smooth" })

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setGenerationError("Your session has expired. Please sign in again before continuing.")
      setIsGenerating(false)
      return
    }

    // The account (who you are and your name) comes from the session token, not this payload.
    const payload = {
      age: data.age,
      gender: data.gender,
      country: data.country,
      height: data.height,
      weight: data.weight,
      swim_experience: data.swimExperience,
      main_events: data.mainEvents,
      pbs_lcm: storedTimes(data.pbsLCM, data.mainEvents),
      pbs_scm: storedTimes(data.pbsSCM, data.mainEvents),
      swimmer_type: data.swimmerType,
      swim_sessions_per_week: data.swimSessionsPerWeek,
      gym_sessions_per_week: data.gymSessionsPerWeek,
      session_duration: data.sessionDuration,
      facilities: data.facilities,
      coaching_situation: data.coachingSituation,
      one_year_goal: data.oneYearGoal.trim(),
      one_year_goal_times: storedTimes(data.oneYearGoalTimes, data.mainEvents),
      coach: data.coach || null,
    }

    try {
      const response = await fetch(`${API_URL}/api/onboarding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        let detail = "Your personalized plan could not be generated. Please try again."
        try {
          const failure = await response.json()
          if (typeof failure.detail === "string") detail = failure.detail
          else if (Array.isArray(failure.detail)) detail = failure.detail.map((issue: { msg: string }) => issue.msg.replace(/^Value error, /, "")).join(" ")
        } catch { /* keep the generic message */ }
        throw new Error(detail)
      }

      const result = await response.json()
      localStorage.setItem("swimgpt_user_key", result.user_key)
      localStorage.setItem(
        "swimgpt_onboarding",
        JSON.stringify({
          ...data,
          fullName,
          user_key: result.user_key,
        }),
      )
      setCoach(result.coach || null)
      setCoachMatch(result.coach_match || null)
      setCoachProfile(result.coach_profile || null)
      localStorage.setItem(
        "swimgpt_pending_payment",
        JSON.stringify({ coach: result.coach || null, coachMatch: result.coach_match || null, coachProfile: result.coach_profile || null }),
      )
      localStorage.removeItem(DRAFT_KEY)
    } catch (error) {
      console.error("Onboarding save failed:", error)
      setGenerationError(error instanceof Error ? error.message : "Your personalized plan could not be generated. Please try again.")
      setIsGenerating(false)
      return
    }

    setPlanReady(true)
  }

  // Called by the loader after the swimmer touches the wall.
  const showResults = () => {
    setIsGenerating(false)
    setPlanReady(false)
    setShowCoaches(true)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // The monthly payment screen is its own page; the coach reveal stays here until the athlete comes back to it.
  const continueToPayment = () => {
    localStorage.setItem("swimgpt_pending_payment", JSON.stringify({ coach, coachMatch, coachProfile }))
    window.location.assign("/subscribe")
  }

  const openDashboard = () => {
    localStorage.removeItem("swimgpt_pending_payment")
    window.location.assign("/dashboard")
  }

  const getCoachDisplayName = (name: string) => {
    return name
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  const firstName = fullName.split(" ")[0]
  const step = steps[currentStep - 1]
  const showForm = !isGenerating && !showCoaches

  const reviewSections = [
    {
      step: 1,
      title: "Profile",
      rows: [
        ["Name", fullName || "—"],
        ["Age", data.age ? `${data.age} years` : "—"],
        ["Gender", labelFor(genders, data.gender)],
        ["Country", data.country || "—"],
        ["Height / weight", `${data.height ? `${data.height} cm` : "—"} · ${data.weight ? `${data.weight} kg` : "—"}`],
        ["Experience", data.swimExperience ? `${data.swimExperience} years swimming` : "—"],
      ],
    },
    {
      step: 2,
      title: "Swimming background",
      rows: [
        ["Swimmer type", labelFor(swimmerTypes, data.swimmerType)],
        ...data.mainEvents.map((event) => [
          event,
          `${formatTime(data.pbsLCM[event]) || "—"} LCM${formatTime(data.pbsSCM[event]) ? ` · ${formatTime(data.pbsSCM[event])} SCM` : ""}`,
        ]),
      ],
    },
    {
      step: 3,
      title: "Training setup",
      rows: [
        ["Weekly volume", `${data.swimSessionsPerWeek} swim · ${data.gymSessionsPerWeek} gym`],
        ["Session length", labelFor(durations, data.sessionDuration)],
        ["Facilities", data.facilities.join(", ") || "—"],
        ["Coaching", labelFor(coachingOptions, data.coachingSituation)],
      ],
    },
    {
      step: 4,
      title: "Goals",
      rows: [
        ...data.mainEvents.map((event) => [`${event} target`, formatTime(data.oneYearGoalTimes[event]) || "—"]),
        ["In your words", data.oneYearGoal.trim() || "—"],
      ],
    },
    {
      step: 5,
      title: "Coach",
      rows: [["Your coach", data.coach || "—"]],
    },
  ]

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Ambient background */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(87,229,234,0.13),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(56,120,220,0.12),transparent_55%)]" />
        <div className="absolute inset-0 opacity-40">
          <WaterBubbles />
        </div>
      </div>

      {/* Top bar */}
      <header className="relative z-10 border-b border-white/8 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative">
              <span className="absolute inset-0 animate-pulse rounded-full bg-accent/20 blur-xl" />
              <span className="relative flex rounded-xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-2">
                <Waves className="h-5 w-5 text-primary-foreground" />
              </span>
            </span>
            <span className="text-lg font-bold tracking-tight text-white">
              Swim<span className="text-accent">GPT</span>
            </span>
          </Link>
          {showForm && (
            <div className="flex items-center gap-4 text-sm">
              {draftUserId && (
                <span className="hidden items-center gap-1.5 text-slate-400 sm:flex">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Progress saved
                </span>
              )}
              <Link href="/" className="text-slate-300 transition-colors hover:text-white">
                Save & exit
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 lg:pt-12">
        {generationError && showForm && !fullName && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {generationError}{" "}
              <Link href="/auth" className="font-medium underline underline-offset-2">
                Go to sign in
              </Link>
            </p>
          </div>
        )}

        {showForm && (
          <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* Step rail */}
            <aside className="hidden lg:block">
              <div className="sticky top-8 space-y-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Plan setup</p>
                  <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
                    {firstName ? `Welcome, ${firstName}` : "Welcome to SwimGPT"}
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">About 3 minutes to your personalized program.</p>
                </div>

                <nav aria-label="Onboarding steps">
                  <ol className="space-y-1">
                    {steps.map((item, idx) => {
                      const number = idx + 1
                      const isCurrent = number === currentStep
                      const isDone = number < currentStep || (number <= maxStep && !isCurrent && number !== maxStep)
                      const reachable = number <= maxStep
                      return (
                        <li key={item.title}>
                          <button
                            type="button"
                            disabled={!reachable}
                            onClick={() => goToStep(number)}
                            aria-current={isCurrent ? "step" : undefined}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                              isCurrent ? "bg-white/[0.06]" : reachable ? "hover:bg-white/[0.04]" : "cursor-default",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all",
                                isCurrent
                                  ? "border-accent bg-accent text-accent-foreground shadow-[0_0_18px_rgba(87,229,234,0.4)]"
                                  : isDone
                                    ? "border-accent/40 bg-accent/10 text-accent"
                                    : "border-white/10 text-slate-500",
                              )}
                            >
                              {isDone ? <Check className="h-4 w-4" strokeWidth={3} /> : number}
                            </span>
                            <span className="min-w-0">
                              <span className={cn("block text-sm font-medium", isCurrent ? "text-white" : reachable ? "text-slate-300" : "text-slate-500")}>
                                {item.title}
                              </span>
                              <span className="block truncate text-xs text-slate-500">{item.description}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </nav>

                {/* Live profile snapshot */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Your profile so far</p>
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Type</span>
                      <span className="font-medium text-white">{data.swimmerType ? labelFor(swimmerTypes, data.swimmerType) : "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Weekly sessions</span>
                      <span className="font-medium text-white">
                        {data.swimSessionsPerWeek} swim · {data.gymSessionsPerWeek} gym
                      </span>
                    </div>
                    {data.mainEvents.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {data.mainEvents.map((event) => (
                          <span key={event} className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs text-accent">
                            {event}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </aside>

            {/* Step content */}
            <section className="min-w-0">
              {/* Mobile progress */}
              <div className="mb-6 lg:hidden">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-[0.16em] text-accent">
                    Step {currentStep} of {steps.length}
                  </span>
                  <span className="text-slate-400">{step.short}</span>
                </div>
                <div className="mt-3 grid grid-cols-6 gap-1.5">
                  {steps.map((item, idx) => (
                    <span
                      key={item.title}
                      className={cn(
                        "h-1.5 rounded-full transition-colors duration-500",
                        idx + 1 <= currentStep ? "bg-accent" : "bg-white/10",
                      )}
                    />
                  ))}
                </div>
              </div>

              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  handleNext()
                }}
                className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(165deg,rgba(20,30,40,0.88),rgba(10,15,21,0.94))] shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              >
                <div key={currentStep} className="animate-in fade-in slide-in-from-bottom-2 p-6 duration-500 sm:p-10">
                  <div className="mb-8 flex items-start gap-4">
                    <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 sm:flex">
                      <step.icon className="h-6 w-6 text-accent" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Step {currentStep} · {step.short}
                      </p>
                      <h2 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                        {currentStep === 1 && firstName ? `Hi ${firstName}, let's start with you` : step.title}
                      </h2>
                      <p className="mt-1.5 text-slate-400">
                        {
                          [
                            "These basics let us scale your training load and nutrition.",
                            "Your events and best times anchor every pace in your plan.",
                            "We'll fit the program around the time and equipment you actually have.",
                            "Set the times you want to hit over the next 12 months.",
                            paid
                              ? "Your coach stays with you while you edit your answers."
                              : "Pick the one coach who'll train you. We've flagged the best fit for your events, but it's your call.",
                            "Check everything looks right, then we'll build your program.",
                          ][currentStep - 1]
                        }
                      </p>
                    </div>
                  </div>

                  {prefilled && (
                    <p role="status" className="mb-6 flex items-start gap-2 rounded-xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-sm text-cyan-50/90">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      We loaded the answers saved to your account. Update anything, then generate again; your training history stays with your profile.
                    </p>
                  )}

                  {currentStep === 1 && (
                    <div className="space-y-7">
                      <div className="grid gap-6 sm:grid-cols-2">
                        <Field label="Age" htmlFor="age" required error={visibleError("age")}>
                          <UnitInput
                            id="age"
                            type="number"
                            inputMode="numeric"
                            unit="years"
                            value={data.age}
                            aria-invalid={Boolean(visibleError("age"))}
                            onChange={(e) => updateData("age", e.target.value)}
                            placeholder="21"
                            autoFocus
                          />
                        </Field>
                        <Field label="Gender" htmlFor="gender" required error={visibleError("gender")}>
                          <Segmented
                            id="gender"
                            label="Gender"
                            options={genders}
                            value={data.gender}
                            invalid={Boolean(visibleError("gender"))}
                            onChange={(value) => updateData("gender", value)}
                          />
                        </Field>
                        <Field label="Country" htmlFor="country" required error={visibleError("country")}>
                          <CountrySelect
                            id="country"
                            value={data.country}
                            invalid={Boolean(visibleError("country"))}
                            onChange={(value) => updateData("country", value)}
                          />
                        </Field>
                        <Field label="Years swimming" htmlFor="swimExperience" required error={visibleError("swimExperience")}>
                          <UnitInput
                            id="swimExperience"
                            type="number"
                            inputMode="numeric"
                            unit="years"
                            value={data.swimExperience}
                            aria-invalid={Boolean(visibleError("swimExperience"))}
                            onChange={(e) => updateData("swimExperience", e.target.value)}
                            placeholder="10"
                          />
                        </Field>
                        <Field label="Height" htmlFor="height" optional error={visibleError("height")}>
                          <UnitInput
                            id="height"
                            type="number"
                            inputMode="decimal"
                            unit="cm"
                            value={data.height}
                            aria-invalid={Boolean(visibleError("height"))}
                            onChange={(e) => updateData("height", e.target.value)}
                            placeholder="180"
                          />
                        </Field>
                        <Field label="Weight" htmlFor="weight" required error={visibleError("weight")}>
                          <UnitInput
                            id="weight"
                            type="number"
                            inputMode="decimal"
                            unit="kg"
                            value={data.weight}
                            aria-invalid={Boolean(visibleError("weight"))}
                            onChange={(e) => updateData("weight", e.target.value)}
                            placeholder="75"
                          />
                        </Field>
                      </div>
                    </div>
                  )}

                  {currentStep === 2 && (
                    <div className="space-y-8">
                      <Field label="What kind of swimmer are you?" htmlFor="swimmerType" required error={visibleError("swimmerType")}>
                        <ChoiceCards
                          id="swimmerType"
                          label="Swimmer type"
                          options={swimmerTypes}
                          value={data.swimmerType}
                          invalid={Boolean(visibleError("swimmerType"))}
                          onChange={(value) => updateData("swimmerType", value)}
                        />
                      </Field>

                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium text-slate-200">
                            Main events<span className="ml-0.5 text-accent">*</span>
                          </p>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-xs font-medium",
                              data.mainEvents.length === 3 ? "bg-accent/15 text-accent" : "bg-white/[0.05] text-slate-400",
                            )}
                          >
                            {data.mainEvents.length} / 3 selected
                          </span>
                        </div>
                        <div
                          id="mainEvents"
                          tabIndex={-1}
                          className={cn(
                            "space-y-4 rounded-2xl border p-4 outline-none sm:p-5",
                            visibleError("mainEvents") ? "border-rose-400/40" : "border-white/10 bg-white/[0.015]",
                          )}
                        >
                          {eventGroups.map((group) => (
                            <div key={group.stroke} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <span className="w-32 shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                {group.stroke}
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {group.events.map((event) => {
                                  const selected = data.mainEvents.includes(event)
                                  return (
                                    <Chip
                                      key={event}
                                      selected={selected}
                                      disabled={!selected && data.mainEvents.length >= 3}
                                      onClick={() => toggleArrayItem("mainEvents", event)}
                                    >
                                      {group.stroke === "Individual Medley" ? event : event.split(" ")[0]}
                                    </Chip>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                        {visibleError("mainEvents") ? (
                          <p role="alert" className="text-xs font-medium text-rose-300">
                            {visibleError("mainEvents")}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500">Choose up to three events you want to build your season around.</p>
                        )}
                      </div>

                      {data.mainEvents.length > 0 && (
                        <div className="space-y-3 animate-in fade-in duration-500">
                          <div>
                            <p className="text-sm font-medium text-slate-200">Personal bests</p>
                            <p className="mt-1 text-xs text-slate-500">
                              Long course (50m) is required, short course (25m) is optional. Leave minutes empty for times under a minute.
                            </p>
                          </div>
                          <div className="divide-y divide-white/8 overflow-hidden rounded-2xl border border-white/10">
                            {data.mainEvents.map((event) => {
                              const lcmPace = pacePer50(event, data.pbsLCM[event])
                              return (
                                <div key={event} className="grid gap-4 bg-white/[0.015] p-4 sm:grid-cols-[150px_1fr_1fr] sm:items-start">
                                  <div className="sm:pt-3">
                                    <p className="font-semibold text-white">{event}</p>
                                    {lcmPace && <p className="mt-0.5 text-xs text-accent">{lcmPace} per 50m</p>}
                                  </div>
                                  <Field label="LCM · 50m pool" htmlFor={eventFieldId("lcm", event)} required error={visibleError(eventFieldId("lcm", event))}>
                                    <TimeInput
                                      id={eventFieldId("lcm", event)}
                                      label={`${event} long course best`}
                                      value={data.pbsLCM[event] || emptyTime}
                                      invalid={Boolean(visibleError(eventFieldId("lcm", event)))}
                                      onChange={(time) => updateTime("pbsLCM", event, time)}
                                    />
                                  </Field>
                                  <Field label="SCM · 25m pool" htmlFor={eventFieldId("scm", event)} optional error={visibleError(eventFieldId("scm", event))}>
                                    <TimeInput
                                      id={eventFieldId("scm", event)}
                                      label={`${event} short course best`}
                                      value={data.pbsSCM[event] || emptyTime}
                                      invalid={Boolean(visibleError(eventFieldId("scm", event)))}
                                      onChange={(time) => updateTime("pbsSCM", event, time)}
                                    />
                                  </Field>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {currentStep === 3 && (
                    <div className="space-y-8">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <CountControl
                          id="swimSessions"
                          label="Swim sessions"
                          unit="session"
                          value={data.swimSessionsPerWeek}
                          min={1}
                          max={14}
                          onChange={(value) => updateData("swimSessionsPerWeek", value)}
                        />
                        <CountControl
                          id="gymSessions"
                          label="Gym sessions"
                          unit="session"
                          value={data.gymSessionsPerWeek}
                          min={0}
                          max={6}
                          onChange={(value) => updateData("gymSessionsPerWeek", value)}
                        />
                      </div>

                      <Field label="Typical session length" htmlFor="sessionDuration" required error={visibleError("sessionDuration")}>
                        <Segmented
                          id="sessionDuration"
                          label="Typical session length"
                          options={durations}
                          value={data.sessionDuration}
                          invalid={Boolean(visibleError("sessionDuration"))}
                          onChange={(value) => updateData("sessionDuration", value)}
                        />
                      </Field>

                      <Field label="Available facilities" htmlFor="facilities" required error={visibleError("facilities")} hint="Select everything you can regularly access.">
                        <div id="facilities" tabIndex={-1} className="flex flex-wrap gap-2 outline-none">
                          {facilityOptions.map((facility) => (
                            <Chip key={facility} selected={data.facilities.includes(facility)} onClick={() => toggleFacility(facility)}>
                              {facility}
                            </Chip>
                          ))}
                        </div>
                      </Field>

                      <Field label="Coaching situation" htmlFor="coachingSituation" required error={visibleError("coachingSituation")}>
                        <ChoiceCards
                          id="coachingSituation"
                          label="Coaching situation"
                          columns="sm:grid-cols-3"
                          options={coachingOptions}
                          value={data.coachingSituation}
                          invalid={Boolean(visibleError("coachingSituation"))}
                          onChange={(value) => updateData("coachingSituation", value)}
                        />
                      </Field>

                      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-accent/25 bg-accent/[0.06] p-4 text-center sm:grid-cols-4">
                        {[
                          { label: "Swim / week", value: data.swimSessionsPerWeek },
                          { label: "Gym / week", value: data.gymSessionsPerWeek },
                          {
                            label: "Weekly hours",
                            value: data.sessionDuration
                              ? `~${Math.round((data.swimSessionsPerWeek * Number(data.sessionDuration)) / 60)}h`
                              : "—",
                          },
                          { label: "Facilities", value: data.facilities.length },
                        ].map((stat) => (
                          <div key={stat.label}>
                            <p className="text-xl font-bold text-white">{stat.value}</p>
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{stat.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentStep === 4 && (
                    <div className="space-y-8">
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-medium text-slate-200">
                            1-year target times<span className="ml-0.5 text-accent">*</span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">Long course targets. Ambitious but realistic works best.</p>
                        </div>
                        {data.mainEvents.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center">
                            <p className="text-sm text-slate-400">Pick your main events first.</p>
                            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => goToStep(2)}>
                              Go to swimming background
                            </Button>
                          </div>
                        ) : (
                          <div className="divide-y divide-white/8 overflow-hidden rounded-2xl border border-white/10">
                            {data.mainEvents.map((event) => {
                              const pb = timeToSeconds(data.pbsLCM[event])
                              const target = timeToSeconds(data.oneYearGoalTimes[event])
                              const delta = pb !== null && target !== null ? pb - target : null
                              return (
                                <div key={event} className="grid gap-4 bg-white/[0.015] p-4 sm:grid-cols-[150px_1fr_160px] sm:items-start">
                                  <div className="sm:pt-3">
                                    <p className="font-semibold text-white">{event}</p>
                                    <p className="mt-0.5 text-xs text-slate-500">PB {formatTime(data.pbsLCM[event]) || "—"}</p>
                                  </div>
                                  <Field label="Target" htmlFor={eventFieldId("goal", event)} required error={visibleError(eventFieldId("goal", event))}>
                                    <TimeInput
                                      id={eventFieldId("goal", event)}
                                      label={`${event} target`}
                                      value={data.oneYearGoalTimes[event] || emptyTime}
                                      invalid={Boolean(visibleError(eventFieldId("goal", event)))}
                                      onChange={(time) => updateTime("oneYearGoalTimes", event, time)}
                                    />
                                  </Field>
                                  <div className="sm:pt-8">
                                    {delta !== null &&
                                      (delta > 0 ? (
                                        <p className="text-sm font-semibold text-emerald-300">
                                          −{delta.toFixed(2)}s
                                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                                            {((delta / pb!) * 100).toFixed(1)}% faster
                                          </span>
                                        </p>
                                      ) : (
                                        <p className="text-xs text-amber-300">Target isn&apos;t faster than your PB</p>
                                      ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <Field label="Your goal in your own words" htmlFor="oneYearGoal" optional error={visibleError("oneYearGoal")}
                        hint="Anything the times don't say: a meet you're aiming at, a qualifying standard, a comeback from injury, what matters most.">
                        <Textarea id="oneYearGoal" rows={3} maxLength={600} value={data.oneYearGoal}
                          placeholder="e.g. Qualify for nationals in the 100 back and stay injury-free through the season."
                          onChange={(event) => updateData("oneYearGoal", event.target.value)}
                          className="min-h-24 rounded-xl border-white/10 bg-white/[0.03] text-sm leading-6 placeholder:text-slate-600 focus-visible:border-accent/50 focus-visible:ring-accent/20" />
                      </Field>
                    </div>
                  )}

                  {currentStep === 5 && paid && data.coach && (
                    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center sm:flex-row sm:text-left">
                      <CoachAvatar name={data.coach} shape="circle" className="h-16 w-16 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Your coach</p>
                        <p className="mt-0.5 text-lg font-semibold text-white">{data.coach}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          Your new answers are built into {getCoachDisplayName(data.coach)}&apos;s program. To change coach, use
                          Switch coach on your dashboard.
                        </p>
                      </div>
                    </div>
                  )}

                  {currentStep === 5 && !(paid && data.coach) && (
                    <CoachPicker
                      answers={{
                        main_events: data.mainEvents,
                        swimmer_type: data.swimmerType,
                        facilities: data.facilities,
                        gym_sessions_per_week: data.gymSessionsPerWeek,
                        swim_sessions_per_week: data.swimSessionsPerWeek,
                      }}
                      value={data.coach}
                      onChange={(coach) => updateData("coach", coach)}
                      invalid={Boolean(visibleError("coach"))}
                    />
                  )}

                  {currentStep === 6 && (
                    <div className="space-y-4">
                      {reviewSections.map((section) => (
                        <div key={section.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="font-semibold text-white">{section.title}</h3>
                            <button
                              type="button"
                              onClick={() => goToStep(section.step)}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                          </div>
                          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                            {section.rows.map(([label, value]) => (
                              <div key={label} className="flex justify-between gap-4 border-b border-white/5 pb-2 sm:block sm:border-0 sm:pb-0">
                                <dt className="text-slate-500">{label}</dt>
                                <dd className="text-right font-medium text-slate-100 sm:text-left">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                      {generationError && fullName && (
                        <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                          {generationError}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Action bar */}
                <div className="flex items-center justify-between gap-3 border-t border-white/8 bg-black/20 px-6 py-4 sm:px-10">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleBack}
                    disabled={currentStep === 1}
                    className="text-slate-300 hover:bg-white/[0.06] hover:text-white"
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex items-center gap-4">
                    {currentStep < steps.length && (
                      <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex">
                        Press Enter
                        <kbd className="flex h-5 items-center rounded border border-white/15 bg-white/[0.05] px-1.5">
                          <CornerDownLeft className="h-3 w-3" />
                        </kbd>
                      </span>
                    )}
                    <Button
                      type="submit"
                      size="lg"
                      className="rounded-full bg-accent px-6 text-accent-foreground shadow-[0_10px_28px_rgba(87,229,234,0.3)] hover:bg-accent/90"
                    >
                      {currentStep === steps.length ? (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Generate my program
                        </>
                      ) : (
                        <>
                          {currentStep === steps.length - 1 ? "Review" : "Continue"}
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </section>
          </div>
        )}

        {isGenerating && (
          <div className="py-4 animate-in fade-in duration-700 sm:py-8">
            <PlanLoader firstName={firstName} coach={data.coach} done={planReady} onFinished={showResults} />
          </div>
        )}

        {showCoaches && (
          <Card className="mx-auto max-w-4xl border-white/10 bg-[linear-gradient(165deg,rgba(20,30,40,0.88),rgba(10,15,21,0.94))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl animate-in fade-in duration-700 sm:p-8">
            <div className="space-y-8">
              <div className="relative overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/10 via-card to-card p-8 text-center">
                <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 shadow-[0_0_35px_rgba(34,211,238,0.18)]">
                    <Sparkles className="h-7 w-7 text-accent" />
                  </div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-accent">Program ready</p>
                  <h2 className="text-3xl font-bold mb-2">Your coach is ready</h2>
                  <p className="mx-auto max-w-xl text-muted-foreground">
                    {coach
                      ? `Your plan is built on ${getCoachDisplayName(coach)}'s program. Every session in your week comes from them.`
                      : "Your coach's program shaped your training plan."}
                  </p>
                </div>
              </div>

              {coach && (coachProfile ? (
                <CoachCard coach={coachProfile} index={0}
                  label={<span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">Your coach</span>} />
              ) : (
                <Card className="border-white/10 bg-card/70 p-6">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your coach</p>
                  <h3 className="mt-1 text-2xl font-bold">{getCoachDisplayName(coach)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Selected for your training profile</p>
                </Card>
              ))}

              {coachMatch && (
                <Card className="overflow-hidden border-accent/30 bg-accent/5">
                  <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
                      <User className="h-5 w-5 text-accent" />
                    </div>
                    <div className="flex-1">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Why this coach</p>
                      <h4 className="mb-2 text-lg font-semibold">{coachMatch.headline}</h4>
                      <p className="text-sm leading-6 text-muted-foreground">{coachMatch.rationale}</p>
                      <div className="mt-4 space-y-2">
                        {coachMatch.evidence?.map((item) => (
                          <div key={item} className="flex gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-4 border-t border-border/60 pt-3 text-sm font-medium text-foreground">{coachMatch.training_impact}</p>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-2 text-center text-xs">
                      <div className="rounded-xl border border-border/70 bg-background/40 px-4 py-3">
                        <p className="text-lg font-bold text-foreground">
                          {data.mainEvents.length ||
                            (coachProfile ? new Set([...coachProfile.covered_events, ...coachProfile.supported_events]).size : "—")}
                        </p>
                        <p className="text-muted-foreground">events</p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/40 px-4 py-3">
                        <p className="text-lg font-bold text-foreground">{coachProfile?.your_week?.requested ?? data.swimSessionsPerWeek}</p>
                        <p className="text-muted-foreground">swims / week</p>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {paid === true && (
                <div className="space-y-5 pt-4 text-center">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-accent">Your coaching plan</p>
                    <h3 className="text-2xl font-bold">Your plan is active</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Your updated program is waiting in your dashboard.</p>
                  </div>
                  <Button onClick={openDashboard} size="lg" className="h-14 w-full rounded-full bg-accent text-lg text-accent-foreground shadow-[0_12px_32px_rgba(87,229,234,0.3)] hover:bg-accent/90">
                    Open my dashboard<ChevronRight className="ml-2 h-5 w-5" />
                  </Button>
                </div>
              )}

              {paid === false && (
                <div className="space-y-5 pt-4 text-center">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-accent">Your coaching plan</p>
                    <h3 className="text-2xl font-bold">Activate your personalized program</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Your plan is generated. Start your monthly plan to unlock the dashboard, where you&apos;ll generate your first week of workouts.</p>
                  </div>
                  <Button onClick={continueToPayment} size="lg" className="h-14 w-full rounded-full bg-accent text-lg text-accent-foreground shadow-[0_12px_32px_rgba(87,229,234,0.3)] hover:bg-accent/90">
                    Unlock my program<ChevronRight className="ml-2 h-5 w-5" />
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}
      </main>
    </div>
  )
}
