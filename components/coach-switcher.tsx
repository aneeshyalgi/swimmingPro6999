"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarRange, Check, Dumbbell, Info, Loader2, Lock, MessageSquare, Repeat, RotateCcw, Sparkles,
  Star, Waves, X,
} from "lucide-react"
import { CoachAvatar, LOOKS, coachLookKey } from "@/components/coach-avatar"
import type { CoachProfile } from "@/components/coach-card"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// GET /api/coach/options, POST /api/coach/checkout and POST /api/coach (backend/app/main.py, app/coach_switch.py).
/** What a switch to a coach costs (a one-time payment on Stripe's checkout page, more for the best match) and what is
 * left to pay of it, both in cents. */
type SwitchCost = { price: number; due: number }
type Coach = CoachProfile & { switch: SwitchCost }
type Options = {
  coaches: Coach[]
  recommended: string
  current: string | null
  currency: string
  /** A payment for a switch that never happened (the tab closed, or the plan couldn't be built): it counts towards
   * the next switch, which then only charges the rest. */
  paid_switch: { amount: number; coach: string } | null
}
type Stage = "browse" | "confirm" | "paying" | "switching" | "done" | "failed"
/** Back on the dashboard from Stripe's payment page (read from the URL Stripe returns to). */
export type SwitchReturn = { status: "paid" } | { status: "cancelled"; coach: string | null }

class RequestError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Each coach's own colour (their portrait's trim): the whole switcher takes it on as you browse. */
const toneOf = (name: string) => LOOKS[coachLookKey(name)]?.trim ?? "#57e5ea"
const firstName = (name: string) => name.replace(/^Coach\s+/i, "")
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Rebuilding the plan takes a while; the handover always plays at least this long so it never just flickers. */
const MIN_HANDOVER_MS = 2600
const STEP_MS = 3400
const BURST = Array.from({ length: 14 }, (_, index) => (index * 360) / 14)
const ORBIT = [0, 72, 144, 216, 288]

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error("Your session has expired. Sign in again to change your coach.")
  const response = await fetch(`${API_URL}${path}`, {
    ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
  })
  if (!response.ok) {
    let detail = "Something went wrong. Please try again."
    try {
      const body = await response.json()
      if (typeof body.detail === "string") detail = body.detail
    } catch { /* keep the generic message */ }
    throw new RequestError(detail, response.status)
  }
  return response.json() as Promise<T>
}

/**
 * Switching coach from the dashboard: browse every coach (best fit first, in their own colours), see why each fits,
 * pay for the switch on Stripe's checkout page, and on coming back watch the handover while the season plan is rebuilt
 * on the new coach's program. `returned` is set when the dashboard opens it on the way back from Stripe;
 * `onSwitched` refreshes the dashboard behind it once the new coach is saved.
 */
export function CoachSwitcher({ open, current, returned = null, onClose, onSwitched }: {
  open: boolean
  current: string
  returned?: SwitchReturn | null
  onClose: () => void
  onSwitched: (coach: string) => Promise<void>
}) {
  if (!open || typeof document === "undefined") return null
  return createPortal(<Switcher current={current} returned={returned} onClose={onClose} onSwitched={onSwitched} />, document.body)
}

