"use client"

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { Check, Sparkles, X } from "lucide-react"
import { SCENES, SceneRenderer, drawnScene, rgb, type Rgb, type SceneId } from "@/lib/call-scenes"
import { cn } from "@/lib/utils"

/*
 * The scenes behind the coach chat and the voice call: the background (CallScene) and the picker of scenes
 * (ScenePicker). A new scene sweeps in from the tile that was picked, behind a liquid wavefront. Every scene moves with
 * the coach: their voice on a call, their replies in the chat.
 */

type Point = { x: number; y: number }

const REVEAL_MS = 1400
// Scenes are soft, so they're drawn under full resolution and scaled up: at most this many pixels a frame.
const MAX_PIXELS = 1_100_000
// Seconds into a scene's own clock it starts at (a moment when every scene has something going on).
const TIME_OFFSET = 20

// Safari has no idle callbacks: a short timeout stands in.
const idleCallbacks = () => typeof window.requestIdleCallback === "function"
const idle = (callback: () => void): number =>
  idleCallbacks() ? window.requestIdleCallback(callback, { timeout: 600 }) : window.setTimeout(callback, 60)
const cancelIdle = (handle: number) => {
  if (idleCallbacks()) window.cancelIdleCallback(handle)
  else window.clearTimeout(handle)
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The scene behind the chat or the call. `scene` changes are revealed from `origin` (CSS pixels; the middle when null).
 * Midnight is their own CSS backdrop, so this canvas is clear while it shows. `level` is how strongly the coach is
 * coming through (0-1) and `phase` the state ("speaking": the coach). `warm` compiles every scene ahead of time (while
 * the picker is open), so a switch starts at once. `variant` sets how much the scene is darkened under the page's text
 * (the chat, mostly text, more than the call); `paused` stops drawing while it's out of sight (a call over the chat),
 * and `fps` caps how often it's drawn. Without WebGL it calls `onUnavailable`; a scene this device can't draw, `onFailed`.
 */
export function CallScene({ scene, origin, tone, level, phase, warm, variant = "call", paused = false, fps, onSettled, onUnavailable, onFailed }: {
  scene: SceneId
  origin: Point | null
  tone: [string, string]
  level: RefObject<number>
  phase: RefObject<string>
  warm: boolean
  variant?: "call" | "chat"
  paused?: boolean
  fps?: number
  onSettled: (scene: SceneId) => void
  onUnavailable: () => void
  onFailed: (scene: SceneId, previous: SceneId) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const [shown, setShown] = useState(drawnScene(scene))
  const live = useRef({ scene, previous: null as SceneId | null, start: 0, ready: false, origin: null as Point | null, tone: [rgb(tone[0]), rgb(tone[1])] as [Rgb, Rgb] })
  const callbacks = useRef({ onSettled, onUnavailable, onFailed })
  const options = useRef({ paused, fps })
  useEffect(() => { callbacks.current = { onSettled, onUnavailable, onFailed }; options.current = { paused, fps } })
  useEffect(() => { live.current.tone = [rgb(tone[0]), rgb(tone[1])] }, [tone])

  // A new scene: reveal it from where it was picked. Out of sight, it's simply there when it's seen again.
  useEffect(() => {
    const state = live.current
    if (scene === state.scene) return
    if (paused) {
      Object.assign(state, { previous: null, scene, ready: true })
      setShown(drawnScene(scene))
      callbacks.current.onSettled(scene)
      return
    }
    Object.assign(state, { previous: state.scene, scene, ready: false, origin })
    if (drawnScene(scene)) setShown(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, origin])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer = SceneRenderer.create(canvas)
    rendererRef.current = renderer
    if (!renderer) { callbacks.current.onUnavailable(); return }
    const reduced = reducedMotion()
    const best = Math.min(window.devicePixelRatio || 1, 2) * 0.75
    let quality = best
    let frame = 0
    let last = performance.now()
    let slow = 0
    let counted = 0
    let strikes = 0
    let speak = 0
    let drawnAt = 0
    let lost = false
    const started = performance.now()
    const onLost = (event: Event) => { event.preventDefault(); lost = true }
    const onRestored = () => { renderer = SceneRenderer.create(canvas); rendererRef.current = renderer; lost = !renderer }
    canvas.addEventListener("webglcontextlost", onLost)
    canvas.addEventListener("webglcontextrestored", onRestored)

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const state = live.current
      const elapsed = now - last
      last = now
      if (!renderer || lost || options.current.paused || (state.previous === null && !drawnScene(state.scene))) return
      const cap = options.current.fps
      if (cap && now - drawnAt < 1000 / cap - 4) return
      drawnAt = now
      // A device that can't hold about 40 frames a second draws the scene at a lower resolution, and climbs back once
      // it runs smoothly again. A one-off stall (a tab coming back, a busy moment) isn't counted.
      if (elapsed < 150) {
        counted++
        slow += elapsed
      }
      if (counted === 60) {
        const average = slow / counted
        strikes = average > 26 ? strikes + 1 : average < 18 ? Math.min(strikes, 0) - 1 : 0
        if (strikes >= 2 && quality > 0.45) { quality *= 0.8; strikes = 0 }
        if (strikes <= -3 && quality < best) { quality = Math.min(best, quality * 1.15); strikes = 0 }
        counted = 0
        slow = 0
      }
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const scale = Math.min(quality, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)))
      renderer.size(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
      speak += ((phase.current === "speaking" ? 1 : 0) - speak) * 0.06
      const input = {
        time: ((now - started) / 1000) * (reduced ? 0.15 : 1) + TIME_OFFSET, level: reduced ? 0 : level.current ?? 0,
        speak, a: state.tone[0], b: state.tone[1], scale,
      }
      renderer.clear()
      if (state.previous === null) { renderer.draw(state.scene, input); return }
      const previous = state.previous
      if (!state.ready) {
        // Compiled before the sweep starts, so it runs its whole length. While it compiles in the background, the
        // scene before stays as it is.
        const ready = drawnScene(state.scene) ? renderer.prepare(state.scene) : true
        if (ready === null) {
          if (drawnScene(previous)) renderer.draw(previous, input)
          return
        }
        if (!ready) {
          const failed = state.scene
          Object.assign(state, { scene: previous, previous: null })
          if (!drawnScene(previous)) setShown(false)
          callbacks.current.onFailed(failed, previous)
          return
        }
        state.ready = true
        state.start = performance.now()
      }
      const k = reduced ? 1 : Math.min(1, (now - state.start) / REVEAL_MS)
      const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      const at = state.origin ?? { x: width / 2, y: height * 0.42 }
      const reach = Math.hypot(Math.max(at.x, width - at.x), Math.max(at.y, height - at.y)) * 1.15
      const clip = { x: at.x * scale, y: (height - at.y) * scale, radius: eased * reach * scale }
      if (drawnScene(previous)) renderer.draw(previous, input, drawnScene(state.scene) ? null : { ...clip, keep: "outside" })
      if (drawnScene(state.scene)) renderer.draw(state.scene, input, { ...clip, keep: "inside" })
      if (k >= 1) {
        state.previous = null
        callbacks.current.onSettled(state.scene)
        if (!drawnScene(state.scene)) { renderer.clear(); setShown(false) }
      }
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      canvas.removeEventListener("webglcontextlost", onLost)
      canvas.removeEventListener("webglcontextrestored", onRestored)
      renderer?.dispose(!canvas.isConnected)
      rendererRef.current = null
    }
  }, [level, phase])

  // While the picker is open, compile the scenes in idle moments, one at a time.
  useEffect(() => {
    if (!warm) return
    const queue = SCENES.map((item) => item.id).filter(drawnScene)
    let handle = 0
    const next = () => {
      const id = queue.shift()
      if (!id) return
      rendererRef.current?.prepare(id)
      handle = idle(next)
    }
    handle = idle(next)
    return () => cancelIdle(handle)
  }, [warm])

  return (
    <>
      <canvas ref={canvasRef} aria-hidden className={cn("vs-canvas absolute inset-0 h-full w-full", !shown && "opacity-0")} />
      <div aria-hidden className={cn("vs-scrim pointer-events-none absolute inset-0", variant === "chat" && "vs-scrim-chat", shown && "vs-scrim-on")} />
    </>
  )
}

