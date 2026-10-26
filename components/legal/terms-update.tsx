"use client"

import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { CalendarClock, Check, Loader2, X } from "lucide-react"
import { answerTerms, type TermsState } from "@/lib/consents"
import { LEGAL_VERSION } from "@/lib/legal"
import { tokensChanged } from "@/lib/token-events"
import { cn } from "@/lib/utils"

const link = "font-medium text-slate-200 underline decoration-white/25 underline-offset-2 transition-colors hover:text-white"

const ending = (iso: string | null) =>
  iso ? `on ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : "at the end of your billing period"

/** The box agreeing to the updated Terms (they bring tokens in), linking them and the Privacy Policy. Tries to go on
 *  without it (`attempt`) shake it. */
export function TermsCheckbox({ checked, onChange, attempt = 0, disabled = false, className }: {
  checked: boolean; onChange: (checked: boolean) => void; attempt?: number; disabled?: boolean; className?: string
}) {
  const id = useId()
  const box = useRef<HTMLInputElement>(null)
  const missing = attempt > 0 && !checked
  useEffect(() => { if (attempt > 0) box.current?.focus() }, [attempt])
  return (
    <div className={className}>
      <label className={cn("flex items-start gap-3 text-left", disabled ? "cursor-default" : "cursor-pointer")}>
        <input ref={box} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled}
          aria-invalid={missing || undefined} aria-describedby={missing ? `${id}-missing` : undefined} className="peer sr-only" />
        {/* Keyed by the try, so each one shakes it again */}
        <span key={attempt} aria-hidden className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-white/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0a1118]",
          checked ? "border-transparent bg-accent text-slate-950" : missing ? "au-shake border-rose-300/80 bg-rose-400/10" : "border-white/25 bg-white/[0.04]")}>
          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
        </span>
        <span className="text-sm leading-6 text-slate-300">
          I agree to the updated <Link href="/terms#tokens" target="_blank" className={link}>Terms of Service</Link>, and
          I&apos;ve read the updated <Link href="/privacy#tokens" target="_blank" className={link}>Privacy Policy</Link>.
        </span>
      </label>
      {missing && <p id={`${id}-missing`} role="alert" className="mt-2 pl-8 text-xs font-medium text-rose-200">Tick the box to continue.</p>}
    </div>
  )
}

/**
 * An account made before tokens is asked, over the dashboard, to agree to the Terms that brought them in (GET
 * /api/consents/terms: required; backend/app/consents.py). Agreeing starts its tokens. Not agreeing (confirmed once) ends
 * its subscription at the end of the billing period, with nothing changed until then. `declined`: asked again after a
 * "don't agree", from the dashboard's notice, so it can be closed.
 */
export function TermsUpdate({ declined, onAnswered, onClose }: { declined: boolean; onAnswered: (state: TermsState) => void; onClose?: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState(false)
  useEffect(() => setMounted(true), [])
  // The dashboard behind doesn't scroll while this is open.
  useEffect(() => {
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = "hidden"
    return () => { root.style.overflow = overflow }
  }, [])

  const answer = async (agree: boolean) => {
    if (agree && !agreed) {
      setAttempt((count) => count + 1)
      return
    }
    setBusy(true)
    setError("")
    try {
      const state = await answerTerms(LEGAL_VERSION, agree)
      if (agree) tokensChanged()
      onAnswered(state)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your answer couldn't be saved. Please try again.")
      setBusy(false)
    }
  }

  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-end justify-center bg-[#04070a]/80 backdrop-blur-md sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="Updated Terms of Service"
        className="dash-reveal relative max-h-[100dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,24,31,0.99),rgba(7,12,17,0.99))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.7)] sm:rounded-[28px]"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
        {onClose && !busy && (
          <button type="button" onClick={onClose} aria-label="Close"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
        {confirming ? (
          <>
            <p className="pr-6 text-sm leading-6 text-slate-300">
              Your subscription will end at the end of your current billing period. Until then everything stays as it is,
              and you can still agree before that date to keep it.
            </p>
            {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
            <button type="button" onClick={() => void answer(false)} disabled={busy}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-6 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-400/15 disabled:cursor-progress">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}End my subscription
            </button>
            <button type="button" onClick={() => { setConfirming(false); setError("") }} disabled={busy}
              className="mt-2 w-full rounded-full py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white">
              Back
            </button>
          </>
        ) : (
          <>
            <TermsCheckbox checked={agreed} onChange={setAgreed} attempt={attempt} disabled={busy} className={cn(onClose && "pr-6")} />
            {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
            <button type="button" onClick={() => void answer(true)} disabled={busy}
              className="au-submit relative mt-5 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-6 text-sm font-semibold text-slate-950 transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-progress">
              <span aria-hidden className="au-submit-sheen" />
              <span className="relative flex items-center gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Agree and continue</span>
            </button>
            {!declined && (
              <button type="button" onClick={() => { setConfirming(true); setError("") }} disabled={busy}
                className="mt-2 w-full rounded-full py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white">
                Don&apos;t agree
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** After a "don't agree": when the subscription ends, and a way to agree and keep it. */
export function TermsEnding({ endsAt, onAgree }: { endsAt: string | null; onAgree: () => void }) {
  return (
    <div role="status" className="dash-reveal mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-50">
      <CalendarClock className="h-4 w-4 shrink-0 text-amber-200" />
      <span className="min-w-0 flex-1 leading-6">Your subscription ends {ending(endsAt)}, as you didn&apos;t agree to the updated Terms.</span>
      <button type="button" onClick={onAgree}
        className="rounded-full bg-amber-200 px-4 py-1.5 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-100">
        Agree and keep it
      </button>
    </div>
  )
}
