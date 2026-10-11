"use client"

import { useCallback, useRef, useState, type CSSProperties } from "react"
import { CalendarDays, Check, Dumbbell, PencilLine, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WorkoutBuilder } from "@/components/workout-builder"
import { Banner, shortDate, todayISO } from "@/components/training-ui"
import { blankDoc, docFromItem, type BuilderDoc } from "@/lib/workout-builder"
import type { GymItem } from "@/lib/training"

type Open = { doc: BuilderDoc; key: string | null; isNew: boolean; token: number }
type Closed = { outcome: "saved"; item: GymItem } | { outcome: "deleted" } | { outcome: "empty" }

const fresh = (): Open => ({ doc: blankDoc(todayISO()), key: null, isNew: true, token: Date.now() })

/**
 * The dashboard's Workout Builder section: the Gym week's builder on its own page. It opens on a new workout for today;
 * workouts save to the gym calendar on the builder's date, exactly as they do from Training → Gym week.
 */
export function WorkoutBuilderSection({ onChanged, onOpenGymWeek }: { onChanged: () => Promise<void>; onOpenGymWeek: () => void }) {
  const [open, setOpen] = useState<Open | null>(fresh)
  const [closed, setClosed] = useState<Closed | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const saved = useRef<GymItem | null>(null)
  const changed = useRef(onChanged)
  changed.current = onChanged

  const start = (next: Open) => {
    saved.current = next.key ? saved.current : null
    setClosed(null); setNotice(null); setOpen(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  // Stable, so the builder's autosave timer isn't reset when this section or the dashboard re-renders.
  const handleSaved = useCallback((_week: unknown, item?: GymItem) => {
    if (item) saved.current = item
    void changed.current()
  }, [])
  const handleBack = useCallback((wasSaved: boolean) => {
    setOpen(null)
    setClosed(wasSaved && saved.current ? { outcome: "saved", item: saved.current } : { outcome: "empty" })
  }, [])
  const handleDeleted = useCallback(() => {
    saved.current = null
    setOpen(null); setNotice(null)
    setClosed({ outcome: "deleted" })
    void changed.current()
  }, [])

  if (open) {
    return (
      <div className="space-y-4">
        {notice && <Banner tone="success">{notice}</Banner>}
        <WorkoutBuilder key={open.token} initial={open.doc} itemKey={open.key} isNew={open.isNew}
          backLabel="Close" backTitle="Save and close the builder"
          onBack={handleBack} onSaved={handleSaved} onDeleted={handleDeleted} onNotice={setNotice} />
      </div>
    )
  }

  const view = closed?.outcome === "saved"
    ? { icon: Check, tone: "from-emerald-300 to-cyan-300", title: `“${closed.item.workout.title}” is saved`,
        body: `It's in your gym week on ${shortDate(closed.item.date, { weekday: "long", day: "numeric", month: "long" })}.` }
    : closed?.outcome === "deleted"
      ? { icon: Trash2, tone: "from-slate-300 to-slate-400", title: "Workout deleted", body: "It's been removed from your gym week." }
      : { icon: Dumbbell, tone: "from-violet-300 to-cyan-300", title: "Nothing saved yet", body: "Give a workout a title or add an exercise and it saves to your gym week as you go." }

  return (
    <div className="dash-reveal mx-auto max-w-xl rounded-[28px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(28,24,48,0.75),rgba(10,15,21,0.95))] p-7 text-center shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-9">
      <span className={`gx-pop mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-slate-950 shadow-[0_0_40px_rgba(167,139,250,0.35)] ${view.tone}`}>
        <view.icon className="h-7 w-7" strokeWidth={2.5} />
      </span>
      <h2 className="gx-rise mt-5 text-balance text-xl font-bold tracking-tight text-white sm:text-2xl" style={{ "--i": 1 } as CSSProperties}>{view.title}</h2>
      <p className="gx-rise mt-2 text-sm leading-6 text-slate-300" style={{ "--i": 2 } as CSSProperties}>{view.body}</p>
      <div className="gx-rise mt-6 flex flex-wrap justify-center gap-2" style={{ "--i": 3 } as CSSProperties}>
        <Button autoFocus onClick={() => start(fresh())} className="rounded-full bg-gradient-to-r from-violet-300 to-cyan-300 font-semibold text-slate-950">
          <Plus className="mr-1.5 h-4 w-4" />{closed?.outcome === "saved" ? "Build another workout" : "New workout"}
        </Button>
        {closed?.outcome === "saved" && (
          <Button variant="outline" onClick={() => start({ doc: docFromItem(closed.item), key: closed.item.key, isNew: false, token: Date.now() })}
            className="rounded-full border-white/15 bg-white/[0.04]">
            <PencilLine className="mr-1.5 h-4 w-4" />Keep editing
          </Button>
        )}
        <Button variant="ghost" onClick={onOpenGymWeek} className="rounded-full text-slate-300 hover:bg-white/10 hover:text-white">
          <CalendarDays className="mr-1.5 h-4 w-4" />See your gym week
        </Button>
      </div>
    </div>
  )
}
