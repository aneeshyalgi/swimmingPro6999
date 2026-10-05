"use client"

import { useEffect, useState, type RefObject } from "react"
import { Bone, ChevronLeft, ChevronRight, Grid3x3, Pause, Play, Spline, Triangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Layers } from "@/components/video-lab/pose-engine"

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00.0"
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`
}

/** Glass control bar: play, scrub, frame-step, speed and HUD layers. Keeps its own clock so the page doesn't re-render per frame. */
export function VideoControls({ videoRef, layers, onLayers, disabled }: {
  videoRef: RefObject<HTMLVideoElement | null>; layers: Layers; onLayers: (layers: Layers) => void; disabled?: boolean
}) {
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let frame = 0
    const loop = () => { setTime(video.currentTime); frame = requestAnimationFrame(loop) }
    const sync = () => { setTime(video.currentTime); setDuration(video.duration || 0); setPlaying(!video.paused) }
    const play = () => { sync(); cancelAnimationFrame(frame); frame = requestAnimationFrame(loop) }
    const stop = () => { sync(); cancelAnimationFrame(frame) }
    video.addEventListener("loadedmetadata", sync); video.addEventListener("play", play); video.addEventListener("pause", stop)
    video.addEventListener("ended", stop); video.addEventListener("seeked", sync)
    sync()
    return () => {
      cancelAnimationFrame(frame)
      video.removeEventListener("loadedmetadata", sync); video.removeEventListener("play", play); video.removeEventListener("pause", stop)
      video.removeEventListener("ended", stop); video.removeEventListener("seeked", sync)
    }
  }, [videoRef])

  const toggle = () => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play(); else video.pause() }
  const step = (frames: number) => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + frames / 30))
  }
  const rate = (value: number) => { setSpeed(value); if (videoRef.current) videoRef.current.playbackRate = value }
  const progress = duration ? (time / duration) * 100 : 0
  const layerButtons: [keyof Layers, string, typeof Bone][] = [["skeleton", "Skeleton", Bone], ["angles", "Angles", Triangle], ["trails", "Hand paths", Spline], ["grid", "Grid", Grid3x3]]

  return (
    <div className={cn("space-y-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 backdrop-blur-xl", disabled && "pointer-events-none opacity-50")}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-[0_0_24px_rgba(87,229,234,0.45)] transition-transform hover:scale-105 active:scale-95">
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <div className="relative h-8 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400" style={{ width: `${progress}%` }} />
          </div>
          <div className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-300 shadow-[0_0_14px_rgba(87,229,234,0.9)]" style={{ left: `${progress}%` }} />
          <input type="range" min={0} max={duration || 0} step={0.01} value={time} aria-label="Scrub video"
            onChange={(event) => { const video = videoRef.current; if (video) { video.currentTime = Number(event.target.value); setTime(video.currentTime) } }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </div>
        <span className="hidden w-[7.5rem] shrink-0 text-right font-mono text-xs tabular-nums text-slate-300 sm:block">{fmt(time)} / {fmt(duration)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5">
          <button type="button" onClick={() => step(-1)} aria-label="Previous frame" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Frame</span>
          <button type="button" onClick={() => step(1)} aria-label="Next frame" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5" role="radiogroup" aria-label="Playback speed">
          {[0.25, 0.5, 1].map((value) => (
            <button key={value} type="button" role="radio" aria-checked={speed === value} onClick={() => rate(value)}
              className={cn("h-7 rounded-full px-2.5 font-mono text-[11px] transition-colors", speed === value ? "bg-white/15 text-white" : "text-slate-400 hover:text-white")}>{value}×</button>
          ))}
        </div>
        <span className="flex-1" />
        {layerButtons.map(([key, text, Icon]) => (
          <button key={key} type="button" aria-pressed={layers[key]} onClick={() => onLayers({ ...layers, [key]: !layers[key] })}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-all duration-300",
              layers[key] ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100 shadow-[0_0_14px_rgba(87,229,234,0.2)]" : "border-white/10 text-slate-500 hover:text-slate-200")}>
            <Icon className="h-3.5 w-3.5" />{text}
          </button>
        ))}
      </div>
    </div>
  )
}
