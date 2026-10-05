"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/** Animated side-on swimmer with a tracked skeleton: previews what the lab draws on a real clip. */
export function StrokeDemo({ className }: { className?: string }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => setTick((value) => value + 1), 700)
    return () => window.clearInterval(timer)
  }, [])
  const elbow = 104 + Math.round(Math.sin(tick * 0.9) * 14)
  const line = (4 + Math.abs(Math.sin(tick * 0.6)) * 3).toFixed(0)
  const rate = 46 + (tick % 3)

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-cyan-200/10 bg-[linear-gradient(180deg,#0b4c5e,#06303d_55%,#041c25)]", className)}>
      <div className="landing-pool-caustics absolute inset-0 opacity-50" />
      <svg viewBox="0 0 400 170" className="relative block h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="demo-bone" x1="0" x2="1">
            <stop offset="0" stopColor="#d9fbff" /><stop offset="0.5" stopColor="#67e8f9" /><stop offset="1" stopColor="#a78bfa" />
          </linearGradient>
          <filter id="demo-glow"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        {/* surface */}
        <path className="lab-surface" d="M0 58 Q 25 52 50 58 T 100 58 T 150 58 T 200 58 T 250 58 T 300 58 T 350 58 T 400 58 T 450 58" stroke="rgba(165,243,252,0.35)" strokeWidth="1.5" fill="none" />
        <g className="lab-swimmer">
          {/* glow underlay */}
          <g stroke="rgba(34,211,238,0.45)" strokeWidth="9" strokeLinecap="round" filter="url(#demo-glow)">
            <line x1="286" y1="76" x2="180" y2="84" /><line x1="180" y1="84" x2="66" y2="86" />
          </g>
          {/* torso + legs */}
          <g stroke="url(#demo-bone)" strokeWidth="3.5" strokeLinecap="round" fill="none">
            <line x1="286" y1="76" x2="180" y2="84" />
            <g className="lab-kick-a"><line x1="180" y1="84" x2="122" y2="88" /><line x1="122" y1="88" x2="66" y2="84" /></g>
            <g className="lab-kick-b"><line x1="180" y1="84" x2="124" y2="82" /><line x1="124" y1="82" x2="68" y2="80" /></g>
          </g>
          {/* arms, half a cycle apart */}
          {["0s", "-1.3s"].map((delay, index) => (
            <g key={delay} className="lab-arm" style={{ animationDelay: delay }}>
              <line x1="286" y1="76" x2="326" y2="76" stroke={index ? "#c4b5fd" : "#67e8f9"} strokeWidth="3.5" strokeLinecap="round" />
              <g className="lab-forearm" style={{ animationDelay: delay }}>
                <line x1="326" y1="76" x2="358" y2="76" stroke={index ? "#c4b5fd" : "#67e8f9"} strokeWidth="3.5" strokeLinecap="round" />
                <circle cx="358" cy="76" r="3.5" fill="#ecfeff" />
              </g>
              <circle cx="326" cy="76" r="3.5" fill="#ecfeff" />
            </g>
          ))}
          <circle cx="300" cy="70" r="9" fill="rgba(236,254,255,0.9)" />
          {[[286, 76], [180, 84], [122, 88], [66, 86]].map(([x, y]) => (
            <g key={`${x}-${y}`}><circle cx={x} cy={y} r="4" fill="#ecfeff" /><circle className="lab-joint-ring" cx={x} cy={y} r="8" fill="none" stroke="rgba(103,232,249,0.6)" /></g>
          ))}
          {/* body line */}
          <line x1="286" y1="76" x2="66" y2="86" stroke="rgba(250,204,21,0.7)" strokeWidth="1.2" strokeDasharray="5 5" />
        </g>
        {/* target brackets */}
        <g stroke="rgba(165,243,252,0.7)" strokeWidth="1.5" fill="none">
          <path d="M44 46 h14 M44 46 v14" /><path d="M376 46 h-14 M376 46 v14" /><path d="M44 120 h14 M44 120 v-14" /><path d="M376 120 h-14 M376 120 v-14" />
        </g>
        <rect className="lab-scanline" x="44" y="46" width="2" height="74" fill="url(#demo-bone)" opacity="0.8" />
      </svg>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap gap-1.5 font-mono text-[10px]">
        <span className="rounded-full border border-cyan-300/40 bg-slate-950/70 px-2 py-0.5 text-cyan-100">elbow {elbow}°</span>
        <span className="rounded-full border border-amber-300/40 bg-slate-950/70 px-2 py-0.5 text-amber-100">line {line}°</span>
        <span className="rounded-full border border-violet-300/40 bg-slate-950/70 px-2 py-0.5 text-violet-100">{rate} strokes/min</span>
      </div>
    </div>
  )
}
