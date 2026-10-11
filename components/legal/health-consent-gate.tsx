"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { Check, HeartPulse, Loader2, ShieldCheck } from "lucide-react"
import { Skeleton } from "@/components/training-ui"
import { agreeToHealthUse, loadConsents, withdrawHealthConsent, type Consents } from "@/lib/consents"
import { cn } from "@/lib/utils"

// One request per page load, shared by Mind and Nutrition and updated when either changes.
let shared: Promise<Consents> | null = null
const consents = () => (shared ??= loadConsents().catch((error) => { shared = null; throw error }))

const COPY = {
  mind: {
    what: "Mind asks how you feel, how you sleep and handle stress, and lets you check in on your mood.",
    use: "Used only to pick your mental skills and race routine",
  },
  nutrition: {
    what: "Nutrition asks about foods you avoid, like nuts, gluten or dairy, which can say something about your health.",
    use: "Used only to build your fuel plan",
  },
}

/**
 * Mind and Nutrition handle health information (GDPR Art. 9), so an athlete who joined under the current terms agrees
 * once before using them, and can withdraw any time below the panel. Athletes who joined before see the panel as
 * always: the API reports nothing required for them, and if it can't be reached the panel shows as before too.
 */
export function HealthConsentGate({ feature, children }: { feature: "mind" | "nutrition"; children: ReactNode }) {
  const [state, setState] = useState<Consents | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let live = true
    consents().then((result) => { if (live) setState(result) }).catch(() => { if (live) setUnavailable(true) })
    return () => { live = false }
  }, [])

  const change = async (action: () => Promise<Consents>) => {
    setBusy(true)
    setError("")
    try {
      const result = await action()
      shared = Promise.resolve(result)
      setState(result)
      setConfirming(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't go through. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (unavailable) return <>{children}</>
  if (!state) return <Skeleton className="h-[22rem] rounded-[28px]" />

  if (state.health_required) {
    const copy = COPY[feature]
    return (
      <section className="lg-consent relative mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(160deg,rgba(87,229,234,0.10),rgba(255,255,255,0.02)_45%,rgba(167,139,250,0.06))] p-6 sm:p-8"
        aria-labelledby="health-consent-title">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-300/10 blur-3xl" />
        <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-cyan-300/15 text-cyan-200"><HeartPulse className="h-6 w-6" /></span>
        <h2 id="health-consent-title" className="relative mt-5 text-2xl font-bold tracking-tight text-white">One quick thing before we start</h2>
        <p className="relative mt-2 text-[15px] leading-7 text-slate-300">
          {copy.what} That&apos;s health information, so we only use it with your OK.
        </p>
        <ul className="relative mt-5 space-y-2.5 text-sm text-slate-200">
          {[copy.use, "Never sold, never used for ads", "Change your mind any time, and we delete it"].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Check className="h-3 w-3" strokeWidth={3} /></span>{item}
            </li>
          ))}
        </ul>
        {state.parental && (
          <p className="relative mt-5 flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />Your parent or guardian agreed to this when you joined.
          </p>
        )}
        {error && <p role="alert" className="relative mt-4 text-sm text-rose-300">{error}</p>}
        <div className="relative mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={() => change(agreeToHealthUse)} disabled={busy}
            className="au-submit relative flex h-12 shrink-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-2xl px-6 text-sm font-semibold text-slate-950 transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-progress">
            <span aria-hidden className="au-submit-sheen" />
            <span className="relative flex items-center gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}I agree, let&apos;s go</span>
          </button>
          <p className="text-xs leading-5 text-slate-500">
            You consent to SwimGPT using what you enter here as described in our{" "}
            <Link href="/privacy#health" target="_blank" className="text-slate-300 underline decoration-white/20 underline-offset-2 hover:text-white">Privacy Policy</Link>.
            Everything else in SwimGPT works without it.
          </p>
        </div>
      </section>
    )
  }

  const given = state.health?.given_at
  return (
    <>
      {children}
      {given && (
        <div className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-slate-500">
          {confirming ? (
            <div className="lg-consent w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left">
              <p className="font-semibold text-white">Withdraw your consent?</p>
              <p className="mt-1 leading-5 text-slate-400">We&apos;ll stop using your health information and delete your Mind and Nutrition answers, check-ins and water log. You can agree again later.</p>
              {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => change(withdrawHealthConsent)} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3.5 py-1.5 font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-progress">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Withdraw and delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                  className="rounded-full border border-white/10 px-3.5 py-1.5 font-semibold text-slate-300 transition-colors hover:text-white">Keep it</button>
              </div>
            </div>
          ) : (
            <p className={cn("flex flex-wrap items-center justify-center gap-x-1.5")}>
              <ShieldCheck className="h-3.5 w-3.5 text-slate-600" />
              You agreed to us using your health information on {new Date(given).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
              <button type="button" onClick={() => setConfirming(true)} className="text-slate-400 underline decoration-white/20 underline-offset-2 hover:text-white">Withdraw consent</button>
            </p>
          )}
        </div>
      )}
    </>
  )
}
