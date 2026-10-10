"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowRight, CalendarDays, Check, Dumbbell, Flag, MousePointerClick, Sparkles, Trophy, Waves, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { competitionsSchema, gymWeekSchema, mondayISO, trainingRequest, weekSchema } from "@/lib/training"

/** Places in the Training tab the guide can walk the athlete to. */
export type GuideTarget = "swim-generate" | "gym-generate" | "add-meet" | "swim-week" | "gym-week"
export const GUIDE_SUBTAB: Record<GuideTarget, "week" | "library" | "competitions"> = {
  "swim-generate": "week", "swim-week": "week", "gym-generate": "library", "gym-week": "library", "add-meet": "competitions",
}

/** What the Training tab reports back while the guided setup walks the athlete through it. */
export type GuideEvent = "swim-started" | "swim-done" | "swim-failed" | "gym-started" | "gym-done" | "gym-failed" | "meet-form-opened" | "meet-saved"

type StepKey = "swim" | "gym" | "meet"
type Status = { swim: boolean; gym: boolean; meet: boolean }

const store = {
  get: (key: string) => { try { return window.localStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string) => { try { window.localStorage.setItem(key, value) } catch { /* private mode */ } },
  session: (key: string, value?: string) => {
    try {
      if (value === undefined) return window.sessionStorage.getItem(key)
      if (value === "") window.sessionStorage.removeItem(key)
      else window.sessionStorage.setItem(key, value)
    } catch { /* private mode */ }
    return null
  },
}

/**
 * Dashboard onboarding: nothing is generated automatically, so this guide shows the athlete what to generate,
 * where the button is, and walks them to it. It reappears whenever the current week isn't planned yet.
 */
export function GettingStarted({ firstName, swimSessions, gymSessions, onShowMe }: {
  firstName: string
  swimSessions: number
  gymSessions: number
  onShowMe: (target: GuideTarget) => void
}) {
  const weekStart = mondayISO()
  const [status, setStatus] = useState<Status | null>(null)
  const [hidden, setHidden] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const [firstVisit, setFirstVisit] = useState(false)

  useEffect(() => {
    setHidden(store.get(`swimgpt_guide_hidden_${weekStart}`) === "1")
    setFirstVisit(store.get("swimgpt_guide_intro_seen") !== "1")
    const controller = new AbortController()
    Promise.all([
      trainingRequest(`/week?week_start=${weekStart}`, weekSchema, { signal: controller.signal }),
      trainingRequest(`/gym/week?week_start=${weekStart}`, gymWeekSchema, { signal: controller.signal }),
      trainingRequest("/competitions", competitionsSchema, { signal: controller.signal }),
    ]).then(([swim, gym, meets]) => {
      const next = { swim: swim.generated, gym: gym.summary.sessions > 0, meet: meets.competitions.some((meet) => meet.date >= weekStart) }
      const pendingKey = `swimgpt_guide_pending_${weekStart}`
      const required = next.swim && (next.gym || gymSessions === 0)
      // Celebrate only a week that was finished in this visit, not one that was already planned.
      if (required && store.session(pendingKey) === "1") setCelebrate(true)
      if (!required) store.session(pendingKey, "1")
      setStatus(next)
    }).catch(() => { /* the guide is optional; the dashboard works without it */ })
    return () => controller.abort()
  }, [weekStart, gymSessions])

  useEffect(() => {
    if (status && firstVisit) store.set("swimgpt_guide_intro_seen", "1")
  }, [status, firstVisit])

  const hide = useCallback(() => {
    store.set(`swimgpt_guide_hidden_${weekStart}`, "1")
    store.session(`swimgpt_guide_pending_${weekStart}`, "")
    setHidden(true)
  }, [weekStart])

  if (!status || hidden) return null
  const gymRequired = gymSessions > 0
  const required = gymRequired ? [status.swim, status.gym] : [status.swim]
  const doneCount = required.filter(Boolean).length
  const allDone = doneCount === required.length
  if (allDone && !celebrate) return null

  const steps: { key: StepKey; title: string; where: string[]; body: string; done: boolean; optional?: boolean;
    target: GuideTarget; view: GuideTarget; icon: typeof Waves; tone: string; demo: ReactNode }[] = [
    {
      key: "swim", title: "Generate your swim week", where: ["Training", "Swim Week"], done: status.swim, icon: Waves, tone: "cyan",
      body: `Your coach writes all ${swimSessions} swim${swimSessions === 1 ? "" : "s"} for Monday to Sunday, paced from your PBs. It takes about 30 seconds.`,
      target: "swim-generate", view: "swim-week", demo: <DemoSwim />,
    },
    {
      key: "gym", title: "Plan your gym week", where: ["Training", "Gym Week"], done: status.gym, optional: !gymRequired, icon: Dumbbell, tone: "violet",
      body: gymRequired
        ? `${gymSessions} strength & mobility session${gymSessions === 1 ? "" : "s"} on spread-out days, with your coach's mobility routine on the others.`
        : "You chose no gym sessions, but you can still plan daily mobility routines for your strokes.",
      target: "gym-generate", view: "gym-week", demo: <DemoGym />,
    },
    {
      key: "meet", title: "Add your next meet", where: ["Training", "Competitions"], done: status.meet, optional: true, icon: Trophy, tone: "amber",
      body: "Optional but powerful: swim and gym plans count down to A and B meets and taper automatically in race week.",
      target: "add-meet", view: "add-meet", demo: <DemoMeet />,
    },
  ]
  const nextKey = steps.find((step) => !step.done && !step.optional)?.key ?? null

  return (
    <section aria-labelledby="gs-title" className="gs-card relative mb-6 overflow-hidden rounded-[30px] border border-white/[0.09] p-5 sm:p-7">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="gs-aurora gs-aurora-a" />
        <span className="gs-aurora gs-aurora-b" />
        <span className="gs-grid absolute inset-0" />
      </div>

      {allDone ? (
        <Completed firstName={firstName} onOpen={() => onShowMe("swim-week")} onClose={hide} />
      ) : (
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <p className="gs-in flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300" style={{ "--i": 0 } as CSSProperties}>
                <Sparkles className="h-3.5 w-3.5" />
                {firstVisit ? "Getting started" : "This week"} · {required.length - doneCount} step{required.length - doneCount === 1 ? "" : "s"} to go
              </p>
              <h2 id="gs-title" className="gs-in mt-3 text-balance text-2xl font-bold tracking-tight text-white sm:text-[2rem] sm:leading-tight" style={{ "--i": 1 } as CSSProperties}>
                {firstVisit ? `Welcome aboard, ${firstName}. ` : `Plan your week, ${firstName}. `}
                <span className="bg-gradient-to-r from-cyan-200 via-accent to-violet-300 bg-clip-text text-transparent">Your workouts are generated by you.</span>
              </h2>
              <p className="gs-in mt-3 text-sm leading-6 text-slate-300 sm:text-base" style={{ "--i": 2 } as CSSProperties}>
                SwimGPT never fills your calendar on its own. You press generate, so every week is built from your latest
                availability, meets and check-ins. <span className="font-semibold text-white">Walk me through it</span> takes you there and shows you every tap.
              </p>
              <ul className="gs-in mt-4 flex flex-wrap gap-2 text-xs text-slate-300" style={{ "--i": 3 } as CSSProperties}>
                {["Uses this week's availability", "Plans around your meets", "Adapts to your check-ins"].map((item) => (
                  <li key={item} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 backdrop-blur-md">
                    <Check className="h-3 w-3 text-accent" />{item}
                  </li>
                ))}
              </ul>
            </div>
            <ProgressWater done={doneCount} total={required.length} />
          </div>

          <ol className="relative mt-8 grid gap-4 lg:grid-cols-3">
            {steps.map(({ key, ...step }, index) => (
              <StepCard key={key} index={index} {...step} next={key === nextKey}
                onShow={() => onShowMe(step.done ? step.view : step.target)} />
            ))}
          </ol>

          <div className="gs-in mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4 text-xs text-slate-400" style={{ "--i": 8 } as CSSProperties}>
            <p className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-slate-500" />Generate a new week each Monday. This guide comes back whenever a week isn&apos;t planned yet.</p>
            <button type="button" onClick={hide} className="rounded-full px-3 py-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">Hide for this week</button>
          </div>
        </div>
      )}
    </section>
  )
}

function StepCard({ index, title, where, body, done, optional, next, icon: Icon, tone, demo, onShow }: {
  index: number; title: string; where: string[]; body: string; done: boolean; optional?: boolean; next: boolean
  icon: typeof Waves; tone: string; demo: ReactNode; onShow: () => void; target?: GuideTarget; view?: GuideTarget
}) {
  const tones: Record<string, string> = {
    cyan: "from-cyan-300/25 to-sky-500/10 text-cyan-200 ring-cyan-300/30",
    violet: "from-violet-300/25 to-fuchsia-500/10 text-violet-200 ring-violet-300/30",
    amber: "from-amber-200/25 to-orange-400/10 text-amber-200 ring-amber-300/30",
  }
  return (
    <li className={cn("gs-step group relative flex flex-col rounded-[24px] border p-4 transition-all duration-500 sm:p-5",
      next ? "gs-next border-transparent" : done ? "border-emerald-300/20 bg-emerald-300/[0.035]" : "border-white/[0.08] bg-white/[0.025] hover:border-white/15")}
      style={{ "--i": 4 + index } as CSSProperties}>
      {next && <span aria-hidden className="gs-next-ring" />}
      <div className="flex items-center justify-between gap-3">
        <span className={cn("relative grid h-[44px] w-[44px] place-items-center rounded-2xl bg-gradient-to-br ring-1", tones[tone])}>
          {done ? (
            <span className="gs-pop grid h-full w-full place-items-center rounded-2xl bg-emerald-400/90 text-slate-950">
              <Check className="h-5 w-5" strokeWidth={3} />
            </span>
          ) : <Icon className="h-5 w-5" />}
          {next && <span aria-hidden className="gs-beacon absolute inset-0 rounded-2xl" />}
        </span>
        <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
          done ? "bg-emerald-400/15 text-emerald-200" : next ? "bg-accent text-accent-foreground" : "bg-white/[0.06] text-slate-400")}>
          {done ? "Done" : next ? "Next up" : optional ? "Optional" : `Step ${index + 1}`}
        </span>
      </div>

      <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] font-medium text-slate-400">
        {where.map((part, partIndex) => (
          <span key={part} className="flex items-center gap-1">
            {partIndex > 0 && <ArrowRight className="h-3 w-3 text-slate-600" />}
            <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-slate-300">{part}</span>
          </span>
        ))}
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>

      <div className={cn("gs-demo relative mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/30", done && "opacity-60 saturate-50")} aria-hidden>
        {demo}
      </div>

      <div className="mt-4 flex items-center gap-2 pt-1">
        <Button onClick={onShow} size="sm"
          className={cn("rounded-full font-semibold transition-all hover:-translate-y-0.5",
            done ? "border border-white/12 bg-white/[0.05] text-white hover:bg-white/10"
              : next ? "bg-gradient-to-r from-cyan-200 to-accent text-slate-950 shadow-[0_10px_30px_rgba(87,229,234,0.35)]"
                : "border border-white/12 bg-white/[0.05] text-white hover:bg-white/10")}>
          {done ? "View" : <><MousePointerClick className="mr-1.5 h-4 w-4" />Walk me through it</>}
        </Button>
        {!done && <span className="text-[11px] text-slate-500">We&apos;ll point at the button</span>}
      </div>
    </li>
  )
}

