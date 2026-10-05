"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, FileText, Loader2, Lock, Repeat, ShieldCheck, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { PlanCover } from "@/components/plan-store/plan-cover"
import { ACCENT_COLORS, formatPrice, type StorePlan } from "@/lib/plan-store"
import { cn } from "@/lib/utils"

/** Rough intensity of a sample-week session, from its wording, for the coloured bars. */
export function sessionTone(text: string): { level: number; color: string; label: string } {
  const t = text.toLowerCase()
  if (/dryland|power|strength|gym|upper|lower|full-body/.test(t)) return { level: 0.6, color: "#a78bfa", label: "Dryland" }
  if (/race|speed|broken|sprint|threshold|css|back-half|start/.test(t)) return { level: 0.95, color: "#fb7185", label: "Hard" }
  if (/recovery|rest|technique|stretch|fun|open$/.test(t)) return { level: 0.3, color: "#34d399", label: "Easy" }
  return { level: 0.62, color: "#38bdf8", label: "Aerobic" }
}

/** A light "paper" page, drawn at a fixed 340 px width so it can be scaled down for thumbnails. */
function Paper({ plan, page, title, children }: { plan: StorePlan; page: number; title: string; children: ReactNode }) {
  const color = ACCENT_COLORS[plan.accent]
  return (
    <div className="relative flex h-[453px] w-[340px] flex-col overflow-hidden rounded-[10px] bg-[#f6f8fa] text-slate-900 shadow-[0_24px_50px_rgba(0,0,0,0.5)]">
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${color.main}, ${color.light})` }} />
      <div className="flex items-center justify-between px-6 pt-4 text-[8px] font-bold uppercase tracking-[0.22em] text-slate-400">
        <span>SwimGPT · {plan.title}</span><span>{page}</span>
      </div>
      <p className="px-6 pt-3 text-[19px] font-black tracking-tight">{title}</p>
      <div className="flex-1 px-6 pb-5 pt-3">{children}</div>
    </div>
  )
}

function WeekPage({ plan }: { plan: StorePlan }) {
  return (
    <Paper plan={plan} page={2} title="Week 1 at a glance">
      <p className="text-[10px] leading-4 text-slate-500">{plan.sessions_per_week} sessions · {plan.level}</p>
      <div className="mt-3 space-y-1.5">
        {plan.sample_week.map(([day, session], index) => {
          const tone = sessionTone(session)
          return (
            <div key={day + session} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-7 shrink-0 text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">{day}</span>
                <p className="min-w-0 flex-1 truncate text-[11px] font-semibold">{session}</p>
                <span className="shrink-0 rounded-full px-1.5 text-[8px] font-bold uppercase tracking-[0.1em]" style={{ background: `${tone.color}22`, color: tone.color }}>{tone.label}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-slate-100">
                <div className="store-fill h-full rounded-full" style={{ width: `${tone.level * 100}%`, background: tone.color, "--fill-delay": `${200 + index * 90}ms` } as CSSProperties} />
              </div>
            </div>
          )
        })}
      </div>
    </Paper>
  )
}

function InsidePage({ plan }: { plan: StorePlan }) {
  const color = ACCENT_COLORS[plan.accent]
  return (
    <Paper plan={plan} page={3} title="What's inside">
      <ul className="space-y-2.5">
        {plan.includes.map((item) => (
          <li key={item} className="flex gap-2.5 text-[11.5px] leading-[1.35] text-slate-700">
            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: color.main }}><Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} /></span>{item}
          </li>
        ))}
      </ul>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        {[[plan.weeks, "weeks"], [plan.sessions_per_week, "per week"], [plan.pages, "pages"]].map(([value, label]) => (
          <div key={label} className="rounded-lg bg-white py-2 ring-1 ring-slate-200"><p className="text-lg font-black">{value}</p><p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p></div>
        ))}
      </div>
      <p className="mt-4 text-[8px] font-bold uppercase tracking-[0.18em] text-slate-400">Built for</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {plan.events.map((event) => <span key={event} className="rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-semibold text-white">{event}</span>)}
      </div>
    </Paper>
  )
}

function LockedPage({ plan }: { plan: StorePlan }) {
  const color = ACCENT_COLORS[plan.accent]
  return (
    <Paper plan={plan} page={4} title="Session 1">
      <div className="pointer-events-none select-none space-y-3 blur-[3px]" aria-hidden>
        {["Warm-up", "Pre-set", "Main set", "Cool-down"].map((block, index) => (
          <div key={block}>
            <p className="text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: color.main }}>{block}</p>
            {Array.from({ length: index === 2 ? 4 : 2 }, (_, line) => (
              <div key={line} className="mt-1.5 flex items-center gap-2">
                <span className="h-2 w-8 rounded bg-slate-300" /><span className="h-2 rounded bg-slate-200" style={{ width: `${45 + ((line * 37 + index * 11) % 40)}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 top-24 flex flex-col items-center justify-center bg-gradient-to-b from-transparent via-[#f6f8fa]/80 to-[#f6f8fa] text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg"><Lock className="h-5 w-5" /></span>
        <p className="mt-3 text-sm font-black">Every session, written out</p>
        <p className="mt-1 max-w-[220px] text-[11px] leading-4 text-slate-500">Sets, send-offs and notes for all {plan.weeks * plan.sessions_per_week} sessions unlock with the plan.</p>
      </div>
    </Paper>
  )
}

