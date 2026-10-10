"use client"

import { useId, useRef, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ACCENT_COLORS, type StorePlan } from "@/lib/plan-store"

/** Small stable number from a string, so every plan gets its own wave pattern. */
const seedOf = (text: string) => [...text].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)

function wave(y: number, amplitude: number, phase: number) {
  let d = `M0 ${y}`
  for (let x = 0; x <= 300; x += 15) d += ` L${x} ${(y + Math.sin(x / 34 + phase) * amplitude).toFixed(1)}`
  return d
}

type CoverSize = "xs" | "sm" | "md" | "lg"
const TEXT: Record<CoverSize, { title: string; kicker: string; meta: string; pad: string }> = {
  xs: { title: "text-[9.5px] leading-[1.15]", kicker: "text-[5.5px]", meta: "", pad: "py-2 pl-[11px] pr-1.5" },
  sm: { title: "text-[15px] leading-[1.1]", kicker: "text-[7px]", meta: "text-[7px]", pad: "p-3 pl-5" },
  md: { title: "text-[22px] leading-[1.05]", kicker: "text-[9px]", meta: "text-[9px]", pad: "p-4 pl-6" },
  lg: { title: "text-[30px] leading-[1.02]", kicker: "text-[10px]", meta: "text-[10px]", pad: "p-6 pl-9" },
}

/** The plan's cover, drawn from its data: a booklet with a spine, lane lines and the plan title. */
export function PlanCover({ plan, size = "md", className }: { plan: StorePlan; size?: CoverSize; className?: string }) {
  const color = ACCENT_COLORS[plan.accent]
  const seed = seedOf(plan.id)
  const text = TEXT[size]
  const id = `cover${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  return (
    <div className={cn("relative aspect-[3/4] overflow-hidden rounded-[14px] bg-[#070d14] text-left shadow-[0_24px_50px_rgba(0,0,0,0.55)] ring-1 ring-white/10", className)}>
      <svg viewBox="0 0 300 400" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id={`${id}-glow`} cx="0.85" cy="0.15" r="0.9">
            <stop offset="0" stopColor={color.main} stopOpacity="0.55" />
            <stop offset="0.45" stopColor={color.main} stopOpacity="0.12" />
            <stop offset="1" stopColor="#070d14" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-wave`} x1="0" x2="1">
            <stop offset="0" stopColor={color.light} stopOpacity="0" />
            <stop offset="0.5" stopColor={color.light} stopOpacity="0.9" />
            <stop offset="1" stopColor={color.main} stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <rect width="300" height="400" fill={`url(#${id}-glow)`} />
        {/* lane ropes */}
        {[0, 1, 2, 3, 4].map((lane) => (
          <line key={lane} x1="0" x2="300" y1={150 + lane * 22} y2={150 + lane * 22 - 40} stroke="white" strokeOpacity={0.05 + lane * 0.012} strokeDasharray="5 6" strokeWidth="1.2" />
        ))}
        {/* the plan's own wave signature */}
        {[0, 1, 2].map((line) => (
          <path key={line} d={wave(118 + line * 16, 7 + ((seed >> line) % 9), (seed % 13) / 2 + line * 0.9)} fill="none"
            stroke={`url(#${id}-wave)`} strokeWidth={line === 1 ? 2.2 : 1.1} strokeOpacity={line === 1 ? 1 : 0.55} />
        ))}
        <circle cx={60 + (seed % 180)} cy={92 + (seed % 40)} r="2.5" fill={color.light} />
      </svg>
      {/* spine */}
      <div className="absolute inset-y-0 left-0 w-[7%] bg-[linear-gradient(90deg,rgba(0,0,0,0.55),rgba(255,255,255,0.06)_70%,rgba(0,0,0,0.25))]" />
      <div className="absolute inset-y-0 left-[7%] w-px bg-white/10" />
      <div className={cn("relative flex h-full flex-col", text.pad)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("font-bold uppercase tracking-[0.28em] text-white/80", text.kicker)}>SwimGPT</span>
          {size !== "xs" && (
            <span className={cn("rounded-full border px-1.5 py-px font-semibold uppercase tracking-[0.14em]", text.kicker)} style={{ borderColor: `rgba(${color.rgb},0.45)`, color: color.light }}>{plan.category}</span>
          )}
        </div>
        <div className="mt-auto">
          <p className={cn("font-black tracking-tight text-white", text.title)}>{plan.title}</p>
          <div className={cn("rounded-full", size === "xs" ? "mt-1.5 h-[2px] w-6" : "mt-2 h-[3px] w-10")} style={{ background: `linear-gradient(90deg, ${color.light}, ${color.main})` }} />
          {size !== "xs" && <div className={cn("mt-2.5 flex flex-wrap gap-x-2 gap-y-0.5 font-semibold uppercase tracking-[0.16em] text-white/55", text.meta)}>
            {size === "sm"
              ? <><span>{plan.weeks} wk</span><span style={{ color: color.light }}>·</span><span>{plan.sessions_per_week}×/wk</span></>
              : <><span>{plan.weeks} weeks</span><span style={{ color: color.light }}>·</span><span>{plan.sessions_per_week}×/week</span><span style={{ color: color.light }}>·</span><span>{plan.pages} pp</span></>}
          </div>}
        </div>
      </div>
      {/* moving sheen, driven by the tilt wrapper's pointer position */}
      <div className="store-sheen pointer-events-none absolute inset-0" />
    </div>
  )
}

/** Wraps children in a pointer-tracked 3D tilt. Does nothing on touch screens or with reduced motion. */
export function Tilt({ children, className, max = 10, style }: { children: ReactNode; className?: string; max?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const element = ref.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      element.style.setProperty("--rx", `${((0.5 - y) * max).toFixed(2)}deg`)
      element.style.setProperty("--ry", `${((x - 0.5) * max).toFixed(2)}deg`)
      element.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`)
      element.style.setProperty("--my", `${(y * 100).toFixed(1)}%`)
      element.dataset.tilting = "true"
    })
  }
  const leave = () => {
    cancelAnimationFrame(frame.current)
    const element = ref.current
    if (!element) return
    element.style.setProperty("--rx", "0deg")
    element.style.setProperty("--ry", "0deg")
    delete element.dataset.tilting
  }
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={cn("store-tilt", className)} style={style}>
      {children}
    </div>
  )
}
