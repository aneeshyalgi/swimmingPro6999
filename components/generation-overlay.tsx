"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ShieldAlert } from "lucide-react"
import type { z } from "zod"
import { GenerationProgress } from "@/components/training-ui"
import { tokensChanged } from "@/lib/token-events"
import { startGeneration } from "@/lib/training"

/**
 * Generating a swim or gym week. While it runs, the browser asks before a reload or a closed tab; if the athlete
 * leaves anyway (or this screen goes away: another section, another page), the run is cancelled on the server and
 * nothing from it is saved, so the week is simply not generated yet when they come back.
 */
export function useWeekGeneration() {
  const running = useRef<{ cancel: () => void } | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => () => running.current?.cancel(), [])

  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    const leave = () => running.current?.cancel()
    window.addEventListener("beforeunload", warn)
    window.addEventListener("pagehide", leave)
    return () => {
      window.removeEventListener("beforeunload", warn)
      window.removeEventListener("pagehide", leave)
    }
  }, [active])

  const run = useCallback(async <T,>(path: string, schema: z.ZodType<T>, body: Record<string, unknown>): Promise<T> => {
    const generation = startGeneration(path, schema, body)
    running.current = generation
    setActive(true)
    try {
      return await generation.promise
    } finally {
      if (running.current === generation) running.current = null
      setActive(false)
      tokensChanged()  // the week was paid for, or its tokens came back
    }
  }, [])

  return { active, run }
}

/** Full-screen progress for a week being generated. Everything behind it is blocked: no clicks, focus or shortcuts. */
export function GenerationOverlay({ title, subtitle, steps, interval }: { title: string; subtitle: string; steps: string[]; interval?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [slow, setSlow] = useState(false)
  useEffect(() => setMounted(true), [])
  // A busy moment can take longer than usual: say it's still working rather than leave the last step looking stuck.
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 30000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!mounted || !host.current) return
    const overlay = host.current
    const blocked = Array.from(document.body.children).filter((element) => element !== overlay && !element.hasAttribute("inert"))
    blocked.forEach((element) => element.setAttribute("inert", ""))
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = "hidden"
    // App shortcuts listen on window; browser ones (reload, close) still work and are covered by the leave prompt.
    const swallow = (event: KeyboardEvent) => {
      event.stopImmediatePropagation()
      if (event.key === "Tab") event.preventDefault()  // nothing behind it can take focus; keep it on the progress
    }
    window.addEventListener("keydown", swallow, true)
    overlay.focus()
    return () => {
      blocked.forEach((element) => element.removeAttribute("inert"))
      root.style.overflow = overflow
      window.removeEventListener("keydown", swallow, true)
    }
  }, [mounted])

  if (!mounted) return null
  return createPortal(
    <div ref={host} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label={title}
      className="gx-backdrop fixed inset-0 z-[200] flex items-center justify-center p-4 outline-none">
      <div className="w-full max-w-lg">
        <GenerationProgress title={title} subtitle={subtitle} steps={steps} interval={interval} />
        {slow && (
          <p role="status" className="mt-3 text-center text-xs text-slate-300">
            Still working on it. Busy moments can take a little longer.
          </p>
        )}
        <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-slate-400">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-200/80" />
          Keep this page open. Leaving or refreshing stops it, and nothing is saved.
        </p>
      </div>
    </div>,
    document.body,
  )
}
