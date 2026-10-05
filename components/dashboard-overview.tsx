"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { ArrowRight, CheckCircle2, Clock, Dumbbell, Flag, Heart, Moon, Sparkles, Timer, Waves } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DashboardOverviewData } from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import { ProgressRing, Reveal, Tile, TileHeader, isMissing } from "@/components/dashboard-ui"

type Metric = DashboardOverviewData["weekly"][number]

const categoryStyle: Record<string, { icon: LucideIcon; chip: string; bar: string }> = {
  swim: { icon: Waves, chip: "bg-accent/12 text-accent", bar: "from-cyan-300 to-sky-400" },
  workout: { icon: Dumbbell, chip: "bg-violet-400/12 text-violet-300", bar: "from-violet-300 to-fuchsia-400" },
  strength: { icon: Dumbbell, chip: "bg-violet-400/12 text-violet-300", bar: "from-violet-300 to-fuchsia-400" },
  mobility: { icon: Heart, chip: "bg-emerald-400/12 text-emerald-300", bar: "from-emerald-300 to-teal-400" },
  recovery: { icon: Moon, chip: "bg-amber-300/12 text-amber-200", bar: "from-amber-200 to-orange-300" },
}

const pickMetric = (items: Metric[], label: string) => items.find((item) => item.label === label)
/** "3 / 5" → done, total and percentage; null when the metric has no ratio. */
const ratio = (metric?: Metric) => {
  const match = metric?.value.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!match) return null
  const [done, total] = [Number(match[1]), Number(match[2])]
  return { done, total, percent: total > 0 ? (done / total) * 100 : 0 }
}

export function DashboardOverview({
  data,
  onViewToday,
}: {
  data: DashboardOverviewData
  onViewToday: () => void
}) {
  const consistency = [
    { label: "Swim week", metric: pickMetric(data.performance, "Swim week consistency"), tone: "cyan" as const, icon: Waves, iconTone: "text-accent" },
    { label: "Gym week", metric: pickMetric(data.performance, "Gym week consistency"), tone: "violet" as const, icon: Dumbbell, iconTone: "text-violet-300" },
  ]
  const competition = pickMetric(data.training_status, "Next major competition")
  const daysUntil = pickMetric(data.training_status, "Days until competition")
  const daysNumber = daysUntil && /^-?\d+$/.test(daysUntil.value) ? Number(daysUntil.value) : null

  return (
    <div className="space-y-5">
      {/* Today + highlight tiles */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Reveal index={0} className="xl:col-span-2">
          <Tile glow>
            <TileHeader
              icon={Clock}
              title="Today's training"
              subtitle={`${data.date} · your swim and workout for today`}
              action={
                <Button onClick={onViewToday} size="sm" className="rounded-full bg-accent px-4 text-accent-foreground hover:bg-accent/90">
                  Open swim week <ArrowRight className="h-4 w-4" />
                </Button>
              }
            />
            {data.today.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {data.today.map((session, index) => {
                  const style = categoryStyle[session.category] ?? categoryStyle.mobility
                  const done = session.status === "Completed"
                  return (
                    <div
                      key={`${session.category}-${index}`}
                      className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 transition-colors duration-300 hover:border-white/15"
                    >
                      <div className={cn("absolute inset-y-0 left-0 w-1 bg-gradient-to-b", style.bar)} />
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider", style.chip)}>
                          <style.icon className="h-3.5 w-3.5" />
                          {session.category}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                            done ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 text-slate-300",
                          )}
                        >
                          {done && <CheckCircle2 className="h-3 w-3" />}
                          {session.status}
                        </span>
                      </div>
                      <h4 className="mt-3 text-base font-semibold text-white">{session.name}</h4>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2 py-1 text-slate-200">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          {session.time}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2 py-1 text-slate-200">
                          <Timer className="h-3.5 w-3.5 text-slate-400" />
                          {session.duration}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">{session.objective}</p>
                      <p className="mt-2 text-[11px] text-slate-500">{session.basis}</p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
                <p className="text-sm text-slate-400">No swim or workout planned for today.</p>
              </div>
            )}
          </Tile>
        </Reveal>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <Reveal index={1}>
            <Tile>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Consistency this week</p>
              <div className="mt-4 grid grid-cols-2 gap-4">
                {consistency.map(({ label, metric, tone, icon: Icon, iconTone }) => {
                  const value = ratio(metric)
                  return (
                    <div key={label} className="flex min-w-0 flex-col items-center text-center">
                      <ProgressRing size={96} stroke={9} tone={tone} value={value?.percent ?? 0} label={`${label} consistency`}>
                        <span className="text-xl font-bold tabular-nums text-white">{value ? `${Math.round(value.percent)}%` : "—"}</span>
                      </ProgressRing>
                      <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-white"><Icon className={cn("h-3.5 w-3.5", iconTone)} />{label}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-slate-300">{value ? `${value.done} of ${value.total} done` : metric?.value ?? "Not recorded"}</p>
                      {metric?.detail && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{metric.detail.split(" · ")[0]}</p>}
                    </div>
                  )
                })}
              </div>
            </Tile>
          </Reveal>
          <Reveal index={2}>
            <Tile>
              <div className="flex h-full items-center gap-5">
                <div className="flex h-[112px] w-[112px] shrink-0 flex-col items-center justify-center rounded-full border border-amber-300/25 bg-[radial-gradient(circle,rgba(252,211,77,0.12),transparent_70%)]">
                  {daysNumber !== null ? (
                    <>
                      <span className="text-3xl font-bold tabular-nums text-white">{daysNumber}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">days</span>
                    </>
                  ) : (
                    <Flag className="h-8 w-8 text-amber-200/70" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Next competition</p>
                  <p className={cn("mt-1 font-semibold", competition && !isMissing(competition.value) ? "text-lg text-white" : "text-base text-slate-400")}>
                    {competition?.value ?? "Not scheduled"}
                  </p>
                  {competition?.detail && <p className="mt-1 text-xs leading-5 text-slate-500">{competition.detail}</p>}
                </div>
              </div>
            </Tile>
          </Reveal>
        </div>
      </div>

      {/* AI insight */}
      <Reveal index={3}>
        <div className="relative overflow-hidden rounded-[22px] border border-accent/25 bg-[linear-gradient(120deg,rgba(87,229,234,0.14),rgba(14,22,30,0.92)_45%,rgba(56,120,220,0.14))] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:p-7">
          <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-[0_0_30px_rgba(87,229,234,0.4)]">
              <Sparkles className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">AI performance insight</p>
              <h3 className="mt-1 text-xl font-semibold text-white">{data.insight.title}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-300">{data.insight.body}</p>
              <p className="mt-2 text-xs text-slate-500">{data.insight.basis}</p>
            </div>
            <Button asChild className="shrink-0 rounded-full bg-white/10 text-white hover:bg-white/15">
              <Link href="/coach-chat">
                Discuss with coach <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </div>
  )
}
