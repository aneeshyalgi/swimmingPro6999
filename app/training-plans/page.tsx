"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUpDown, BookOpen, RotateCcw, Search, ShieldCheck, Sparkles, X } from "lucide-react"
import { SiteNavbar } from "@/components/site-navbar"
import { SiteFooter } from "@/components/site-footer"
import { WaterBubbles } from "@/components/water-bubbles"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlanCard, PlanCardSkeleton } from "@/components/plan-store/plan-card"
import { PlanPreview } from "@/components/plan-store/plan-preview"
import { CategoryTabs, FeaturedPlan, HeroStack, HowItWorks } from "@/components/plan-store/store-ui"
import { fetchCatalog, formatPrice, startPlanCheckout, type Catalog, type StorePlan } from "@/lib/plan-store"

type Sort = "featured" | "price-asc" | "price-desc" | "shortest"
const SORTS: { value: Sort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "shortest", label: "Shortest first" },
]

const FAQ = [
  { q: "Is this a subscription?", a: "No. Each plan is a one-time purchase. Pay once and the PDF is yours to keep." },
  { q: "What do I actually get?", a: "A print-ready PDF with every session written out: sets, send-offs and notes, plus the extras listed on each plan, like dryland, taper or race-day pages." },
  { q: "Do I need a SwimGPT membership?", a: "No. The plans work on their own. Members still get their personalised Swim Week and Gym Week in the app; these PDFs are focused blocks for a specific goal." },
  { q: "Which plan should I choose?", a: "Start with your main event and level. Open \"Details\" on any plan to see its cover, a sample week and everything that's included before you buy." },
]