/** The scene's name, shown like a film title for a moment after it's picked. On the call: in the middle of the top bar
 *  on a wide screen, just under it on a phone (where the bar is full), above the coach either way. `className` places
 *  it elsewhere; `boxed` sets it on glass, over text. */
export function SceneTitle({ scene, className, boxed = false }: { scene: SceneId; className?: string; boxed?: boolean }) {
  const item = SCENES.find((entry) => entry.id === scene) ?? SCENES[0]
  return (
    <div aria-hidden className={cn("vs-title pointer-events-none absolute inset-x-0 top-[74px] z-10 flex justify-center px-4 text-center sm:top-[10px]", className)}>
      <div className={cn("flex flex-col items-center", boxed && "rounded-2xl border border-white/10 bg-[#060b11]/60 px-6 py-2.5 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.8)] backdrop-blur-md")}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">Scene</span>
        <span className="vs-title-name mt-0.5 text-2xl font-light text-white">{item.name}</span>
        <span className="mt-1 hidden text-xs text-white/60 sm:block">{item.mood}</span>
      </div>
    </div>
  )
}

/**
 * The scenes to pick from, each a live picture of itself. Picking one sweeps it in behind the chat or the call
 * (`place`; `onPick`, with the tile's middle as the point it starts from); the panel fades back meanwhile so the sweep
 * can be seen.
 */
