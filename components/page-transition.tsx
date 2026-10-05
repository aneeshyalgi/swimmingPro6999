"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Waves } from "lucide-react"
import { cn } from "@/lib/utils"

type Phase = "idle" | "covering" | "covered" | "revealing"
type Target = { href: string; path: string; label: string }

const TransitionContext = createContext<{ phase: Phase; pendingPath: string | null; navigate: (href: string) => void }>({
  phase: "idle", pendingPath: null, navigate: () => {},
})
/** Current transition phase, the path being navigated to, and a navigate() that plays the dive transition. */
export const usePageTransition = () => useContext(TransitionContext)

const COVER_MS = 760
const REVEAL_MS = 1000
const FALLBACK_MS = 6000
const LABELS: [RegExp, string][] = [
  [/^\/$/, "Home"], [/^\/training-plans/, "Training Plans"], [/^\/video-analysis/, "Video Analysis"], [/^\/dashboard/, "Your dashboard"],
  [/^\/auth/, "Welcome"], [/^\/onboarding/, "Plan setup"], [/^\/coach-chat/, "Coach chat"], [/^\/payment/, "Payment"],
]
const labelFor = (path: string) => LABELS.find(([pattern]) => pattern.test(path))?.[1] ?? "SwimGPT"
// One tile of wave crest; both ends sit at y = 60 with matching slopes, so tiles repeat seamlessly.
const WAVE = "M0 60 C 180 0, 540 0, 720 60 C 900 120, 1260 120, 1440 60 V 160 H 0 Z"
const LAYERS = [
  { color: "#0a3443", body: "#0a3443", rise: 0, leave: 160 },
  { color: "#0f5f72", body: "#0f5f72", rise: 80, leave: 80 },
  { color: "#06202c", body: "linear-gradient(180deg,#06202c,#04131b 60%,#030c12)", rise: 160, leave: 0 },
]

function WaveEdge({ color, flip, speed }: { color: string; flip?: boolean; speed: string }) {
  return (
    <div className={cn("pt-wave", flip && "pt-wave-flip")}>
      <div className="pt-wave-track" style={{ animationDuration: speed }}>
        {[0, 1].map((copy) => (
          <svg key={copy} viewBox="0 0 1440 160" preserveAspectRatio="none" className="h-full w-1/2"><path d={WAVE} fill={color} /></svg>
        ))}
      </div>
    </div>
  )
}

/** Plays a water "dive" between pages: waves rise over the screen, the next page loads underneath, the water drains away. */
export function PageTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [phase, setPhase] = useState<Phase>("idle")
  const [target, setTarget] = useState<Target | null>(null)
  const phaseRef = useRef<Phase>("idle")
  const timers = useRef<number[]>([])
  phaseRef.current = phase

  const later = (callback: () => void, ms: number) => { timers.current.push(window.setTimeout(callback, ms)) }
  const clearTimers = () => { timers.current.forEach((timer) => window.clearTimeout(timer)); timers.current = [] }

  const reveal = useCallback(() => {
    if (phaseRef.current !== "covered") return
    clearTimers()
    window.scrollTo(0, 0)
    setPhase("revealing")
    later(() => { setPhase("idle"); setTarget(null) }, REVEAL_MS)
  }, [])

  const navigate = useCallback((href: string) => {
    if (phaseRef.current !== "idle") return
    const url = new URL(href, window.location.href)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { router.push(href); return }
    router.prefetch(url.pathname)
    setTarget({ href: url.pathname + url.search + url.hash, path: url.pathname, label: labelFor(url.pathname) })
    setPhase("covering")
    later(() => { setPhase("covered"); router.push(url.pathname + url.search + url.hash) }, COVER_MS)
    later(() => reveal(), COVER_MS + FALLBACK_MS) // never leave the screen covered if navigation stalls
  }, [router, reveal])

  // Reveal once the destination route has rendered underneath the water.
  useEffect(() => {
    if (phase === "covered" && target && pathname === target.path) later(reveal, 220)
  }, [pathname, phase, target, reveal])

  // Every internal link click (navbar, buttons, logo) plays the transition.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download") || "noTransition" in anchor.dataset) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      event.preventDefault()
      event.stopPropagation()
      navigate(url.pathname + url.search + url.hash)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [navigate])

  useEffect(() => () => clearTimers(), [])

  return (
    <TransitionContext.Provider value={{ phase, pendingPath: phase === "idle" ? null : target?.path ?? null, navigate }}>
      {children}
      <div aria-hidden className={cn("pt-overlay", `pt-${phase}`)}>
        {LAYERS.map((layer, index) => (
          <div key={index} className="pt-layer" style={{ "--rise-delay": `${layer.rise}ms`, "--leave-delay": `${layer.leave}ms` } as CSSProperties}>
            <WaveEdge color={layer.color} speed={`${2.6 + index * 0.7}s`} />
            <div className="pt-body" style={{ background: layer.body }}>
              {index === LAYERS.length - 1 && <>
                <div className="landing-pool-caustics absolute inset-0 opacity-40" />
                {Array.from({ length: 14 }, (_, bubble) => (
                  <span key={bubble} className="pt-bubble" style={{
                    left: `${(bubble * 37) % 100}%`, width: `${4 + (bubble % 4) * 3}px`, height: `${4 + (bubble % 4) * 3}px`,
                    animationDelay: `${(bubble % 7) * 0.18}s`, animationDuration: `${1.6 + (bubble % 5) * 0.35}s`,
                  }} />
                ))}
              </>}
            </div>
            <WaveEdge color={index === LAYERS.length - 1 ? "#030c12" : layer.color} flip speed={`${3 + index * 0.6}s`} />
          </div>
        ))}
        <div className="pt-stage">
          <div className="relative flex h-20 w-20 items-center justify-center">
            <span className="pt-ripple" />
            <span className="pt-ripple" style={{ animationDelay: "0.55s" }} />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 via-teal-300 to-sky-600 shadow-[0_0_50px_rgba(87,229,234,0.55)]">
              <Waves className="h-8 w-8 text-slate-950" />
            </span>
          </div>
          <p className="mt-7 overflow-hidden text-3xl font-bold tracking-tight text-white sm:text-5xl">
            {(target?.label ?? "").split("").map((letter, index) => (
              <span key={`${target?.href}-${index}`} className="pt-letter" style={{ animationDelay: `${520 + index * 30}ms` }}>{letter === " " ? " " : letter}</span>
            ))}
          </p>
          <div className="pt-progress mt-5" />
        </div>
      </div>
    </TransitionContext.Provider>
  )
}

/** Page content enters as the water clears (or straight away on a normal load). */
export function PageEnter({ children }: { children: ReactNode }) {
  const { phase } = usePageTransition()
  // Only a page that mounts underneath the water waits for the reveal; the outgoing page stays put while it is covered.
  const [mountedUnderWater] = useState(phase === "covered")
  return <div className={mountedUnderWater && phase === "covered" ? "pt-page-waiting" : "pt-page-enter"}>{children}</div>
}
