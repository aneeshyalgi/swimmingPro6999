"use client"

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, Check, Sparkles, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Banner } from "@/components/training-ui"
import { cn } from "@/lib/utils"

/**
 * The first-visit flow shared by the dashboard's Nutrition and Mental Performance sections: an intro, one question per
 * screen, and an animation while the answers are saved and the plan is built.
 */
export type FlowOption<T> = { value: T; label: string; detail?: string; icon: LucideIcon }
/** `tone` colours the question's icon and the glow behind the card. */
export type FlowStep = { key: string; title: string; hint: string; icon: LucideIcon; tone: string }

function ChoiceCard<T extends string>({ option, selected, onSelect, index }: { option: FlowOption<T>; selected: boolean; onSelect: () => void; index: number }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={{ "--i": index } as CSSProperties}
      className={cn(
        "qf-rise group relative flex items-center gap-3 rounded-2xl border p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-300",
        selected
          ? "border-accent/70 bg-accent/[0.09] shadow-[0_0_0_1px_rgba(87,229,234,0.25),0_12px_30px_rgba(87,229,234,0.1)]"
          : "border-white/10 bg-white/[0.02] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.04]",
      )}
    >
      <span key={String(selected)} className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors duration-300",
        selected ? "qf-pick bg-accent text-accent-foreground" : "bg-white/[0.05] text-slate-300 group-hover:text-white")}>
        <option.icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{option.label}</span>
        {option.detail && <span className="mt-0.5 block text-xs leading-5 text-slate-400">{option.detail}</span>}
      </span>
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-all duration-300",
        selected ? "border-accent bg-accent text-accent-foreground" : "border-white/20 text-transparent")}>
        <Check className={cn("h-3 w-3 transition-transform duration-300", selected ? "scale-100" : "scale-0")} strokeWidth={3} />
      </span>
    </button>
  )
}

/** Answer cards with an icon; `offset` continues the entrance stagger after earlier items. */
export function Choices<T extends string>({ label, options, value, onChange, columns = "sm:grid-cols-2", offset = 0 }: {
  label: string; options: FlowOption<T>[]; value: T | null; onChange: (value: T) => void; columns?: string; offset?: number
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-3", columns)}>
      {options.map((option, index) => (
        <ChoiceCard key={option.value} option={option} selected={value === option.value} onSelect={() => onChange(option.value)} index={index + offset} />
      ))}
    </div>
  )
}

