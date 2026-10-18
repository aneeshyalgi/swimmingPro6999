"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Star } from "lucide-react"
import { SURVEY_STEPS, resumeAt } from "@/components/survey/survey-flow"
import { openSurvey, readProgress } from "@/lib/survey"
import { cn } from "@/lib/utils"

/**
 * Whether the dashboard invites the athlete to the survey at /survey, and how far they got if they started it. Loaded
 * once the dashboard knows the athlete (`ready`). An athlete who answered this round gets no invitation, and neither does
 * anyone when the survey can't load (say its table doesn't exist yet).
 */
export function useSurvey(ready: boolean) {
  const [invite, setInvite] = useState<{ question: number; started: boolean } | null>(null)

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    openSurvey(controller.signal)
      .then((access) => {
        if ("blocked" in access || !access.state.available || access.state.response) return
        const saved = readProgress(access.state.version, access.account)
        const step = saved ? resumeAt(saved) : 0
        setInvite({ question: step + 1, started: step > 0 || (saved?.answers.rating ?? null) !== null })
      })
      .catch(() => { /* the survey is optional: the dashboard works without it */ })
    return () => controller.abort()
  }, [ready])

  return invite
}
export type SurveyInvite = ReturnType<typeof useSurvey>

/**
 * The link to the survey: a "Rate SwimGPT" pill in the top bar, or (`variant="dashboard"`) a row on the Dashboard tab
 * for smaller screens, which grows into place so the page below it glides down rather than jumping, and shows how far
 * the athlete got along its bottom edge.
 */
export function SurveyLink({ invite, variant = "bar", className }: { invite: SurveyInvite; variant?: "bar" | "dashboard"; className?: string }) {
  if (!invite) return null
  const { question, started } = invite
  const label = started ? `Rate SwimGPT: carry on from question ${question} of ${SURVEY_STEPS}` : "Rate SwimGPT in a 2-minute survey"
  const star = <Star className="h-4 w-4 shrink-0 fill-amber-300 text-amber-300 transition-transform duration-500 group-hover:rotate-[72deg] group-hover:scale-110" />
  if (variant === "dashboard") {
    return (
      <div className={cn("sv-grow grid", className)}>
        <div>
          <Link href="/survey" aria-label={label}
            className="group relative mb-6 flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-amber-200/25 bg-[linear-gradient(110deg,rgba(252,211,77,0.12),rgba(12,20,28,0.92)_55%,rgba(87,229,234,0.08))] px-4 py-3 text-left transition-colors hover:border-amber-200/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-200/70">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-300/15">{star}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">Rate SwimGPT</span>
              <span className="block truncate text-xs text-slate-400">
                {started ? `Carry on from question ${question} of ${SURVEY_STEPS}` : "2 minutes · help shape what we build next"}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-amber-200 transition-transform duration-300 group-hover:translate-x-1" />
            {started && (
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-white/[0.06]">
                <span className="block h-full bg-gradient-to-r from-amber-300 to-amber-200" style={{ width: `${(question / SURVEY_STEPS) * 100}%` }} />
              </span>
            )}
          </Link>
        </div>
      </div>
    )
  }
  return (
    <Link href="/survey" aria-label={label} title={label}
      className={cn("group flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-amber-200/30 bg-amber-300/[0.08] px-3.5 text-sm font-medium text-amber-50 transition-colors hover:border-amber-200/50 hover:bg-amber-300/[0.15]", className)}>
      {star}
      Rate SwimGPT
      {started && <span className="rounded-full bg-amber-300/15 px-1.5 text-[11px] tabular-nums text-amber-200">{question}/{SURVEY_STEPS}</span>}
    </Link>
  )
}
