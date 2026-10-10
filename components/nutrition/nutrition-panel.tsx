"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Banner, Skeleton } from "@/components/training-ui"
import { FuelBuilding, FuelIntro, FuelQuiz, draftFrom } from "@/components/nutrition/fuel-quiz"
import { FuelDashboard } from "@/components/nutrition/fuel-dashboard"
import { localDay } from "@/lib/api"
import { loadNutrition, logWater, saveNutrition, type NutritionAnswers, type NutritionData } from "@/lib/nutrition"

type View = "intro" | "quiz" | "building" | "plan"
const WATER_SAVE_MS = 500

/** Dashboard → Nutrition. A first visit asks the questions; after that it shows the athlete's fuel plan. */
export function NutritionPanel({ firstName, trainingToday }: { firstName: string; trainingToday: boolean }) {
  const [data, setData] = useState<NutritionData | null>(null)
  const [view, setView] = useState<View>("intro")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The answers being saved, and the saved result once the server has it.
  const [submitted, setSubmitted] = useState<NutritionAnswers | null>(null)
  const [saved, setSaved] = useState<NutritionData | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [water, setWater] = useState({ date: localDay(), ml: 0 })
  const [waterError, setWaterError] = useState<string | null>(null)
  // Bumped when a new plan arrives, so the dashboard replays its entrance.
  const [reveal, setReveal] = useState(0)
  const waterNow = useRef(water)
  const waterTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    setLoadError(null)
    loadNutrition(controller.signal)
      .then((result) => {
        setData(result)
        setWater(result.water)
        waterNow.current = result.water
        setView(result.answers ? "plan" : "intro")
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : "Your nutrition plan could not be loaded.")
      })
    return () => controller.abort()
  }, [attempt])

  const submit = (answers: NutritionAnswers) => {
    setSubmitted(answers)
    setSaved(null)
    setSaveError(null)
    setView("building")
    saveNutrition(answers)
      .then(setSaved)
      .catch((failure: unknown) => {
        setSaveError(failure instanceof Error ? failure.message : "Your answers could not be saved. Please try again.")
        setView("quiz")
      })
  }

  // Each tap shows straight away; the total is saved once the taps pause. A new day starts from an empty bottle.
  const changeWater = (delta: number) => {
    const today = localDay()
    const current = waterNow.current
    const next = { date: today, ml: Math.min(10000, Math.max(0, (current.date === today ? current.ml : 0) + delta)) }
    waterNow.current = next
    setWater(next)
    window.clearTimeout(waterTimer.current)
    waterTimer.current = window.setTimeout(() => {
      logWater(next.date, next.ml)
        .then(() => setWaterError(null))
        .catch(() => setWaterError("That glass isn't saved yet. Check your connection, the next one will try again."))
    }, WATER_SAVE_MS)
  }

  if (loadError) {
    return (
      <Banner tone="error" action={
        <Button size="sm" variant="outline" onClick={() => setAttempt((count) => count + 1)} className="rounded-full border-rose-300/30 bg-transparent">
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      }>
        {loadError}
      </Banner>
    )
  }

  if (!data) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading your nutrition plan">
        <Skeleton className="h-[22rem] rounded-[28px]" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-56 rounded-[22px]" delay={index * 90} />)}
        </div>
      </div>
    )
  }

  if (view === "intro") return <FuelIntro firstName={firstName} onStart={() => setView("quiz")} />

  if (view === "quiz") {
    const editing = data.answers !== null
    return (
      <FuelQuiz
        initial={draftFrom(submitted ?? data.answers, data.defaults)}
        startAt={saveError ? 5 : 0}
        editing={editing}
        error={saveError}
        onBack={() => { setSaveError(null); setSubmitted(null); setView(editing ? "plan" : "intro") }}
        onSubmit={submit}
      />
    )
  }

  if (view === "building") {
    return (
      <FuelBuilding firstName={firstName} done={saved !== null} onFinished={() => {
        if (!saved) return
        setData(saved)
        setSubmitted(null)
        setReveal((count) => count + 1)
        setView("plan")
      }} />
    )
  }

  if (!data.plan || !data.answers) return <FuelIntro firstName={firstName} onStart={() => setView("quiz")} />

  return (
    <FuelDashboard
      key={reveal}
      plan={data.plan}
      answers={data.answers}
      trainingToday={trainingToday}
      waterMl={water.date === localDay() ? water.ml : 0}
      waterError={waterError}
      onWater={changeWater}
      onEdit={() => setView("quiz")}
    />
  )
}