/** One-line choice with a sliding highlight; nothing is highlighted until something is chosen. */
export function Pills<T extends string | number>({ label, value, options, onChange, className }: {
  label: string; value: T | null; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string
}) {
  const index = options.findIndex((option) => option.value === value)
  return (
    <div role="radiogroup" aria-label={label} className={cn("relative grid h-11 rounded-xl border border-white/10 bg-white/[0.03] p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className={cn("absolute inset-y-1 left-1 rounded-lg bg-accent shadow-[0_4px_14px_rgba(87,229,234,0.3)] transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
        index < 0 && "opacity-0")} style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${Math.max(0, index) * 100}%)` }} />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button key={String(option.value)} type="button" role="radio" aria-checked={active} onClick={() => onChange(option.value)}
            className={cn("relative z-10 truncate rounded-lg px-2 text-sm font-medium transition-colors duration-300", active ? "text-accent-foreground" : "text-slate-300 hover:text-white")}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** A labelled question inside a step; `index` sets where it falls in the entrance stagger. */
export function Question({ label, children, index }: { label: string; children: ReactNode; index: number }) {
  return (
    <div className="qf-rise space-y-3" style={{ "--i": index } as CSSProperties}>
      <p className="text-sm font-medium text-slate-200">{label}</p>
      {children}
    </div>
  )
}

/** Which question is showing, which way the last move went (for the slide) and whether Continue was pressed too early. */
export function useFlow(startAt = 0) {
  const [step, setStep] = useState(startAt)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [tried, setTried] = useState(false)
  const go = (to: number) => {
    setDirection(to > step ? 1 : -1)
    setTried(false)
    setStep(to)
  }
  return { step, direction, tried, setTried, go }
}

/**
 * The question card: progress along the top, the current question sliding in from the side it came from, and
 * Back/Continue in a footer that stays on screen on phones. Enter continues.
 */
export function QuestionFlow({ steps, step, direction, eyebrow, editing, valid, missing, error, finalLabel, onBack, onCancel, onNext, children }: {
  steps: readonly FlowStep[]
  step: number
  direction: 1 | -1
  /** Shown before "n of N", e.g. the plan's name. */
  eyebrow: string
  editing: boolean
  valid: boolean
  /** Continue was pressed without an answer: says one is needed. */
  missing: boolean
  /** Why saving failed; shown on the last question. */
  error: string | null
  finalLabel: string
  onBack: () => void
  onCancel: () => void
  onNext: () => void
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  const headingId = useId()
  const current = steps[step]
  const last = step === steps.length - 1

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    heading.current?.focus({ preventScroll: true })
  }, [step])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    onNext()
  }

  return (
    <section onKeyDown={onKeyDown} aria-labelledby={headingId}
      className="qf-card dash-reveal relative mx-auto max-w-3xl overflow-clip rounded-[28px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.88),rgba(10,15,21,0.95))] shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
      style={{ "--qf-tone": current.tone } as CSSProperties}>
      <div aria-hidden className="qf-card-glow" />
      <header className="relative px-5 pt-5 sm:px-8 sm:pt-7">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent" aria-live="polite">
            {editing ? "Edit your answers" : eyebrow} · {step + 1} of {steps.length}
          </p>
          {editing && (
            <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">
              Cancel
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-hidden>
          {steps.map((item, index) => (
            <span key={item.key} className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <span className={cn("block h-full origin-left rounded-full bg-gradient-to-r from-accent to-sky-400 transition-transform duration-500 ease-out",
                index < step ? "scale-x-100" : index === step ? "qf-progress-now scale-x-100" : "scale-x-0")} />
            </span>
          ))}
        </div>
      </header>

      <div key={step} className={cn("relative px-5 pb-6 pt-6 sm:px-8", direction === 1 ? "qf-step-next" : "qf-step-prev")}>
        <div className="flex items-start gap-4">
          <span className="qf-step-icon grid h-12 w-12 shrink-0 place-items-center rounded-2xl border">
            <current.icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 id={headingId} ref={heading} tabIndex={-1} className="text-balance text-xl font-bold tracking-tight text-white outline-none sm:text-2xl">{current.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{current.hint}</p>
          </div>
        </div>
        {error && last && <div className="mt-5"><Banner tone="error">{error}</Banner></div>}
        <div className="mt-6">{children}</div>
        {missing && <p role="alert" className="mt-4 text-sm font-medium text-rose-300">Choose an answer to continue.</p>}
      </div>

      <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-b-[28px] border-t border-white/[0.06] bg-[#0b1218]/90 px-5 py-4 backdrop-blur-md sm:px-8">
        {step === 0 && editing ? <span /> : (
          <Button variant="ghost" onClick={onBack} className="rounded-full text-slate-300 hover:bg-white/[0.06] hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        <Button onClick={onNext} aria-disabled={!valid}
          className={cn("qf-cta group h-11 rounded-full px-6 text-sm font-semibold transition-all duration-300",
            valid ? "bg-accent text-accent-foreground shadow-[0_10px_30px_rgba(87,229,234,0.25)] hover:bg-accent/90" : "bg-white/[0.08] text-slate-400 hover:bg-white/[0.1]")}>
          {last ? (
            <>
              <Sparkles className="h-4 w-4" />
              {finalLabel}
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </>
          )}
        </Button>
      </footer>
    </section>
  )
}

/** First visit only: what the questions are for, before the first one, with icons orbiting the section's emblem. */
export function FlowIntro({ eyebrow, title, body, features, orbit, emblem: Emblem, tint, onStart }: {
  eyebrow: string
  title: string
  body: string
  features: { icon: LucideIcon; title: string; body: string }[]
  /** Six icons, with their text colour. */
  orbit: { icon: LucideIcon; tone: string }[]
  emblem: LucideIcon
  /** Colour of the light in the top-left corner, e.g. "bg-emerald-400/10". */
  tint: string
  onStart: () => void
}) {
  return (
    <section className="dash-reveal relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(125deg,rgba(255,255,255,0.05),rgba(12,20,28,0.94)_45%,rgba(87,229,234,0.12))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-10">
      <div aria-hidden className={cn("pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full blur-3xl", tint)} />
      <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_auto]">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
          <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2>
          <p className="mt-3 text-base leading-7 text-slate-300">{body}</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {features.map((item, index) => (
              <li key={item.title} className="qf-rise rounded-2xl border border-white/10 bg-black/20 p-3.5" style={{ "--i": index + 2 } as CSSProperties}>
                <item.icon className="h-4 w-4 text-accent" />
                <p className="mt-2 text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-400">{item.body}</p>
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button onClick={onStart} className="qf-cta group h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground hover:bg-accent/90">
              Start
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Button>
            <span className="text-xs text-slate-400">About a minute</span>
          </div>
        </div>
        <div aria-hidden className="relative mx-auto grid h-60 w-60 place-items-center">
          <span className="qf-spin-slow absolute inset-0 rounded-full border border-dashed border-white/15" />
          <span className="qf-glow absolute inset-8 rounded-full bg-[radial-gradient(circle,rgba(87,229,234,0.22),transparent_70%)]" />
          <div className="qf-orbit absolute inset-0">
            {orbit.map((item, index) => (
              <span key={index} className="qf-orbit-item" style={{ "--a": `${index * (360 / orbit.length)}deg` } as CSSProperties}>
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-[#0d151d]/90 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                  <item.icon className={cn("h-5 w-5", item.tone)} />
                </span>
              </span>
            ))}
          </div>
          <div className="qf-float relative grid h-24 w-24 place-items-center rounded-full border border-accent/30 bg-[#0b1218] shadow-[0_0_44px_rgba(87,229,234,0.28)]">
            <Emblem className="h-9 w-9 text-accent" />
          </div>
        </div>
      </div>
    </section>
  )
}

const BUILD_STEP_MS = 650

/**
 * Shown while the answers are saved: three rings draw in while each step ticks off, and it finishes once `done` is
 * true (and every step has shown), then calls `onFinished`.
 */
export function FlowBuilding({ title, readyTitle, subtitle, steps, rings, emblem: Emblem, done, onFinished }: {
  title: string
  readyTitle: string
  subtitle: string
  steps: string[]
  /** Outer to inner: each ring's two gradient colours. */
  rings: [string, string][]
  emblem: LucideIcon
  done: boolean
  onFinished: () => void
}) {
  const id = useId()
  const [ticked, setTicked] = useState(0)
  const finished = useRef(onFinished)
  finished.current = onFinished
  const ready = done && ticked >= steps.length

  useEffect(() => {
    if (ticked >= steps.length) return
    const timer = window.setTimeout(() => setTicked((count) => count + 1), BUILD_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [ticked, steps.length])

  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => finished.current(), 900)
    return () => window.clearTimeout(timer)
  }, [ready])

  return (
    <section role="status" aria-live="polite" className="dash-reveal relative mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.88),rgba(10,15,21,0.95))] px-6 py-10 text-center shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:px-10">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-10 h-56 w-56 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
      <div aria-hidden className="relative mx-auto h-44 w-44">
        <span className={cn("qf-spin-slow absolute -inset-3 rounded-full border border-dashed border-accent/30 transition-opacity duration-500", ready && "opacity-0")} />
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <defs>
            {rings.map(([from, to], index) => (
              <linearGradient key={index} id={`${id}-${index}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={from} />
                <stop offset="1" stopColor={to} />
              </linearGradient>
            ))}
          </defs>
          {rings.map((_, index) => {
            const radius = 70 - index * 14
            const length = 2 * Math.PI * radius
            return (
              <g key={index}>
                <circle cx="80" cy="80" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
                <circle cx="80" cy="80" r={radius} fill="none" stroke={`url(#${id}-${index})`} strokeWidth="9" strokeLinecap="round"
                  className="qf-build-arc" strokeDasharray={length}
                  style={{ "--len": `${length}px`, "--d": `${index * 220}ms`, strokeDashoffset: ready ? 0 : length * 0.28 } as CSSProperties} />
              </g>
            )
          })}
        </svg>
        <span className={cn("absolute inset-0 m-auto grid h-14 w-14 place-items-center rounded-full transition-all duration-500",
          ready ? "qf-pick bg-accent text-accent-foreground shadow-[0_0_30px_rgba(87,229,234,0.5)]" : "bg-white/[0.04] text-accent")}>
          {ready ? <Check className="h-7 w-7" strokeWidth={3} /> : <Emblem className="h-6 w-6" />}
        </span>
      </div>
      <h2 className="relative mt-6 text-2xl font-bold tracking-tight text-white">{ready ? readyTitle : title}</h2>
      <p className="relative mt-1.5 text-sm text-slate-400">{ready ? "Here it comes." : subtitle}</p>
      <ol className="relative mx-auto mt-7 max-w-sm space-y-2 text-left">
        {steps.map((label, index) => {
          const checked = index < ticked
          const active = index === ticked && !ready
          return (
            <li key={label} className={cn("flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-all duration-500",
              checked ? "border-white/[0.08] bg-white/[0.03] text-slate-200" : active ? "border-accent/35 bg-accent/[0.07] text-white" : "border-transparent text-slate-600")}>
              <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full transition-all duration-300",
                checked ? "qf-pick bg-accent text-accent-foreground" : active ? "bg-accent/20" : "bg-white/[0.05]")}>
                {checked ? <Check className="h-3 w-3" strokeWidth={3.5} /> : active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
              </span>
              {label}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