const PAGES = ["Cover", "Week 1", "Inside", "Sessions"] as const

function PageView({ plan, page }: { plan: StorePlan; page: number }) {
  if (page === 0) return <div className="w-[340px]"><PlanCover plan={plan} size="lg" /></div>
  if (page === 1) return <WeekPage plan={plan} />
  if (page === 2) return <InsidePage plan={plan} />
  return <LockedPage plan={plan} />
}

export function BuyButton({ plan, buying, onBuy, className, compact }: { plan: StorePlan; buying: boolean; onBuy: () => void; className?: string; compact?: boolean }) {
  return (
    <button type="button" onClick={onBuy} disabled={buying}
      className={cn("store-cta inline-flex items-center justify-center gap-2 rounded-full bg-accent font-semibold text-accent-foreground shadow-[0_14px_34px_rgba(87,229,234,0.32)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(87,229,234,0.45)] disabled:translate-y-0 disabled:opacity-80",
        compact ? "h-9 px-4 text-sm" : "h-12 px-6 text-[15px]", className)}>
      {buying ? <><Loader2 className="h-4 w-4 animate-spin" />Opening checkout…</> : <><CreditCard className="h-4 w-4" />{compact ? "Buy" : `Buy now · ${formatPrice(plan.price, plan.currency)}`}</>}
    </button>
  )
}

