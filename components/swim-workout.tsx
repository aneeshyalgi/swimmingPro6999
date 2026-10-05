import { Clock, Dumbbell, NotebookPen, Repeat, Ruler, Target } from "lucide-react"
import type { SwimWorkout } from "@/lib/training"
import { cn } from "@/lib/utils"
import { ZoneChip, zoneTone } from "@/components/training-ui"

export function SwimWorkoutDetails({ workout }: { workout: SwimWorkout }) {
  const total = workout.sets.reduce((sum, set) => sum + set.rounds * set.repetitions * set.distance_meters, 0)
  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-lg font-semibold tracking-tight text-white">{workout.title}</h4>
        <p className="mt-1.5 text-sm leading-6 text-slate-300">{workout.objective}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300"><Clock className="h-3.5 w-3.5 text-accent" />{workout.estimated_duration_minutes} min</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300"><Ruler className="h-3.5 w-3.5 text-accent" />{total.toLocaleString()} m</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300"><Dumbbell className="h-3.5 w-3.5 text-accent" />{workout.equipment.join(", ") || "No equipment"}</span>
          {workout.main_training_zones.map((zone) => <ZoneChip key={zone} zone={zone} />)}
        </div>
      </div>
      <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-gradient-to-b before:from-accent/40 before:via-white/10 before:to-transparent">
        {workout.sets.map((set, index) => {
          const tone = zoneTone(set.training_zone)
          return (
            <li key={index} className="relative flex gap-3">
              <span className={cn("relative z-10 mt-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#0d151c] text-xs font-bold", tone.text)}>
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 transition-colors hover:border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="font-semibold text-white">{set.name}</h5>
                  <ZoneChip zone={set.training_zone} />
                </div>
                <p className={cn("mt-2 text-base font-semibold", tone.text)}>
                  {set.rounds > 1 && `${set.rounds} rounds of `}{set.repetitions} × {set.distance_meters} m {set.stroke}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
                  {([
                    [Repeat, "Interval / rest", set.interval],
                    [Target, "Target", set.target_time || "Effort / technical cue"],
                    [Dumbbell, "Equipment", set.equipment.join(", ") || "None"],
                    [Ruler, "Set distance", `${(set.rounds * set.repetitions * set.distance_meters).toLocaleString()} m`],
                  ] as const).map(([Icon, label, value]) => (
                    <div key={label} className="min-w-0 rounded-xl bg-black/20 px-3 py-2">
                      <dt className="flex items-center gap-1 text-[11px] text-slate-500"><Icon className="h-3 w-3" />{label}</dt>
                      <dd className="mt-0.5 break-words text-slate-200">{value}</dd>
                    </div>
                  ))}
                </dl>
                {set.description && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-300">{set.description}</p>}
                {set.technical_focus.length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-sm text-slate-400">
                    {set.technical_focus.map((cue, i) => (
                      <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />{cue}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {workout.notes && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <h5 className="flex items-center gap-2 text-sm font-semibold text-white"><NotebookPen className="h-4 w-4 text-accent" />Session notes</h5>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-400">{workout.notes}</p>
        </div>
      )}
    </div>
  )
}
