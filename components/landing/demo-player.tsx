"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import {
  ArrowRight, Check, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX, X,
} from "lucide-react"
import { cn } from "@/lib/utils"

const LEAVE_MS = 760
const IDLE_MS = 2600
const SEEK_STEP = 5
const RATES = [0.5, 1, 1.25, 1.5, 2]
const THUMB_W = 176
const THUMB_H = Math.round((THUMB_W * 9) / 16)
const STRIP_STEP = 0.5 // seconds between filmstrip frames

export type DemoOrigin = { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const timecode = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`
}
const ratioAt = (event: { clientX: number }, element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  return clamp((event.clientX - rect.left) / rect.width, 0, 1)
}

/** Fullscreen demo player: liquid reveal from the trigger, ambient glow, custom scrubber with frame previews. */
export function DemoPlayer({ open, onClose, src, origin, title = "SwimGPT in 10 seconds" }: {
  open: boolean
  onClose: () => void
  src: string
  origin: DemoOrigin | null
  title?: string
}) {
  // Stay mounted through the leave animation, then drop the whole player (next open starts fresh).
  const [stage, setStage] = useState<"closed" | "shown" | "leaving">("closed")

  useEffect(() => {
    if (open) setStage("shown")
    else setStage((current) => (current === "closed" ? current : "leaving"))
  }, [open])

  useEffect(() => {
    if (stage !== "leaving") return
    const timer = window.setTimeout(() => setStage("closed"), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [stage])

  if (stage === "closed") return null
  return createPortal(<PlayerShell src={src} title={title} origin={origin} leaving={stage === "leaving"} onClose={onClose} />, document.body)
}

type Flash = { id: number; kind: "play" | "pause" | "mute" | "unmute" | "volume"; label?: string }
type Ripple = { id: number; dir: -1 | 1 }

function PlayerShell({ src, title, origin, leaving, onClose }: {
  src: string
  title: string
  origin: DemoOrigin | null
  leaving: boolean
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const ambientRef = useRef<HTMLCanvasElement>(null)
  const thumbRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)
  const idleTimer = useRef<number | undefined>(undefined)
  const fadeFrame = useRef<number | undefined>(undefined)
  const strip = useRef<(HTMLCanvasElement | undefined)[]>([])
  const hoverIndex = useRef(-1)
  const counter = useRef(0)

  const [paused, setPaused] = useState(true)
  const [started, setStarted] = useState(false) // autoplay attempted; avoids a play-button flash during the entrance
  const [waiting, setWaiting] = useState(true)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState(false)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [pipSupported, setPipSupported] = useState(false)
  const [idle, setIdle] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [hover, setHover] = useState<{ ratio: number; x: number } | null>(null)
  const [thumbReady, setThumbReady] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [ripple, setRipple] = useState<Ripple | null>(null)

  const chromeHidden = idle && !paused && !ended && !menuOpen && !scrubbing
  const ox = origin ? `${origin.x}px` : "50%"
  const oy = origin ? `${origin.y}px` : "50%"

  const poke = useCallback(() => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
  }, [])

  const showFlash = (kind: Flash["kind"], label?: string) => setFlash({ id: ++counter.current, kind, label })

  /** Ramp the element volume (not the UI value) so opening and closing never start or stop with a hard cut. */
  const fadeTo = useCallback((target: number, ms: number) => new Promise<void>((resolve) => {
    const video = videoRef.current
    if (!video) return resolve()
    window.cancelAnimationFrame(fadeFrame.current ?? 0)
    const from = video.volume
    const start = performance.now()
    const step = (now: number) => {
      const k = clamp((now - start) / ms, 0, 1)
      video.volume = clamp(from + (target - from) * k * (2 - k), 0, 1)
      if (k < 1) fadeFrame.current = window.requestAnimationFrame(step)
      else resolve()
    }
    fadeFrame.current = window.requestAnimationFrame(step)
  }), [])

  // ---- mount: scroll lock, focus, autoplay with a soft audio fade-in ----
  useEffect(() => {
    const root = document.documentElement
    const previousFocus = document.activeElement as HTMLElement | null
    const scrollbar = window.innerWidth - root.clientWidth
    const prev = { overflow: root.style.overflow, padding: document.body.style.paddingRight }
    root.style.overflow = "hidden"
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
    cardRef.current?.focus({ preventScroll: true })
    setPipSupported(typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled)

    const video = videoRef.current
    let timer: number | undefined
    if (video) {
      video.volume = 0
      timer = window.setTimeout(() => {
        video.play().then(() => fadeTo(0.8, 900)).catch(() => {
          video.volume = 0.8
          setWaiting(false)
        }).finally(() => setStarted(true))
      }, 420)
    }
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(idleTimer.current)
      window.cancelAnimationFrame(fadeFrame.current ?? 0)
      root.style.overflow = prev.overflow
      document.body.style.paddingRight = prev.padding
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      previousFocus?.focus?.({ preventScroll: true })
    }
  }, [fadeTo])

  // ---- leaving: fade the audio out under the closing animation ----
  useEffect(() => {
    if (!leaving) return
    setMenuOpen(false)
    fadeTo(0, 340).then(() => videoRef.current?.pause())
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [leaving, fadeTo])

  // ---- per-frame: progress + buffer as CSS vars (no re-render), ambient glow painted from the live frame ----
  useEffect(() => {
    let frame = 0
    let tick = 0
    const ambient = ambientRef.current?.getContext("2d", { alpha: false })
    const loop = () => {
      const video = videoRef.current
      const card = cardRef.current
      if (video && card) {
        const total = video.duration || 0
        if (total) {
          card.style.setProperty("--dp-p", String(video.currentTime / total))
          const buffered = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
          card.style.setProperty("--dp-buf", String(buffered / total))
        }
        if (ambient && video.readyState >= 2 && (!video.paused || tick % 20 === 0)) {
          ambient.drawImage(video, 0, 0, ambient.canvas.width, ambient.canvas.height)
        }
      }
      tick++
      frame = window.requestAnimationFrame(loop)
    }
    frame = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === cardRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  // ---- actions ----
  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0
      if (video.volume === 0 && !muted) video.volume = volume
      video.play().catch(() => {})
      showFlash("play")
    } else {
      video.pause()
      showFlash("pause")
    }
  }, [muted, volume])

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current
    if (!video || !video.duration) return
    video.currentTime = clamp(video.currentTime + delta, 0, video.duration)
    setRipple({ id: ++counter.current, dir: delta < 0 ? -1 : 1 })
  }, [])

  const seekToRatio = useCallback((ratio: number) => {
    const video = videoRef.current
    if (!video || !video.duration) return
    video.currentTime = ratio * video.duration
    cardRef.current?.style.setProperty("--dp-p", String(ratio))
    if (ended && ratio < 1) setEnded(false)
  }, [ended])

  const applyVolume = useCallback((next: number, announce = false) => {
    const video = videoRef.current
    const value = clamp(next, 0, 1)
    window.cancelAnimationFrame(fadeFrame.current ?? 0)
    setVolume(value)
    setMuted(value === 0)
    if (video) {
      video.volume = value
      video.muted = value === 0
    }
    if (announce) showFlash("volume", `${Math.round(value * 100)}%`)
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const next = !muted
    video.muted = next
    if (!next && volume === 0) applyVolume(0.6)
    else if (!next && video.volume === 0) video.volume = volume
    setMuted(next)
    showFlash(next ? "mute" : "unmute")
  }, [muted, volume, applyVolume])

  const toggleFullscreen = useCallback(() => {
    const card = cardRef.current
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else if (card?.requestFullscreen) card.requestFullscreen().catch(() => {})
    else video?.webkitEnterFullscreen?.() // iOS Safari only fullscreens the <video> itself
  }, [])

  const togglePip = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
    else video.requestPictureInPicture().catch(() => {})
  }, [])

  const chooseRate = (next: number) => {
    if (videoRef.current) videoRef.current.playbackRate = next
    setRate(next)
    setMenuOpen(false)
  }

  const replay = () => {
    const video = videoRef.current
    if (!video) return
    setEnded(false)
    video.currentTime = 0
    video.play().catch(() => {})
  }

  // ---- keyboard ----
  useEffect(() => {
    if (leaving) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const handled = (fn: () => void) => { event.preventDefault(); fn(); poke() }
      if (key === "escape") {
        if (menuOpen) handled(() => setMenuOpen(false))
        else if (!document.fullscreenElement) handled(onClose)
        return
      }
      // Let focused buttons/sliders keep their own Space/Enter/arrow behaviour.
      const role = (event.target as HTMLElement | null)?.getAttribute?.("role")
      if ((event.target as HTMLElement | null)?.tagName === "BUTTON" && (key === " " || key === "enter")) return
      if (role === "slider" && key.startsWith("arrow")) return
      if (key === " " || key === "k") handled(togglePlay)
      else if (key === "arrowleft" || key === "j") handled(() => seekBy(-SEEK_STEP))
      else if (key === "arrowright" || key === "l") handled(() => seekBy(SEEK_STEP))
      else if (key === "arrowup") handled(() => applyVolume(volume + 0.1, true))
      else if (key === "arrowdown") handled(() => applyVolume(volume - 0.1, true))
      else if (key === "m") handled(toggleMute)
      else if (key === "f") handled(toggleFullscreen)
      else if (/^[0-9]$/.test(key)) handled(() => seekToRatio(Number(key) / 10))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [leaving, menuOpen, volume, onClose, poke, togglePlay, seekBy, applyVolume, toggleMute, toggleFullscreen, seekToRatio])

  // ---- scrubber previews: a filmstrip captured once in the background, so hovering never waits on a seek ----
  const paintThumb = useCallback((index: number) => {
    const context = thumbRef.current?.getContext("2d")
    const frames = strip.current
    if (!context || index < 0 || !frames.length) return
    // Nearest frame captured so far (the strip fills in from the start).
    for (let offset = 0; offset < frames.length; offset++) {
      const frame = frames[index - offset] ?? frames[index + offset]
      if (frame) {
        context.drawImage(frame, 0, 0, context.canvas.width, context.canvas.height)
        return setThumbReady(true)
      }
    }
  }, [])

  useEffect(() => {
    const video = previewRef.current
    if (!video || !duration) return
    let alive = true
    const count = Math.ceil(duration / STRIP_STEP)
    strip.current = new Array(count)
    const seek = (seconds: number) => new Promise<void>((resolve) => {
      const done = () => { window.clearTimeout(timer); video.removeEventListener("seeked", done); resolve() }
      const timer = window.setTimeout(done, 2500)
      video.addEventListener("seeked", done)
      video.currentTime = seconds
    })
    ;(async () => {
      if (video.readyState < 1) await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }))
      for (let index = 0; index < count && alive; index++) {
        await seek(Math.min(duration - 0.05, (index + 0.5) * STRIP_STEP))
        if (!alive || video.readyState < 2) continue
        const frame = document.createElement("canvas")
        frame.width = THUMB_W * 2
        frame.height = THUMB_H * 2
        frame.getContext("2d")?.drawImage(video, 0, 0, frame.width, frame.height)
        strip.current[index] = frame
        if (hoverIndex.current >= 0) paintThumb(hoverIndex.current)
      }
    })()
    return () => { alive = false }
  }, [duration, paintThumb])

  const trackHover = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    if (!track) return
    const ratio = ratioAt(event, track)
    const width = track.getBoundingClientRect().width
    setHover({ ratio, x: clamp(ratio * width, THUMB_W / 2, width - THUMB_W / 2) })
    const index = duration ? Math.min(strip.current.length - 1, Math.floor((ratio * duration) / STRIP_STEP)) : -1
    if (index !== hoverIndex.current) paintThumb(index)
    hoverIndex.current = index
  }
  const onTrackDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setScrubbing(true)
    seekToRatio(ratioAt(event, event.currentTarget))
    trackHover(event)
  }
  const onTrackMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    trackHover(event)
    if (scrubbing) seekToRatio(ratioAt(event, event.currentTarget))
  }
  const endHover = () => { setHover(null); hoverIndex.current = -1 }
  const onTrackUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setScrubbing(false)
    if (event.pointerType !== "mouse") endHover()
  }

  const onVolumeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    applyVolume(ratioAt(event, event.currentTarget))
  }
  const onVolumeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) applyVolume(ratioAt(event, event.currentTarget))
  }

  const onSurfaceClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // On touch, the first tap only wakes the controls.
    if (event.pointerType === "touch" && chromeHidden) return poke()
    if (menuOpen) return setMenuOpen(false)
    togglePlay()
  }

  const shownVolume = muted ? 0 : volume
  const VolumeIcon = shownVolume === 0 ? VolumeX : shownVolume < 0.5 ? Volume1 : Volume2

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn("dp-root", leaving ? "dp-leave" : "dp-enter")}
      style={{ "--dp-ox": ox, "--dp-oy": oy } as CSSProperties}
    >
      {/* Backdrop: a liquid circle that spreads out from the Watch demo button */}
      <div className="dp-veil" onClick={onClose} aria-hidden>
        <div className="landing-pool-caustics absolute inset-0 opacity-25" />
        <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[110vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(87,229,234,0.16),transparent_65%)]" />
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close demo"
        className="dp-close group absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] py-2 pl-2 pr-3 text-sm text-slate-300 backdrop-blur-xl transition-colors hover:border-white/25 hover:bg-white/[0.12] hover:text-white sm:right-6 sm:top-6"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/10 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-90">
          <X className="h-4 w-4" />
        </span>
        <kbd className="font-sans text-xs tracking-wide">Esc</kbd>
      </button>

      <div className="dp-stage relative w-full max-w-5xl">
        <div className="dp-head mb-4 flex items-end justify-between gap-4 px-1">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-300">
              <span className="relative flex h-2 w-2">
                <span className={cn("absolute inset-0 rounded-full bg-cyan-300", !paused && "animate-ping")} />
                <span className="relative h-2 w-2 rounded-full bg-cyan-300" />
              </span>
              Product demo
            </p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
          </div>
          <p className="hidden items-center gap-3 text-xs text-slate-500 md:flex">
            <Hint k="Space">play</Hint>
            <Hint k="← →">5s</Hint>
            <Hint k="F">fullscreen</Hint>
          </p>
        </div>

        <div className="relative">
          <canvas ref={ambientRef} width={40} height={22} aria-hidden className={cn("dp-ambient", (paused || ended) && "dp-ambient-dim")} />

          <div
            ref={cardRef}
            tabIndex={-1}
            data-idle={chromeHidden}
            className={cn("dp-card relative aspect-video w-full overflow-hidden bg-black outline-none", fullscreen ? "rounded-none" : "rounded-[22px] sm:rounded-[28px]")}
            style={{ "--dp-p": 0, "--dp-buf": 0 } as CSSProperties}
            onPointerMove={poke}
            onPointerDown={poke}
            onPointerLeave={() => !paused && setIdle(true)}
          >
            {!fullscreen && <span className="dp-ring" aria-hidden />}

            <video
              ref={videoRef}
              crossOrigin="anonymous"
              src={src}
              playsInline
              preload="auto"
              className="absolute inset-0 h-full w-full object-contain"
              onPlay={() => { setPaused(false); setEnded(false); poke() }}
              onPause={() => setPaused(true)}
              onWaiting={() => setWaiting(true)}
              onPlaying={() => setWaiting(false)}
              onCanPlay={() => setWaiting(false)}
              onSeeked={() => setTime(videoRef.current?.currentTime ?? 0)}
              onTimeUpdate={() => setTime(videoRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
              onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
              onEnded={() => { setEnded(true); setIdle(false) }}
              onError={() => { setError(true); setWaiting(false) }}
            />
            {/* Silent twin used only to capture scrubber previews, so seeking it never disturbs playback.
                Kept rendered (just invisible): Chrome never finishes seeks on a display:none video. */}
            <video ref={previewRef} crossOrigin="anonymous" src={src} muted playsInline preload="auto" className="pointer-events-none absolute left-0 top-0 h-9 w-16 opacity-0" aria-hidden tabIndex={-1} />

            {/* click / double-click surface */}
            <div className="absolute inset-0" onPointerUp={onSurfaceClick} onDoubleClick={toggleFullscreen} />

            {/* soft vignette scrims under the chrome */}
            <div className={cn("dp-chrome pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 via-black/30 to-transparent")} />
            <div className={cn("dp-chrome pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent")} />

            {/* buffering */}
            {waiting && !error && !paused && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="dp-spinner" />
              </div>
            )}

            {/* big centre play while paused */}
            {paused && started && !ended && !error && (
              <button
                type="button"
                onClick={togglePlay}
                aria-label="Play"
                className="dp-bigplay group absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full sm:h-24 sm:w-24"
              >
                <span className="dp-pulse absolute inset-0 rounded-full" />
                <span className="dp-pulse absolute inset-0 rounded-full [animation-delay:1.1s]" />
                <span className="absolute inset-0 rounded-full border border-white/25 bg-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110" />
                <span className="absolute inset-[18%] rounded-full bg-gradient-to-br from-cyan-200 via-accent to-sky-500 shadow-[0_0_40px_rgba(87,229,234,0.6)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-105" />
                <Play className="relative ml-1 h-7 w-7 fill-slate-950 text-slate-950 sm:h-8 sm:w-8" />
              </button>
            )}

            {/* action feedback */}
            {flash && (
              <div key={flash.id} className="dp-flash pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md">
                  {flash.kind === "play" && <Play className="ml-1 h-8 w-8 fill-white" />}
                  {flash.kind === "pause" && <Pause className="h-8 w-8 fill-white" />}
                  {flash.kind === "mute" && <VolumeX className="h-8 w-8" />}
                  {flash.kind === "unmute" && <Volume2 className="h-8 w-8" />}
                  {flash.kind === "volume" && <span className="text-lg font-semibold tabular-nums">{flash.label}</span>}
                </div>
              </div>
            )}
            {ripple && (
              <div
                key={ripple.id}
                className={cn("dp-ripple pointer-events-none absolute inset-y-0 flex w-[38%] items-center justify-center",
                  ripple.dir < 0 ? "left-0 rounded-r-[50%] bg-gradient-to-r" : "right-0 rounded-l-[50%] bg-gradient-to-l",
                  "from-white/15 to-transparent")}
              >
                <span className="flex flex-col items-center gap-1 text-sm font-semibold text-white">
                  {ripple.dir < 0 ? <RotateCcw className="h-6 w-6" /> : <RotateCw className="h-6 w-6" />}
                  {ripple.dir < 0 ? "−" : "+"}{SEEK_STEP}s
                </span>
              </div>
            )}

            {/* end screen */}
            {ended && !leaving && (
              <div className="dp-end absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 px-6 text-center backdrop-blur-md">
                <p className="dp-end-item text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-300" style={{ "--i": 0 } as CSSProperties}>That&apos;s SwimGPT</p>
                <h3 className="dp-end-item mt-3 text-balance text-2xl font-bold tracking-tight text-white sm:text-4xl" style={{ "--i": 1 } as CSSProperties}>
                  Ready to meet your coaching team?
                </h3>
                <div className="dp-end-item mt-7 flex flex-col gap-3 sm:flex-row" style={{ "--i": 2 } as CSSProperties}>
                  <Link
                    href="/auth?mode=signup"
                    className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-accent-foreground shadow-[0_12px_32px_rgba(87,229,234,0.35)] transition hover:bg-accent/90"
                  >
                    Start training
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={replay}
                    className="group inline-flex h-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] px-6 text-sm font-medium text-white transition hover:bg-white/[0.12]"
                  >
                    <RotateCcw className="mr-2 h-4 w-4 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-rotate-[360deg]" />
                    Watch again
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 px-6 text-center text-white">
                <p className="text-lg font-semibold">The demo couldn&apos;t be played here.</p>
                <a href={src} className="text-sm text-cyan-300 underline underline-offset-4">Open the video directly</a>
              </div>
            )}

            {/* controls */}
            {!error && (
              <div className={cn("dp-chrome absolute inset-x-0 bottom-0 px-3 pb-3 sm:px-5 sm:pb-4", ended && "opacity-0 pointer-events-none")}>
                <div
                  ref={trackRef}
                  role="slider"
                  tabIndex={0}
                  aria-label="Seek"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(time)}
                  aria-valuetext={`${timecode(time)} of ${timecode(duration)}`}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") { event.preventDefault(); seekBy(-SEEK_STEP) }
                    if (event.key === "ArrowRight") { event.preventDefault(); seekBy(SEEK_STEP) }
                  }}
                  onPointerDown={onTrackDown}
                  onPointerMove={onTrackMove}
                  onPointerUp={onTrackUp}
                  onPointerCancel={onTrackUp}
                  onPointerLeave={() => !scrubbing && endHover()}
                  className="dp-ctl group/track relative h-6 cursor-pointer touch-none outline-none"
                  style={{ "--i": 0 } as CSSProperties}
                  data-active={scrubbing || hover !== null}
                >
                  {/* hover preview */}
                  <div
                    className={cn("dp-preview pointer-events-none absolute bottom-7", hover ? "dp-preview-on" : "")}
                    style={{ left: hover?.x ?? 0 }}
                  >
                    <div
                      className={cn("overflow-hidden rounded-xl border border-white/20 bg-slate-900 shadow-[0_18px_40px_rgba(0,0,0,0.55)] transition-[opacity,height] duration-300",
                        thumbReady ? "opacity-100" : "h-0 border-0 opacity-0")}
                      style={{ width: THUMB_W, height: thumbReady ? THUMB_H : 0 }}
                    >
                      <canvas ref={thumbRef} width={THUMB_W * 2} height={THUMB_H * 2} className="block h-full w-full" />
                    </div>
                    <p className="mt-1.5 text-center text-xs font-semibold tabular-nums text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
                      {timecode((hover?.ratio ?? 0) * duration)}
                    </p>
                  </div>

                  <div className="dp-rail absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/15">
                    <div className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-500" style={{ width: "calc(var(--dp-buf) * 100%)" }} />
                    <div className={cn("absolute inset-y-0 left-0 bg-white/25 transition-opacity", hover ? "opacity-100" : "opacity-0")} style={{ width: `${(hover?.ratio ?? 0) * 100}%` }} />
                    <div className="dp-played absolute inset-y-0 left-0 rounded-full" style={{ width: "calc(var(--dp-p) * 100%)" }} />
                  </div>
                  <span className="dp-knob pointer-events-none absolute top-1/2" style={{ left: "calc(var(--dp-p) * 100%)" }} />
                </div>

                <div className="mt-1 flex items-center gap-1 sm:gap-2">
                  <CtlButton i={1} label={paused ? "Play (k)" : "Pause (k)"} onClick={togglePlay}>
                    <span className="relative h-5 w-5">
                      <Play className={cn("dp-swap absolute inset-0 h-5 w-5 fill-current", paused ? "dp-swap-in" : "dp-swap-out")} />
                      <Pause className={cn("dp-swap absolute inset-0 h-5 w-5 fill-current", paused ? "dp-swap-out" : "dp-swap-in")} />
                    </span>
                  </CtlButton>
                  <CtlButton i={2} label="Back 5 seconds (j)" onClick={() => seekBy(-SEEK_STEP)} className="hidden sm:grid">
                    <SkipIcon back />
                  </CtlButton>
                  <CtlButton i={3} label="Forward 5 seconds (l)" onClick={() => seekBy(SEEK_STEP)} className="hidden sm:grid">
                    <SkipIcon />
                  </CtlButton>

                  <div className="dp-ctl group/vol flex items-center" style={{ "--i": 4 } as CSSProperties}>
                    <CtlButton label={muted ? "Unmute (m)" : "Mute (m)"} onClick={toggleMute}>
                      <VolumeIcon className="h-5 w-5" />
                    </CtlButton>
                    <div className="hidden w-0 overflow-hidden opacity-0 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/vol:w-[84px] group-hover/vol:opacity-100 group-focus-within/vol:w-[84px] group-focus-within/vol:opacity-100 sm:block">
                      <div
                        ref={volumeRef}
                        role="slider"
                        tabIndex={0}
                        aria-label="Volume"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(shownVolume * 100)}
                        onPointerDown={onVolumeDown}
                        onPointerMove={onVolumeMove}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); applyVolume(volume - 0.1) }
                          if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); applyVolume(volume + 0.1) }
                        }}
                        className="relative ml-1 mr-3 h-8 w-[68px] cursor-pointer touch-none outline-none"
                      >
                        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
                          <div className="h-full rounded-full bg-white transition-[width] duration-150" style={{ width: `${shownVolume * 100}%` }} />
                        </div>
                        <span
                          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)] transition-[left] duration-150"
                          style={{ left: `${shownVolume * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <p className="dp-ctl ml-1 text-xs font-medium tabular-nums text-white/90 sm:text-sm" style={{ "--i": 5 } as CSSProperties}>
                    {timecode(time)} <span className="text-white/40">/ {timecode(duration)}</span>
                  </p>

                  <div className="flex-1" />

                  <div className="dp-ctl relative" style={{ "--i": 6 } as CSSProperties}>
                    <button
                      type="button"
                      onClick={() => setMenuOpen((value) => !value)}
                      aria-label="Playback speed"
                      aria-expanded={menuOpen}
                      className={cn("h-8 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors sm:text-sm",
                        menuOpen || rate !== 1 ? "bg-white text-slate-950" : "text-white hover:bg-white/15")}
                    >
                      {rate}×
                    </button>
                    {menuOpen && (
                      <div className="dp-menu absolute bottom-11 right-0 w-36 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
                        <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Speed</p>
                        {RATES.map((option, index) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => chooseRate(option)}
                            className="dp-menu-item flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
                            style={{ "--i": index } as CSSProperties}
                          >
                            {option === 1 ? "Normal" : `${option}×`}
                            {option === rate && <Check className="h-4 w-4 text-cyan-300" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {pipSupported && (
                    <CtlButton i={7} label="Picture in picture" onClick={togglePip} className="hidden sm:grid">
                      <PictureInPicture2 className="h-5 w-5" />
                    </CtlButton>
                  )}
                  <CtlButton i={8} label={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"} onClick={toggleFullscreen}>
                    {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                  </CtlButton>
                </div>
              </div>
            )}

            {/* hairline progress that stays visible while the chrome is hidden */}
            <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[3px] transition-opacity duration-500", chromeHidden ? "opacity-100" : "opacity-0")}>
              <div className="dp-played h-full" style={{ width: "calc(var(--dp-p) * 100%)" }} />
            </div>
          </div>
        </div>

        <p className="sr-only" aria-live="polite">{ended ? "Demo finished" : paused ? "Paused" : "Playing"} at {timecode(time)}</p>
      </div>
    </div>
  )
}

function CtlButton({ label, onClick, children, className, i }: {
  label: string
  onClick: () => void
  children: ReactNode
  className?: string
  i?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full text-white transition-[background-color,transform] duration-300 hover:bg-white/15 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70",
        i !== undefined && "dp-ctl",
        className,
      )}
      style={i !== undefined ? ({ "--i": i } as CSSProperties) : undefined}
    >
      {children}
    </button>
  )
}

function SkipIcon({ back }: { back?: boolean }) {
  const Icon = back ? RotateCcw : RotateCw
  return (
    <span className="relative grid h-5 w-5 place-items-center">
      <Icon className="absolute inset-0 h-5 w-5" strokeWidth={2.2} />
      <span className="relative pt-px text-[7.5px] font-bold leading-none">{SEEK_STEP}</span>
    </span>
  )
}

function Hint({ k, children }: { k: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-slate-300">{k}</kbd>
      {children}
    </span>
  )
}
