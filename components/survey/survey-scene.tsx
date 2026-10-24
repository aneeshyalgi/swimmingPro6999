"use client"

import { Fragment, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import Link from "next/link"
import { X, type LucideIcon } from "lucide-react"
import { WaterBubbles } from "@/components/water-bubbles"
import { cn } from "@/lib/utils"

/** Text that arrives word by word, each word rising out of a blur; `from` carries on the stagger after earlier text. */
export function Words({ text, from = 0 }: { text: string; from?: number }) {
  const words = text.split(" ")
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={index}>
          <span className="sv-word" style={{ "--w": index + from } as CSSProperties}>{word}</span>
          {index < words.length - 1 && " "}
        </Fragment>
      ))}
    </>
  )
}

// Fixed values (no Math.random) so the server's markup matches the browser's.
const CONFETTI = Array.from({ length: 40 }, (_, index) => ({
  x: `${(index * 37 + 7) % 100}%`,
  dx: `${((index % 7) - 3) * 26}px`,
  delay: `${(index % 10) * 0.08}s`,
  duration: `${2.6 + (index % 5) * 0.4}s`,
  rotate: `${(index % 2 ? 1 : -1) * (300 + ((index * 53) % 420))}deg`,
  color: ["#fcd34d", "#57e5ea", "#34d399", "#c4b5fd", "#fda4af", "#7dd3fc"][index % 6],
  shape: [{ w: "8px", h: "8px", r: "9999px" }, { w: "6px", h: "13px", r: "2px" }, { w: "10px", h: "4px", r: "9999px" }][index % 3],
}))

/** Where the athlete is in the survey: a swimmer travelling down the lane rope, past a float for each question. */
function Lane({ step, total, done }: { step: number; total: number; done: boolean }) {
  const at = done ? 100 : total > 1 ? (step / (total - 1)) * 100 : 0
  return (
    <div aria-hidden className="mx-auto max-w-3xl px-7 pb-3.5 pt-3 sm:px-8">
      <div className="relative h-4">
        <span className="sv-rope" />
        <span className="sv-lane-fill" style={{ width: `${at}%` }} />
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={cn("sv-mark", (done || index < step) && "is-done", !done && index === step && "is-now")}
            style={{ left: `${(index / (total - 1)) * 100}%` }} />
        ))}
        <span className={cn("sv-swimmer", done && "is-done")} style={{ left: `${at}%` }} />
      </div>
    </div>
  )
}

/** The question count in the header, its number rolling up as it changes. */
export function Counter({ value, total }: { value: number; total: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-baseline gap-1 font-semibold tabular-nums">
      <span className="relative inline-block overflow-hidden text-xl leading-none text-white sm:text-2xl">
        <span key={value} className="sv-count inline-block">{String(value).padStart(2, "0")}</span>
      </span>
      <span className="text-xs text-slate-500">/ {String(total).padStart(2, "0")}</span>
    </span>
  )
}

/**
 * The /survey page's frame: an underwater scene that takes on the page's colour (`tone`), a glass header (back to the
 * dashboard, the title, `status` and the swim-lane progress) and a glass footer, both staying on screen. Plain page flow
 * (the scene is sticky, not fixed), so it works inside the page's entrance animation.
 */