/** Circular water level filling as steps are completed. */
function ProgressWater({ done, total }: { done: number; total: number }) {
  const level = total ? done / total : 0
  return (
    <div className="gs-in relative shrink-0" style={{ "--i": 2 } as CSSProperties} role="img" aria-label={`${done} of ${total} steps done`}>
      <div className="gs-orb relative grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-white/10 bg-slate-950/60 sm:h-32 sm:w-32">
        <div className="gs-water absolute inset-x-0 bottom-0" style={{ height: `${12 + level * 88}%` }}>
          <svg className="gs-wave absolute -top-3 left-0 h-4 w-[200%]" viewBox="0 0 400 16" preserveAspectRatio="none">
            <path d="M0 8 Q 25 0 50 8 T 100 8 T 150 8 T 200 8 T 250 8 T 300 8 T 350 8 T 400 8 V16 H0 Z" fill="currentColor" />
          </svg>
          <svg className="gs-wave gs-wave-back absolute -top-2.5 left-0 h-4 w-[200%]" viewBox="0 0 400 16" preserveAspectRatio="none">
            <path d="M0 8 Q 25 16 50 8 T 100 8 T 150 8 T 200 8 T 250 8 T 300 8 T 350 8 T 400 8 V16 H0 Z" fill="currentColor" />
          </svg>
        </div>
        <div className="relative text-center">
          <p className="text-3xl font-bold tabular-nums text-white">{done}<span className="text-lg text-white/50">/{total}</span></p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">steps</p>
        </div>
      </div>
      <span aria-hidden className="gs-orb-glow absolute inset-0 -z-10 rounded-full" />
    </div>
  )
}

