"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { CreditCard, Loader2, ShieldCheck } from "lucide-react"
import { StartNowConsent } from "@/components/legal/start-now-consent"
import { PlanCover } from "@/components/plan-store/plan-cover"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ACCENT_COLORS, formatPrice, type StorePlan } from "@/lib/plan-store"

/** The step before Stripe's payment page: the plan, its price and the box to tick to have it unlocked straight away
 * (components/legal/start-now-consent.tsx). `onPay` opens Stripe once the box is ticked. */
export function ConfirmPurchase({ plan, open, onOpenChange, buying, error, onPay }: {
  plan: StorePlan | null; open: boolean; onOpenChange: (open: boolean) => void; buying: boolean; error: string | null; onPay: (plan: StorePlan) => void
}) {
  const [startNow, setStartNow] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const planId = plan?.id
  // Every purchase asks afresh.
  useEffect(() => { if (open) { setStartNow(false); setAttempt(0) } }, [open, planId])
  if (!plan) return null
  const color = ACCENT_COLORS[plan.accent]
  const pay = () => {
    if (!startNow) { setAttempt((count) => count + 1); return }
    onPay(plan)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-white/10 bg-[#0a1118] p-0 sm:max-w-md" style={{ "--accent-rgb": color.rgb } as CSSProperties}>
        <div className="relative px-6 pb-6 pt-7">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-[70px]" style={{ background: `rgba(${color.rgb},0.28)` }} />
          <div className="relative flex items-center gap-4 pr-6">
            <div className="w-16 shrink-0"><PlanCover plan={plan} size="xs" className="rounded-[9px] shadow-[0_12px_28px_rgba(0,0,0,0.5)]" /></div>
            <div className="min-w-0">
              <DialogTitle className="text-xl font-bold leading-tight tracking-tight text-white">{plan.title}</DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-5 text-slate-400">
                {plan.weeks}-week plan · {plan.pages} pages, read in your SwimGPT account
              </DialogDescription>
            </div>
          </div>
          <div className="relative mt-5 flex items-end justify-between gap-3 border-t border-white/[0.07] pt-4">
            <p className="pb-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">One-time price</p>
            <p className="font-mono text-3xl font-bold tracking-tighter tabular-nums text-white">{formatPrice(plan.price, plan.currency)}</p>
          </div>
          <StartNowConsent kind="plan" checked={startNow} onChange={setStartNow} attempt={attempt} disabled={buying}
            className="relative mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4" />
          {error && <p role="alert" className="relative mt-3 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3 py-2 text-sm text-red-200">{error}</p>}
          <button type="button" onClick={pay} disabled={buying}
            className="store-cta relative mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-accent-foreground shadow-[0_14px_34px_rgba(87,229,234,0.32)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(87,229,234,0.45)] disabled:translate-y-0 disabled:opacity-80">
            {buying ? <><Loader2 className="h-4 w-4 animate-spin" />Opening checkout…</> : <><CreditCard className="h-4 w-4" />Continue to payment</>}
          </button>
          <p className="relative mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" />Secure payment by Stripe. Card details never touch SwimGPT.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