function Switcher({ current: initial, returned, onClose, onSwitched }: {
  current: string
  returned: SwitchReturn | null
  onClose: () => void
  onSwitched: (coach: string) => Promise<void>
}) {
  const [options, setOptions] = useState<Options | null>(null)
  const [loadError, setLoadError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [focus, setFocus] = useState(initial)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [stage, setStage] = useState<Stage>("browse")
  const [step, setStep] = useState(0)
  const [error, setError] = useState("")
  const [payError, setPayError] = useState("")
  const [leaving, setLeaving] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef(stage)
  stageRef.current = stage
  const arrived = useRef(false)

  const current = options?.current ?? initial
  const coaches = options?.coaches ?? []
  const index = Math.max(0, coaches.findIndex((coach) => coach.name === focus))
  const coach = coaches[index]
  const format = (cents: number) => money(cents, options?.currency ?? "usd")
  const paidSwitch = options?.paid_switch ?? null

  const close = useCallback(() => {
    // Mid-handover the new plan is being saved, and mid-payment Stripe's page is opening: both finish first.
    if (stageRef.current === "switching" || stageRef.current === "paying") return
    setLeaving(true)
    window.setTimeout(onClose, 240)
  }, [onClose])

  useEffect(() => {
    let live = true
    setLoadError("")
    request<Options>("/api/coach/options")
      .then((result) => { if (live) setOptions(result) })
      .catch((failure: Error) => { if (live) setLoadError(failure.message) })
    return () => { live = false }
  }, [attempt])

  // Opening: back from paying, the paid switch goes straight into the handover; back from a cancelled payment, the
  // coach it was for is shown again; a payment for a switch that never happened shows the coach it was for.
  useEffect(() => {
    if (!options || arrived.current) return
    arrived.current = true
    const switchable = (name: string | null | undefined) => options.coaches.find((item) => item.name === name && item.name !== options.current)
    const paidFor = switchable(options.paid_switch?.coach)
    if (returned?.status === "paid" && paidFor?.switch.due === 0) void switchCoach(paidFor.name)
    else if (paidFor) setFocus(paidFor.name)
    else if (returned?.status === "cancelled") {
      const cancelledFor = switchable(returned.coach)
      if (cancelledFor) setFocus(cancelledFor.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  // Coming back from Stripe's page with the browser's Back button restores this page as it was left: mid-payment.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => { if (event.persisted && stageRef.current === "paying") setStage("confirm") }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [])

  const choose = useCallback((name: string) => {
    if (!options || stageRef.current !== "browse") return
    const next = options.coaches.findIndex((item) => item.name === name)
    setDirection(next >= options.coaches.findIndex((item) => item.name === focus) ? 1 : -1)
    setFocus(name)
  }, [options, focus])

  useEffect(() => {
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = overflow }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (stageRef.current === "confirm") setStage("browse")
        else close()
      }
      if (!coaches.length || stageRef.current !== "browse" || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
      event.preventDefault()
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + coaches.length) % coaches.length
      setDirection(event.key === "ArrowRight" ? 1 : -1)
      setFocus(coaches[next].name)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close, coaches, index])

  // The handover's steps advance while the plan is rebuilt, holding on the long one until it's done.
  useEffect(() => {
    if (stage !== "switching") return
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, 2)), STEP_MS)
    return () => window.clearInterval(timer)
  }, [stage])

  /** Spends the paid switch on `name`: the plan is rebuilt on their program, then they're the athlete's coach. */
  const switchCoach = async (name: string) => {
    setFocus(name)
    setStage("switching")
    setStep(0)
    setError("")
    setPayError("")
    try {
      const [result] = await Promise.all([
        request<{ coach: string }>("/api/coach", { method: "POST", body: JSON.stringify({ coach: name }) }),
        wait(MIN_HANDOVER_MS),
      ])
      setStep(3)
      // The coach is saved; refreshing the dashboard behind is best effort (a reload shows it either way).
      await onSwitched(result.coach).catch((failure) => console.error("Dashboard refresh after switching coach failed:", failure))
      await wait(450)
      setStage("done")
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 402) {
        // Not paid for after all (say the payment was just used in another tab): what's left to pay is fetched again,
        // and paid first.
        setAttempt((count) => count + 1)
        setPayError(failure.message)
        setStage("confirm")
        return
      }
      setError(failure instanceof Error ? failure.message : "Your coach couldn't be switched. Please try again.")
      setStage("failed")
    }
  }

  /** Pays for the switch on Stripe's page, which brings the athlete back here to finish it; nothing to pay switches straight away. */
  const pay = async () => {
    if (!coach) return
    if (coach.switch.due === 0) { void switchCoach(coach.name); return }
    setStage("paying")
    setPayError("")
    try {
      const result = await request<{ checkout_url?: string; paid?: boolean }>("/api/coach/checkout", {
        method: "POST", body: JSON.stringify({ coach: coach.name }),
      })
      if (result.checkout_url) {
        window.location.assign(result.checkout_url)
        return
      }
      void switchCoach(coach.name) // covered by a payment for a switch that never happened
    } catch (failure) {
      setPayError(failure instanceof Error ? failure.message : "Secure checkout couldn't be opened. Please try again.")
      setStage("confirm")
    }
  }

  const tone = toneOf(stage === "browse" || stage === "confirm" || stage === "paying" ? focus : coach?.name ?? focus)
  const first = coach ? firstName(coach.name) : ""
  const steps = coach ? [
    `Sharing your profile with ${first}`,
    `Reading ${first}'s program`,
    "Rebuilding your season plan",
    "Setting up chat and voice calls",
  ] : []

  return (
    <div className={cn("csw-root fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6", leaving && "csw-leave")}
      style={{ "--csw-tone": tone } as CSSProperties}>
      <button type="button" aria-label="Close coach switcher" tabIndex={-1} onClick={close} className="csw-backdrop absolute inset-0 cursor-default" />
      <div aria-hidden className="csw-aurora pointer-events-none absolute inset-0 overflow-hidden"><i /><i /><i /></div>

      <section role="dialog" aria-modal="true" aria-labelledby="csw-title"
        className="csw-panel relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-clip rounded-[32px] border border-white/10 sm:max-h-[calc(100dvh-3rem)]">
        <span aria-hidden className="csw-panel-edge pointer-events-none absolute inset-x-0 top-0 h-px" />

        {/* Header */}
        <header className="relative flex items-start justify-between gap-4 px-5 pb-2 pt-5 sm:px-8 sm:pt-7">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-400">
              <Repeat className="h-3.5 w-3.5" style={{ color: "var(--csw-tone)" }} />Switch coach
            </p>
            <h2 id="csw-title" className="mt-1.5 text-xl font-bold text-white sm:text-2xl">
              {stage === "done" ? "Meet your new coach" : stage === "switching" ? "Handing you over" : "Who should coach you?"}
            </h2>
          </div>
          {/* No way out mid-handover: the new plan is being saved, and it finishes by itself. */}
          {stage !== "switching" && (
            <button ref={closeRef} type="button" onClick={close} aria-label="Close"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-all duration-300 hover:rotate-90 hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </header>

        {loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-300" />
            <p className="max-w-sm text-sm text-slate-300">{loadError}</p>
            <button type="button" onClick={() => setAttempt((count) => count + 1)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-accent">
              <RotateCcw className="h-4 w-4" />Try again
            </button>
          </div>
        ) : !coach ? (
          <Skeleton />
        ) : stage === "switching" ? (
          <Handover from={current} to={coach.name} steps={steps} step={step} />
        ) : stage === "done" ? (
          <Done coach={coach} onClose={close} />
        ) : stage === "failed" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-14 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-rose-300/30 bg-rose-500/10"><AlertTriangle className="h-7 w-7 text-rose-300" /></span>
            <div>
              <p className="text-lg font-semibold text-white">{current} is still your coach</p>
              <p role="alert" className="mt-1 max-w-md text-sm leading-6 text-slate-400">{error}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => setStage("browse")} className="rounded-full border border-white/12 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06]">Back to coaches</button>
              <button type="button" onClick={() => void switchCoach(coach.name)} className="csw-cta inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold">
                <RotateCcw className="relative h-4 w-4" /><span className="relative">Try again</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {paidSwitch ? (
              <p role="status" className="csw-notice mx-5 mt-1 flex items-start gap-2.5 rounded-2xl px-4 py-2.5 text-sm leading-5 text-slate-200 sm:mx-8">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--csw-tone)" }} />
                You&apos;ve already paid {format(paidSwitch.amount)} for a switch that hasn&apos;t happened yet. It counts towards the
                coach you choose, so you won&apos;t pay twice.
              </p>
            ) : returned?.status === "cancelled" && (
              <p role="status" className="csw-notice mx-5 mt-1 flex items-start gap-2.5 rounded-2xl px-4 py-2.5 text-sm leading-5 text-slate-200 sm:mx-8">
                <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--csw-tone)" }} />
                Checkout cancelled. No payment was taken, and {firstName(current)} is still your coach.
              </p>
            )}

            {/* Stage */}
            <div className={cn("relative grid min-h-0 flex-1 items-center gap-6 overflow-y-auto px-5 pb-6 pt-2 sm:px-8 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-12 lg:py-6",
              stage !== "browse" && "pointer-events-none")}>
              <Portrait key={`portrait-${coach.key}`} coach={coach} current={coach.name === current} />
              <Details key={`details-${coach.key}`} coach={coach} current={coach.name === current} direction={direction} />
            </div>

            {/* Every coach */}
            <div className="relative border-t border-white/[0.07] px-2 py-3 sm:px-6">
              <div role="tablist" aria-label="Coaches" className="relative grid" style={{ gridTemplateColumns: `repeat(${coaches.length}, minmax(0, 1fr))` }}>
                <span aria-hidden className="csw-indicator" style={{ width: `${100 / coaches.length}%`, transform: `translateX(${index * 100}%)` }} />
                {coaches.map((item) => {
                  const active = item.name === focus
                  return (
                    <button key={item.key} type="button" role="tab" aria-selected={active} onClick={() => choose(item.name)}
                      className="csw-tile group relative flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-white/40">
                      <span className="relative">
                        <CoachAvatar name={item.name} shape="circle"
                          className={cn("h-11 w-11 transition-transform duration-500 sm:h-12 sm:w-12", active ? "scale-110" : "group-hover:scale-105")} />
                        {item.name === current && (
                          <span title="Your coach" className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-[#0b1218] bg-emerald-400 text-slate-950">
                            <Check className="h-2.5 w-2.5" strokeWidth={4} />
                          </span>
                        )}
                        {item.recommended && (
                          <span title="Best match for you" className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-amber-300 text-slate-950 shadow-[0_0_10px_rgba(252,211,77,0.6)]">
                            <Star className="h-2.5 w-2.5" fill="currentColor" />
                          </span>
                        )}
                      </span>
                      <span className={cn("max-w-full truncate text-[11px] font-semibold transition-colors sm:text-xs", active ? "text-white" : "text-slate-400 group-hover:text-slate-200")}>
                        {firstName(item.name)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Action */}
            <footer className="relative flex flex-wrap items-center gap-3 border-t border-white/[0.07] bg-black/20 px-5 py-4 sm:px-8">
              <p className="hidden min-w-0 flex-1 text-sm text-slate-400 sm:block">
                {coach.name === current ? "This is your coach right now. Browse the others with ← and →." : `${
                  coach.switch.due === 0 ? "Already paid"
                    : coach.switch.due < coach.switch.price ? `${format(coach.switch.price)}, with ${format(coach.switch.price - coach.switch.due)} already paid`
                    : `One-time ${format(coach.switch.price)}${coach.recommended ? " for your best match" : ""}`
                }: ${first} takes over your plan, chat and calls. This week's sessions stay; ${first}'s start with your next week.`}
              </p>
              {coach.name === current ? (
                <span className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-slate-300 sm:w-auto">
                  <Check className="h-4 w-4 text-emerald-300" strokeWidth={3} />Your coach right now
                </span>
              ) : (
                <button type="button" onClick={() => { setPayError(""); setStage("confirm") }}
                  className="csw-cta group inline-flex w-full items-center justify-center gap-2 rounded-full py-3 pl-6 pr-3 text-sm font-bold sm:w-auto">
                  <Repeat className="relative h-4 w-4 transition-transform duration-500 group-hover:rotate-180" />
                  <span className="relative">Switch to {first}</span>
                  <span className="csw-price relative rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums">
                    {coach.switch.due === 0 ? "Paid" : coach.switch.due < coach.switch.price ? `+${format(coach.switch.due)}` : format(coach.switch.price)}
                  </span>
                </button>
              )}
            </footer>

            {(stage === "confirm" || stage === "paying") && (
              <Confirm from={current} to={coach.name} cost={coach.switch} bestMatch={Boolean(coach.recommended)} paidAmount={paidSwitch?.amount ?? 0}
                format={format} paying={stage === "paying"} error={payError} onCancel={() => setStage("browse")} onConfirm={() => void pay()} />
            )}
          </>
        )}
      </section>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid flex-1 items-center gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading coaches">
      <div className="csw-skeleton-orb mx-auto aspect-square w-48 rounded-full sm:w-56" />
      <div className="space-y-3">
        {["w-32", "w-72", "w-56", "w-full", "w-5/6", "w-2/3"].map((width, index) => (
          <div key={index} className={cn("h-4 animate-pulse rounded-full bg-white/[0.06]", width, index === 1 && "h-9")} style={{ animationDelay: `${index * 90}ms` }} />
        ))}
      </div>
    </div>
  )
}

function Portrait({ coach, current }: { coach: CoachProfile; current: boolean }) {
  return (
    <div className="csw-portrait-in flex flex-col items-center gap-4">
      <div className="relative aspect-square w-44 sm:w-52 lg:w-64">
        <span aria-hidden className="csw-halo" />
        <span aria-hidden className="csw-ring" />
        <span aria-hidden className="csw-ring-dash" />
        <span aria-hidden className="csw-dots">{ORBIT.map((angle) => <span key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />)}</span>
        <span className="csw-avatar absolute inset-[11%] rounded-full">
          <CoachAvatar name={coach.name} shape="circle" className="h-full w-full" />
        </span>
      </div>
      <div className="flex min-h-7 flex-wrap justify-center gap-1.5">
        {current && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
            <Check className="h-3 w-3" strokeWidth={3} />Your coach
          </span>
        )}
        {coach.recommended && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-bold text-slate-950 shadow-[0_0_18px_rgba(252,211,77,0.35)]">
            <Star className="h-3 w-3" fill="currentColor" />Best match for you
          </span>
        )}
      </div>
    </div>
  )
}