/** Mini animated how-to: a cursor presses the real button's look-alike, then the week fills in. */
function DemoFrame({ label, gradient, children }: { label: string; gradient: string; children: ReactNode }) {
  return (
    <div className="relative h-[124px] px-3 pt-3">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-white/15" /><span className="h-1.5 w-1.5 rounded-full bg-white/15" /><span className="h-1.5 w-1.5 rounded-full bg-white/15" />
        <span className="ml-auto h-1.5 w-12 rounded-full bg-white/[0.07]" />
      </div>
      <div className="mt-2.5 flex justify-end">
        <span className={cn("gs-demo-btn relative inline-flex items-center gap-1 overflow-visible rounded-full px-2.5 py-1 text-[10px] font-semibold text-slate-950", gradient)}>
          <Sparkles className="h-2.5 w-2.5" />{label}
          <span className="gs-demo-ripple absolute inset-0 rounded-full" />
        </span>
      </div>
      {children}
      <svg className="gs-cursor absolute h-5 w-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" viewBox="0 0 24 24">
        <path d="M4 2l15 9.5-6.6 1.4 3.9 7.4-2.7 1.4-3.9-7.4L4 18.4z" fill="white" stroke="#0b1220" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function DemoSwim() {
  return (
    <DemoFrame label="Generate Swim Week" gradient="bg-gradient-to-r from-cyan-300 to-sky-400">
      <div className="mt-3 grid grid-cols-7 items-end gap-1.5">
        {[62, 85, 40, 92, 55, 78, 30].map((height, index) => (
          <span key={index} className="flex h-12 items-end">
            <span className="gs-bar w-full rounded-md bg-gradient-to-t from-sky-500 to-cyan-200" style={{ "--h": `${height}%`, "--i": index } as CSSProperties} />
          </span>
        ))}
      </div>
    </DemoFrame>
  )
}

function DemoGym() {
  const days = ["S", "M", "S", "M", "S", "M", "M"]
  return (
    <DemoFrame label="Plan my week with AI" gradient="bg-gradient-to-r from-violet-300 to-cyan-300">
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {days.map((kind, index) => (
          <span key={index} className="grid h-12 place-items-center rounded-lg border border-dashed border-white/10">
            <span className={cn("gs-chip grid h-7 w-7 place-items-center rounded-lg", kind === "S" ? "bg-violet-400/30 text-violet-100" : "bg-teal-300/20 text-teal-100")}
              style={{ "--i": index } as CSSProperties}>
              {kind === "S" ? <Dumbbell className="h-3.5 w-3.5" /> : <Waves className="h-3.5 w-3.5" />}
            </span>
          </span>
        ))}
      </div>
    </DemoFrame>
  )
}

function DemoMeet() {
  return (
    <DemoFrame label="Add competition" gradient="bg-gradient-to-r from-amber-200 to-orange-300">
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className={cn("relative grid h-12 place-items-center rounded-lg border text-[9px] font-semibold", index === 5 ? "gs-meet-day border-amber-300/0" : "border-white/[0.07] text-slate-600")}>
            {index === 5 ? <Flag className="gs-flag h-4 w-4 text-amber-300" /> : index + 1}
          </span>
        ))}
      </div>
    </DemoFrame>
  )
}