/** Plan details with a page-turning preview of the PDF. */
export function PlanPreview({ plan, open, onOpenChange, buying, error, onBuy }: {
  plan: StorePlan | null; open: boolean; onOpenChange: (open: boolean) => void; buying: boolean; error: string | null; onBuy: (plan: StorePlan) => void
}) {
  const [page, setPage] = useState(0)
  const [direction, setDirection] = useState(1)
  useEffect(() => { if (open) { setPage(0); setDirection(1) } }, [open, plan?.id])
  const go = (next: number) => {
    const target = (next + PAGES.length) % PAGES.length
    setDirection(target > page ? 1 : -1)
    setPage(target)
  }
  if (!plan) return null
  const color = ACCENT_COLORS[plan.accent]
  const flip = { "--flip-from": direction > 0 ? "-34deg" : "34deg", "--flip-shift": direction > 0 ? "26px" : "-26px", "--flip-origin": direction > 0 ? "left" : "right" } as CSSProperties
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] gap-0 overflow-y-auto border-white/10 bg-[#0a1118] p-0 sm:max-w-5xl"
        onKeyDown={(event) => { if (event.key === "ArrowRight") go(page + 1); if (event.key === "ArrowLeft") go(page - 1) }}>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* viewer */}
          <div className="relative flex flex-col items-center overflow-hidden border-b border-white/[0.06] bg-[radial-gradient(circle_at_50%_30%,rgba(var(--accent-rgb),0.22),transparent_60%)] px-4 pb-5 pt-8 lg:border-b-0 lg:border-r" style={{ "--accent-rgb": color.rgb } as CSSProperties}>
            <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:18px_18px]" />
            <div className="relative flex w-full items-center justify-center gap-2">
              <button type="button" onClick={() => go(page - 1)} aria-label="Previous page" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/10 sm:flex"><ChevronLeft className="h-5 w-5" /></button>
              <div className="relative h-[371px] w-[279px] sm:h-[453px] sm:w-[340px]" style={{ perspective: 1400 }}>
                <div className="origin-top-left scale-[0.82] sm:scale-100">
                  <div key={page} className="store-flip" style={flip}><PageView plan={plan} page={page} /></div>
                </div>
              </div>
              <button type="button" onClick={() => go(page + 1)} aria-label="Next page" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/10 sm:flex"><ChevronRight className="h-5 w-5" /></button>
            </div>
            <div className="relative mt-5 flex gap-2.5">
              {PAGES.map((label, index) => (
                <button key={label} type="button" onClick={() => go(index)} aria-label={`Show ${label}`} aria-current={index === page}
                  className={cn("group flex flex-col items-center gap-1.5 transition-transform", index === page ? "-translate-y-1" : "hover:-translate-y-0.5")}>
                  <span className={cn("block h-[76px] w-[57px] overflow-hidden rounded-md ring-2 transition-all", index === page ? "ring-accent shadow-[0_0_18px_rgba(87,229,234,0.45)]" : "opacity-60 ring-white/10 group-hover:opacity-100")}>
                    <span className="block origin-top-left scale-[0.1676]"><PageView plan={plan} page={index} /></span>
                  </span>
                  <span className={cn("text-[10px] font-semibold", index === page ? "text-cyan-200" : "text-slate-500")}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* details */}
          <div className="flex flex-col p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              {plan.badge && <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: `rgba(${color.rgb},0.16)`, color: color.light }}><Sparkles className="h-3 w-3" />{plan.badge}</span>}
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{plan.category} · {plan.level}</span>
            </div>
            <DialogTitle className="mt-3 text-balance text-3xl font-bold leading-tight tracking-tight text-white">{plan.title}</DialogTitle>
            <DialogDescription className="mt-2 text-[15px] leading-7 text-slate-300">{plan.tagline}</DialogDescription>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                { icon: CalendarDays, value: plan.weeks, label: "weeks" },
                { icon: Repeat, value: plan.sessions_per_week, label: "sessions / wk" },
                { icon: FileText, value: plan.pages, label: "PDF pages" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                  <stat.icon className="h-4 w-4" style={{ color: color.light }} />
                  <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-white">{stat.value}</p>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">You get</p>
            <ul className="mt-2.5 space-y-2">
              {plan.includes.map((item, index) => (
                <li key={item} className="dash-reveal flex gap-2.5 text-sm leading-6 text-slate-200" style={{ "--reveal-delay": `${120 + index * 60}ms` } as CSSProperties}>
                  <Check className="mt-1 h-4 w-4 shrink-0" style={{ color: color.main }} />{item}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {plan.events.map((event) => <span key={event} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">{event}</span>)}
            </div>
            <div className="mt-auto pt-7">
              <div className="flex items-end justify-between gap-3 border-t border-white/[0.07] pt-5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">One-time price</p>
                  <p className="font-mono text-4xl font-bold tabular-nums text-white">{formatPrice(plan.price, plan.currency)}</p>
                </div>
                <p className="pb-1 text-right text-xs leading-5 text-slate-500">No subscription.<br />Yours to keep.</p>
              </div>
              <BuyButton plan={plan} buying={buying} onBuy={() => onBuy(plan)} className="mt-4 w-full" />
              {error && <p role="alert" className="mt-3 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3 py-2 text-sm text-red-200">{error}</p>}
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />Secure payment by Stripe. Card details never touch SwimGPT.</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
