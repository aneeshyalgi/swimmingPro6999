"use client"

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { ArrowRight, BookOpen, Check, CreditCard, Eye, MousePointerClick, ShieldCheck, Sparkles } from "lucide-react"
import { PlanCover, Tilt } from "@/components/plan-store/plan-cover"
import { BuyButton, sessionTone } from "@/components/plan-store/plan-preview"
import { useInView } from "@/components/landing/use-in-view"
import { readProgress, type ReadingProgress } from "@/lib/plan-book"
import { ACCENT_COLORS, formatPrice, prefetchPlanPreview, readerHref, type StorePlan } from "@/lib/plan-store"
import { cn } from "@/lib/utils"

const LIQUID_EASE = "cubic-bezier(0.76, 0, 0.24, 1)"

/** Category filter with a pill that slides (and stretches) between options. */
export function CategoryTabs({ options, value, onChange }: { options: { key: string; label: string; count: number }[]; value: string; onChange: (key: string) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const scroller = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const button = refs.current[value]
      if (button) setPill({ left: button.offsetLeft, width: button.offsetWidth })
    }
    place()
    window.addEventListener("resize", place)
    document.fonts?.ready.then(place)
    // Keep the chosen tab in view on narrow screens (scrolls only the strip, never the page).
    const strip = scroller.current, button = refs.current[value]
    if (strip && button && strip.scrollWidth > strip.clientWidth) {
      strip.scrollTo({ left: button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2, behavior: "smooth" })
    }
    return () => window.removeEventListener("resize", place)
  }, [value, options.length])
  return (
    <div ref={scroller} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <div role="tablist" aria-label="Plan categories" className="relative inline-flex min-w-max gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
        {pill && (
          <span aria-hidden className="absolute bottom-1 top-1 rounded-full bg-[linear-gradient(135deg,rgba(87,229,234,0.95),rgba(56,189,248,0.9))] shadow-[0_8px_26px_rgba(87,229,234,0.35)]"
            style={{ left: pill.left, width: pill.width, transition: `left 560ms ${LIQUID_EASE}, width 560ms ${LIQUID_EASE}` }} />
        )}
        {options.map((option) => (
          <button key={option.key} ref={(node) => { refs.current[option.key] = node }} type="button" role="tab" aria-selected={value === option.key} onClick={() => onChange(option.key)}
            className={cn("relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-300",
              value === option.key ? "text-[#03161a]" : "text-slate-300 hover:text-white")}>
            {option.label}
            <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums transition-colors duration-300", value === option.key ? "bg-black/15" : "bg-white/[0.07] text-slate-400")}>{option.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Three plan covers dealt into a floating fan, with orbiting rings and a couple of floating chips. */
export function HeroStack({ plans, onPick }: { plans: StorePlan[]; onPick: (plan: StorePlan) => void }) {
  const fan = [
    { fx: "-46%", fy: "22px", fr: "-11deg", delay: 250, bob: "0s", z: 1 },
    { fx: "46%", fy: "22px", fr: "11deg", delay: 420, bob: "-2.3s", z: 2 },
    { fx: "0%", fy: "-6px", fr: "0deg", delay: 80, bob: "-4.6s", z: 3 },
  ]
  return (
    <div className="store-fan relative mx-auto flex h-[380px] w-full max-w-[520px] items-center justify-center sm:h-[460px]">
      <div className="pointer-events-none absolute h-[360px] w-[360px] rounded-full bg-accent/20 blur-[90px]" />
      <div className="store-orbit pointer-events-none absolute h-[330px] w-[330px] rounded-full border border-dashed border-cyan-200/15 sm:h-[420px] sm:w-[420px]">
        <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(165,243,252,0.9)]" />
      </div>
      <div className="store-orbit-rev pointer-events-none absolute h-[250px] w-[250px] rounded-full border border-violet-300/10 sm:h-[320px] sm:w-[320px]">
        <span className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-violet-300 shadow-[0_0_12px_rgba(196,181,253,0.9)]" />
      </div>
      {plans.slice(0, 3).map((plan, index) => {
        const slot = fan[index]
        return (
          <div key={plan.id} className="store-deal absolute w-[38%] sm:w-[36%]" style={{ zIndex: slot.z, "--deal-delay": `${slot.delay}ms`, "--deal-spin": slot.fr } as CSSProperties}>
            <div className="store-fan-item" style={{ "--fx": slot.fx, "--fy": slot.fy, "--fr": slot.fr } as CSSProperties}>
              <div className="store-bob" style={{ "--bob-delay": slot.bob } as CSSProperties}>
                <Tilt max={14}>
                  <button type="button" onClick={() => onPick(plan)} onPointerEnter={() => prefetchPlanPreview(plan.id)} aria-label={`Preview ${plan.title}`} className="block w-full rounded-[14px] transition-shadow hover:shadow-[0_0_0_2px_rgba(87,229,234,0.6)]">
                    <PlanCover plan={plan} size="sm" className="store-glint" />
                  </button>
                </Tilt>
              </div>
            </div>
          </div>
        )
      })}
      <div className="store-deal absolute bottom-6 left-0 z-10 hidden items-center gap-2 rounded-2xl border border-white/10 bg-[#0b141c]/85 px-3 py-2 shadow-xl backdrop-blur sm:flex" style={{ "--deal-delay": "900ms" } as CSSProperties}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/15"><ShieldCheck className="h-4 w-4 text-emerald-300" /></span>
        <span className="text-xs leading-4"><span className="block font-semibold text-white">Secure checkout</span><span className="text-slate-400">Powered by Stripe</span></span>
      </div>
      <div className="store-deal absolute right-0 top-8 z-10 hidden items-center gap-2 rounded-2xl border border-white/10 bg-[#0b141c]/85 px-3 py-2 shadow-xl backdrop-blur sm:flex" style={{ "--deal-delay": "1050ms" } as CSSProperties}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400/15"><BookOpen className="h-4 w-4 text-cyan-200" /></span>
        <span className="text-xs leading-4"><span className="block font-semibold text-white">Interactive book</span><span className="text-slate-400">Any phone, tablet or laptop</span></span>
      </div>
    </div>
  )
}

/** The bestseller, spotlit: big cover, its sample week drawn as an intensity chart, and the buy button. */
export function FeaturedPlan({ plan, buying, owned, onPreview, onBuy }: {
  plan: StorePlan; buying: boolean; owned?: boolean; onPreview: () => void; onBuy: () => void
}) {
  const color = ACCENT_COLORS[plan.accent]
  const { ref, inView } = useInView<HTMLDivElement>(0.2)
  return (
    <div ref={ref} onPointerEnter={() => prefetchPlanPreview(plan.id)} className="store-border rounded-[34px] p-px" style={{ "--accent-rgb": color.rgb } as CSSProperties}>
      <div className="relative overflow-hidden rounded-[33px] bg-[linear-gradient(135deg,#0b1720,#070c12_55%,#0d1220)] p-6 sm:p-10">
        <div className="pointer-events-none absolute -left-24 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full blur-[100px]" style={{ background: `rgba(${color.rgb},0.22)` }} />
        <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="mx-auto w-full max-w-[300px]">
            <Tilt max={12}>
              <button type="button" onClick={onPreview} aria-label={`Preview ${plan.title}`} className="block w-full">
                <PlanCover plan={plan} size="lg" className="store-glint shadow-[0_40px_80px_rgba(0,0,0,0.6)]" />
              </button>
            </Tilt>
          </div>
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ borderColor: `rgba(${color.rgb},0.35)`, color: color.light }}>
              <Sparkles className="h-3.5 w-3.5" />Spotlight · {plan.badge ?? "Featured"}
            </p>
            <h2 className="mt-4 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">{plan.title}</h2>
            <p className="mt-3 max-w-xl text-base leading-7 text-slate-300">{plan.tagline}</p>

            <div className="mt-7 rounded-2xl border border-white/[0.07] bg-black/25 p-4">
              <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>A week from the plan</span><span className="hidden sm:inline">{plan.weeks} weeks · {plan.sessions_per_week}×/week</span>
              </div>
              <div className="flex h-32 items-end gap-2">
                {plan.sample_week.map(([day, session], index) => {
                  const tone = sessionTone(session)
                  return (
                    <div key={day + session} className="group/bar relative flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                      <span className="pointer-events-none absolute -top-1 left-1/2 z-10 w-max max-w-[150px] -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-[#0b141c] px-2 py-1 text-center text-[11px] text-white opacity-0 shadow-lg transition-opacity group-hover/bar:opacity-100">{session}</span>
                      <div className="w-full rounded-t-lg transition-[height] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{ height: inView ? `${tone.level * 100}%` : "4%", transitionDelay: `${index * 110}ms`, background: `linear-gradient(180deg, ${tone.color}, ${tone.color}33)`, boxShadow: `0 0 18px ${tone.color}44` }} />
                      <span className="text-[10px] font-semibold uppercase text-slate-500">{day}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {plan.includes.slice(0, 4).map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-6 text-slate-300"><Check className="mt-1 h-4 w-4 shrink-0" style={{ color: color.main }} />{item}</li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <BuyButton plan={plan} buying={buying} owned={owned} onBuy={onBuy} className="w-full sm:w-auto" />
              <button type="button" onClick={onPreview} className="inline-flex h-12 w-full items-center justify-center gap-2 sm:w-auto rounded-full border border-white/12 bg-white/[0.04] px-6 text-[15px] font-medium text-white transition-colors hover:bg-white/[0.09]">
                <Eye className="h-4 w-4" />Look inside
              </button>
              {owned
                ? <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-300"><Check className="h-4 w-4" strokeWidth={3} />Purchased · in your library</span>
                : <span className="text-sm text-slate-500">{formatPrice(plan.price, plan.currency)} once · no subscription</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Pick → pay → train, with a moving dashed line joining the steps. */
export function HowItWorks() {
  const steps = [
    { icon: MousePointerClick, title: "Pick your plan", body: "Look inside any plan first: the cover, a sample week and what's included." },
    { icon: CreditCard, title: "Pay once with Stripe", body: "Log in with a free SwimGPT account, then pay on Stripe: your card details never touch SwimGPT. No subscription." },
    { icon: BookOpen, title: "Read it in SwimGPT", body: "Your plan opens as an interactive book in your account: turn the pages, search any set and tick off sessions, on any device." },
  ]
  const { ref, inView } = useInView<HTMLDivElement>(0.3)
  return (
    <div ref={ref} className="relative grid gap-5 md:grid-cols-3">
      <div className={cn("store-flow pointer-events-none absolute left-[16%] right-[16%] top-8 hidden h-px transition-opacity duration-700 md:block", inView ? "opacity-100" : "opacity-0")} />
      {steps.map((step, index) => (
        <div key={step.title} className={cn("relative text-center transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]", inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0")} style={{ transitionDelay: `${index * 150}ms` }}>
          <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/25 bg-[#0b161e] shadow-[0_0_30px_rgba(87,229,234,0.15)]">
            <step.icon className="h-7 w-7 text-cyan-200" />
            <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-black text-accent-foreground">{index + 1}</span>
          </div>
          <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-400">{step.body}</p>
        </div>
      ))}
    </div>
  )
}

/** The plans this account owns, with where the reader got to and the sessions ticked off (this browser's record). */
export function YourPlans({ plans, userId }: { plans: StorePlan[]; userId: string | null }) {
  const [progress, setProgress] = useState<Record<string, ReadingProgress | null>>({})
  useEffect(() => {
    if (userId) setProgress(Object.fromEntries(plans.map((plan) => [plan.id, readProgress(userId, plan.id)])))
  }, [plans, userId])
  return (
    <div className="dash-reveal rounded-[30px] border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(16,40,36,0.55),rgba(8,14,20,0.9)_60%)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.3)] sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300"><BookOpen className="h-3.5 w-3.5" />Your library</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Your plans</h2>
        </div>
        <p className="text-sm text-slate-400">Bought with this account. Open one to keep training.</p>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const saved = progress[plan.id]
          const sessions = plan.weeks * plan.sessions_per_week
          const done = Math.min(saved?.done.length ?? 0, sessions)
          const color = ACCENT_COLORS[plan.accent]
          return (
            <Link key={plan.id} href={readerHref(plan.id)} aria-label={`${saved ? "Continue" : "Open"} ${plan.title}`}
              className="dash-reveal group flex gap-4 rounded-[22px] border border-white/[0.08] bg-black/25 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-300/30 hover:bg-black/35"
              style={{ "--reveal-delay": `${120 + index * 80}ms` } as CSSProperties}>
              <div className="w-[82px] shrink-0 self-start transition-transform duration-500 group-hover:-rotate-2 group-hover:scale-[1.03]"><PlanCover plan={plan} size="xs" className="rounded-[10px] shadow-[0_12px_28px_rgba(0,0,0,0.5)]" /></div>
              <div className="flex min-w-0 flex-1 flex-col py-1">
                <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300"><Check className="h-3 w-3" strokeWidth={3.5} />Purchased</p>
                <h3 className="mt-1 truncate text-base font-semibold text-white">{plan.title}</h3>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {saved && saved.page > 0 ? `Page ${saved.page + 1} of ${plan.pages}` : `${plan.pages} pages`} · {done}/{sessions} sessions done
                </p>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full" style={{ width: `${(done / sessions) * 100}%`, background: `linear-gradient(90deg, ${color.main}, #6ee7b7)` }} />
                </div>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-3 text-sm font-semibold text-emerald-200 transition-colors group-hover:text-white">
                  {saved && saved.page > 0 ? "Continue reading" : "Open plan"}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
