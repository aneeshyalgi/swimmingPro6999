"use client"

import type { CSSProperties } from "react"
import { CalendarDays, Eye, FileText, Repeat, Sparkles } from "lucide-react"
import { PlanCover, Tilt } from "@/components/plan-store/plan-cover"
import { BuyButton } from "@/components/plan-store/plan-preview"
import { ACCENT_COLORS, formatPrice, type StorePlan } from "@/lib/plan-store"

/** One plan in the store grid: the cover on a lit stage with a page fanning out behind it on hover. */
export function PlanCard({ plan, index, buying, onPreview, onBuy }: { plan: StorePlan; index: number; buying: boolean; onPreview: () => void; onBuy: () => void }) {
  const color = ACCENT_COLORS[plan.accent]
  return (
    <div className="dash-reveal h-full" style={{ "--reveal-delay": `${Math.min(index, 8) * 70}ms` } as CSSProperties}>
      <Tilt max={7} className="group h-full">
        <article className="relative flex h-full flex-col overflow-hidden rounded-[26px] border border-white/[0.08] bg-[linear-gradient(170deg,rgba(20,30,40,0.92),rgba(8,12,18,0.97))] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.35)] transition-[border-color,box-shadow] duration-500 hover:border-white/[0.16]"
          style={{ "--accent-rgb": color.rgb } as CSSProperties}>
          <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ boxShadow: `inset 0 0 0 1px rgba(${color.rgb},0.35), 0 0 60px rgba(${color.rgb},0.08)`, borderRadius: 26 }} />

          {/* stage */}
          <button type="button" onClick={onPreview} aria-label={`Preview ${plan.title}`}
            className="relative flex h-60 items-center justify-center overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_50%_70%,rgba(var(--accent-rgb),0.28),transparent_62%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]">
            <div className="pointer-events-none absolute inset-x-8 bottom-6 h-6 rounded-[50%] bg-black/60 blur-xl transition-transform duration-700 group-hover:scale-x-110" />
            <div className="relative w-[38%] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-2">
              {/* page behind the cover */}
              <div className="absolute inset-0 rotate-[3deg] rounded-[14px] bg-[#e9eef3] shadow-lg transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-7 group-hover:rotate-[11deg]">
                <div className="h-1 rounded-t-[14px]" style={{ background: color.main }} />
                <div className="space-y-1.5 p-3">
                  {[70, 90, 55, 80, 62, 88, 48].map((width, line) => <div key={line} className="h-1 rounded bg-slate-300" style={{ width: `${width}%` }} />)}
                </div>
              </div>
              <div className="relative transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-rotate-[4deg] group-hover:-translate-x-2">
                <PlanCover plan={plan} size="sm" className="store-glint" />
              </div>
            </div>
            {plan.badge && (
              <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] backdrop-blur"
                style={{ borderColor: `rgba(${color.rgb},0.4)`, background: `rgba(${color.rgb},0.14)`, color: color.light }}>
                <Sparkles className="h-3 w-3" />{plan.badge}
              </span>
            )}
            <span className="absolute right-3 top-3 inline-flex translate-y-1 items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-white opacity-0 backdrop-blur transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
              <Eye className="h-3 w-3" />Preview
            </span>
          </button>

          {/* details */}
          <div className="flex flex-1 flex-col px-2 pb-1.5 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: color.light }}>{plan.category} · <span className="text-slate-500">{plan.level}</span></p>
            <h3 className="mt-1.5 text-lg font-bold leading-snug tracking-tight text-white">{plan.title}</h3>
            <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-slate-400">{plan.tagline}</p>
            <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-slate-500" />{plan.weeks} wk</span>
              <span className="inline-flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5 text-slate-500" />{plan.sessions_per_week}×/wk</span>
              <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-slate-500" />{plan.pages} pages</span>
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 pt-5">
              <p className="font-mono text-2xl font-bold tabular-nums text-white">{formatPrice(plan.price, plan.currency)}</p>
              <div className="flex gap-2">
                <button type="button" onClick={onPreview} className="h-9 rounded-full border border-white/12 bg-white/[0.04] px-4 text-sm font-medium text-white transition-colors hover:bg-white/[0.1]">Details</button>
                <BuyButton plan={plan} buying={buying} onBuy={onBuy} compact />
              </div>
            </div>
          </div>
        </article>
      </Tilt>
    </div>
  )
}

export function PlanCardSkeleton() {
  return (
    <div className="rounded-[26px] border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="store-shimmer h-60 rounded-[20px]" />
      <div className="space-y-2.5 px-2 pb-2 pt-4">
        <div className="store-shimmer h-3 w-1/3 rounded" />
        <div className="store-shimmer h-5 w-3/4 rounded" />
        <div className="store-shimmer h-3 w-full rounded" />
        <div className="store-shimmer h-3 w-2/3 rounded" />
        <div className="flex justify-between pt-4"><div className="store-shimmer h-7 w-16 rounded" /><div className="store-shimmer h-9 w-32 rounded-full" /></div>
      </div>
    </div>
  )
}
