"use client"

import type { MouseEvent, ReactNode } from "react"
import { CheckCircle2, Clock, Dumbbell, Flame, Lightbulb, Pencil, Snowflake, Sparkles, UserRound, Waves } from "lucide-react"
import { Expander } from "@/components/training-ui"
import { cn } from "@/lib/utils"
import type { GymItem } from "@/lib/training"

export const doseTones: Record<string, { chip: string; icon: string; bar: string }> = {
  Minimal: { chip: "border-sky-300/30 bg-sky-300/10 text-sky-100", icon: "bg-sky-300/15 text-sky-200", bar: "from-sky-300 to-sky-400" },
  Moderate: { chip: "border-violet-300/30 bg-violet-400/10 text-violet-100", icon: "bg-violet-400/15 text-violet-200", bar: "from-violet-300 to-fuchsia-400" },
  Full: { chip: "border-amber-300/30 bg-amber-300/10 text-amber-100", icon: "bg-amber-300/15 text-amber-200", bar: "from-amber-200 to-orange-300" },
}

export function DoseChip({ dose, className }: { dose: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", (doseTones[dose] ?? doseTones.Moderate).chip, className)}>{dose}</span>
}

function List({ icon: Icon, title, items, tone, dot }: { icon: typeof Flame; title: string; items: string[]; tone: string; dot: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h5 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400"><Icon className={cn("h-3.5 w-3.5", tone)} />{title}</h5>
      <ul className="mt-2.5 space-y-1.5 text-sm text-slate-300">{items.map((item, index) => <li key={index} className="flex gap-2"><span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />{item}</li>)}</ul>
    </div>
  )
}

const SECTION_DOTS: Record<string, string> = {
  warmup: "bg-orange-300", activation: "bg-amber-300", main: "bg-violet-400", power: "bg-fuchsia-400", accessory: "bg-sky-300",
  core: "bg-emerald-400", conditioning: "bg-rose-400", mobility: "bg-teal-300", cooldown: "bg-cyan-300", custom: "bg-slate-400",
}

/** Full prescription for a strength workout. */
export function GymWorkoutDetails({ item }: { item: GymItem }) {
  const workout = item.workout
  if (workout.sections?.length) {
    return (
      <div className="space-y-4">
        {workout.rationale && <p className="flex gap-2.5 rounded-2xl border border-accent/20 bg-accent/[0.06] p-3.5 text-sm leading-6 text-slate-200"><Lightbulb className="mt-1 h-4 w-4 shrink-0 text-accent" /><span><span className="font-semibold text-white">Why this workout: </span>{workout.rationale}</span></p>}
        {workout.objective && <p className="whitespace-pre-line text-sm leading-6 text-slate-300">{workout.objective}</p>}
        {workout.sections.map((section) => {
          const sets = section.exercises.reduce((sum, row) => sum + row.sets, 0)
          if (!section.notes.trim() && !section.exercises.length) return null
          return (
            <div key={section.id} className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 pl-5">
              <span className={cn("absolute inset-y-0 left-0 w-1", SECTION_DOTS[section.kind] ?? SECTION_DOTS.custom)} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-sm font-bold uppercase tracking-[0.12em] text-violet-200">{section.title}</h5>
                {section.exercises.length > 0 && <span className="text-[11px] font-semibold tabular-nums text-slate-400">{section.exercises.length} ex · {sets} sets</span>}
              </div>
              {section.notes.trim() && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-300">{section.notes}</p>}
              {section.exercises.length > 0 && <ol className="mt-3 divide-y divide-white/[0.05]">
                {section.exercises.map((row, index) => (
                  <li key={index} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="w-5 shrink-0 text-xs font-bold text-slate-500">{index + 1}</span>
                    <span className="min-w-0 flex-1 font-medium text-white">{row.name}</span>
                    <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-violet-100">{row.sets} × {row.reps || "—"}</span>
                    {row.load && <span className="text-xs text-slate-400">{row.load}</span>}
                    <span className="text-xs tabular-nums text-slate-500">{row.rest_seconds}s rest{row.tempo && ` · ${row.tempo}`}</span>
                    {row.notes && <span className="basis-full pl-8 text-xs text-slate-500">{row.notes}</span>}
                  </li>
                ))}
              </ol>}
            </div>
          )
        })}
        {workout.coaching_notes && <p className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-200">Coach's notes: </span>{workout.coaching_notes}</p>}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {workout.rationale && <p className="flex gap-2.5 rounded-2xl border border-accent/20 bg-accent/[0.06] p-3.5 text-sm leading-6 text-slate-200"><Lightbulb className="mt-1 h-4 w-4 shrink-0 text-accent" /><span><span className="font-semibold text-white">Why this workout: </span>{workout.rationale}</span></p>}
      {workout.objective && <p className="text-sm leading-6 text-slate-300">{workout.objective}</p>}
      {workout.warm_up.length > 0 && <List icon={Flame} title="Warm-up" items={workout.warm_up} tone="text-orange-300" dot="bg-orange-300" />}
      <ol className="space-y-2.5">
        {workout.exercises.map((exercise, index) => (
          <li key={index} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 transition-colors hover:border-white/15">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h5 className="flex items-center gap-2.5 font-semibold text-white"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-bold text-slate-300">{index + 1}</span>{exercise.exercise}</h5>
              <span className="rounded-full bg-violet-400/15 px-2.5 py-0.5 text-xs font-semibold text-violet-100">{exercise.sets} × {exercise.repetitions}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {([["Load", exercise.load], ["Rest", `${exercise.rest_seconds}s`], ["Tempo", exercise.tempo || "Controlled"]] as const).map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-xl bg-black/20 px-3 py-2"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-slate-200">{value}</dd></div>
              ))}
            </dl>
            <ol className="mt-3 space-y-1.5 text-sm text-slate-400">{exercise.demonstration.map((step, stepIndex) => <li key={stepIndex} className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-bold text-slate-300">{stepIndex + 1}</span>{step}</li>)}</ol>
            {exercise.swim_benefit && <p className="mt-3 flex gap-2 text-xs leading-5 text-cyan-100/80"><Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{exercise.swim_benefit}</p>}
          </li>
        ))}
      </ol>
      {workout.cool_down.length > 0 && <List icon={Snowflake} title="Cool-down" items={workout.cool_down} tone="text-sky-300" dot="bg-sky-300" />}
      {workout.coaching_notes && <p className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-200">Coach's notes: </span>{workout.coaching_notes}</p>}
    </div>
  )
}

/** A strength workout's prescription and its builder and ••• controls (the open card and the full-screen workout view). */
export function GymWorkoutBody({ item, onEdit, actions }: { item: GymItem; onEdit: () => void; actions?: ReactNode }) {
  return (
    <>
      <GymWorkoutDetails item={item} />
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
        {!item.completed && <button type="button" onClick={onEdit} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 text-sm font-medium text-white transition-colors hover:border-violet-300/50 hover:bg-violet-400/10"><Pencil className="h-3.5 w-3.5 text-violet-300" />Open in builder</button>}
        {item.completed && <span className="text-xs text-slate-500">Untick it to edit, move or delete.</span>}
        <span className="flex-1" />
        {actions}
      </div>
    </>
  )
}

/**
 * A strength workout in the Workout Library calendar. With `onOpen` its button opens the workout full screen; without
 * it the card expands in place (`defaultOpen` starts it expanded, as in the full-screen day view).
 */
export function GymWorkoutCard({ item, onEdit, actions, className, defaultOpen = false, onOpen }: {
  item: GymItem
  onEdit: () => void
  actions?: ReactNode
  className?: string
  defaultOpen?: boolean
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const tone = doseTones[item.dose] ?? doseTones.Moderate
  const meta = item.workout.meta
  const when = [meta?.label, meta?.start_time && (meta.end_time ? `${meta.start_time}–${meta.end_time}` : meta.start_time)].filter(Boolean).join(" · ")
  const manual = item.source === "manual"
  return (
    <Expander defaultOpen={defaultOpen} onOpen={onOpen} className={cn(item.completed ? "border-emerald-400/25" : "border-violet-400/15", className)} header={
      <div className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", item.completed ? "bg-emerald-400/15 text-emerald-300" : tone.icon)}>{item.completed ? <CheckCircle2 className="h-5 w-5" /> : <Dumbbell className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px normal-case tracking-normal", manual ? "bg-sky-400/15 text-sky-200" : "bg-violet-400/15 text-violet-200")}>
              {manual ? <UserRound className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}{manual ? "Yours" : "AI"}
            </span>
            {when && <span className="normal-case tracking-normal text-slate-400">{when}</span>}
            {item.completed && <span>Completed</span>}
            {item.edited && !manual && <span className="inline-flex items-center gap-1 normal-case tracking-normal"><Pencil className="h-2.5 w-2.5" />edited</span>}
          </p>
          <p className="truncate font-semibold text-white">{item.workout.title}</p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1"><DoseChip dose={item.dose} /><span className="flex items-center gap-1 text-[11px] text-slate-400"><Clock className="h-3 w-3" />{item.workout.estimated_duration_minutes} min</span></span>
      </div>}>
      <GymWorkoutBody item={item} onEdit={onEdit} actions={actions} />
    </Expander>
  )
}
