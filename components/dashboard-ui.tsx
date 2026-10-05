"use client"

import { useEffect, useId, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Values the backend sends when something hasn't been logged yet.
export const isMissing = (value: string) => /^(not recorded|not scheduled|date not recorded)$/i.test(value.trim())

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** Staggered entrance animation; `index` sets the delay. */
export function Reveal({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn("dash-reveal", className)}
      style={{ "--reveal-delay": `${Math.min(index, 12) * 60}ms` } as CSSProperties}
    >
      {children}
    </div>
  )
}

export function Tile({
  className,
  glow,
  children,
}: {
  className?: string
  glow?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "group relative h-full overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(22,32,42,0.82),rgba(10,15,21,0.92))] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300 sm:p-6",
        "hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-[0_20px_50px_rgba(0,0,0,0.38)]",
        glow && "border-accent/25 shadow-[0_14px_40px_rgba(0,0,0,0.28),0_0_0_1px_rgba(87,229,234,0.08)]",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/0 blur-3xl transition-colors duration-500 group-hover:bg-accent/10" />
      <div className="relative h-full">{children}</div>
    </div>
  )
}

export function TileHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10">
          <Icon className="h-5 w-5 text-accent" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "accent",
}: {
  icon: LucideIcon
  label: string
  value: string
  detail?: string
  tone?: "accent" | "violet" | "amber" | "emerald" | "rose" | "sky"
}) {
  const missing = isMissing(value)
  const tones = {
    accent: "bg-accent/12 text-accent",
    violet: "bg-violet-400/12 text-violet-300",
    amber: "bg-amber-300/12 text-amber-200",
    emerald: "bg-emerald-400/12 text-emerald-300",
    rose: "bg-rose-400/12 text-rose-300",
    sky: "bg-sky-400/12 text-sky-300",
  }
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 transition-colors duration-300 hover:border-white/15 hover:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-xs font-medium text-slate-400">{label}</dt>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <dd className={cn("mt-3 font-semibold tracking-tight", missing ? "text-sm text-slate-500" : "text-2xl text-white")}>
        {missing ? "—" : value}
      </dd>
      {(detail || missing) && (
        <dd className="mt-1.5 text-xs leading-5 text-slate-500">{missing ? `${value}. ${detail ?? ""}`.trim() : detail}</dd>
      )}
    </div>
  )
}

export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])
  return value
}

export function ProgressRing({
  value,
  size = 112,
  stroke = 10,
  label,
  tone = "cyan",
  children,
}: {
  value: number
  size?: number
  stroke?: number
  label: string
  tone?: "cyan" | "violet"
  children?: ReactNode
}) {
  const gradientId = useId()
  const [from, to] = tone === "violet" ? ["#c4b5fd", "#a78bfa"] : ["#67e8f9", "#38bdf8"]
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(Math.max(0, Math.min(100, value))))
    return () => cancelAnimationFrame(frame)
  }, [value])
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(value)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
          className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
        />
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

/** Horizontal bar that grows to `percent` on mount. */
export function GrowBar({ percent, className, barClassName }: { percent: number; className?: string; barClassName?: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(Math.max(0, Math.min(100, percent))))
    return () => cancelAnimationFrame(frame)
  }, [percent])
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div
        className={cn("h-full rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-[width] duration-1000 ease-out motion-reduce:transition-none", barClassName)}
        style={{ width: `${shown}%` }}
      />
    </div>
  )
}
