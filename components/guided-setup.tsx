"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowRight, Check, Dumbbell, Loader2, Pointer, Trophy, Waves, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { competitionsSchema, gymWeekSchema, mondayISO, trainingRequest, weekSchema } from "@/lib/training"
import type { GuideEvent, GuideTarget } from "@/components/dashboard-guide"
import { CoachAvatar } from "@/components/coach-avatar"

/** Where the guided setup is. Point steps spotlight a button; working/done steps narrate and move on by themselves. */
export type SetupStep = "intro" | "swim" | "swim-working" | "swim-done" | "gym" | "gym-working" | "gym-done" | "meet" | "meet-form" | "done"
export type SetupStart = "swim" | "gym" | "meet"
type Status = { swim: boolean; gym: boolean; meet: boolean }

const ADVANCE_MS = 3200
const SPOT: Partial<Record<SetupStep, GuideTarget | "meet-form">> = { swim: "swim-generate", gym: "gym-generate", meet: "add-meet", "meet-form": "meet-form" }
const STEP_NUMBER: Partial<Record<SetupStep, number>> = {
  swim: 1, "swim-working": 1, "swim-done": 1, gym: 2, "gym-working": 2, "gym-done": 2, meet: 3, "meet-form": 3,
}

const storage = {
  get(key: string, session = false) { try { return (session ? window.sessionStorage : window.localStorage).getItem(key) } catch { return null } },
  set(key: string, value: string | null, session = false) {
    try {
      const store = session ? window.sessionStorage : window.localStorage
      if (value === null) store.removeItem(key)
      else store.setItem(key, value)
    } catch { /* private mode */ }
  },
}

async function fetchStatus(): Promise<Status> {
  const weekStart = mondayISO()
  const [swim, gym, meets] = await Promise.all([
    trainingRequest(`/week?week_start=${weekStart}`, weekSchema),
    trainingRequest(`/gym/week?week_start=${weekStart}`, gymWeekSchema),
    trainingRequest("/competitions", competitionsSchema),
  ])
  return { swim: swim.generated, gym: gym.summary.sessions > 0, meet: meets.competitions.some((meet) => meet.date >= weekStart) }
}

/**
 * The dashboard's hands-on first-week setup. It starts by itself for an athlete with nothing planned yet, then walks
 * them through every tap: it opens the right screen, points at the one button to press (blocking everything else),
 * narrates while their coach writes the week, and moves on as soon as each step lands.
 */
