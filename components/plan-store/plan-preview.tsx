"use client"

import { useEffect, useState, type CSSProperties } from "react"
import Link from "next/link"
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, FileText, Loader2, Repeat, RotateCcw, ShieldCheck, Sparkles, X, ZoomIn } from "lucide-react"
import { BookPage } from "@/components/plan-reader/book-page"
import { PlanCover } from "@/components/plan-store/plan-cover"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ACCENT_COLORS, fetchPlanPreview, formatPrice, readerHref, type PlanPreviewPages, type StorePlan } from "@/lib/plan-store"
import { cn } from "@/lib/utils"

/** Rough intensity of a sample-week session, from its wording, for the coloured bars. */
export function sessionTone(text: string): { level: number; color: string; label: string } {
  const t = text.toLowerCase()
  if (/dryland|power|strength|gym|upper|lower|full-body/.test(t)) return { level: 0.6, color: "#a78bfa", label: "Dryland" }
  if (/race|speed|broken|sprint|threshold|css|back-half|start/.test(t)) return { level: 0.95, color: "#fb7185", label: "Hard" }
  if (/recovery|rest|technique|stretch|fun|open$/.test(t)) return { level: 0.3, color: "#34d399", label: "Easy" }
  return { level: 0.62, color: "#38bdf8", label: "Aerobic" }
}

export function BuyButton({ plan, buying, owned, onBuy, className, compact }: {
  plan: StorePlan; buying: boolean; owned?: boolean; onBuy: () => void; className?: string; compact?: boolean
}) {
  if (owned) {
    return (
      <Link href={readerHref(plan.id)} aria-label={`Open ${plan.title}`}
        className={cn("store-cta inline-flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#6ee7b7,#34d399)] font-semibold text-emerald-950 shadow-[0_14px_34px_rgba(52,211,153,0.32)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(52,211,153,0.45)]",
          compact ? "h-9 px-4 text-sm" : "h-12 px-6 text-[15px]", className)}>
        <BookOpen className="h-4 w-4" />{compact ? "Open" : "Open plan"}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onBuy} disabled={buying}
      className={cn("store-cta inline-flex items-center justify-center gap-2 rounded-full bg-accent font-semibold text-accent-foreground shadow-[0_14px_34px_rgba(87,229,234,0.32)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(87,229,234,0.45)] disabled:translate-y-0 disabled:opacity-80",
        compact ? "h-9 px-4 text-sm" : "h-12 px-6 text-[15px]", className)}>
      {buying ? <><Loader2 className="h-4 w-4 animate-spin" />Opening checkout…</> : <><CreditCard className="h-4 w-4" />{compact ? "Buy" : `Buy now · ${formatPrice(plan.price, plan.currency)}`}</>}
    </button>
  )
}

/** Plan details with Look inside: the plan's cover as the store shows it, then the book's own first two pages after its
 * cover, which open larger to read. */
