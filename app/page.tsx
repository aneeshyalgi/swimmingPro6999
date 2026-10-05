"use client"

import { Button } from "@/components/ui/button"
import { SiteNavbar } from "@/components/site-navbar"
import { WaterBubbles } from "@/components/water-bubbles"
import { SiteFooter } from "@/components/site-footer"
import { useState, type MouseEvent } from "react"
import Link from "next/link"
import { ArrowRight, Play, Sparkles } from "lucide-react"
import { RaceGhost } from "@/components/landing/race-ghost"
import { PlanComparison } from "@/components/landing/plan-comparison"
import { FeatureBento } from "@/components/landing/feature-bento"
import { CoachShowcase } from "@/components/landing/coach-showcase"
import { DemoPlayer, type DemoOrigin } from "@/components/landing/demo-player"
import { supabase } from "@/lib/supabase"

const demoVideoUrl = supabase.storage.from("Videos").getPublicUrl("gemini_generated_video_ff08e50c.mp4").data.publicUrl

const heroStats = [
  { value: "6", label: "pace zones from your PBs" },
  { value: "2", label: "elite coaches matched to you" },
  { value: "24/7", label: "coach chat" },
]

const sectionEyebrow =
  "mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300"

export default function HomePage() {
  const [showDemo, setShowDemo] = useState(false)
  const [demoOrigin, setDemoOrigin] = useState<DemoOrigin | null>(null)

  // The player's backdrop spreads out from (and drains back into) the button that opened it.
  const openDemo = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setDemoOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    setShowDemo(true)
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <SiteNavbar />

      <DemoPlayer open={showDemo} onClose={() => setShowDemo(false)} src={demoVideoUrl} origin={demoOrigin} />

      {/* Hero */}
      <section className="relative flex min-h-screen items-center overflow-hidden pb-20 pt-32">
        <div className="absolute inset-0 z-0">
          <img
            src="/underwater-swimming-pool-cinematic-blue-water.jpg"
            alt=""
            className="h-full w-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(87,229,234,0.22),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_119px,rgba(255,255,255,0.035)_120px)] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
          <WaterBubbles />
        </div>

        <div className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div className="text-center lg:text-left">
            <div className={`${sectionEyebrow} animate-in fade-in duration-700`}>
              <Sparkles className="h-3.5 w-3.5" />
              AI high-performance coaching
            </div>

            <h1 className="animate-in fade-in slide-in-from-bottom-4 text-balance text-5xl font-bold leading-[1.05] tracking-tight text-white duration-1000 md:text-7xl">
              Your entire Olympic coaching team,{" "}
              <span className="bg-gradient-to-r from-cyan-200 via-accent to-sky-400 bg-clip-text text-transparent">
                in one app.
              </span>
            </h1>

            <p className="animate-in fade-in slide-in-from-bottom-6 mx-auto mt-6 max-w-xl text-lg leading-8 text-slate-300 delay-200 duration-1000 md:text-xl lg:mx-0">
              The world&apos;s first AI high-performance swim coach. Swim and gym weeks that adapt, paces for every
              zone, race plans and stroke analysis, all built around you.
            </p>

            <div className="animate-in fade-in slide-in-from-bottom-8 mt-10 flex flex-col justify-center gap-3 delay-300 duration-1000 sm:flex-row lg:justify-start">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-accent px-7 text-base text-accent-foreground shadow-[0_12px_32px_rgba(87,229,234,0.35)] hover:bg-accent/90"
              >
                <Link href="/auth?mode=signup">
                  Start training
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-white/15 bg-white/[0.04] px-7 text-base text-white backdrop-blur-md hover:bg-white/[0.09] hover:text-white"
                onClick={openDemo}
              >
                <Play className="mr-2 h-4 w-4 fill-current" />
                Watch demo
              </Button>
            </div>

            <dl className="mx-auto mt-12 grid max-w-md grid-cols-3 divide-x divide-white/10 border-t border-white/10 pt-6 lg:mx-0">
              {heroStats.map((stat) => (
                <div key={stat.label} className="px-3 first:pl-0">
                  <dt className="sr-only">{stat.label}</dt>
                  <dd className="text-2xl font-bold text-white">{stat.value}</dd>
                  <dd className="mt-1 text-xs text-slate-400">{stat.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Hero: race your future self */}
          <div className="relative mx-auto w-full max-w-md animate-in fade-in slide-in-from-right-8 delay-300 duration-1000 lg:max-w-none">
            <RaceGhost />
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="relative overflow-hidden py-28">
        <div className="pointer-events-none absolute left-1/2 top-24 h-[28rem] w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(87,229,234,0.10),transparent_65%)]" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className={sectionEyebrow}>The problem</div>
            <h2 className="text-balance text-4xl font-bold tracking-tight text-white md:text-6xl">
              Why generic plans{" "}
              <span className="relative inline-block text-slate-500">
                fail
                <span className="absolute left-0 right-0 top-1/2 h-[3px] -rotate-3 rounded-full bg-rose-400/80" />
              </span>
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-400">
              A PDF can't see your times, your pool or yesterday's session. SwimGPT does, every single day.
            </p>
          </div>
          <div className="mt-14">
            <PlanComparison />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative overflow-hidden py-28">
        <div className="pointer-events-none absolute -right-40 top-10 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-40 bottom-10 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className={sectionEyebrow}>The platform</div>
            <h2 className="text-balance text-4xl font-bold tracking-tight text-white md:text-6xl">
              Everything you need to{" "}
              <span className="bg-gradient-to-r from-cyan-200 via-accent to-violet-300 bg-clip-text text-transparent">excel</span>
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-400">
              Not a list of features: a coaching team that plans, paces, lifts, races and reviews with you.
            </p>
          </div>
          <div className="mt-14">
            <FeatureBento />
          </div>
        </div>
      </section>

      {/* Coaches */}
      <CoachShowcase />

      {/* Final CTA */}
      <section id="start-onboarding" className="py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-[32px] border border-accent/25 bg-[linear-gradient(135deg,rgba(87,229,234,0.16),rgba(14,22,30,0.9)_45%,rgba(56,120,220,0.14))] px-6 py-16 text-center sm:px-12">
            <div className="absolute left-1/2 top-0 h-40 w-2/3 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
            <div className="relative">
              <h2 className="text-balance text-4xl font-bold tracking-tight text-white md:text-5xl">
                Join the high-performance revolution
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg text-slate-300">
                Start your journey to championship results today.
              </p>
              <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-accent px-8 text-base text-accent-foreground shadow-[0_12px_32px_rgba(87,229,234,0.35)] hover:bg-accent/90"
                >
                  <Link href="/auth?mode=signup">Begin your transformation</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-full border-white/15 bg-transparent px-8 text-base text-white hover:bg-white/[0.08] hover:text-white"
                >
                  <Link href="/auth">I already have an account</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
