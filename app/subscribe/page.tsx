"use client"

import { Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle, ArrowRight, CalendarRange, Dumbbell, Info, LogOut, MessageCircle, ShieldCheck, Sparkles, Target, Timer,
  TrendingUp, Trophy, Waves, Zap,
} from "lucide-react"
import { CoachAvatar } from "@/components/coach-avatar"
import { Tilt } from "@/components/plan-store/plan-cover"
import { WaterBubbles } from "@/components/water-bubbles"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// GET /api/subscription (backend/app/main.py).
type Screen = {
  paid: boolean
  user_key: string
  first_name: string
  offer: { id: string; name: string; description: string; amount: number; currency: string; interval: string }
  coach: { name: string; title: string; inspired_by: string | null } | null
  program: {
    headline: string | null
    phase: string | null
    phase_duration: string | null
    focus: string | null
    tags: string[]
    main_events: string[]
    swim_sessions_per_week: number
    gym_sessions_per_week: number
    week: string[]
  }
}

const DIGITS = Array.from({ length: 20 }, (_, index) => index % 10)
const GHOST_LINES = [["w-[88%]", "w-[62%]", "w-[74%]"], ["w-[70%]", "w-[84%]", "w-[52%]"], ["w-[80%]", "w-[58%]", "w-[90%]"]]

/** Stripe bills a monthly subscription on the same day each month (the month's last day when it is shorter). */
function addMonths(date: Date, months: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

function ordinal(day: number) {
  const suffixes = ["th", "st", "nd", "rd"]
  const tens = day % 100
  return `${day}${suffixes[(tens - 20) % 10] || suffixes[tens] || suffixes[0]}`
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)
}

async function errorDetail(response: Response, fallback: string) {
  try {
    const body = await response.json()
    return typeof body.detail === "string" ? body.detail : fallback
  } catch {
    return fallback
  }
}

export default function SubscribePage() {
  return (
    <Suspense fallback={<Preparing />}>
      <SubscribeContent />
    </Suspense>
  )
}

/**
 * The monthly payment screen. Every athlete who hasn't paid lands here (from sign-in, the dashboard and coach chat);
 * it previews the program they've already built and starts the Stripe subscription that unlocks it.
 */