export function PlanPreview({ plan, open, onOpenChange, buying, owned, error, onBuy }: {
  plan: StorePlan | null; open: boolean; onOpenChange: (open: boolean) => void; buying: boolean; owned?: boolean; error: string | null; onBuy: (plan: StorePlan) => void
}) {
  const [slide, setSlide] = useState(0)
  const [direction, setDirection] = useState(1)
  const [reading, setReading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<{ id: string; pages?: PlanPreviewPages; failed?: string } | null>(null)
  const planId = plan?.id
  useEffect(() => { if (open) { setSlide(0); setDirection(1); setReading(false) } }, [open, planId])
  useEffect(() => {
    if (!open || !planId) return
    let cancelled = false
    fetchPlanPreview(planId)
      .then((pages) => { if (!cancelled) setPreview({ id: planId, pages }) })
      .catch((reason: Error) => { if (!cancelled) setPreview({ id: planId, failed: reason.message || "The preview didn't load." }) })
    return () => { cancelled = true }
  }, [open, planId, attempt])
  const shown = preview?.id === planId ? preview : null
  const pages = shown?.pages
  const count = pages?.book.pages.length ?? 2
  const firstPage = pages?.firstPage ?? 1
  // Slide 0 is the cover; slide 1 onwards, the book's pages (bookIndex into the preview).
  const slides = 1 + count
  const bookIndex = slide - 1
  const pageNumber = firstPage + bookIndex + 1
  const go = (next: number) => {
    const target = (next + slides) % slides
    setDirection(target > slide ? 1 : -1)
    setSlide(target)
  }
  /** In the larger view: between the book's pages only. */
  const turnPage = (by: 1 | -1) => go(slide + by < 1 ? slides - 1 : slide + by > slides - 1 ? 1 : slide + by)
  if (!plan) return null
  const color = ACCENT_COLORS[plan.accent]
  const flip = { "--flip-from": direction > 0 ? "-34deg" : "34deg", "--flip-shift": direction > 0 ? "26px" : "-26px", "--flip-origin": direction > 0 ? "left" : "right" } as CSSProperties
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] gap-0 overflow-y-auto border-white/10 bg-[#0a1118] p-0 sm:max-w-5xl"
        onKeyDown={(event) => { if (event.key === "ArrowRight") go(slide + 1); if (event.key === "ArrowLeft") go(slide - 1) }}>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Look inside: the cover, then the plan's own pages */}
          <div className="relative flex flex-col items-center overflow-hidden border-b border-white/[0.06] bg-[radial-gradient(circle_at_50%_30%,rgba(var(--accent-rgb),0.22),transparent_60%)] px-4 pb-5 pt-8 lg:border-b-0 lg:border-r" style={{ "--accent-rgb": color.rgb } as CSSProperties}>
            <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:18px_18px]" />
            <div className="relative flex w-full items-center justify-center gap-2">
              <button type="button" onClick={() => go(slide - 1)} aria-label="Previous page" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/10 sm:flex"><ChevronLeft className="h-5 w-5" /></button>
              <div className="relative aspect-[595/842] w-[262px] sm:w-[340px]" style={{ perspective: 1400 }}>
                {slide === 0 ? (
                  <button key={`${planId}-cover`} type="button" onClick={() => go(1)} aria-label={`Look inside ${plan.title}`}
                    className="store-flip group/page relative block h-full w-full rounded-[14px] text-left transition-shadow hover:shadow-[0_0_0_2px_rgba(87,229,234,0.6)]" style={flip}>
                    <PlanCover plan={plan} size="lg" className="aspect-auto h-full w-full" />
                    {/* A hint for mouse users only, in the cover's empty middle, so the cover itself stays as the store shows it */}
                    <span className="pointer-events-none absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-2 text-xs font-semibold text-slate-900 opacity-0 shadow-lg backdrop-blur transition-opacity group-focus-visible/page:opacity-100 [@media(hover:hover)]:group-hover/page:opacity-100">
                      <BookOpen className="h-3.5 w-3.5" />Look inside
                    </span>
                  </button>
                ) : pages ? (
                  <button key={`${planId}-${slide}`} type="button" onClick={() => setReading(true)} aria-label={`Read page ${pageNumber} larger`}
                    className="store-flip group/page relative block h-full w-full overflow-hidden rounded-[6px] bg-white text-left shadow-[0_24px_50px_rgba(0,0,0,0.5)] ring-1 ring-white/10 transition-shadow hover:shadow-[0_30px_60px_rgba(0,0,0,0.6),0_0_0_2px_rgba(87,229,234,0.6)]" style={flip}>
                    <BookPage book={pages.book} index={bookIndex} images={pages.images} label={`Page ${pageNumber}`} />
                    {/* Always there on touch screens; with a mouse, on hover, so it doesn't sit on the page */}
                    <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur transition-opacity group-focus-visible/page:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/page:opacity-100">
                      <ZoomIn className="h-3.5 w-3.5" />Tap to read
                    </span>
                  </button>
                ) : shown?.failed ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[6px] border border-white/10 bg-white/[0.03] p-6 text-center">
                    <p className="text-sm text-slate-300">{shown.failed}</p>
                    <button type="button" onClick={() => setAttempt((value) => value + 1)} className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/15">
                      <RotateCcw className="h-4 w-4" />Try again
                    </button>
                  </div>
                ) : (
                  <div role="status" aria-label="Loading the preview" className="store-shimmer h-full w-full rounded-[6px]" />
                )}
              </div>
              <button type="button" onClick={() => go(slide + 1)} aria-label="Next page" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/10 sm:flex"><ChevronRight className="h-5 w-5" /></button>
            </div>
            <div className="relative mt-5 flex gap-3">
              {Array.from({ length: slides }, (_, index) => (
                <button key={index} type="button" onClick={() => go(index)} aria-label={index === 0 ? "Show the cover" : `Show page ${firstPage + index}`} aria-current={index === slide}
                  className={cn("group flex flex-col items-center gap-1.5 transition-transform", index === slide ? "-translate-y-1" : "hover:-translate-y-0.5")}>
                  <span className={cn("block w-[57px] overflow-hidden rounded-md ring-2 transition-all", index === 0 ? "bg-[#070d14]" : "bg-white",
                    index === slide ? "ring-accent shadow-[0_0_18px_rgba(87,229,234,0.45)]" : "opacity-60 ring-white/10 group-hover:opacity-100")}
                    style={{ aspectRatio: "595 / 842" }}>
                    {index === 0 ? (
                      <span className="block origin-top-left scale-[0.1676]" style={{ width: 340, height: 481 }}><PlanCover plan={plan} size="lg" className="aspect-auto h-full w-full" /></span>
                    ) : pages ? <BookPage book={pages.book} index={index - 1} images={pages.images} /> : <span className="store-shimmer block h-full w-full" />}
                  </span>
                  <span className={cn("text-[10px] font-semibold", index === slide ? "text-cyan-200" : "text-slate-500")}>{index === 0 ? "Cover" : `Page ${firstPage + index}`}</span>
                </button>
              ))}
            </div>
            <p className="relative mt-4 max-w-[340px] text-center text-xs leading-5 text-slate-500">
              {pages ? `Pages ${firstPage + 1}–${firstPage + count} of ${pages.pageCount}, straight from the plan. ` : "A look inside the plan. "}
              {owned ? "Open the plan to read every page." : "Every page is yours once you buy."} Tap a page to read it larger.
            </p>
          </div>

          {/* A preview page, large enough to read */}
          {pages && (
            <Dialog open={reading && slide > 0} onOpenChange={setReading}>
              <DialogContent showCloseButton={false}
                className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-[#05090d]/95 p-0 backdrop-blur-sm sm:max-w-none"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
                  event.stopPropagation()  // the details dialog underneath turns pages on arrows too
                  turnPage(event.key === "ArrowRight" ? 1 : -1)
                }}>
                <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="truncate text-sm font-semibold text-white">{plan.title}</DialogTitle>
                    <DialogDescription className="truncate text-[11px] text-slate-400">Look inside · page {pageNumber} of {pages.pageCount}</DialogDescription>
                  </div>
                  <button type="button" onClick={() => turnPage(-1)} aria-label="Previous page" className="reader-icon-btn"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" onClick={() => turnPage(1)} aria-label="Next page" className="reader-icon-btn"><ChevronRight className="h-4 w-4" /></button>
                  <BuyButton plan={plan} buying={buying} owned={owned} onBuy={() => { setReading(false); onBuy(plan) }} compact className="hidden sm:inline-flex" />
                  <DialogClose aria-label="Close" className="reader-icon-btn"><X className="h-4 w-4" /></DialogClose>
                </div>
                <div className="flex-1 overflow-auto overscroll-contain">
                  <div key={slide} className="store-flip mx-auto my-4 overflow-hidden rounded-md bg-white shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:my-8"
                    style={{ ...flip, width: "min(900px, max(92vw, 760px))", aspectRatio: "595 / 842" }}>
                    <BookPage book={pages.book} index={Math.max(0, bookIndex)} images={pages.images} label={`Page ${pageNumber}`} />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

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
                { icon: FileText, value: plan.pages, label: "pages" },
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
                {owned ? (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">In your library</p>
                    <p className="mt-1 inline-flex items-center gap-2 text-2xl font-bold text-emerald-300"><Check className="h-6 w-6" strokeWidth={3} />Purchased</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">One-time price</p>
                    <p className="font-mono text-4xl font-bold tracking-tighter tabular-nums text-white">{formatPrice(plan.price, plan.currency)}</p>
                  </div>
                )}
                <p className="pb-1 text-right text-xs leading-5 text-slate-500">{owned ? <>Read it in SwimGPT,<br />on any device.</> : <>No subscription.<br />Yours to keep.</>}</p>
              </div>
              <BuyButton plan={plan} buying={buying} owned={owned} onBuy={() => onBuy(plan)} className="mt-4 w-full" />
              {error && <p role="alert" className="mt-3 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3 py-2 text-sm text-red-200">{error}</p>}
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                {owned ? "Saved to your SwimGPT account. Open it any time you sign in." : "Secure payment by Stripe. Card details never touch SwimGPT."}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
