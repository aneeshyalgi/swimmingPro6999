"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import type { PoseLandmarker } from "@mediapipe/tasks-vision"
import { Activity, ArrowRight, Check, Crosshair, Cpu, Film, Gauge, Loader2, Ruler, RotateCcw, ScanLine, Sparkles, Waves } from "lucide-react"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import {
  detectPose, drawHud, getPoseLandmarker, measure, smoothPose, strokeRate, summarize,
  type ClipSummary, type FrameMetrics, type Layers, type Point, type PosePoint,
} from "@/components/video-lab/pose-engine"
import { UploadZone } from "@/components/video-lab/upload-zone"
import { Telemetry } from "@/components/video-lab/telemetry"
import { VideoControls } from "@/components/video-lab/video-controls"
import { CoachBrief, type AnalysisResult } from "@/components/video-lab/coach-brief"

type Phase = "empty" | "ready" | "scanning" | "measuring" | "writing" | "done"
type TelemetryState = { live: FrameMetrics | null; history: FrameMetrics[]; tracking: "idle" | "live" | "paused" | "lost"; fps: number }

const STROKES = ["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "IM", "Dive"]
const ANGLES = ["Side view", "Front view", "Underwater view", "Mixed angles"]
const STAGES: { phase: Phase; label: string; detail: string }[] = [
  { phase: "scanning", label: "Tracking every frame", detail: "33 body landmarks per frame, on your device" },
  { phase: "measuring", label: "Measuring your stroke", detail: "Angles, body line, kick depth and stroke rate" },
  { phase: "writing", label: "Writing your coach brief", detail: "Grounded in what was measured" },
]
const MEASURES = [
  { icon: Crosshair, title: "33-point body tracking", body: "Every joint, every frame, drawn live over your clip." },
  { icon: Ruler, title: "Joint angles", body: "Elbow bend at the catch, knee bend in the kick, hip angle." },
  { icon: Activity, title: "Stroke rate & kick depth", body: "Measured from your hand's cycle and ankle travel." },
  { icon: Gauge, title: "Body line", body: "How flat you are from shoulders to ankles, in degrees." },
]
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The AI Stroke Lab: on-device pose tracking, live telemetry and an AI coach brief for a swimming clip.
 * Used by the public /video-analysis page and by the Video Analysis section of the dashboard.
 */
export function StrokeLab({ variant = "public" }: { variant?: "public" | "dashboard" }) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const inputRef = useRef<HTMLCanvasElement | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastTimeRef = useRef(-1)
  const lastDetectRef = useRef(0)
  const poseRef = useRef<PosePoint[] | null>(null)
  const trailsRef = useRef<Point[][]>([[], []])
  const samplesRef = useRef<FrameMetrics[]>([])
  const missedRef = useRef(0)
  const fpsRef = useRef({ frames: 0, since: 0, value: 0 })
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const scanTotalRef = useRef(0)

  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState("")
  const [meta, setMeta] = useState({ duration: 0, width: 16, height: 9 })
  const [model, setModel] = useState<"loading" | "ready" | "error">("loading")
  const [layers, setLayers] = useState<Layers>({ skeleton: true, angles: true, trails: true, grid: false })
  const layersRef = useRef(layers)
  layersRef.current = layers
  const [phase, setPhase] = useState<Phase>("empty")
  const [progress, setProgress] = useState(0)
  const [scan, setScan] = useState({ index: 0, total: 0, tracked: 0 })
  const [thumbs, setThumbs] = useState<string[]>([])
  const [summary, setSummary] = useState<ClipSummary | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [stroke, setStroke] = useState("Freestyle")
  const [cameraAngle, setCameraAngle] = useState("Side view")
  const [error, setError] = useState("")
  const [accountModal, setAccountModal] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [telemetry, setTelemetry] = useState<TelemetryState>({ live: null, history: [], tracking: "idle", fps: 0 })
  const busy = phase === "scanning" || phase === "measuring" || phase === "writing"

  useEffect(() => {
    let cancelled = false
    getPoseLandmarker()
      .then((landmarker) => { if (!cancelled) { landmarkerRef.current = landmarker; setModel("ready") } })
      .catch((failure) => { console.error("Pose model failed to load:", failure); if (!cancelled) setModel("error") })
    return () => { cancelled = true; if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  /** Detect on the current video frame, draw the HUD, and return the frame's measurements. */
  const processFrame = useCallback((live: boolean): FrameMetrics | null => {
    const video = videoRef.current, canvas = canvasRef.current, landmarker = landmarkerRef.current
    if (!video || !canvas || !landmarker || video.readyState < 2 || !video.videoWidth) return null
    const input = inputRef.current ?? document.createElement("canvas")
    inputRef.current = input
    if (input.width !== video.videoWidth) { input.width = video.videoWidth; input.height = video.videoHeight }
    input.getContext("2d")?.drawImage(video, 0, 0, input.width, input.height)
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight }
    let detected: PosePoint[] | null = null
    try { detected = detectPose(landmarker, input) } catch (failure) { console.error("Pose detection failed:", failure) }
    if (detected) {
      poseRef.current = live ? smoothPose(poseRef.current, detected) : detected
      missedRef.current = 0
      if (live) {
        ;[15, 16].forEach((joint, side) => {
          const point = poseRef.current![joint]
          if ((point.visibility ?? 0) >= 0.35) trailsRef.current[side] = [...trailsRef.current[side], { x: point.x, y: point.y }].slice(-26)
        })
      }
    } else {
      missedRef.current += 1
      if (!live || missedRef.current > 8) poseRef.current = null
    }
    const context = canvas.getContext("2d")
    if (context) drawHud(context, poseRef.current, live ? trailsRef.current : [[], []], layersRef.current, (Math.sin(performance.now() / 260) + 1) / 2)
    return poseRef.current ? measure(poseRef.current, video.videoWidth, video.videoHeight, video.currentTime) : null
  }, [])

  const pushTelemetry = useCallback((tracking: TelemetryState["tracking"]) => {
    const samples = samplesRef.current
    setTelemetry({ live: samples[samples.length - 1] ?? null, history: samples.slice(-120), tracking, fps: fpsRef.current.value })
  }, [])

  // Live tracking while the clip plays.
  const loop = useCallback(() => {
    const video = videoRef.current
    const now = performance.now()
    if (video && !video.paused && video.currentTime !== lastTimeRef.current && now - lastDetectRef.current >= 33) {
      const metrics = processFrame(true)
      if (metrics) samplesRef.current = [...samplesRef.current, metrics].slice(-900)
      lastTimeRef.current = video.currentTime
      lastDetectRef.current = now
      const fps = fpsRef.current
      fps.frames += 1
      if (now - fps.since >= 1000) { fps.value = Math.round((fps.frames * 1000) / (now - fps.since)); fps.frames = 0; fps.since = now }
    }
    frameRef.current = requestAnimationFrame(loop)
  }, [processFrame])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => pushTelemetry(missedRef.current > 8 ? "lost" : "live"), 120)
    return () => window.clearInterval(timer)
  }, [playing, pushTelemetry])

  // Redraw the HUD straight away when layers are toggled on a paused frame.
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d")
    if (context && !playing && canvasRef.current?.width) drawHud(context, poseRef.current, trailsRef.current, layers, 0.5)
  }, [layers, playing])

  const onPlay = () => {
    setPlaying(true)
    fpsRef.current = { frames: 0, since: performance.now(), value: fpsRef.current.value }
    if (!frameRef.current) frameRef.current = requestAnimationFrame(loop)
  }
  const onPause = () => {
    setPlaying(false)
    if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null }
    pushTelemetry("paused")
  }
  const onSeeked = () => {
    if (busy || !videoRef.current?.paused) return
    trailsRef.current = [[], []]
    const metrics = processFrame(false)
    if (metrics) samplesRef.current = [...samplesRef.current, metrics].slice(-900)
    pushTelemetry("paused")
  }

  const loadFile = (next: File) => {
    if (!next.type.startsWith("video/")) { setError("That isn't a video file. Try an MP4, MOV or WebM clip."); return }
    if (url) URL.revokeObjectURL(url)
    setFile(next)
    setUrl(URL.createObjectURL(next))
    setPhase("ready"); setResult(null); setSummary(null); setThumbs([]); setProgress(0); setError("")
    poseRef.current = null; trailsRef.current = [[], []]; samplesRef.current = []; lastTimeRef.current = -1
    setTelemetry({ live: null, history: [], tracking: "idle", fps: 0 })
  }
  const reset = () => {
    videoRef.current?.pause()
    if (url) URL.revokeObjectURL(url)
    setFile(null); setUrl(""); setPhase("empty"); setResult(null); setSummary(null); setThumbs([]); setProgress(0); setError("")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const seek = (video: HTMLVideoElement, time: number) => new Promise<void>((resolve) => {
    const done = () => { video.removeEventListener("seeked", done); resolve() }
    video.addEventListener("seeked", done)
    video.currentTime = time
    window.setTimeout(done, 2500)
  })
  const thumbnail = () => {
    const video = videoRef.current, overlay = canvasRef.current
    if (!video || !overlay) return null
    const canvas = document.createElement("canvas")
    canvas.width = 176
    canvas.height = Math.round(176 * (video.videoHeight / video.videoWidth))
    const context = canvas.getContext("2d")
    context?.drawImage(video, 0, 0, canvas.width, canvas.height)
    context?.drawImage(overlay, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.72)
  }

  /** Step through the clip frame by frame, tracking and measuring each one. */
  const scanClip = async (): Promise<FrameMetrics[]> => {
    const video = videoRef.current!
    video.pause()
    const total = Math.min(120, Math.max(24, Math.ceil(meta.duration * 5)))
    const every = Math.max(1, Math.floor(total / 14))
    const samples: FrameMetrics[] = []
    poseRef.current = null
    trailsRef.current = [[], []]
    for (let index = 0; index < total; index++) {
      await seek(video, Math.min(meta.duration - 0.01, ((index + 0.5) / total) * meta.duration))
      const metrics = processFrame(false)
      if (metrics) samples.push(metrics)
      if (index % every === 0) { const image = thumbnail(); if (image) setThumbs((current) => [...current, image]) }
      setScan({ index: index + 1, total, tracked: samples.filter((sample) => sample.confidence >= 0.4).length })
      scanTotalRef.current = total
      setProgress(Math.round(((index + 1) / total) * 68))
      if (samples.length) setTelemetry({ live: samples[samples.length - 1], history: samples.slice(-120), tracking: "live", fps: 0 })
    }
    await seek(video, 0)
    processFrame(false)
    return samples
  }

  const analyze = async () => {
    if (!file || model !== "ready") return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user && localStorage.getItem("swimgpt_video_analysis_used") === "true") { setAccountModal(true); return }
    setError(""); setResult(null); setSummary(null); setThumbs([]); setProgress(1)
    setPhase("scanning")
    const samples = await scanClip()

    setPhase("measuring")
    // A dive is angled through take-off, flight and entry, so every tracked frame counts.
    const horizontal = stroke !== "Dive" && (cameraAngle === "Side view" || cameraAngle === "Underwater view")
    const measured = summarize(samples, scanTotalRef.current || samples.length, horizontal)
    if (measured.stroke_rate_per_min === null && measured.swimming_frames >= 5) {
      const live = samplesRef.current.filter((sample) => !horizontal || (sample.bodyTilt !== null && sample.bodyTilt <= 40))
      measured.stroke_rate_per_min = strokeRate(live) // denser live-playback data, if the clip was played
    }
    setSummary(measured)
    for (let value = 69; value <= 78; value += 3) { setProgress(value); await wait(160) }

    setPhase("writing")
    const creep = window.setInterval(() => setProgress((current) => Math.min(96, current + 1)), 260)
    try {
      const profile = localStorage.getItem("swimgpt_onboarding")
      const response = await fetch(`${API_URL}/api/video-analysis`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name, file_size_mb: Number((file.size / 1024 / 1024).toFixed(2)), duration_seconds: Math.round(meta.duration),
          stroke, camera_angle: cameraAngle, athlete_profile: profile ? JSON.parse(profile) : {}, pose_metrics: measured,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      setResult(await response.json())
      setProgress(100)
      setPhase("done")
      if (!user) localStorage.setItem("swimgpt_video_analysis_used", "true")
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250)
    } catch (failure) {
      console.error("Video analysis failed:", failure)
      setError("The coach brief couldn't be written. Check that the backend is running and try again; your measurements are kept.")
      setPhase("ready")
    } finally {
      window.clearInterval(creep)
    }
  }

  const stageIndex = STAGES.findIndex((stage) => stage.phase === phase)
  const ring = 2 * Math.PI * 46

  return (
    <div className={cn("relative", variant === "public" && "mx-auto max-w-7xl px-4 pb-16 pt-28 sm:px-6 lg:px-8")}>
      {variant === "dashboard" && <div aria-hidden className="lab-grid-bg pointer-events-none absolute -inset-x-4 -top-4 h-[640px] opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />}
      {accountModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 backdrop-blur-md">
          <div className="dash-reveal w-full max-w-md rounded-3xl border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(16,24,31,0.98),rgba(7,12,17,0.98))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.65)]">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10 text-cyan-300"><Waves className="h-6 w-6" /></div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-cyan-300">Free analysis used</p>
            <h2 className="mt-2 text-2xl font-bold text-white">Create an account for more stroke reviews</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">You&apos;ve used your free video analysis. Create a SwimGPT account to keep analysing clips and track your technique over time.</p>
            <div className="mt-6 flex gap-3">
              <Button variant="outline" onClick={() => setAccountModal(false)} className="flex-1 border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.07] hover:text-white">Maybe later</Button>
              <Button onClick={() => router.push("/auth?mode=signup")} className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90">Create account<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="mb-10 grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300">
            <ScanLine className="h-3.5 w-3.5" />AI Stroke Lab
          </div>
          <h1 className={cn("text-balance font-bold leading-[1.02] tracking-tight text-white", variant === "public" ? "text-5xl sm:text-7xl" : "text-4xl sm:text-6xl")}>
            See the stroke behind the <span className="lab-shimmer-text">split.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
            Drop in a clip. Watch your skeleton tracked live, joint angles measured frame by frame, and a coach brief built from the numbers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {[["33", "landmarks / frame"], ["120", "frames scanned"], ["100%", "on-device tracking"]].map(([value, text]) => (
            <div key={text} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 backdrop-blur-md">
              <p className="font-mono text-2xl font-bold text-white">{value}</p>
              <p className="text-[11px] text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,0.85fr)]">
        {/* Lab */}
        <div className="space-y-4">
          {!url ? (
            <UploadZone onFile={loadFile} />
          ) : (
            <div className="dash-reveal space-y-3">
              <div className="lab-viewport relative overflow-hidden rounded-[26px] border border-cyan-300/20 bg-black shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(87,229,234,0.05)]"
                style={{ aspectRatio: `${meta.width} / ${meta.height}` }}>
                <video ref={videoRef} src={url} muted playsInline preload="auto" className="h-full w-full object-contain"
                  onLoadedMetadata={(event) => setMeta({ duration: event.currentTarget.duration, width: event.currentTarget.videoWidth || 16, height: event.currentTarget.videoHeight || 9 })}
                  onPlay={onPlay} onPause={onPause} onEnded={onPause} onSeeked={onSeeked} />
                <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Pose tracking overlay" />
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/60 to-transparent" />
                  <span className="lab-corner left-3 top-3 border-l-2 border-t-2" /><span className="lab-corner right-3 top-3 border-r-2 border-t-2" />
                  <span className="lab-corner bottom-3 left-3 border-b-2 border-l-2" /><span className="lab-corner bottom-3 right-3 border-b-2 border-r-2" />
                  <div className="absolute left-5 top-5 flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] backdrop-blur-md",
                      model === "ready" ? "border-cyan-300/30 bg-slate-950/70 text-cyan-100" : model === "error" ? "border-rose-300/30 bg-rose-950/60 text-rose-100" : "border-amber-300/30 bg-slate-950/70 text-amber-100")}>
                      {model === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={cn("h-1.5 w-1.5 rounded-full", model === "ready" ? "animate-pulse bg-cyan-300" : "bg-rose-300")} />}
                      {model === "ready" ? (playing ? "Tracking live" : "Pose model ready") : model === "error" ? "Pose model unavailable" : "Loading pose model"}
                    </span>
                    {playing && <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/30 bg-slate-950/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-100 backdrop-blur-md"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />Rec</span>}
                  </div>
                  <span className="absolute right-5 top-5 max-w-[45%] truncate rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1 font-mono text-[10px] text-slate-300 backdrop-blur-md">
                    {meta.width}×{meta.height} · {meta.duration.toFixed(1)}s
                  </span>
                  {phase === "scanning" && (
                    <>
                      <div className="lab-beam absolute inset-y-0 w-[18%]" />
                      <div className="absolute inset-0 bg-cyan-950/20" />
                      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-cyan-300/40 bg-slate-950/80 px-4 py-1.5 font-mono text-xs text-cyan-100 shadow-[0_0_24px_rgba(87,229,234,0.35)] backdrop-blur-md">
                        Scanning frame {scan.index} / {scan.total} · {scan.tracked} tracked
                      </div>
                    </>
                  )}
                </div>
                {!playing && phase === "ready" && model === "ready" && (
                  <button type="button" onClick={() => void videoRef.current?.play()} aria-label="Play clip with live tracking"
                    className="group absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-cyan-300/90 text-slate-950 shadow-[0_0_60px_rgba(87,229,234,0.6)] transition-transform hover:scale-110">
                    <span className="absolute inset-0 animate-ping rounded-full bg-cyan-300/40" />
                    <svg viewBox="0 0 24 24" className="relative ml-1 h-8 w-8 fill-current"><path d="M7 4.5v15l13-7.5z" /></svg>
                  </button>
                )}
              </div>
              <VideoControls videoRef={videoRef} layers={layers} onLayers={setLayers} disabled={busy} />
            </div>
          )}

          {url && (
            <div className="dash-reveal rounded-[24px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(18,28,38,0.85),rgba(8,13,19,0.95))] p-5">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Stroke</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STROKES.map((item) => (
                      <button key={item} type="button" disabled={busy} aria-pressed={stroke === item} onClick={() => setStroke(item)}
                        className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300", stroke === item ? "border-cyan-300/50 bg-cyan-300/15 text-white shadow-[0_0_16px_rgba(87,229,234,0.25)]" : "border-white/10 text-slate-400 hover:text-white")}>{item}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Camera angle</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ANGLES.map((item) => (
                      <button key={item} type="button" disabled={busy} aria-pressed={cameraAngle === item} onClick={() => setCameraAngle(item)}
                        className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300", cameraAngle === item ? "border-violet-300/50 bg-violet-400/15 text-white shadow-[0_0_16px_rgba(167,139,250,0.25)]" : "border-white/10 text-slate-400 hover:text-white")}>{item}</button>
                    ))}
                  </div>
                </div>
              </div>
              {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void analyze()} disabled={busy || model !== "ready"}
                  className="lab-cta group relative inline-flex h-12 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400 px-6 text-sm font-bold text-slate-950 shadow-[0_14px_40px_rgba(87,229,234,0.35)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {busy ? STAGES[Math.max(0, stageIndex)].label : phase === "done" ? "Analyze again" : "Analyze my stroke"}
                  {!busy && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
                </button>
                <button type="button" onClick={reset} disabled={busy} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/10 px-4 text-sm text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white">
                  <RotateCcw className="h-4 w-4" />New clip
                </button>
              </div>
              {file && <p className="mt-3 flex items-center gap-2 truncate text-xs text-slate-500"><Film className="h-3.5 w-3.5 shrink-0" />{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
            </div>
          )}

          {thumbs.length > 0 && (
            <div className="dash-reveal rounded-[24px] border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <span>Tracked frames</span><span className="font-mono normal-case tracking-normal text-slate-400">{scan.tracked} of {scan.total || scan.index} with a clear swimmer</span>
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {thumbs.map((image, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={index} src={image} alt={`Tracked frame ${index + 1}`} className="lab-thumb h-16 w-auto shrink-0 rounded-lg border border-cyan-300/20" style={{ "--thumb-delay": "0ms" } as CSSProperties} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Readout */}
        <aside className="space-y-4 lg:sticky lg:top-24">
          {busy && (
            <div className="dash-reveal rounded-[24px] border border-cyan-300/25 bg-[linear-gradient(160deg,rgba(87,229,234,0.10),rgba(8,14,20,0.96))] p-5">
              <div className="flex items-center gap-4">
                <div className="relative h-24 w-24 shrink-0">
                  <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
                    <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
                    <circle cx="50" cy="50" r="46" fill="none" stroke="url(#lab-progress)" strokeWidth="7" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - progress / 100)} className="transition-[stroke-dashoffset] duration-300" />
                    <defs><linearGradient id="lab-progress" x1="0" x2="1"><stop offset="0" stopColor="#67e8f9" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs>
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-bold tabular-nums text-white">{progress}%</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{STAGES[Math.max(0, stageIndex)].label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{STAGES[Math.max(0, stageIndex)].detail}</p>
                </div>
              </div>
              <ol className="mt-5 space-y-2">
                {STAGES.map((stage, index) => (
                  <li key={stage.phase} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-all duration-500",
                    index < stageIndex ? "border-emerald-300/20 bg-emerald-400/[0.06] text-emerald-100" : index === stageIndex ? "border-cyan-300/30 bg-cyan-300/[0.08] text-white" : "border-white/[0.06] text-slate-500")}>
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      index < stageIndex ? "bg-emerald-400 text-slate-950" : index === stageIndex ? "bg-cyan-300 text-slate-950" : "bg-white/[0.06] text-slate-500")}>
                      {index < stageIndex ? <Check className="h-3.5 w-3.5" /> : index === stageIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : index + 1}
                    </span>
                    {stage.label}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="rounded-[24px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(18,28,38,0.85),rgba(8,13,19,0.95))] p-5">
            {url ? (
              <Telemetry {...telemetry} />
            ) : (
              <div className="space-y-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-white"><Cpu className="h-4 w-4 text-cyan-300" />What the lab measures</p>
                {MEASURES.map((item, index) => (
                  <div key={item.title} className="dash-reveal flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5" style={{ "--reveal-delay": `${index * 90}ms` } as CSSProperties}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20"><item.icon className="h-4 w-4" /></span>
                    <div><p className="text-sm font-semibold text-white">{item.title}</p><p className="mt-0.5 text-xs leading-5 text-slate-400">{item.body}</p></div>
                  </div>
                ))}
                <p className="text-[11px] leading-5 text-slate-500">Pose tracking runs in your browser with MediaPipe; your video isn&apos;t uploaded for it.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <div ref={resultsRef} className="scroll-mt-24">
        {result && <div className="mt-10"><CoachBrief result={result} summary={summary} stroke={stroke} onReset={reset} /></div>}
      </div>
    </div>
  )
}
