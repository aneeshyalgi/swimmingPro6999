"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Star } from "lucide-react"
import { SurveyFlow, resumeAt } from "@/components/survey/survey-flow"
import { BackToDashboard, SurveyNotice, SurveyScreen } from "@/components/survey/survey-scene"
import {
  clearProgress, emptyDraft, openSurvey, readProgress, saveProgress, sendSurvey,
  type SurveyAnswers, type SurveyBlock, type SurveyProgress, type SurveyState,
} from "@/lib/survey"

/** Where someone who can't take the survey goes instead: to sign in (and come back here), to pay, or to finish setup. */
const ELSEWHERE: Record<SurveyBlock, string> = { signed_out: "/auth?next=/survey", unpaid: "/subscribe", no_profile: "/onboarding" }

/**
 * /survey: athletes rate SwimGPT and answer a few questions about it. Only for signed-in athletes who pay for SwimGPT
 * (the API checks the same): anyone else is sent to sign in, to pay or to finish setting up. An athlete who already
 * answered this round is told so, and while the survey isn't open (its table doesn't exist yet) the page says that.
 */
export default function SurveyPage() {
  const router = useRouter()
  const [survey, setSurvey] = useState<{ state: SurveyState; account: string; firstName: string } | null>(null)
  const [progress, setProgress] = useState<SurveyProgress>(() => ({ step: 0, answers: emptyDraft() }))
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The answers were just sent here: the thank-you stays, rather than the "already answered" page.
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    openSurvey(controller.signal)
      .then((access) => {
        if ("blocked" in access) {
          router.replace(ELSEWHERE[access.blocked])
          return
        }
        const saved = readProgress(access.state.version, access.account)
        if (saved) setProgress({ step: resumeAt(saved), answers: saved.answers })
        setSurvey(access)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailed(error instanceof Error ? error.message : "The survey couldn't be loaded just now. Please try again.")
      })
    return () => controller.abort()
  }, [router, attempt])

  if (failed) {
    return (
      <SurveyScreen tone="#fb7185">
        <SurveyNotice icon={AlertTriangle} tone="text-rose-300" title="The survey didn't load" body={failed} action={<>
          <button type="button" onClick={() => { setFailed(null); setAttempt((count) => count + 1) }} className="sv-cta h-12 px-7 text-sm">
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <BackToDashboard />
        </>} />
      </SurveyScreen>
    )
  }

  if (!survey) {
    return (
      <SurveyScreen tone="#57e5ea">
        <SurveyNotice icon={LoaderCircle} tone="text-cyan-200" busy title="Opening the survey…" />
      </SurveyScreen>
    )
  }

  const { state, account, firstName } = survey
  if (!state.available) {
    return (
      <SurveyScreen tone="#fcd34d">
        <SurveyNotice icon={Star} tone="fill-amber-300 text-amber-300" title="The survey isn't open right now"
          body="Please check back soon. Thanks for wanting to help us improve SwimGPT!" action={<BackToDashboard primary />} />
      </SurveyScreen>
    )
  }
  if (state.response && !sent) {
    const when = new Date(state.response.submitted_at).toLocaleDateString(undefined, { day: "numeric", month: "long" })
    return (
      <SurveyScreen tone="#34d399">
        <SurveyNotice icon={CheckCircle2} tone="text-emerald-300" title={`You've already answered${firstName ? `, ${firstName}` : ""}. Thank you!`}
          body={`You rated SwimGPT ${state.response.rating} out of 5 on ${when}. Your answers are with the team building SwimGPT.`}
          action={<BackToDashboard primary />} />
      </SurveyScreen>
    )
  }

  const changeProgress = (next: SurveyProgress) => {
    setProgress(next)
    saveProgress(state.version, account, next)
  }
  const send = async (answers: SurveyAnswers) => {
    const saved = await sendSurvey(answers)
    clearProgress(state.version, account)
    setSent(true)
    setSurvey({ ...survey, state: saved })
  }
  return <SurveyFlow firstName={firstName} progress={progress} onProgress={changeProgress} onSend={send} />
}
