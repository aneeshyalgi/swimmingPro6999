"use client"

import type { MouseEvent } from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowRight, CheckCircle2, Clock, Dumbbell, Flag, Heart, Moon, Sparkles, Timer, Waves } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DashboardOverviewData } from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import { ProgressRing, Reveal, Tile, TileHeader, isMissing } from "@/components/dashboard-ui"
import { ClampText } from "@/components/training-ui"
import { TrainingDaysEditor } from "@/components/training-days"

type Metric = DashboardOverviewData["weekly"][number]
type Session = DashboardOverviewData["today"][number]

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

/**
 * The dashboard's summary, in the order an athlete reads it: today's training, how the week is going and the next meet,
 * their coach's priority, then the days they train (a glance at the week, opened to change them).
 */
export function DashboardOverview({
  data,
  onViewToday,
  onOpenChat,
  onDaysSaved,
}: {
  data: DashboardOverviewData
  onViewToday: () => void
  onOpenChat: (event: MouseEvent<HTMLElement>) => void
  /** The athlete saved their training days: their swims and strength sessions a week now. */
  onDaysSaved: (week: { swims: number; strength: number }) => void
}) {
  const consistency = [
    { label: "Swim week", metric: pickMetric(data.performance, "Swim week consistency"), tone: "cyan" as const, icon: Waves, iconTone: "text-accent" },
    { label: "Gym week", metric: pickMetric(data.performance, "Gym week consistency"), tone: "violet" as const, icon: Dumbbell, iconTone: "text-violet-300" },
  ]
  const competition = pickMetric(data.training_status, "Next major competition")
  const daysUntil = pickMetric(data.training_status, "Days until competition")
  const daysNumber = daysUntil && /^-?\d+$/.test(daysUntil.value) ? Number(daysUntil.value) : null
  const done = data.today.filter((session) => session.status === "Completed").length

  return (
    <div className="space-y-5">
      {/* Today beside the rest of the week and the coach's priority (one after another on smaller screens). */}
      <div className="grid gap-5 xl:grid-cols-3 xl:items-start">
        {/* Today */}
        <Reveal index={0} className="xl:col-span-2">
          <Tile glow>
            <TileHeader
              icon={Clock}
              title="Today's training"
              subtitle={data.today.length ? `${data.date} · ${done} of ${data.today.length} done` : data.date}
              action={
                <Button onClick={onViewToday} size="sm" className="rounded-full bg-accent px-4 text-accent-foreground hover:bg-accent/90">
                  Open swim week <ArrowRight className="h-4 w-4" />
                </Button>
              }
            />
            {data.today.length ? (
              <ul className="space-y-2.5">
                {data.today.map((session, index) => <TodaySession key={`${session.category}-${index}`} session={session} />)}
              </ul>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
                <p className="text-sm text-slate-400">No swim or workout planned for today.</p>
              </div>
            )}
          </Tile>
        </Reveal>

        <div className="space-y-5">
          {/* This week: consistency, and the next meet */}
          <Reveal index={1}>
            <Tile>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Consistency this week</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {consistency.map(({ label, metric, tone, icon: Icon, iconTone }) => {
                  const value = ratio(metric)
                  return (
                    <div key={label} className="flex min-w-0 flex-col items-center text-center">
                      <ProgressRing size={84} stroke={8} tone={tone} value={value?.percent ?? 0} label={`${label} consistency`}>
                        <span className="text-lg font-bold tabular-nums text-white">{value ? `${Math.round(value.percent)}%` : "—"}</span>
                      </ProgressRing>
                      <p className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-white"><Icon className={cn("h-3.5 w-3.5", iconTone)} />{label}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-slate-300">{value ? `${value.done} of ${value.total} done` : metric?.value ?? "Not recorded"}</p>
                      {metric?.detail && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{metric.detail.split(" · ")[0]}</p>}
                    </div>
                  )
                })}
              </div>
              <div className="mt-5 flex items-center gap-4 border-t border-white/[0.06] pt-4">
                <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border border-amber-300/25 bg-[radial-gradient(circle,rgba(252,211,77,0.12),transparent_70%)]">
                  {daysNumber !== null ? (
                    <>
                      <span className="text-xl font-bold tabular-nums leading-none text-white">{daysNumber}</span>
                      <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-amber-200">days</span>
                    </>
                  ) : (
                    <Flag className="h-6 w-6 text-amber-200/70" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Next competition</p>
                  <p className={cn("mt-0.5 font-semibold", competition && !isMissing(competition.value) ? "text-white" : "text-slate-400")}>
                    {competition?.value ?? "Not scheduled"}
                  </p>
                  {competition?.detail && <p className="mt-0.5 text-xs leading-5 text-slate-500">{competition.detail}</p>}
                </div>
              </div>
            </Tile>
          </Reveal>

          {/* The coach's priority: a column of its own beside Today, a row across the page on its own (container query) */}
          <Reveal index={2}>
            <div className="@container relative overflow-hidden rounded-[22px] border border-accent/25 bg-[linear-gradient(120deg,rgba(87,229,234,0.12),rgba(14,22,30,0.92)_45%,rgba(56,120,220,0.12))] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.3)] sm:p-6">
              <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-accent/15 blur-3xl" />
              <div className="relative flex flex-col gap-4 @xl:flex-row @xl:items-start">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-[0_0_26px_rgba(87,229,234,0.35)]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">AI performance insight</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">{data.insight.title}</h3>
                  <ClampText text={data.insight.body} clamp="line-clamp-3" className="mt-1.5 text-sm leading-6 text-slate-300" />
                  <p className="mt-2 text-xs text-slate-500">{data.insight.basis}</p>
                </div>
                <Button onClick={onOpenChat} className="shrink-0 cursor-pointer self-start rounded-full bg-white/10 text-white hover:bg-white/15">
                  Discuss with coach <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      {/* The days the athlete trains */}
      <Reveal index={3}>
        <TrainingDaysEditor onSaved={onDaysSaved} onOpenTraining={onViewToday} />
      </Reveal>
    </div>
  )
}

/** One of today's sessions, on a line of its own: what it is and how it stands, when and how long, and what it's for. */
function TodaySession({ session }: { session: Session }) {
  const style = categoryStyle[session.category] ?? categoryStyle.mobility
  const done = session.status === "Completed"
  return (
    <li className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] py-3.5 pl-5 pr-4 transition-colors duration-300 hover:border-white/15">
      <div className={cn("absolute inset-y-0 left-0 w-1 bg-gradient-to-b", style.bar)} />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", style.chip)}>
              <style.icon className="h-3 w-3" />
              {session.category}
            </span>
            <span className="text-[11px] text-slate-500">{session.basis}</span>
          </div>
          <h4 className="mt-1.5 font-semibold leading-6 text-white">{session.name}</h4>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
          done ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 text-slate-300")}>
          {done && <CheckCircle2 className="h-3 w-3" />}
          {session.status}
        </span>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-slate-400">
        <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-slate-500" />{session.time}</span>
        <span className="inline-flex items-center gap-1.5"><Timer className="h-3.5 w-3.5 text-slate-500" />{session.duration}</span>
      </p>
      <ClampText text={session.objective} clamp="line-clamp-2" className="mt-2 text-sm leading-6 text-slate-300" />
    </li>
  )
}