export function ScenePicker({ open, place, current, tone, coachFirstName, returnFocus, onPick, onClose }: {
  open: boolean
  place: "call" | "chat"
  current: SceneId
  tone: [string, string]
  coachFirstName: string
  returnFocus: RefObject<HTMLElement | null>
  onPick: (scene: SceneId, from: Point) => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const [watching, setWatching] = useState(false)
  const [failed, setFailed] = useState<SceneId[]>([])
  const canvases = useRef<Partial<Record<SceneId, HTMLCanvasElement | null>>>({})
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const toneRef = useRef(tone)
  useEffect(() => { toneRef.current = tone }, [tone])

  // Open, and close with a short exit; focus moves to the scene in use, and back to the button afterwards.
  useEffect(() => {
    if (open) {
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mounted) return
    setLeaving(true)
    const timer = window.setTimeout(() => { setMounted(false); setLeaving(false); returnFocus.current?.focus() }, 260)
    return () => window.clearTimeout(timer)
  }, [open, mounted, returnFocus])
  useEffect(() => {
    if (!mounted || leaving) return
    const chosen = panelRef.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")
    chosen?.focus({ preventScroll: true })
    // A scene further down the list is brought into view, so the one in use is seen with the picker.
    const list = scrollRef.current
    if (chosen && list) {
      const top = chosen.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
      if (top + chosen.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - (list.clientHeight - chosen.offsetHeight) / 2
    }
  }, [mounted, leaving])
  useEffect(() => {
    if (!watching) return
    const timer = window.setTimeout(() => setWatching(false), REVEAL_MS)
    return () => window.clearTimeout(timer)
  }, [watching])

  // The tiles: one hidden WebGL canvas draws each scene and copies it into its tile, 30 times a second.
  useEffect(() => {
    if (!mounted) return
    const source = document.createElement("canvas")
    const renderer = SceneRenderer.create(source)
    if (!renderer) return
    const reduced = reducedMotion()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const compiling: SceneId[] = SCENES.map((item) => item.id)
    const started = performance.now()
    let frame = 0
    let tick = 0
    let quiet = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (++tick % 2) return
      // Compiled in the background where the browser can; otherwise one a frame, so opening the picker never stalls.
      for (const id of renderer.background ? [...compiling] : compiling.slice(0, 1)) {
        const ready = renderer.prepare(id)
        if (ready === null) continue
        compiling.splice(compiling.indexOf(id), 1)
        if (!ready) setFailed((list) => [...list, id])
      }
      const [a, b] = toneRef.current
      const input = { time: ((now - started) / 1000) * (reduced ? 0 : 1) + TIME_OFFSET, level: 0, speak: 0, a: rgb(a), b: rgb(b), scale: ratio * 0.8 }
      SCENES.forEach((item) => {
        const target = canvases.current[item.id]
        if (!target || !renderer.prepared(item.id) || !target.clientWidth) return
        const width = Math.round(target.clientWidth * input.scale)
        const height = Math.round(target.clientHeight * input.scale)
        if (target.width !== width || target.height !== height) { target.width = width; target.height = height }
        renderer.size(width, height)
        renderer.clear()
        renderer.draw(item.id, input)
        target.getContext("2d")?.drawImage(source, 0, 0)
        target.dataset.ready = "true"
      })
      // With reduced motion every tile is a still picture: stop once they're all drawn.
      if (reduced && !compiling.length && ++quiet > 2) cancelAnimationFrame(frame)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); renderer.dispose() }
  }, [mounted])

  if (!mounted) return null

  const tilt = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse") return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const style = event.currentTarget.style
    style.setProperty("--rx", `${((0.5 - y) * 14).toFixed(2)}deg`)
    style.setProperty("--ry", `${((x - 0.5) * 16).toFixed(2)}deg`)
    style.setProperty("--mx", `${(x * 100).toFixed(1)}%`)
    style.setProperty("--my", `${(y * 100).toFixed(1)}%`)
  }
  const untilt = (event: ReactPointerEvent<HTMLButtonElement>) => {
    for (const property of ["--rx", "--ry"]) event.currentTarget.style.removeProperty(property)
  }

  return (
    <div className={cn("vs-picker absolute inset-0 z-30", leaving && "vs-leaving", watching && "vs-watch")}>
      <button type="button" tabIndex={-1} aria-label="Close scenes" onClick={onClose} className="vs-picker-backdrop absolute inset-0 cursor-default" />
      <div ref={panelRef} role="dialog" aria-modal="false" aria-labelledby="vs-title"
        className={cn("vs-panel absolute inset-x-0 bottom-0 flex max-h-[78dvh] flex-col overflow-hidden rounded-t-[28px] sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[68px] sm:max-h-[calc(100dvh-84px)] sm:w-[min(560px,calc(100vw-2rem))] sm:rounded-[28px]",
          watching && "vs-panel-watch")}>
        <span aria-hidden className="vs-panel-ring" />
        {/* Only the inside scrolls: the light round the edge stays on the panel. */}
        <div ref={scrollRef} className="relative min-h-0 overflow-y-auto overscroll-contain p-4 pb-6 sm:p-5" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
          <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
          <div className="relative flex items-start gap-3">
            <span aria-hidden className="vs-panel-icon grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-slate-950"><Sparkles className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/80">{place === "call" ? "Call scene" : "Chat scene"}</p>
              <h2 id="vs-title" className="text-lg font-semibold leading-tight text-white">Set the scene</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-400">
                Pick where you and {coachFirstName} talk. Every scene is alive, and {place === "call" ? `moves with the voices on the call` : `stirs as ${coachFirstName} replies`}.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close scenes"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2.5 sm:gap-3">
            {SCENES.map((item, index) => {
              const selected = item.id === current
              const unavailable = failed.includes(item.id)
              return (
                <button key={item.id} type="button" aria-pressed={selected} disabled={unavailable}
                  aria-label={`${item.name}: ${unavailable ? "not available on this device" : item.mood}`}
                  onPointerMove={tilt} onPointerLeave={untilt}
                  onClick={(event) => {
                    if (selected) return
                    const rect = event.currentTarget.getBoundingClientRect()
                    setWatching(true)
                    onPick(item.id, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
                  }}
                  className={cn("vs-tile group relative aspect-[3/4] overflow-hidden rounded-2xl text-left outline-none disabled:opacity-40 sm:aspect-[4/3]", selected && "vs-tile-on")}
                  style={{ "--i": index, "--vs-swatch": item.swatch } as CSSProperties}>
                  <span aria-hidden className="vs-tile-art absolute inset-[2px] overflow-hidden rounded-[14px]">
                    <canvas ref={(element) => { canvases.current[item.id] = element }} className="vs-tile-canvas h-full w-full" />
                    <span className="vs-tile-glare absolute inset-0" />
                  </span>
                  {selected && <span aria-hidden className="vs-tile-ring" />}
                  <span className="vs-tile-label absolute inset-x-[2px] bottom-[2px] rounded-b-[14px] px-2.5 pb-2 pt-6">
                    <span className="block truncate text-[12px] font-semibold text-white sm:text-[13px]">{item.name}</span>
                    <span className="vs-tile-mood hidden text-[11px] leading-4 text-white/70 sm:line-clamp-2">{unavailable ? "Not available on this device" : item.mood}</span>
                  </span>
                  {selected && (
                    <span aria-hidden className="vs-tile-check absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-slate-950">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="relative mt-3 text-center text-[11px] text-slate-500">Scenes are made by SwimGPT. Your pick is kept on this device, for chats and calls.</p>
        </div>
      </div>
    </div>
  )
}