function SubscribeContent() {
  const router = useRouter()
  const cancelled = useSearchParams().get("checkout") === "cancelled"
  const [screen, setScreen] = useState<Screen | null>(null)
  const [loadError, setLoadError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [starting, setStarting] = useState(false)
  const [checkoutError, setCheckoutError] = useState("")
  const [errorKey, setErrorKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoadError("")
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.replace("/auth")
          return
        }
        const response = await fetch(`${API_URL}/api/subscription`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
        })
        if (response.status === 401) {
          router.replace("/auth")
          return
        }
        // No profile or no plan yet: setup comes first.
        if (response.status === 404 || response.status === 409) {
          router.replace("/onboarding")
          return
        }
        if (!response.ok) throw new Error(await errorDetail(response, "Your plan could not be loaded."))
        const result: Screen = await response.json()
        if (result.paid) {
          router.replace("/dashboard")
          return
        }
        localStorage.setItem("swimgpt_user_key", result.user_key)
        setScreen(result)
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Your plan could not be loaded.")
      }
    }
    load()
    return () => controller.abort()
  }, [router, attempt])

  // Coming back from Stripe with the browser's Back button restores this page as it was left: mid-checkout.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) setStarting(false) }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [])

  const startCheckout = async () => {
    if (!screen || starting) return
    setStarting(true)
    setCheckoutError("")
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error("Your session has expired. Please sign in again.")
      const response = await fetch(`${API_URL}/api/payments/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ auth_user_id: session.user.id, user_key: screen.user_key, plan_id: screen.offer.id }),
      })
      // Already paid (an earlier checkout went through, or this email already has a subscription): nothing to charge.
      if (response.status === 409) {
        router.replace("/dashboard")
        return
      }
      if (!response.ok) throw new Error(await errorDetail(response, "Secure checkout could not be opened. Please try again."))
      const { checkout_url } = await response.json()
      window.location.assign(checkout_url)
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Secure checkout could not be opened. Please try again.")
      setErrorKey((key) => key + 1)
      setStarting(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    for (const key of ["swimgpt_user_key", "swimgpt_onboarding", "swimgpt_coaches", "swimgpt_pending_payment"]) localStorage.removeItem(key)
    router.push("/")
  }

  if (loadError) {
    return (
      <Backdrop>
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="au-glass au-rise w-full max-w-md rounded-3xl p-8 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-rose-300" />
            <p className="mt-4 font-semibold text-white">We couldn&apos;t load your plan</p>
            <p className="mt-1 text-sm text-slate-400">{loadError}</p>
            <button type="button" onClick={() => setAttempt((count) => count + 1)}
              className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-accent">
              Try again
            </button>
          </div>
        </div>
      </Backdrop>
    )
  }
  if (!screen) return <Preparing />

  const { offer, program, coach } = screen
  const price = money(offer.amount, offer.currency)
  const today = new Date()
  const renewals = [0, 1, 2, 3].map((months) => addMonths(today, months))
  const billingDay = today.getDate() <= 28 ? `every month on the ${ordinal(today.getDate())}` : "on this date every month"
  const coachName = coach?.name ?? "your coach"
  const sessions = program.week.length ? program.week : Array.from({ length: Math.max(program.swim_sessions_per_week, 3) }, () => "Coach session")
  const features = [
    { icon: Waves, text: `Every swim session written from ${coachName}'s program` },
    { icon: Dumbbell, text: "Strength, mobility and recovery planned around your swims" },
    { icon: MessageCircle, text: `Chat or talk live with ${coachName}, any time` },
    { icon: Trophy, text: "Race plans, pacing and taper for your meets" },
    { icon: TrendingUp, text: "Track every PB, split and training zone" },
  ]

  return (
    <Backdrop>
      <header className="au-rise relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative">
            <span className="absolute inset-0 animate-pulse rounded-full bg-accent/20 blur-xl" />
            <span className="relative flex rounded-xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-2">
              <Waves className="h-5 w-5 text-primary-foreground" />
            </span>
          </span>
          <span className="text-lg font-bold tracking-tight text-white">Swim<span className="text-accent">GPT</span></span>
        </Link>
        <button type="button" onClick={signOut}
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">
          <LogOut className="h-4 w-4" />Sign out
        </button>
      </header>

      <main className="relative z-10 mx-auto grid max-w-6xl gap-8 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[1.12fr_0.88fr] lg:gap-12 lg:pt-10">
        {/* Headline */}
        <section className="lg:col-start-1 lg:row-start-1">
          <p className="au-rise inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
            <Sparkles className="h-3.5 w-3.5" />Your program is ready
          </p>
          <h1 className="au-rise mt-5 text-balance text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl" style={{ "--i": 1 } as CSSProperties}>
            {screen.first_name ? `${screen.first_name}, your season is ` : "Your season is "}
            <span className="au-gradient-text">ready to unlock.</span>
          </h1>
          <p className="au-rise mt-4 max-w-xl text-[15px] leading-7 text-slate-300" style={{ "--i": 2 } as CSSProperties}>
            {program.headline ? `${program.headline}. ` : ""}Start your monthly plan to open your dashboard and this week&apos;s sessions.
          </p>
        </section>

        {/* Price */}
        <section className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="lg:sticky lg:top-8">
            <Tilt max={5} className="rounded-[30px]" style={{ "--i": 2 } as CSSProperties}>
              <div className="au-card relative rounded-[30px] p-[1px]">
                <div className="relative overflow-hidden rounded-[29px] bg-[linear-gradient(180deg,rgba(15,22,30,0.97),rgba(8,12,17,0.98))] p-6 sm:p-8">
                  <span aria-hidden className="sb-spot pointer-events-none absolute inset-0" />
                  <span aria-hidden className="store-sheen pointer-events-none absolute inset-0" />
                  <span aria-hidden className="au-card-glow" />

                  <div className="relative">
                    {cancelled && (
                      <p role="status" className="au-swap mb-5 flex items-start gap-2.5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />Checkout was cancelled. No payment was taken.
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-lg font-bold text-white">{offer.name}</p>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
                        <CalendarRange className="h-3.5 w-3.5" />Monthly
                      </span>
                    </div>

                    <p className="mt-5 flex items-end gap-2">
                      <span className="sr-only">{price} per month</span>
                      <span aria-hidden className="sb-price inline-flex items-start text-[64px] font-black leading-none tracking-tight text-white tabular-nums">
                        <Odometer text={price.replace(/\.\d+$/, "")} />
                        <span className="text-[30px] text-slate-300">{price.match(/\.\d+$/)?.[0]}</span>
                      </span>
                      <span aria-hidden className="pb-1.5 text-sm font-medium text-slate-400">/ month</span>
                    </p>
                    <p className="mt-2 text-sm text-slate-400">Billed monthly. Renews automatically each month.</p>

                    <BillingTimeline renewals={renewals} price={price} />

                    <ul className="mt-7 space-y-3">
                      {features.map((feature, index) => (
                        <li key={feature.text} className="sb-feature flex items-start gap-3 text-sm leading-5 text-slate-200" style={{ "--i": index } as CSSProperties}>
                          <span className="sb-check grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-300/15 text-cyan-200" style={{ "--i": index } as CSSProperties}>
                            <feature.icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="pt-0.5">{feature.text}</span>
                        </li>
                      ))}
                    </ul>

                    {checkoutError && (
                      <div key={errorKey} role="alert" className="au-shake mt-6 flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />{checkoutError}
                      </div>
                    )}

                    <div className="relative mt-7">
                      {starting && <span aria-hidden className="sb-burst pointer-events-none absolute inset-0 rounded-2xl" />}
                      <button type="button" onClick={startCheckout} disabled={starting}
                        className={cn("au-submit group relative flex h-[58px] w-full items-center justify-center overflow-hidden rounded-2xl text-base font-semibold text-slate-950 transition-transform duration-300 enabled:hover:-translate-y-0.5 disabled:cursor-progress",
                          starting && "sb-unlocking")}>
                        <span aria-hidden className="au-submit-sheen" />
                        {starting && <span aria-hidden className="au-submit-wave" />}
                        <span className="relative flex items-center gap-2.5">
                          <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                            <path className="sb-shackle" d="M8 11V7a4 4 0 0 1 8 0v4" />
                            <rect x="5" y="11" width="14" height="10" rx="2.5" />
                          </svg>
                          {starting ? "Opening secure checkout…" : "Start my monthly plan"}
                          {!starting && <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />}
                        </span>
                      </button>
                    </div>
                    <p className="mt-3 text-center text-xs leading-5 text-slate-400">
                      {price} today, then {price} {billingDay}.
                    </p>

                    <div className="mt-6 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-5 text-center text-[11px] leading-4 text-slate-400">
                      <span className="flex flex-col items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-cyan-300" />Secure checkout by Stripe</span>
                      <span className="flex flex-col items-center gap-1.5"><Zap className="h-4 w-4 text-cyan-300" />Dashboard opens instantly</span>
                      <span className="flex flex-col items-center gap-1.5">
                        <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 text-cyan-300" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 11V7a4 4 0 0 1 8 0v4" /><rect x="5" y="11" width="14" height="10" rx="2.5" />
                        </svg>
                        Card details never touch SwimGPT
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Tilt>
          </div>
        </section>

        {/* The program this unlocks */}
        <section className="sb-season au-rise relative overflow-hidden rounded-[32px] border border-white/10 p-6 sm:p-8 lg:col-start-1 lg:row-start-2"
          style={{ "--i": 3 } as CSSProperties} aria-label="Your program">
          <span aria-hidden className="au-caustics absolute inset-0" />

          <div className="relative flex items-center gap-4">
            {coach && (
              <span className="relative grid h-[72px] w-[72px] shrink-0 place-items-center">
                <span aria-hidden className="sb-halo absolute inset-0 rounded-full" />
                <span aria-hidden className="sb-orbit absolute -inset-1 rounded-full" />
                <CoachAvatar name={coach.name} shape="circle" className="relative h-16 w-16 border-[3px] border-[#08131a]" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Built by</p>
              <p className="truncate text-xl font-bold text-white">{coach?.name ?? "Your coach"}</p>
              {coach && <p className="truncate text-sm text-slate-400">{coach.title}</p>}
            </div>
          </div>

          {(program.phase || program.focus) && (
            <div className="relative mt-6 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                <Target className="h-4 w-4 text-cyan-300" />{program.phase}
                {program.phase_duration && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-slate-300">{program.phase_duration}</span>}
              </p>
              {program.focus && <p className="mt-1.5 text-sm leading-6 text-slate-400">{program.focus}</p>}
            </div>
          )}

          <div className="relative mt-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Your swim week</p>
            <div className="relative mt-3 overflow-hidden rounded-2xl">
              <div className={cn("grid grid-cols-2 gap-2.5", sessions.length > 4 && "sm:grid-cols-3")}>
                {sessions.map((session, index) => (
                  <div key={index} className="sb-lane rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3.5" style={{ "--i": index } as CSSProperties}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300/80">Swim {index + 1}</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-white">{session}</p>
                    <div aria-hidden className="sb-ghost mt-3 space-y-1.5">
                      {GHOST_LINES[index % GHOST_LINES.length].map((width) => (
                        <span key={width} className={cn("block h-1.5 rounded-full bg-gradient-to-r from-cyan-200/40 to-white/10", width)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <span aria-hidden className="sb-beam" />
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="sb-lock relative flex items-center gap-2.5 rounded-full border border-white/15 bg-[#071017]/80 py-2 pl-2 pr-4 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md">
                  <span className="relative grid h-8 w-8 place-items-center rounded-full bg-cyan-300/15 text-cyan-200">
                    <span aria-hidden className="sb-lock-ring absolute inset-0 rounded-full" />
                    <span aria-hidden className="sb-lock-ring sb-lock-ring-late absolute inset-0 rounded-full" />
                    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" /><rect x="5" y="11" width="14" height="10" rx="2.5" />
                    </svg>
                  </span>
                  <span className="text-xs font-semibold text-white">Unlocks with your monthly plan</span>
                </div>
              </div>
            </div>
          </div>

          {program.tags.length > 0 && (
            <div className="relative mt-6 flex flex-wrap gap-2">
              {program.tags.map((tag, index) => (
                <span key={tag} className="sb-chip rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1 text-xs text-cyan-100" style={{ "--i": index } as CSSProperties}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          <dl className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={program.main_events.length === 1 ? "Event" : "Events"} value={program.main_events.length} delay={500} />
            <Stat label="Swims / week" value={program.swim_sessions_per_week} delay={620} />
            <Stat label="Gym / week" value={program.gym_sessions_per_week} delay={740} />
            <div className="flex flex-col-reverse rounded-2xl border border-white/[0.08] bg-black/20 px-3 py-3 text-center">
              <dt className="mt-0.5 text-[11px] text-slate-400">This phase</dt>
              <dd className="flex items-center justify-center gap-1.5 text-lg font-bold text-white"><Timer className="h-4 w-4 text-cyan-300" />{program.phase_duration || "—"}</dd>
            </div>
          </dl>
        </section>
      </main>
    </Backdrop>
  )
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="au-page relative min-h-screen overflow-hidden text-foreground">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <span className="au-blob au-blob-a" />
        <span className="au-blob au-blob-b" />
        <span className="au-blob au-blob-c" />
        <span className="au-rays absolute inset-0" />
        <span className="au-grid absolute inset-0" />
        <div className="absolute inset-0 opacity-50"><WaterBubbles /></div>
      </div>
      {children}
    </div>
  )
}

function Preparing() {
  return (
    <Backdrop>
      <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
        <span className="relative grid h-20 w-20 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
          <span aria-hidden className="sb-lock-ring absolute inset-0 rounded-full" />
          <span aria-hidden className="sb-lock-ring sb-lock-ring-late absolute inset-0 rounded-full" />
          <svg viewBox="0 0 24 24" aria-hidden className="h-8 w-8 text-cyan-200" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 11V7a4 4 0 0 1 8 0v4" /><rect x="5" y="11" width="14" height="10" rx="2.5" />
          </svg>
        </span>
        <div>
          <p className="font-semibold text-white">Getting your plan ready</p>
          <div className="pt-progress mx-auto mt-4" />
        </div>
      </div>
    </Backdrop>
  )
}

/** Digits roll a full turn and settle on the price, like a race clock stopping. */
function Odometer({ text }: { text: string }) {
  const [rolled, setRolled] = useState(false)
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setRolled(true)) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [])
  let order = 0
  return (
    <>
      {[...text].map((char, index) => {
        if (!/\d/.test(char)) return <span key={index}>{char}</span>
        const delay = 250 + order++ * 160
        return (
          <span key={index} className="sb-odo">
            <span className="sb-odo-strip" style={{ transform: `translateY(${rolled ? -(10 + Number(char)) : 0}em)`, "--d": `${delay}ms` } as CSSProperties}>
              {DIGITS.map((digit, position) => <span key={position}>{digit}</span>)}
            </span>
          </span>
        )
      })}
    </>
  )
}

/** Today's charge and the next three monthly renewals. */
function BillingTimeline({ renewals, price }: { renewals: Date[]; price: string }) {
  const label = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return (
    <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/25 px-4 pb-4 pt-5">
      <div className="relative mx-3 h-1 rounded-full bg-white/[0.08]">
        <span aria-hidden className="sb-track-fill absolute inset-0 rounded-full" />
        <span aria-hidden className="sb-pulse absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        {renewals.map((date, index) => (
          <span key={index} aria-hidden style={{ left: `${(index / (renewals.length - 1)) * 100}%`, "--i": index } as CSSProperties}
            className={cn("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
              index === 0 ? "sb-node-now border-cyan-200 bg-cyan-300" : "sb-node border-cyan-300/60 bg-[#0b141b]")} />
        ))}
      </div>
      <ol className="mt-4 grid grid-cols-4 text-center">
        {renewals.map((date, index) => (
          <li key={index} className="sb-label" style={{ "--i": index } as CSSProperties}>
            <p className={cn("text-[11px] font-semibold", index === 0 ? "text-cyan-200" : "text-slate-300")}>{index === 0 ? "Today" : label(date)}</p>
            <p className="text-[11px] tabular-nums text-slate-500">{price}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Stat({ label, value, delay }: { label: string; value: number; delay: number }) {
  const shown = useCountUp(value, delay)
  return (
    <div className="flex flex-col-reverse rounded-2xl border border-white/[0.08] bg-black/20 px-3 py-3 text-center">
      <dt className="mt-0.5 text-[11px] text-slate-400">{label}</dt>
      <dd className="text-lg font-bold tabular-nums text-white">{shown}</dd>
    </div>
  )
}

function useCountUp(target: number, delay = 0, duration = 1100) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target)
      return
    }
    let frame = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration))
      setValue(Math.round(target * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, delay, duration])
  return value
}