function Completed({ firstName, onOpen, onClose }: { firstName: string; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="relative flex flex-col items-center py-6 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 18 }, (_, index) => (
          <span key={index} className="gs-bubble" style={{ left: `${(index * 53) % 100}%`, "--i": index, "--s": `${6 + (index % 5) * 4}px` } as CSSProperties} />
        ))}
      </div>
      <span className="relative grid h-20 w-20 place-items-center">
        <span className="gs-burst absolute inset-0 rounded-full" />
        <span className="gs-burst absolute inset-0 rounded-full [animation-delay:0.35s]" />
        <span className="gs-pop grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-emerald-300 to-cyan-300 text-slate-950 shadow-[0_0_50px_rgba(52,211,153,0.5)]">
          <Check className="h-8 w-8" strokeWidth={3} />
        </span>
      </span>
      <h2 className="gs-in mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl" style={{ "--i": 1 } as CSSProperties}>Your week is planned, {firstName}.</h2>
      <p className="gs-in mt-2 max-w-md text-sm leading-6 text-slate-300" style={{ "--i": 2 } as CSSProperties}>
        Swims and gym sessions are waiting in Training. Tick them off as you go, and come back on Monday to generate the next week.
      </p>
      <div className="gs-in mt-6 flex flex-wrap justify-center gap-2" style={{ "--i": 3 } as CSSProperties}>
        <Button onClick={onOpen} className="rounded-full bg-gradient-to-r from-cyan-200 to-accent font-semibold text-slate-950 shadow-[0_10px_30px_rgba(87,229,234,0.35)]">
          Open my week<ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={onClose} className="rounded-full border-white/15 bg-transparent text-white hover:bg-white/10">Close</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- spotlight tour
