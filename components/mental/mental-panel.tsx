"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Banner, Skeleton } from "@/components/training-ui"
import { MindBuilding, MindIntro, MindQuiz, draftFrom } from "@/components/mental/mind-quiz"
import { MindDashboard } from "@/components/mental/mind-dashboard"
import { checkIn, loadMental, saveMental, type MentalData, type MindAnswers } from "@/lib/mental"

type View = "intro" | "quiz" | "building" | "plan"

/** Dashboard → Mental Performance. A first visit asks the questions; after that it shows the athlete's plan and check-in. */
export function MentalPanel({ firstName }: { firstName: string }) {
  const [data, setData] = useState<MentalData | null>(null)
  const [view, setView] = useState<View>("intro")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The answers being saved, and the saved result once the server has it.
  const [submitted, setSubmitted] = useState<MindAnswers | null>(null)
  const [saved, setSaved] = useState<MentalData | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkInError, setCheckInError] = useState<string | null>(null)
  // Bumped when a new plan arrives, so the dashboard replays its entrance.
  const [reveal, setReveal] = useState(0)
  const latest = useRef(data)
  latest.current = data

  useEffect(() => {
    const controller = new AbortController()
    setLoadError(null)
    loadMental(controller.signal)
      .then((result) => {
        setData(result)
        setView(result.answers ? "plan" : "intro")
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : "Your mental performance plan could not be loaded.")
      })
    return () => controller.abort()
  }, [attempt])

  const submit = (answers: MindAnswers) => {
    setSubmitted(answers)
    setSaved(null)
    setSaveError(null)
    setView("building")
    saveMental(answers)
      .then(setSaved)
      .catch((failure: unknown) => {
        setSaveError(failure instanceof Error ? failure.message : "Your answers could not be saved. Please try again.")
        setView("quiz")
      })
  }

  // Shows the mood straight away; if it can't be saved, the week goes back to how it was.
  const recordMood = (mood: number) => {
    const before = latest.current
    if (!before) return
    setCheckInError(null)
    setChecking(true)
    setData({ ...before, week: before.week.map((day, index) => (index === before.week.length - 1 ? { ...day, mood } : day)) })
    checkIn(mood)
      .then((result) => setData((current) => (current ? { ...current, week: result.week, support: result.support } : current)))
      .catch((failure: unknown) => {
        setData(before)
        setCheckInError(failure instanceof Error ? failure.message : "Your check-in wasn't saved. Please try again.")
      })
      .finally(() => setChecking(false))
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
      <div className="space-y-6" aria-busy="true" aria-label="Loading your mental performance plan">
        <Skeleton className="h-[22rem] rounded-[28px]" />
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1].map((index) => <Skeleton key={index} className="h-80 rounded-[22px]" delay={index * 90} />)}
        </div>
      </div>
    )
  }

  if (view === "intro") return <MindIntro firstName={firstName} onStart={() => setView("quiz")} />

  if (view === "quiz") {
    const editing = data.answers !== null
    return (
      <MindQuiz
        initial={draftFrom(submitted ?? data.answers)}
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
      <MindBuilding firstName={firstName} done={saved !== null} onFinished={() => {
        if (!saved) return
        setData(saved)
        setSubmitted(null)
        setReveal((count) => count + 1)
        setView("plan")
      }} />
    )
  }

  if (!data.plan || !data.answers) return <MindIntro firstName={firstName} onStart={() => setView("quiz")} />

  return (
    <MindDashboard
      key={reveal}
      plan={data.plan}
      answers={data.answers}
      week={data.week}
      support={data.support}
      saving={checking}
      checkInError={checkInError}
      onCheckIn={recordMood}
      onEdit={() => setView("quiz")}
    />
  )
}