function Details({ coach, current, direction }: { coach: CoachProfile; current: boolean; direction: 1 | -1 }) {
  const first = firstName(coach.name)
  const week = coach.your_week?.order ?? []
  return (
    <div className={cn("min-w-0", direction > 0 ? "csw-in-right" : "csw-in-left")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--csw-tone)" }}>
        {current ? "Your coach" : coach.recommended ? "Best fit for your events" : "Coach"}
      </p>
      <h3 className="csw-name mt-1 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">{coach.name}</h3>
      <p className="mt-2 text-base font-medium text-slate-200 sm:text-lg">{coach.title}</p>
      {coach.inspired_by && <p className="mt-0.5 text-xs text-slate-500">Program inspired by {coach.inspired_by}</p>}
      <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">{coach.summary}</p>

      <div className="csw-stagger mt-5 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Why {first} fits you</p>
        {coach.reasons.slice(0, 3).map((reason, index) => (
          <p key={reason} style={{ "--i": index } as CSSProperties} className="flex gap-2.5 text-sm leading-6 text-slate-200">
            <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color: "var(--csw-tone)" }} />{reason}
          </p>
        ))}
      </div>

      <div className="csw-stagger mt-5 flex flex-wrap gap-1.5">
        {(coach.covered_events.length ? coach.covered_events : coach.main_events.slice(0, 4)).map((event, index) => (
          <span key={event} style={{ "--i": index + 3 } as CSSProperties}
            className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
              coach.covered_events.length ? "csw-chip text-white" : "border-white/10 text-slate-400")}>
            {coach.covered_events.length > 0 && <Check className="h-3 w-3" strokeWidth={3} style={{ color: "var(--csw-tone)" }} />}{event}
          </span>
        ))}
        {coach.requires_gym && (
          <span style={{ "--i": 8 } as CSSProperties} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300">
            <Dumbbell className="h-3 w-3" />Gym program
          </span>
        )}
      </div>

      {week.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Your swim week with {first}</p>
          <ol className="csw-stagger mt-2 flex flex-wrap gap-1.5">
            {week.map((session, index) => (
              <li key={`${session}-${index}`} style={{ "--i": index + 4 } as CSSProperties}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] py-1 pl-1 pr-2.5 text-xs text-slate-200">
                <span className="csw-day grid h-5 w-5 place-items-center rounded-lg text-[10px] font-bold">{index + 1}</span>{session}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function Confirm({ from, to, cost, bestMatch, paidAmount, format, paying, error, onCancel, onConfirm }: {
  from: string
  to: string
  /** What the switch costs and what is left to pay of it, after an earlier payment for a switch that never happened. */
  cost: SwitchCost
  /** `to` is the athlete's best match, whose switch costs more. */
  bestMatch: boolean
  /** That earlier payment, in cents (0 for none). */
  paidAmount: number
  format: (cents: number) => string
  /** Stripe's checkout page is opening. */
  paying: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const first = firstName(to)
  const covered = cost.due === 0
  const rest = !covered && cost.due < cost.price
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Focused without scrolling: the sheet is still sliding up from below, and scrolling to it would shift the switcher.
  useEffect(() => { confirmRef.current?.focus({ preventScroll: true }) }, [])
  const changes = [
    { icon: Sparkles, text: <>Your season plan is rebuilt on {first}&apos;s program.</> },
    { icon: MessageSquare, text: <>Chat and live voice calls are with {first}.</> },
    { icon: Waves, text: <>This week&apos;s planned swim and gym sessions stay as they are, and so does everything you&apos;ve completed.</> },
    { icon: CalendarRange, text: <>{first}&apos;s sessions start with the next week you generate.</> },
  ]
  return (
    <>
      <button type="button" aria-label="Back to coaches" onClick={onCancel} disabled={paying} className="csw-dim absolute inset-0 z-10 cursor-default" />
      <div role="alertdialog" aria-labelledby="csw-confirm-title" aria-busy={paying}
        className="csw-confirm absolute inset-x-0 bottom-0 z-20 max-h-full overflow-y-auto rounded-t-[28px] border-t border-white/10 px-5 pb-5 pt-6 sm:px-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <div className="flex items-center justify-center gap-3 sm:gap-5">
            <CoachAvatar name={from} shape="circle" className="h-14 w-14 opacity-70 grayscale-[0.4]" />
            <span aria-hidden className="csw-chevrons flex items-center"><i /><i /><i /></span>
            <span className="csw-confirm-to rounded-full"><CoachAvatar name={to} shape="circle" className="h-16 w-16" /></span>
          </div>
          <h3 id="csw-confirm-title" className="text-center text-xl font-bold text-white sm:text-2xl">Switch from {firstName(from)} to {first}?</h3>

          <div className="csw-price-card flex items-center gap-3 rounded-2xl px-4 py-3">
            <span className="csw-day grid h-10 w-10 shrink-0 place-items-center rounded-xl">
              {covered ? <BadgeCheck className="h-5 w-5" /> : <Lock className="h-[18px] w-[18px]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-white">
                {covered ? "Already paid" : rest ? "Pay the rest" : "One-time payment"}
                {bestMatch && !covered && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                    <Star className="h-2.5 w-2.5" fill="currentColor" />Best match
                  </span>
                )}
              </span>
              <span className="block text-xs leading-5 text-slate-400">
                {covered ? `Your earlier ${format(paidAmount)} payment covers this switch.`
                  : rest ? `This switch is ${format(cost.price)}, and ${format(cost.price - cost.due)} of it is already paid.`
                  : "Paid securely with Stripe. Your monthly plan stays the same."}
              </span>
            </span>
            {covered ? (
              <span className="csw-price-amount csw-receipt inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />Paid
              </span>
            ) : (
              <span className="csw-price-amount shrink-0 text-2xl font-black tabular-nums text-white">{format(cost.due)}</span>
            )}
          </div>

          <ul className="csw-stagger grid gap-2 sm:grid-cols-2">
            {changes.map(({ icon: Icon, text }, index) => (
              <li key={index} style={{ "--i": index } as CSSProperties} className="flex gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 text-sm leading-5 text-slate-200">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--csw-tone)" }} />{text}
              </li>
            ))}
          </ul>

          {error && (
            <p role="alert" className="flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm leading-5 text-rose-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />{error}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onCancel} disabled={paying}
                className="rounded-full border border-white/12 px-5 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06] disabled:opacity-50">
                Keep {firstName(from)}
              </button>
              <button ref={confirmRef} type="button" onClick={onConfirm} disabled={paying}
                className="csw-cta group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold">
                {paying ? (
                  <><Loader2 className="relative h-4 w-4 animate-spin" /><span className="relative">Opening secure checkout…</span></>
                ) : covered ? (
                  <><Repeat className="relative h-4 w-4 transition-transform duration-500 group-hover:rotate-180" /><span className="relative">Yes, switch to {first}</span></>
                ) : (
                  <>
                    <Lock className="relative h-4 w-4" /><span className="relative">Pay {format(cost.due)} and switch</span>
                    <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </div>
            {!covered && (
              <p className="text-center text-xs leading-5 text-slate-500 sm:text-right">
                You&apos;ll pay on Stripe&apos;s secure page, then come straight back here to meet {first}.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Handover({ from, to, steps, step }: { from: string; to: string; steps: string[]; step: number }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 overflow-y-auto px-6 py-10 text-center sm:py-14" aria-live="polite">
      <div className="flex w-full max-w-md items-center">
        <span className="csw-from shrink-0 rounded-full"><CoachAvatar name={from} shape="circle" className="h-16 w-16 sm:h-20 sm:w-20" /></span>
        <span aria-hidden className="csw-beam relative mx-3 h-[3px] flex-1 rounded-full">
          {[0, 1, 2, 3, 4].map((index) => <i key={index} style={{ "--i": index } as CSSProperties} />)}
        </span>
        <span className="relative shrink-0">
          <span aria-hidden className="csw-ring csw-ring-fast" />
          <span className="csw-to block rounded-full p-1.5"><CoachAvatar name={to} shape="circle" className="h-20 w-20 sm:h-24 sm:w-24" /></span>
        </span>
      </div>
      <div>
        <p className="csw-receipt mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
          <BadgeCheck className="h-3.5 w-3.5" />Payment received
        </p>
        <h3 className="text-2xl font-bold text-white">Handing you over to {firstName(to)}</h3>
        <p className="mt-1.5 text-sm text-slate-400">Rebuilding your season plan on {firstName(to)}&apos;s program. This takes about half a minute.</p>
        <p className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs text-slate-300">
          <CalendarRange className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--csw-tone)" }} />
          This week&apos;s sessions won&apos;t change. {firstName(to)}&apos;s start with your next week.
        </p>
      </div>
      <div className="csw-progress relative h-1 w-full max-w-sm overflow-hidden rounded-full bg-white/[0.06]"><i /></div>
      <ol className="w-full max-w-sm space-y-2 text-left">
        {steps.map((label, index) => {
          const done = index < step, active = index === step
          return (
            <li key={label} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-500",
              active ? "bg-white/[0.05] text-white" : done ? "text-slate-300" : "text-slate-500")}>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full transition-all duration-500",
                done ? "csw-step-done text-slate-950" : active ? "border border-white/15" : "border border-white/10")}>
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--csw-tone)" }} /> : <span className="h-1.5 w-1.5 rounded-full bg-white/20" />}
              </span>
              {label}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Done({ coach, onClose }: { coach: CoachProfile; onClose: () => void }) {
  const first = firstName(coach.name)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10 text-center sm:py-14">
      <div className="relative grid h-44 w-44 place-items-center">
        <span aria-hidden className="csw-ripple" />
        <span aria-hidden className="csw-ripple [animation-delay:0.35s]" />
        <span aria-hidden className="csw-burst">{BURST.map((angle) => <i key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />)}</span>
        <span aria-hidden className="csw-halo" />
        <span className="csw-done-avatar relative block h-36 w-36 rounded-full">
          <CoachAvatar name={coach.name} shape="circle" className="h-full w-full" />
          <span className="csw-check absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full border-4 border-[#0b1218] bg-emerald-400 text-slate-950">
            <Check className="h-4 w-4" strokeWidth={4} />
          </span>
        </span>
      </div>
      <div className="csw-stagger max-w-lg">
        <p style={{ "--i": 0 } as CSSProperties} className="text-[11px] font-semibold uppercase tracking-[0.24em]"><span style={{ color: "var(--csw-tone)" }}>Coach switched</span></p>
        <h3 style={{ "--i": 1 } as CSSProperties} className="csw-name mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{coach.name} is your coach</h3>
        <p style={{ "--i": 2 } as CSSProperties} className="mt-3 text-sm leading-6 text-slate-300">
          Your season plan is rebuilt on {first}&apos;s program, and chat and voice calls are with {first} now. This
          week&apos;s planned sessions stay as they are; {first}&apos;s sessions start with the next week you generate.
        </p>
      </div>
      <div className="csw-stagger flex flex-col gap-2 sm:flex-row">
        <Link href="/coach-chat" style={{ "--i": 3 } as CSSProperties} className="csw-cta group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold">
          <MessageSquare className="relative h-4 w-4" /><span className="relative">Say hi to {first}</span>
          <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
        <button type="button" onClick={onClose} style={{ "--i": 4 } as CSSProperties}
          className="rounded-full border border-white/12 px-6 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06]">
          Back to dashboard
        </button>
      </div>
    </div>
  )
}