const TIPS: Record<GuideTarget, { title: string; body: string }> = {
  "swim-generate": { title: "Tap Generate Swim Week", body: "Your coach builds every swim from Monday to Sunday around your availability. It takes about 30 seconds." },
  "gym-generate": { title: "Tap Plan my week with AI", body: "Strength & mobility sessions go on spread-out days, with your coach's mobility routine on the rest." },
  "add-meet": { title: "Add your next competition", body: "Enter the date and priority. A and B meets make your plans build up and taper toward race day." },
  "swim-week": { title: "Your swim week lives here", body: "Open any day for the full session. Tick swims off as you complete them." },
  "gym-week": { title: "Your gym week lives here", body: "Every session shows warm-up, exercises with demonstrations, and your mobility finish." },
}
const FALLBACK: Partial<Record<GuideTarget, GuideTarget>> = { "swim-generate": "swim-week", "gym-generate": "gym-week" }

/** Dims the page and points at a button in the Training tab, following it as the page scrolls. */
export function GuideSpotlight({ target, onClose }: { target: GuideTarget; onClose: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [shown, setShown] = useState<GuideTarget>(target)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    let frame = 0
    let element: HTMLElement | null = null
    let found = false
    const started = performance.now()
    const find = () => {
      // The button renders once the week has loaded; only fall back to its section if it never appears.
      const patient = performance.now() - started < 3000
      for (const key of (patient ? [target] : [target, FALLBACK[target]]).filter(Boolean) as GuideTarget[]) {
        const match = document.querySelector<HTMLElement>(`[data-guide="${key}"]`)
        if (match && match.getClientRects().length) return { match, key }
      }
      return null
    }
    const loop = () => {
      if (!found) {
        const hit = find()
        if (hit) {
          found = true
          element = hit.match
          setShown(hit.key)
          element.scrollIntoView({ behavior: "smooth", block: "center" })
        } else if (performance.now() - started > 6000) {
          return closeRef.current()
        }
      } else if (!element || !element.isConnected) {
        return closeRef.current()      // e.g. the button disappears once the week is generated
      } else {
        setRect(element.getBoundingClientRect())
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    const opened = performance.now()
    // Any tap closes the tour, and it passes through, so tapping the highlighted button works first time.
    const onPointer = () => { if (performance.now() - opened > 400) closeRef.current() }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current() }
    window.addEventListener("pointerdown", onPointer, true)
    window.addEventListener("keydown", onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("pointerdown", onPointer, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [target])

  if (!rect || typeof document === "undefined") return null
  const pad = 10
  const box = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
  const below = box.top + box.height + 190 < window.innerHeight
  const tipWidth = Math.min(320, window.innerWidth - 32)
  const tipLeft = Math.max(16, Math.min(box.left + box.width / 2 - tipWidth / 2, window.innerWidth - tipWidth - 16))
  const arrowLeft = Math.max(20, Math.min(box.left + box.width / 2 - tipLeft, tipWidth - 20))
  const tip = TIPS[shown]

  return createPortal(
    <div className="gs-tour pointer-events-none fixed inset-0 z-[70]" role="dialog" aria-live="polite" aria-label={tip.title}>
      <div className={cn("gs-spot absolute", shown.endsWith("-week") && "gs-spot-section")} style={box}>
        <span className="gs-spot-ring absolute inset-0 rounded-[inherit]" />
        <span className="gs-spot-ring absolute inset-0 rounded-[inherit] [animation-delay:0.9s]" />
      </div>
      <div className="gs-tip absolute" style={{ left: tipLeft, width: tipWidth, ...(below ? { top: box.top + box.height + 16 } : { bottom: window.innerHeight - box.top + 16 }) } as CSSProperties}>
        <span className={cn("gs-tip-arrow absolute h-3 w-3 rotate-45 border-white/15 bg-[#0d1820]", below ? "-top-1.5 border-l border-t" : "-bottom-1.5 border-b border-r")} style={{ left: arrowLeft - 6 }} />
        <div className="relative rounded-2xl border border-white/15 bg-[#0d1820]/95 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <MousePointerClick className="h-4 w-4 text-accent" />{tip.title}
          </p>
          <p className="mt-1.5 text-[13px] leading-5 text-slate-300">{tip.body}</p>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500"><X className="h-3 w-3" />Tap anywhere to close</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
