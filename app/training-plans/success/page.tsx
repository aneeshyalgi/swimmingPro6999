"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { ArrowLeft, CalendarDays, Check, FileText, Loader2, Mail, Repeat, XCircle } from "lucide-react"
import { SiteNavbar } from "@/components/site-navbar"
import { PlanCover } from "@/components/plan-store/plan-cover"
import { ACCENT_COLORS, formatPrice, verifyPlanPurchase, type PlanPurchase } from "@/lib/plan-store"

const CONFETTI_COLORS = ["#67e8f9", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#e0f2fe"]

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, index) => ({
    x: `${(index * 37) % 100}%`,
    drift: `${((index * 53) % 160) - 80}px`,
    spin: `${360 + ((index * 97) % 720)}deg`,
    delay: `${((index * 29) % 90) / 100}s`,
    time: `${2.4 + ((index * 17) % 140) / 100}s`,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    round: index % 3 === 0,
  })), [])
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((piece, index) => (
        <span key={index} className="store-confetti" style={{
          "--x": piece.x, "--drift": piece.drift, "--spin": piece.spin, "--d": piece.delay, "--t": piece.time,
          background: piece.color, borderRadius: piece.round ? 999 : 2, width: piece.round ? 9 : 7, height: piece.round ? 9 : 14,
        } as CSSProperties} />
      ))}
    </div>
  )
}

type State = { status: "checking" } | { status: "paid"; purchase: PlanPurchase } | { status: "pending"; purchase: PlanPurchase } | { status: "error"; message: string }

export default function PlanPurchaseSuccessPage() {
  const [state, setState] = useState<State>({ status: "checking" })

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id")
    if (!sessionId) {
      setState({ status: "error", message: "This page needs a Stripe checkout session. If you just paid, check your email for the receipt." })
      return
    }
    verifyPlanPurchase(sessionId)
      .then((purchase) => setState({ status: purchase.paid ? "paid" : "pending", purchase }))
      .catch((error: Error) => setState({ status: "error", message: error.message || "We couldn't confirm this purchase." }))
  }, [])

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_50%_0%,rgba(87,229,234,0.14),transparent_55%)] bg-background">
      <SiteNavbar />
      <main className="mx-auto flex min-h-screen max-w-5xl items-center px-4 pb-16 pt-28 sm:px-6">
        {state.status === "checking" && (
          <div className="mx-auto flex flex-col items-center text-center">
            <Loader2 className="h-9 w-9 animate-spin text-cyan-300" />
            <p className="mt-5 text-lg font-semibold text-white">Confirming your payment with Stripe…</p>
            <p className="mt-1 text-sm text-slate-400">This only takes a second.</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="dash-reveal mx-auto w-full max-w-lg rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-8 text-center">
            <XCircle className="mx-auto h-9 w-9 text-red-300" />
            <h1 className="mt-4 text-2xl font-bold text-white">We couldn&apos;t confirm that purchase</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">{state.message}</p>
            <Link href="/training-plans" className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground"><ArrowLeft className="h-4 w-4" />Back to the plans</Link>
          </div>
        )}

        {(state.status === "paid" || state.status === "pending") && (() => {
          const { plan, email, amount_total } = state.purchase
          const color = ACCENT_COLORS[plan.accent]
          const paid = state.status === "paid"
          return (
            <div className="grid w-full items-center gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              {paid && <Confetti />}
              <div className="relative mx-auto w-full max-w-[290px]">
                <div className="pointer-events-none absolute inset-0 -z-10 scale-125 rounded-full blur-[80px]" style={{ background: `rgba(${color.rgb},0.3)` }} />
                <div className="store-land"><PlanCover plan={plan} size="lg" className="store-glint shadow-[0_50px_90px_rgba(0,0,0,0.6)]" /></div>
                {paid && (
                  <div className="store-stamp absolute -right-5 -top-5 flex h-24 w-24 flex-col items-center justify-center rounded-full border-[3px] border-emerald-300 bg-[#06261d]/90 text-emerald-200 shadow-[0_0_30px_rgba(52,211,153,0.45)] backdrop-blur">
                    <Check className="h-7 w-7" strokeWidth={3} />
                    <span className="text-[11px] font-black uppercase tracking-[0.2em]">Paid</span>
                  </div>
                )}
              </div>
              <div className="dash-reveal text-center lg:text-left" style={{ "--reveal-delay": "500ms" } as CSSProperties}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: color.light }}>{paid ? "Payment confirmed" : "Payment processing"}</p>
                <h1 className="mt-3 text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">{paid ? "It's yours." : "Almost there."}</h1>
                <p className="mt-3 text-lg text-slate-300">
                  {paid ? <>Thanks for buying <span className="font-semibold text-white">{plan.title}</span>. Time to get in the water.</> : <>Stripe is still confirming your payment for <span className="font-semibold text-white">{plan.title}</span>. Refresh in a minute.</>}
                </p>

                <div className="mt-8 overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(170deg,rgba(20,30,40,0.9),rgba(8,12,18,0.96))] text-left">
                  <div className="flex items-center justify-between border-b border-dashed border-white/[0.1] px-5 py-4">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Receipt</span>
                    {amount_total !== null && <span className="font-mono text-xl font-bold tabular-nums text-white">{formatPrice(amount_total, plan.currency)}</span>}
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-white/[0.06]">
                    {[
                      { icon: CalendarDays, value: `${plan.weeks} weeks` },
                      { icon: Repeat, value: `${plan.sessions_per_week}×/week` },
                      { icon: FileText, value: `${plan.pages} pages` },
                    ].map((item) => (
                      <div key={item.value} className="flex flex-col items-center gap-1.5 px-2 py-4 text-sm text-slate-300 sm:flex-row sm:justify-center"><item.icon className="h-4 w-4" style={{ color: color.light }} />{item.value}</div>
                    ))}
                  </div>
                  {paid && (
                    <div className="flex items-start gap-3 border-t border-white/[0.06] bg-cyan-300/[0.04] px-5 py-4">
                      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
                      <p className="text-sm leading-6 text-slate-300">
                        {email ? <>We&apos;ll send your PDF to <span className="font-semibold text-white">{email}</span>.</> : <>We&apos;ll send your PDF to the email you used at checkout.</>}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                  <Link href="/training-plans" className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 text-sm font-medium text-white transition-colors hover:bg-white/[0.09]"><ArrowLeft className="h-4 w-4" />More plans</Link>
                  <Link href="/dashboard" className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground shadow-[0_12px_30px_rgba(87,229,234,0.3)] transition-transform hover:-translate-y-0.5">Go to my dashboard</Link>
                </div>
              </div>
            </div>
          )
        })()}
      </main>
    </div>
  )
}