export function SurveyScreen({ tone = "#57e5ea", status, progress, footer, onKeyDown, celebrate = false, sweep, children }: {
  tone?: string
  /** Shown at the top right, e.g. the question count. */
  status?: ReactNode
  progress?: { step: number; total: number; done: boolean }
  footer?: ReactNode
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  /** Confetti falls across the scene. */
  celebrate?: boolean
  /** A new question arriving (`key`): light washes across the scene, the way the athlete is going. */
  sweep?: { key: number; direction: 1 | -1 }
  children: ReactNode
}) {
  const light = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  // A soft light follows the mouse through the water.
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return
    const { clientX, clientY } = event
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (light.current) light.current.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`
    })
  }

  return (
    <div onKeyDown={onKeyDown} onPointerMove={follow} style={{ "--sv-tone": tone, minHeight: "100dvh" } as CSSProperties}
      className="sv-page relative flex min-h-screen flex-col text-foreground">
      <div aria-hidden className="pointer-events-none sticky top-0 z-0 -mb-[100vh] h-screen w-full shrink-0 overflow-hidden"
        style={{ height: "100dvh", marginBottom: "-100dvh" }}>
        <div className="sv-deep absolute inset-0" />
        <div className="sv-aurora absolute inset-0"><i /><i /><i /></div>
        <WaterBubbles />
        <div ref={light} className="sv-light" />
        {sweep && <div key={sweep.key} className="sv-wash" data-direction={sweep.direction} />}
        <div className="sv-vignette absolute inset-0" />
        {celebrate && (
          <div className="sv-confetti absolute inset-0">
            {CONFETTI.map((piece, index) => (
              <i key={index} style={{
                "--x": piece.x, "--dx": piece.dx, "--d": piece.delay, "--t": piece.duration, "--rot": piece.rotate, "--c": piece.color,
                "--w": piece.shape.w, "--h": piece.shape.h, "--r": piece.shape.r,
              } as CSSProperties} />
            ))}
          </div>
        )}
      </div>

      {/* Clipped sideways only: the swimmer's ripple at either end of the lane never widens the page. */}
      <header className="sv-glass sv-header sticky top-0 z-20 overflow-x-clip">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pt-3.5 sm:px-6 sm:pt-4">
          <Link href="/dashboard" aria-label="Back to your dashboard" title="Back to your dashboard"
            className="sv-icon-button grid h-10 w-10 shrink-0 place-items-center rounded-full">
            <X className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="sv-eyebrow truncate">Your feedback</p>
            <h1 className="truncate text-lg font-bold tracking-tight text-white sm:text-xl">Rate SwimGPT</h1>
          </div>
          {status}
        </div>
        {progress ? <Lane {...progress} /> : <div className="h-3.5 sm:h-4" />}
      </header>

      <main className="relative z-10 flex-1">{children}</main>

      {footer && (
        <footer className="sv-glass sv-footer sticky bottom-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3.5 sm:px-6">{footer}</div>
        </footer>
      )}
    </div>
  )
}

/** A message in place of the questions (opening, already answered, not open, or not loaded), with a way on. */
export function SurveyNotice({ icon: Icon, tone = "text-white", title, body, busy = false, action, children }: {
  icon: LucideIcon
  /** The icon's colour. */
  tone?: string
  title: string
  body?: ReactNode
  /** Still opening: the icon spins and screen readers hear that the page is busy. */
  busy?: boolean
  action?: ReactNode
  /** Below the message, before the way on: say, a choice to make. */
  children?: ReactNode
}) {
  return (
    <div role={busy ? "status" : undefined} aria-busy={busy || undefined}
      className="mx-auto flex max-w-lg flex-col items-center px-6 pb-16 pt-20 text-center sm:pt-28">
      <span className="sv-notice-icon relative grid h-20 w-20 place-items-center rounded-[1.75rem]">
        <span aria-hidden className="sv-sonar" />
        <Icon className={cn("relative h-8 w-8", tone, busy && "animate-spin")} />
      </span>
      <h2 className="sv-rise mt-8 text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl" style={{ "--i": 1 } as CSSProperties}>{title}</h2>
      {body && <div className="sv-rise mt-3 text-sm leading-6 text-slate-400 sm:text-base" style={{ "--i": 2 } as CSSProperties}>{body}</div>}
      {children && <div className="sv-rise mt-8 w-full" style={{ "--i": 3 } as CSSProperties}>{children}</div>}
      {action && (
        <div className={cn("sv-rise flex flex-wrap items-center justify-center gap-3", children ? "mt-6" : "mt-8")} style={{ "--i": children ? 4 : 3 } as CSSProperties}>
          {action}
        </div>
      )}
    </div>
  )
}

/** The way back to the dashboard: the main button (`primary`) or a quieter one. */
export function BackToDashboard({ primary = false }: { primary?: boolean }) {
  return (
    <Link href="/dashboard" className={cn("h-12 px-7 text-sm", primary ? "sv-cta" : "sv-cta-ghost")}>Back to dashboard</Link>
  )
}