export default function TrainingPlansPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [category, setCategory] = useState("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>("featured")
  const [previewing, setPreviewing] = useState<StorePlan | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoadError(null)
    fetchCatalog().then(setCatalog).catch((error: Error) => setLoadError(error.message || "Couldn't load the plans."))
  }, [])
  useEffect(load, [load])

  // Back from a cancelled Stripe checkout: say so, and tidy the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("checkout") === "cancelled") {
      setCancelled(params.get("plan") ?? "")
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  const plans = useMemo(() => catalog?.plans ?? [], [catalog])
  const featured = plans.find((plan) => plan.badge === "Bestseller") ?? plans[0]
  const cancelledPlan = plans.find((plan) => plan.id === cancelled)
  // Hero fan: badged plans first, each a different colour; the top one sits in the middle (last = on top).
  const heroPlans = useMemo(() => {
    const picked: StorePlan[] = []
    for (const plan of [...plans.filter((p) => p.badge), ...plans.filter((p) => !p.badge)]) {
      if (picked.length < 3 && !picked.some((p) => p.accent === plan.accent)) picked.push(plan)
    }
    return picked.length === 3 ? [picked[1], picked[2], picked[0]] : []
  }, [plans])

  const tabs = useMemo(() => [
    { key: "all", label: "All plans", count: plans.length },
    ...(catalog?.categories ?? []).map((name) => ({ key: name, label: name, count: plans.filter((plan) => plan.category === name).length })).filter((tab) => tab.count),
  ], [catalog, plans])

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = plans.filter((plan) => {
      if (category !== "all" && plan.category !== category) return false
      const haystack = [plan.title, plan.tagline, plan.category, plan.level, ...plan.events].join(" ").toLowerCase()
      return words.every((word) => haystack.includes(word))
    })
    if (sort === "price-asc") return [...list].sort((a, b) => a.price - b.price)
    if (sort === "price-desc") return [...list].sort((a, b) => b.price - a.price)
    if (sort === "shortest") return [...list].sort((a, b) => a.weeks - b.weeks)
    return list
  }, [plans, category, query, sort])

  const openPreview = (plan: StorePlan) => {
    setCheckoutError(null)
    setPreviewing(plan)
    setPreviewOpen(true)
  }

  const buy = async (plan: StorePlan) => {
    if (buyingId) return
    setBuyingId(plan.id)
    setCheckoutError(null)
    try {
      await startPlanCheckout(plan.id)
    } catch (error) {
      setBuyingId(null)
      openPreview(plan)
      setCheckoutError(error instanceof Error ? error.message : "Couldn't start checkout. Please try again.")
    }
  }

  const prices = plans.map((plan) => plan.price)
  const weeks = plans.map((plan) => plan.weeks)
  const filtersKey = `${category}|${sort}|${query}`

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <SiteNavbar />

      {/* Hero */}
      <section className="relative overflow-hidden pb-12 pt-32 sm:pt-36">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(87,229,234,0.16),transparent_55%),radial-gradient(ellipse_at_10%_80%,rgba(167,139,250,0.10),transparent_50%)]" />
        <WaterBubbles />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-8">
          <div className="dash-reveal text-center lg:text-left">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300">
              <BookOpen className="h-3.5 w-3.5" />The SwimGPT plan store
            </div>
            <h1 className="text-balance text-5xl font-bold leading-[1.04] tracking-tight text-white md:text-6xl">
              One goal. One plan.{" "}
              <span className="bg-gradient-to-r from-cyan-200 via-accent to-violet-300 bg-clip-text text-transparent">Every session written out.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-slate-300 lg:mx-0">
              Focused PDF training plans from SwimGPT, built for a single event or block. Buy once, print it or keep it on your phone, and swim it.
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <a href="#plans" className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-base font-semibold text-accent-foreground shadow-[0_12px_32px_rgba(87,229,234,0.35)] transition-transform hover:-translate-y-0.5">
                Browse plans<ArrowDown className="h-4 w-4" />
              </a>
              {featured && (
                <button type="button" onClick={() => openPreview(featured)} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-7 text-base font-medium text-white transition-colors hover:bg-white/[0.09]">
                  <Sparkles className="h-4 w-4 text-cyan-200" />Look inside the bestseller
                </button>
              )}
            </div>
            {plans.length > 0 && (
              <dl className="mx-auto mt-10 grid max-w-md grid-cols-3 gap-3 lg:mx-0">
                {[
                  { label: "plans", value: String(plans.length) },
                  { label: "weeks long", value: `${Math.min(...weeks)}–${Math.max(...weeks)}` },
                  { label: "one-time", value: `from ${formatPrice(Math.min(...prices))}` },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3 py-3">
                    <dt className="sr-only">{stat.label}</dt>
                    <dd className="font-mono text-lg font-bold tabular-nums text-white sm:text-xl">{stat.value}</dd>
                    <dd className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{stat.label}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {heroPlans.length === 3 ? <HeroStack plans={heroPlans} onPick={openPreview} /> : <div className="h-[380px] sm:h-[460px]" />}
        </div>
      </section>

      {cancelled !== null && (
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div role="status" className="dash-reveal flex flex-col gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-amber-50/90"><span className="font-semibold text-amber-100">Checkout cancelled.</span> You weren&apos;t charged{cancelledPlan ? ` for ${cancelledPlan.title}` : ""}.</p>
            <div className="flex gap-2">
              {cancelledPlan && <button type="button" onClick={() => openPreview(cancelledPlan)} className="h-8 rounded-full bg-amber-200 px-3.5 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-100">Back to the plan</button>}
              <button type="button" onClick={() => setCancelled(null)} aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center rounded-full text-amber-100/70 transition-colors hover:bg-white/10 hover:text-amber-50"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Spotlight */}
      {featured && (
        <section className="relative py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <FeaturedPlan plan={featured} buying={buyingId === featured.id} onPreview={() => openPreview(featured)} onBuy={() => buy(featured)} />
          </div>
        </section>
      )}

      {/* Catalog */}
      <section id="plans" className="relative scroll-mt-24 py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-balance text-3xl font-bold tracking-tight text-white md:text-4xl">Find your plan</h2>
              <p className="mt-2 text-slate-400">Filter by goal, then look inside before you buy.</p>
            </div>
            <div className="flex gap-2">
              <label className="relative flex-1 md:w-64 md:flex-none">
                <span className="sr-only">Search plans</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events, goals…"
                  className="h-11 w-full rounded-full border border-white/[0.08] bg-white/[0.03] pl-10 pr-9 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/40 focus:bg-white/[0.05]" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>}
              </label>
              <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
                <SelectTrigger aria-label="Sort plans" className="!h-11 w-auto gap-2 rounded-full border-white/[0.08] bg-white/[0.03] px-4 text-sm text-white">
                  <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" /><SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0d151d]">
                  {SORTS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-7">
            {tabs.length > 1 ? <CategoryTabs options={tabs} value={category} onChange={setCategory} /> : <div className="store-shimmer h-11 w-full max-w-xl rounded-full" />}
          </div>

          <div className="mt-8">
            {loadError ? (
              <div className="flex flex-col items-center rounded-[26px] border border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
                <p className="text-lg font-semibold text-white">The plan store didn&apos;t load</p>
                <p className="mt-2 max-w-md text-sm text-slate-400">{loadError}</p>
                <button type="button" onClick={load} className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground"><RotateCcw className="h-4 w-4" />Try again</button>
              </div>
            ) : !catalog ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <PlanCardSkeleton key={index} />)}</div>
            ) : visible.length === 0 ? (
              <div className="dash-reveal flex flex-col items-center rounded-[26px] border border-dashed border-white/[0.12] px-6 py-16 text-center">
                <Search className="h-8 w-8 text-slate-600" />
                <p className="mt-4 text-lg font-semibold text-white">No plans match that</p>
                <p className="mt-1 text-sm text-slate-400">Try another word or category.</p>
                <button type="button" onClick={() => { setQuery(""); setCategory("all") }} className="mt-5 h-9 rounded-full border border-white/12 bg-white/[0.04] px-4 text-sm text-white hover:bg-white/[0.09]">Show all plans</button>
              </div>
            ) : (
              <div key={filtersKey} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((plan, index) => (
                  <PlanCard key={plan.id} plan={plan} index={index} buying={buyingId === plan.id} onPreview={() => openPreview(plan)} onBuy={() => buy(plan)} />
                ))}
              </div>
            )}
            {checkoutError && !previewOpen && <p role="alert" className="mt-4 text-center text-sm text-red-300">{checkoutError}</p>}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative border-y border-white/[0.06] bg-muted/20 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-white md:text-4xl">From checkout to the pool</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-400">Three steps, about a minute.</p>
          <div className="mt-14"><HowItWorks /></div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Questions</h2>
            <p className="mt-3 text-slate-400">Everything else about buying a plan.</p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-1.5 text-xs text-emerald-100"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />Payments handled securely by Stripe</p>
          </div>
          <Accordion type="single" collapsible className="rounded-[24px] border border-white/[0.08] bg-white/[0.02] px-5">
            {FAQ.map((item) => (
              <AccordionItem key={item.q} value={item.q} className="border-white/[0.07]">
                <AccordionTrigger className="text-left text-base text-white hover:no-underline">{item.q}</AccordionTrigger>
                <AccordionContent className="text-sm leading-6 text-slate-400">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <SiteFooter />

      <PlanPreview plan={previewing} open={previewOpen} onOpenChange={setPreviewOpen} buying={buyingId === previewing?.id} error={checkoutError} onBuy={buy} />
    </div>
  )
}
