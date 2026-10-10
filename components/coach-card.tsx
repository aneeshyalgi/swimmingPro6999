"use client"

import { useId, useState } from "react"
import type { ReactNode } from "react"
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Dumbbell,
  Gauge,
  Layers,
  Sparkles,
  Target,
  TrendingDown,
  Wrench,
} from "lucide-react"
import { CoachAvatar } from "@/components/coach-avatar"
import { cn } from "@/lib/utils"

// Mirrors backend/app/coach_catalog.py public_profile() + context.coach_recommendation().
export type CoachProfile = {
  key: string
  name: string
  title: string
  inspired_by: string | null
  summary: string
  swimmer_types: string[]
  main_events: string[]
  supporting_events: string[]
  requires_gym: boolean
  principles: string[]
  training_cycle?: string[]
  weekly_structure: { sessions_per_week: number; order: string[] }[]
  sessions: { type: string; count: number; description: string }[]
  taper_sessions: { type: string; count: number }[]
  intensity_guide: { level: string; detail: string }[]
  equipment: string[]
  glossary: { term: string; meaning: string }[]
  source_files: string[]
  covered_events: string[]
  supported_events: string[]
  reasons: string[]
  your_week: { requested: number; sessions_per_week: number; order: string[] } | null
  // Only in the onboarding coach step (POST /api/coaches/options): true for the top match.
  recommended?: boolean
}

function Section({ icon: Icon, title, children, className }: { icon: typeof Target; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-white/8 bg-white/[0.02] p-5", className)}>
      <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        <Icon className="h-3.5 w-3.5 text-accent" />
        {title}
      </h4>
      {children}
    </section>
  )
}