export function GuidedSetup({ userKey, firstName, coach, swimSessions, gymSessions, step, onStep, event, onNavigate }: {
  userKey: string
  firstName: string
  coach: string
  swimSessions: number
  gymSessions: number
  step: SetupStep | null
  onStep: (step: SetupStep | null) => void
  event: { type: GuideEvent; at: number } | null
  onNavigate: (target: GuideTarget | "overview") => void
}) {
  const doneKey = `swimgpt_setup_${userKey}`
  const [failed, setFailed] = useState(false)
  const handled = useRef(0)

  // Start by itself on the first visit (or resume after a reload); never again once finished or dismissed.
  useEffect(() => {
    if (step || storage.get(doneKey)) return
    let cancelled = false
    fetchStatus().then((status) => {
      if (cancelled) return
      const resume = storage.get("swimgpt_setup_step", true)
      if (resume) onStep(!status.swim ? "swim" : !status.gym ? "gym" : "meet")
      else if (!status.swim) onStep("intro")
    }).catch(() => { /* the dashboard works without the guide */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey])

  // Take the athlete to the right screen for each step.
  useEffect(() => {
    if (!step) return
    if (step !== "intro" && step !== "done") storage.set("swimgpt_setup_step", step, true)
    const target = SPOT[step]
    if (target && target !== "meet-form") onNavigate(target)
    if (step === "intro") onNavigate("overview")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // React to what the athlete just did in the Training tab.
  useEffect(() => {
    if (!event || event.at === handled.current || !step) return
    handled.current = event.at
    const next: Partial<Record<GuideEvent, [SetupStep[], SetupStep]>> = {
      "swim-started": [["swim"], "swim-working"], "swim-done": [["swim", "swim-working"], "swim-done"],
      "gym-started": [["gym"], "gym-working"], "gym-done": [["gym", "gym-working"], "gym-done"],
      "meet-form-opened": [["meet"], "meet-form"], "meet-saved": [["meet", "meet-form"], "done"],
    }
    if (event.type === "swim-failed" || event.type === "gym-failed") {
      setFailed(true)
      onStep(event.type === "swim-failed" ? "swim" : "gym")
      return
    }
    const rule = next[event.type]
    if (rule && rule[0].includes(step)) {
      setFailed(false)
      onStep(rule[1])
    }
  }, [event, step, onStep])

  // Finished steps move on by themselves.
  useEffect(() => {
    if (step !== "swim-done" && step !== "gym-done") return
    const timer = window.setTimeout(() => onStep(step === "swim-done" ? "gym" : "meet"), ADVANCE_MS)
    return () => window.clearTimeout(timer)
  }, [step, onStep])

  // Leave room under the page while the dock is up, so any button can be scrolled clear of it.
  useEffect(() => {
    if (!step || step === "intro" || step === "done") return
    document.documentElement.classList.add("gx-docked")
    return () => document.documentElement.classList.remove("gx-docked")
  }, [step])

  const close = (outcome: "done" | "dismissed") => {
    storage.set(doneKey, outcome)
    storage.set("swimgpt_setup_step", null, true)
    onStep(null)
  }

  if (!step || typeof document === "undefined") return null
  const coachFirst = coach.replace(/^Coach\s+/i, "")

  const dockCopy: Partial<Record<SetupStep, { title: string; body: string }>> = {
    swim: failed
      ? { title: "Let's try that again", body: "That didn't go through. Tap Generate Swim Week once more." }
      : { title: "First, your swim week", body: `Tap Generate Swim Week. ${coach} will pick your ${swimSessions} swim${swimSessions === 1 ? "" : "s"} from their own sessions and pace every set to your PBs.` },
    "swim-working": { title: `${coach} is writing your swim week`, body: "Choosing the sessions from their program and fitting each one to your time and pace. About 30 seconds." },
    "swim-done": { title: "Your swim week is ready", body: "Nice. Next up: your gym week." },
    gym: failed
      ? { title: "Let's try that again", body: "That didn't go through. Tap Plan my week with AI once more." }
      : { title: "Now your gym week", body: gymSessions > 0
          ? `Tap Plan my week with AI: ${gymSessions} strength session${gymSessions === 1 ? "" : "s"} on spread-out days, mobility on the rest.`
          : "Tap Plan my week with AI for daily mobility routines that suit your strokes." },
    "gym-working": { title: "Building your gym week", body: "Matching every exercise to your level and equipment, with mobility for your strokes." },
    "gym-done": { title: "Your gym week is ready", body: "One last, optional step: your next meet." },
    meet: { title: "Racing soon?", body: "Tap Add Competition so both plans build up and taper toward your next meet. No meet yet? Skip it." },
    "meet-form": { title: "Add your meet", body: "Fill in the name, date and pool, pick a priority (A is your big one) and your events, then save." },
  }
  const copy = dockCopy[step]
  const spotTarget = SPOT[step]

  return createPortal(
    <>
      {step === "intro" && (
        <IntroModal firstName={firstName} coach={coach} swimSessions={swimSessions} gymSessions={gymSessions}
          onStart={() => onStep("swim")} />
      )}
      {spotTarget && <Spotlight key={`spot-${spotTarget}`} target={spotTarget} hint={step === "meet-form" ? null : step === "meet" ? "Tap Add Competition" : "Tap here"} />}
      {copy && (
        <Dock key={`dock-${step}`} coach={coachFirst} step={STEP_NUMBER[step] ?? 1} title={copy.title} body={copy.body}
          working={step.endsWith("-working")} done={step.endsWith("-done")}
          onSkipSetup={() => close("dismissed")}
          action={step === "meet" || step === "meet-form" ? <Button size="sm" variant="ghost" onClick={() => onStep("done")} className="rounded-full text-slate-300 hover:bg-white/10 hover:text-white">Skip this</Button>
            : step === "gym" && gymSessions === 0 ? <Button size="sm" variant="ghost" onClick={() => onStep("meet")} className="rounded-full text-slate-300 hover:bg-white/10 hover:text-white">Skip this</Button>
              : step.endsWith("-done") ? <Button size="sm" onClick={() => onStep(step === "swim-done" ? "gym" : "meet")} className="rounded-full bg-gradient-to-r from-cyan-200 to-accent font-semibold text-slate-950">Continue<ArrowRight className="ml-1 h-4 w-4" /></Button>
                : null} />
      )}
      {step === "done" && <DoneModal firstName={firstName} onOpen={() => { close("done"); onNavigate("swim-week") }} />}
    </>,
    document.body,
  )
}

// ---------------------------------------------------------------- welcome
function IntroModal({ firstName, coach, swimSessions, gymSessions, onStart }: {
  firstName: string; coach: string; swimSessions: number; gymSessions: number; onStart: () => void
}) {
  const steps = [
    { icon: Waves, tone: "from-cyan-300/30 to-sky-500/10 text-cyan-200", title: "Your swim week", body: `${coach}'s sessions for your ${swimSessions} swims` },
    { icon: Dumbbell, tone: "from-violet-300/30 to-fuchsia-500/10 text-violet-200", title: "Your gym week", body: gymSessions > 0 ? `${gymSessions} strength sessions plus mobility` : "Mobility for your strokes" },
    { icon: Trophy, tone: "from-amber-200/30 to-orange-400/10 text-amber-200", title: "Your next meet", body: "Optional: plans taper toward it" },
  ]
  return (
    <div className="gx-backdrop fixed inset-0 z-[95] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="gx-intro-title">
      <div className="gx-modal relative w-full max-w-lg overflow-hidden rounded-[30px] border border-white/10 p-6 text-center sm:p-8">
        <div aria-hidden className="gx-modal-glow" />
        <div className="relative mx-auto grid h-20 w-20 place-items-center">
          <span className="gx-orb-ring absolute inset-0 rounded-full" />
          <span className="gx-orb-ring absolute inset-0 rounded-full [animation-delay:1s]" />
          <CoachAvatar name={coach} shape="circle" className="relative h-16 w-16 shadow-[0_0_50px_rgba(87,229,234,0.55)]" />
        </div>
        <p className="gx-rise mt-6 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300" style={{ "--i": 0 } as CSSProperties}>Welcome to SwimGPT</p>
        <h2 id="gx-intro-title" className="gx-rise mt-2 text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl" style={{ "--i": 1 } as CSSProperties}>
          Hi {firstName}, let&apos;s build your first week together
        </h2>
        <p className="gx-rise mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-300" style={{ "--i": 2 } as CSSProperties}>
          I&apos;ll take you to every button and tell you what to tap. It takes about two minutes.
        </p>
        <ol className="mt-6 space-y-2.5 text-left">
          {steps.map((item, index) => (
            <li key={item.title} className="gx-rise flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3" style={{ "--i": 3 + index } as CSSProperties}>
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ring-1 ring-white/10", item.tone)}><item.icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">{index + 1}. {item.title}</span>
                <span className="block truncate text-xs text-slate-400">{item.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="gx-rise mt-7 flex justify-center" style={{ "--i": 6 } as CSSProperties}>
          <Button autoFocus onClick={onStart} className="gx-cta h-11 rounded-full bg-gradient-to-r from-cyan-200 to-accent px-7 font-semibold text-slate-950 shadow-[0_12px_32px_rgba(87,229,234,0.4)]">
            Let&apos;s go<ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the coach's voice, pinned to the bottom
function Dock({ coach, step, title, body, working, done, action, onSkipSetup }: {
  coach: string; step: number; title: string; body: string; working: boolean; done: boolean; action: ReactNode; onSkipSetup: () => void
}) {
  const [shown, setShown] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(body.length); return }
    const timer = window.setInterval(() => setShown((value) => (value >= body.length ? value : value + 2)), 16)
    return () => window.clearInterval(timer)
  }, [body])
  useEffect(() => {
    if (!working) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [working])

  return (
    <div className="gx-dock fixed inset-x-0 bottom-0 z-[90] flex justify-center px-3 pb-3 sm:pb-5" role="status" aria-live="polite">
      <div className="gx-dock-card relative w-full max-w-xl overflow-hidden rounded-[24px] border border-white/12 p-4 sm:p-5">
        {done && <span aria-hidden className="gx-countdown absolute inset-x-0 top-0 h-[3px]" style={{ "--ms": `${ADVANCE_MS}ms` } as CSSProperties} />}
        <div className="flex items-start gap-3.5">
          <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-200 via-accent to-sky-500 text-sm font-bold text-slate-950">
            <CoachAvatar name={coach} shape="circle" className="h-11 w-11" />
            {(done || working) && (
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[#0b1820] bg-accent text-slate-950">
                {done ? <Check className="gx-pop h-3 w-3" strokeWidth={3.5} /> : <Loader2 className="h-3 w-3 animate-spin" />}
              </span>
            )}
            {!done && <span aria-hidden className="gx-talk absolute -inset-1 rounded-full" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300"><span className="hidden sm:inline">Coach {coach} · </span>Step {step} of 3</p>
              <button type="button" onClick={onSkipSetup} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-white/10 hover:text-white">
                Skip setup<X className="h-3 w-3" />
              </button>
            </div>
            <p className="mt-1 font-semibold text-white">{title}</p>
            {!working && (
              <p className="mt-1 min-h-[2.5rem] text-sm leading-5 text-slate-300">
                {body.slice(0, shown)}<span className={cn("gx-caret", shown >= body.length && "opacity-0")} aria-hidden>|</span>
              </p>
            )}
            {working && <span className="sr-only">{body}</span>}
            <div className={cn("flex items-center justify-between gap-3", working ? "mt-2" : "mt-3")}>
              <div className="flex items-center gap-1.5" aria-hidden>
                {[1, 2, 3].map((index) => (
                  <span key={index} className={cn("h-1.5 rounded-full transition-all duration-500",
                    index < step || (index === step && done) ? "w-7 bg-emerald-300" : index === step ? "gx-current w-10" : "w-5 bg-white/12")} />
                ))}
                {working && <span className="ml-2 font-mono text-[11px] tabular-nums text-slate-500">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
              </div>
              {action}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- spotlight that only lets the right tap through
function Spotlight({ target, hint }: { target: string; hint: string | null }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  useEffect(() => {
    let frame = 0
    let scrolled = false
    const loop = () => {
      const element = document.querySelector<HTMLElement>(`[data-guide="${target}"]`)
      if (element && element.getClientRects().length) {
        if (!scrolled) {
          const box = element.getBoundingClientRect()
          if (box.height > window.innerHeight * 0.55) window.scrollTo({ top: window.scrollY + box.top - 96, behavior: "smooth" })
          else element.scrollIntoView({ behavior: "smooth", block: "center" })
          scrolled = true
        }
        const next = element.getBoundingClientRect()
        setRect((current) => current && current.top === next.top && current.left === next.left && current.width === next.width && current.height === next.height ? current : next)
      } else {
        setRect(null)
        scrolled = false
      }
      setViewport((current) => current.w === window.innerWidth && current.h === window.innerHeight ? current : { w: window.innerWidth, h: window.innerHeight })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [target])

  const pad = 10
  const hole = rect && { left: rect.left - pad, top: rect.top - pad, right: rect.right + pad, bottom: rect.bottom + pad }
  // Everything outside the hole is covered (and can't be clicked); the hole lets the real button through.
  const clip = hole
    ? `polygon(evenodd, 0 0, ${viewport.w}px 0, ${viewport.w}px ${viewport.h}px, 0 ${viewport.h}px, 0 0, ${hole.left}px ${hole.top}px, ${hole.right}px ${hole.top}px, ${hole.right}px ${hole.bottom}px, ${hole.left}px ${hole.bottom}px, ${hole.left}px ${hole.top}px)`
    : undefined
  const below = hole ? hole.bottom + 70 < viewport.h - 190 : true

  return (
    <>
      <div aria-hidden className="gx-shade fixed inset-0 z-[85]" style={{ clipPath: clip }} />
      {!hole && (
        <div className="fixed inset-0 z-[86] grid place-items-center">
          <span className="gx-finding flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />Getting it ready…
          </span>
        </div>
      )}
      {hole && (
        <>
          <div aria-hidden className="gx-ring pointer-events-none fixed z-[86] rounded-2xl"
            style={{ left: hole.left, top: hole.top, width: hole.right - hole.left, height: hole.bottom - hole.top }}>
            <span className="gx-ring-pulse absolute inset-0 rounded-[inherit]" />
          </div>
          {hint && (
            <>
              <Pointer aria-hidden className="gx-hand pointer-events-none fixed z-[87] h-9 w-9 text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]"
                style={{ left: hole.right - 30, top: below ? hole.bottom - 12 : hole.top - 28 }} />
              <span className="gx-hint pointer-events-none fixed z-[87] -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-slate-950 shadow-[0_8px_24px_rgba(87,229,234,0.45)]"
                style={{ left: (hole.left + hole.right) / 2, top: below ? hole.bottom + 34 : hole.top - 62 }}>
                {hint}
              </span>
            </>
          )}
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- finish
// Fixed pseudo-random spread so every render (server and client) scatters the same way.
const CONFETTI = Array.from({ length: 28 }, (_, index) => {
  const rand = (salt: number) => { const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x) }
  return {
    left: `${rand(1) * 100}%`,
    "--hue": `${[185, 265, 150, 45][index % 4]}`,
    "--dx": `${(rand(2) - 0.5) * 160}px`,
    "--spin": `${(rand(3) - 0.5) * 1440}deg`,
    "--dur": `${1.8 + rand(4) * 1.6}s`,
    "--delay": `${rand(5) * 0.7}s`,
  } as CSSProperties
})

function DoneModal({ firstName, onOpen }: { firstName: string; onOpen: () => void }) {
  return (
    <div className="gx-backdrop fixed inset-0 z-[95] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="gx-done-title">
      <div className="gx-modal relative w-full max-w-md overflow-hidden rounded-[30px] border border-white/10 p-7 text-center sm:p-9">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {CONFETTI.map((piece, index) => <span key={index} className="gx-confetti" style={piece} />)}
        </div>
        <span className="relative mx-auto grid h-20 w-20 place-items-center">
          <span className="gx-orb-ring absolute inset-0 rounded-full" />
          <span className="gx-pop grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-emerald-300 to-cyan-300 text-slate-950 shadow-[0_0_50px_rgba(52,211,153,0.5)]">
            <Check className="h-8 w-8" strokeWidth={3} />
          </span>
        </span>
        <h2 id="gx-done-title" className="gx-rise mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl" style={{ "--i": 1 } as CSSProperties}>You&apos;re all set, {firstName}!</h2>
        <p className="gx-rise mt-2 text-sm leading-6 text-slate-300" style={{ "--i": 2 } as CSSProperties}>
          Your swims and gym sessions are in Training. Tick each one off as you finish it, and come back every Monday: I&apos;ll help you plan the next week.
        </p>
        <Button autoFocus onClick={onOpen} className="gx-rise gx-cta mt-6 h-11 rounded-full bg-gradient-to-r from-cyan-200 to-accent px-7 font-semibold text-slate-950 shadow-[0_12px_32px_rgba(87,229,234,0.4)]" style={{ "--i": 3 } as CSSProperties}>
          Show me my week<ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
