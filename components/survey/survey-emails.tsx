"use client"

import { useState } from "react"
import { AlertTriangle, Check, LoaderCircle } from "lucide-react"
import { SwitchRow } from "@/components/survey/survey-inputs"
import { setSurveyEmails, type SurveyState } from "@/lib/survey"

/**
 * Permission to email the athlete now and then to ask for their feedback (backend/app/survey.py), worded the same
 * wherever it's asked: this is what an athlete who turns it on agrees to.
 */
export const EMAILS_QUESTION = {
  title: "Email me when there's a new survey",
  detail: "Now and then, to ask for your feedback. You can turn this off at any time.",
}

/**
 * After answering: the same switch, saved as soon as it's turned on or off, so giving and withdrawing the permission
 * are equally easy. While it saves, the switch waits; if saving fails, it goes back and says why.
 */
export function SurveyEmails({ value, onSaved }: { value: boolean; onSaved: (state: SurveyState) => void }) {
  const [on, setOn] = useState(value)
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  const change = (next: boolean) => {
    if (status === "saving") return
    setOn(next)
    setStatus("saving")
    setError(null)
    setSurveyEmails(next)
      .then((saved) => {
        setStatus("saved")
        onSaved(saved)
      })
      .catch((failure: unknown) => {
        setOn(!next)
        setStatus("idle")
        setError(failure instanceof Error ? failure.message : "Your choice couldn't be saved just now. Please try again.")
      })
  }

  return (
    <div className="text-left">
      <SwitchRow {...EMAILS_QUESTION} checked={on} onChange={change} />
      <p aria-live="polite" className="mt-2.5 flex min-h-5 items-center gap-1.5 px-1 text-xs text-slate-400">
        {status === "saving" ? (
          <>
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            Saving…
          </>
        ) : status === "saved" ? (
          <>
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
            {on ? "Saved. We'll email you when there's a new survey." : "Saved. We won't email you about new surveys."}
          </>
        ) : null}
      </p>
      {error && (
        <p role="alert" className="mt-1 flex items-start gap-2 px-1 text-xs leading-5 text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
          {error}
        </p>
      )}
    </div>
  )
}