/** `label` replaces the "Match 01" eyebrow; `alwaysOpen` shows the full profile with no toggle (used in the coach details sheet). */
export function CoachCard({ coach, index, label, alwaysOpen = false }: { coach: CoachProfile; index: number; label?: ReactNode; alwaysOpen?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const open = alwaysOpen || expanded
  const panelId = useId()
  const yourRow = coach.your_week?.sessions_per_week

  return (
    <article className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(160deg,rgba(22,34,44,0.9),rgba(10,15,21,0.95))] shadow-[0_18px_50px_rgba(0,0,0,0.3)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-sky-500/60 to-transparent" />

      {/* Summary */}
      <div className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-2xl bg-accent/25 blur-xl" />
            <CoachAvatar name={coach.name} className="relative h-20 w-20 shadow-[0_12px_30px_rgba(0,0,0,0.35)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {label ?? <>
                Match {String(index + 1).padStart(2, "0")}
                {index === 0 && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-accent">Lead coach</span>}
              </>}
            </p>
            <h3 className="mt-1 text-2xl font-bold text-white">{coach.name}</h3>
            <p className="text-sm text-slate-300">
              {coach.title}
              {coach.inspired_by && <span className="text-slate-500"> · inspired by {coach.inspired_by}</span>}
            </p>

            {(coach.covered_events.length > 0 || coach.supported_events.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {coach.covered_events.map((event) => (
                  <span key={event} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 font-medium text-accent">
                    <Check className="h-3 w-3" strokeWidth={3} />
                    {event}
                  </span>
                ))}
                {coach.supported_events.map((event) => (
                  <span key={event} className="rounded-full border border-dashed border-accent/30 px-3 py-1.5 text-slate-300">
                    {event} · pace work
                  </span>
                ))}
              </div>
            )}

            <ul className="mt-4 space-y-1.5">
              {coach.reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-sm text-slate-300">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {!alwaysOpen && <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
          className="mt-5 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white transition-colors hover:border-accent/40 hover:bg-accent/[0.06]"
        >
          {open ? "Hide coach profile" : `View ${coach.name}'s full profile`}
          <ChevronDown className={cn("h-4 w-4 text-accent transition-transform duration-300", open && "rotate-180")} />
        </button>}
      </div>

      {/* Full profile */}
      <div
        id={panelId}
        inert={!open}
        className={cn("grid transition-[grid-template-rows] duration-500 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="overflow-hidden">
          <div className="grid grid-cols-1 gap-4 border-t border-white/8 p-4 sm:p-6 lg:grid-cols-2">
            <Section icon={BookOpen} title="Coaching approach" className="lg:col-span-2">
              <p className="text-sm leading-6 text-slate-200">{coach.summary}</p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {coach.principles.map((principle) => (
                  <li key={principle} className="flex gap-2 text-sm leading-6 text-slate-300">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {principle}
                  </li>
                ))}
              </ul>
            </Section>

            <Section icon={CalendarDays} title={coach.weekly_structure.length ? "Your week with this coach" : "Training cycle"} className="lg:col-span-2">
              {coach.your_week ? (
                <>
                  <ol className="flex flex-wrap gap-2">
                    {coach.your_week.order.map((session, idx) => (
                      <li key={`${session}-${idx}`} className="flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/[0.07] px-3 py-2 text-sm text-white">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">{idx + 1}</span>
                        {session}
                      </li>
                    ))}
                  </ol>
                  {coach.your_week.requested !== coach.your_week.sessions_per_week && (
                    <p className="mt-3 text-xs text-amber-200/90">
                      You chose {coach.your_week.requested} swim sessions per week. {coach.name}&apos;s plan is written for{" "}
                      {coach.weekly_structure[0].sessions_per_week}–{coach.weekly_structure[coach.weekly_structure.length - 1].sessions_per_week}, so
                      you&apos;ll follow the {coach.your_week.sessions_per_week}-session week.
                    </p>
                  )}
                </>
              ) : coach.training_cycle?.length ? (
                <ol className="flex flex-wrap gap-2">
                  {coach.training_cycle.map((session, idx) => (
                    <li key={`${session}-${idx}`} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold">{idx + 1}</span>
                      {session}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-400">This coach&apos;s plan doesn&apos;t define a fixed weekly order.</p>
              )}

              {coach.weekly_structure.length > 0 && (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <caption className="sr-only">{coach.name}&apos;s session order for each number of sessions per week</caption>
                    <thead>
                      <tr className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                        <th scope="col" className="w-20 pb-2 font-medium">Per week</th>
                        <th scope="col" className="pb-2 font-medium">Session order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coach.weekly_structure.map((row) => (
                        <tr key={row.sessions_per_week} className={cn("border-t border-white/5", row.sessions_per_week === yourRow && "bg-accent/[0.07]")}>
                          <th scope="row" className={cn("py-2 pl-2 font-semibold", row.sessions_per_week === yourRow ? "text-accent" : "text-slate-300")}>
                            {row.sessions_per_week}×
                          </th>
                          <td className="py-2 pr-2 text-slate-300">{row.order.join(" → ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section icon={Layers} title="Session library" className="lg:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2">
                {coach.sessions.map((session) => (
                  <div key={session.type} className="rounded-xl border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-white">{session.type}</p>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-slate-400">
                        {session.count} session{session.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-slate-400">{session.description}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={TrendingDown} title="Taper sessions">
              {coach.taper_sessions.length ? (
                <div className="flex flex-wrap gap-2">
                  {coach.taper_sessions.map((taper) => (
                    <span key={taper.type} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-200">
                      {taper.type} <span className="text-slate-500">×{taper.count}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No separate taper document for this coach.</p>
              )}
            </Section>

            <Section icon={Target} title="Main events">
              <div className="flex flex-wrap gap-2">
                {coach.main_events.map((event) => {
                  const yours = coach.covered_events.includes(event)
                  return (
                    <span
                      key={event}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm",
                        yours ? "border-accent/40 bg-accent/10 text-accent" : "border-white/10 text-slate-300",
                      )}
                    >
                      {event}
                    </span>
                  )
                })}
              </div>
              {coach.supporting_events.length > 0 && (
                <p className="mt-3 text-xs text-slate-500">Also includes pace work for: {coach.supporting_events.join(", ")}</p>
              )}
            </Section>

            {coach.intensity_guide.length > 0 && (
              <Section icon={Gauge} title="Intensity guide" className="lg:col-span-2">
                <dl className="grid gap-2 sm:grid-cols-2">
                  {coach.intensity_guide.map((item) => (
                    <div key={item.level} className="flex gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm">
                      <dt className="w-28 shrink-0 font-semibold text-white">{item.level}</dt>
                      <dd className="text-slate-400">{item.detail}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            <Section icon={coach.requires_gym ? Dumbbell : Wrench} title="Equipment">
              <div className="flex flex-wrap gap-2">
                {coach.equipment.map((item) => (
                  <span key={item} className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-sm text-slate-200">
                    {item}
                  </span>
                ))}
              </div>
            </Section>

            <Section icon={BookOpen} title="Glossary">
              <dl className="space-y-1.5 text-sm">
                {coach.glossary.map((item) => (
                  <div key={item.term} className="flex gap-3">
                    <dt className="w-20 shrink-0 font-mono text-xs font-semibold leading-6 text-accent">{item.term}</dt>
                    <dd className="text-slate-300">{item.meaning}</dd>
                  </div>
                ))}
              </dl>
            </Section>

          </div>
        </div>
      </div>
    </article>
  )
}
