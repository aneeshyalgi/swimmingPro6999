"use client"

import type { CSSProperties } from "react"
import Link from "next/link"
import { ArrowRight, Check, LogIn, UserRound } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ACCENT_COLORS, formatPrice, type StorePlan } from "@/lib/plan-store"

const POINTS = [
  "Every plan you buy is saved to your account",
  "No subscription and no setup: just an account",
  "Then straight on to secure checkout",
]

/** Buying a plan needs a free SwimGPT account: create one or log in, then come straight back to this plan's checkout. */
export function AccountRequired({ plan, open, onOpenChange }: { plan: StorePlan | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!plan) return null
  const color = ACCENT_COLORS[plan.accent]
  const next = encodeURIComponent(`/training-plans?buy=${plan.id}`)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-white/10 bg-[#0a1118] p-0 sm:max-w-md" style={{ "--accent-rgb": color.rgb } as CSSProperties}>
        <div className="relative px-6 pb-6 pt-7">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-[70px]" style={{ background: `rgba(${color.rgb},0.28)` }} />
          <span className="relative grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.05]">
            <UserRound className="h-6 w-6" style={{ color: color.light }} />
          </span>
          <DialogTitle className="relative mt-4 text-2xl font-bold tracking-tight text-white">Create a free account to buy</DialogTitle>
          <DialogDescription className="relative mt-1.5 text-sm leading-6 text-slate-400">
            You&apos;re buying <span className="font-semibold text-white">{plan.title}</span> for {formatPrice(plan.price, plan.currency)}.
          </DialogDescription>
          <ul className="relative mt-5 space-y-2.5">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm leading-5 text-slate-200">
                <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: `rgba(${color.rgb},0.16)`, color: color.light }}>
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {point}
              </li>
            ))}
          </ul>
          <div className="relative mt-7 grid gap-2.5">
            <Link href={`/auth?mode=signup&next=${next}`}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-accent-foreground shadow-[0_14px_34px_rgba(87,229,234,0.32)] transition-transform hover:-translate-y-0.5">
              Create free account<ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={`/auth?next=${next}`}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] text-[15px] font-medium text-white transition-colors hover:bg-white/[0.09]">
              <LogIn className="h-4 w-4" />I have an account
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
