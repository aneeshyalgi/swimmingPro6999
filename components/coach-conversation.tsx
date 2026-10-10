"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Captions, CaptionsOff, Hand, Loader2, Mic, MicOff, PhoneOff, RotateCcw, Send } from "lucide-react"
import { CoachAvatar, coachLookKey } from "@/components/coach-avatar"
import { CoachLiveAvatar } from "@/components/coach-live-avatar"
import { generateCoachSpeech, speechChunks, transcribeRecording } from "@/lib/coach-audio"
import { playHangUpSound } from "@/lib/call-sounds"
import { cn } from "@/lib/utils"

/*
 * Conversation mode: a hands-free voice call with a coach.
 * listen (voice-activity detection ends the turn) → transcribe → coach reply (short, spoken style) → speak it
 * sentence by sentence (the next sentence is synthesised while the current one plays) → listen again.
 * Every turn is also written to the normal chat thread by the page's `ask`.
 */

type Phase = "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "muted" | "error"

const TONES: Record<string, [string, string]> = {
  brad: ["#22d3ee", "#0ea5e9"], pete: ["#fbbf24", "#f97316"], timothy: ["#f472b6", "#a855f7"],
  robert: ["#a78bfa", "#6366f1"], tony: ["#34d399", "#14b8a6"],
}
const LISTEN_TONE: [string, string] = ["#e0f2fe", "#57e5ea"]

const SILENCE_MS = 1150        // pause that ends the athlete's turn
const MIN_SPEECH_MS = 280      // ignore coughs and clicks
const IDLE_RESET_MS = 20_000   // restart an empty recording so it never grows large
const MAX_TURN_MS = 45_000

/** Spoken parts: a short opening sentence so the coach starts talking quickly, then groups of up to ~360 characters. */
function spokenParts(text: string) {
  const plain = speechChunks(text).join(" ")
  const sentences = plain.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? []
  const parts: string[] = []
  for (const sentence of sentences) {
    const last = parts[parts.length - 1]
    const opening = parts.length === 1 && last.length < 40
    if (last && (opening || (parts.length > 1 && last.length + sentence.length < 360))) parts[parts.length - 1] = `${last} ${sentence}`
    else parts.push(sentence)
  }
  return parts.length ? parts : [plain]
}

export function CoachConversation({ coach, coachName, origin, ask, onClose }: {
  coach: string
  coachName: string
  origin: { x: number; y: number } | null
  ask: (text: string, signal: AbortSignal) => Promise<string>
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>("connecting")
  const [error, setError] = useState<string | null>(null)
  const [userCaption, setUserCaption] = useState("")
  const [coachCaption, setCoachCaption] = useState("")
  const [revealed, setRevealed] = useState(0)
  const [captions, setCaptions] = useState(true)
  const [heard, setHeard] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [closing, setClosing] = useState(false)

  const phaseRef = useRef<Phase>("connecting")
  const levelRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const micAnalyser = useRef<AnalyserNode | null>(null)
  const outAnalyser = useRef<AnalyserNode | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const turnRef = useRef({ started: 0, voiceAt: 0, speechMs: 0, speaking: false, floor: 0.01 })
  const abortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const aliveRef = useRef(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const askRef = useRef(ask)
  askRef.current = ask

  const tone = TONES[coachLookKey(coach)] ?? TONES.brad
  const go = (next: Phase) => { phaseRef.current = next; setPhase(next) }

  // ---------------------------------------------------------------- audio graph
  const level = (analyser: AnalyserNode | null) => {
    if (!analyser) return 0
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
    return Math.sqrt(sum / data.length)
  }

  const stopPlayback = () => {
    abortRef.current?.abort()
    abortRef.current = null
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
  }

  const discardRecording = () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && recorder.state !== "inactive") { recorder.onstop = null; recorder.stop() }
    chunksRef.current = []
  }

  // ---------------------------------------------------------------- one listening turn
  const listen = useCallback(() => {
    if (!aliveRef.current || !streamRef.current) return
    stopPlayback()
    discardRecording()
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) { setError("Your browser can't record audio. Try Chrome, Edge or Safari."); go("error"); return }
    const recorder = new MediaRecorder(streamRef.current, { mimeType })
    chunksRef.current = []
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.start(250)
    recorderRef.current = recorder
    turnRef.current = { ...turnRef.current, started: performance.now(), voiceAt: 0, speechMs: 0, speaking: false }
    setHeard(false)
    go("listening")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finishTurn = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || phaseRef.current !== "listening") return
    recorderRef.current = null
    go("transcribing")
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType }))
      recorder.stop()
    })
    if (!aliveRef.current) return
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const text = await transcribeRecording(coach, blob, controller.signal)
      if (!aliveRef.current || controller.signal.aborted) return
      setUserCaption(text)
      setCoachCaption("")
      setRevealed(0)
      go("thinking")
      const reply = await askRef.current(text, controller.signal)
      if (!aliveRef.current || controller.signal.aborted) return
      await speak(reply, controller)
      if (aliveRef.current && !controller.signal.aborted && (phaseRef.current as Phase) === "speaking") listen()
    } catch (problem) {
      if (!aliveRef.current || controller.signal.aborted) return
      const message = problem instanceof Error ? problem.message : "Something went wrong."
      // Nothing intelligible: just keep listening.
      if (/no speech|detected/i.test(message)) { listen(); return }
      setError(message)
      go("error")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach, listen])

  // ---------------------------------------------------------------- speaking, with the next part prefetched
  const speak = async (reply: string, controller: AbortController) => {
    const parts = spokenParts(reply)
    const caption = parts.join(" ")
    setCoachCaption(caption)
    setRevealed(0)
    go("speaking")
    const context = contextRef.current
    let offset = 0
    // The next part is synthesised while the current one plays. When the call ends or the athlete interrupts, that
    // request is cancelled with nothing left awaiting it; the no-op catch keeps its cancellation from surfacing as an
    // unhandled AbortError. A part that is awaited still rejects normally, so real failures reach finishTurn's catch.
    const synthesise = (text: string) => {
      const request = generateCoachSpeech(coach, text, controller.signal)
      request.catch(() => undefined)
      return request
    }
    let next = synthesise(parts[0])
    for (let index = 0; index < parts.length; index++) {
      const blob = await next
      if (controller.signal.aborted) return
      if (index + 1 < parts.length) next = synthesise(parts[index + 1])
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      if (context && outAnalyser.current) {
        try { context.createMediaElementSource(audio).connect(outAnalyser.current) } catch { /* plays without the visualiser */ }
      }
      const start = offset
      const length = parts[index].length + 1
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (audio.duration && Number.isFinite(audio.duration)) setRevealed(start + Math.round(length * Math.min(1, audio.currentTime / audio.duration)))
        }
        audio.ontimeupdate = tick
        audio.onended = () => { setRevealed(start + length); resolve() }
        audio.onerror = () => reject(new Error("Could not play the coach's voice."))
        controller.signal.addEventListener("abort", () => { audio.pause(); resolve() }, { once: true })
        audio.play().catch(reject)
      }).finally(() => URL.revokeObjectURL(url))
      offset += length
      if (controller.signal.aborted) return
    }
    setRevealed(caption.length)
  }

  // ---------------------------------------------------------------- start, end
  useEffect(() => {
    aliveRef.current = true
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Voice conversation needs a browser with microphone support (HTTPS or localhost).")
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (!aliveRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
        streamRef.current = stream
        const context = new AudioContext()
        await context.resume()
        contextRef.current = context
        const mic = context.createAnalyser()
        mic.fftSize = 1024
        context.createMediaStreamSource(stream).connect(mic)
        micAnalyser.current = mic
        const out = context.createAnalyser()
        out.fftSize = 1024
        out.connect(context.destination)
        outAnalyser.current = out
        listen()
      } catch (problem) {
        const denied = problem instanceof DOMException && (problem.name === "NotAllowedError" || problem.name === "SecurityError")
        setError(denied ? "Microphone access was blocked. Allow the microphone for this site and try again." : problem instanceof Error ? problem.message : "Couldn't start the microphone.")
        go("error")
      }
    }
    void start()
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => {
      aliveRef.current = false
      window.clearInterval(timer)
      stopPlayback()
      discardRecording()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      void contextRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- voice activity + orb, one frame loop
  useEffect(() => {
    let frame = 0
    let smooth = 0
    let time = 0
    let last = performance.now()
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const draw = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const current = phaseRef.current
      const raw = current === "speaking" ? level(outAnalyser.current) : current === "listening" ? level(micAnalyser.current) : 0
      levelRef.current = raw

      // End the athlete's turn after a pause that follows real speech.
      if (current === "listening") {
        const turn = turnRef.current
        const threshold = Math.max(0.018, turn.floor * 3.2)
        if (raw > threshold) {
          if (!turn.speaking) { turn.speaking = true; setHeard(true) }
          turn.voiceAt = now
          turn.speechMs += dt
        } else if (!turn.speaking) {
          turn.floor = turn.floor * 0.97 + raw * 0.03
        }
        if (turn.speaking && turn.speechMs > MIN_SPEECH_MS && now - turn.voiceAt > SILENCE_MS) void finishTurn()
        else if (!turn.speaking && now - turn.started > IDLE_RESET_MS) listen()
        else if (now - turn.started > MAX_TURN_MS) void finishTurn()
        if (turn.speaking && turn.speechMs <= MIN_SPEECH_MS && now - turn.voiceAt > SILENCE_MS) { turn.speaking = false; turn.speechMs = 0; setHeard(false) }
      }

      const target = current === "thinking" || current === "transcribing" ? 0.18 : Math.min(1, raw * 7)
      smooth += (target - smooth) * (target > smooth ? 0.35 : 0.08)
      time += (dt / 1000) * (current === "thinking" || current === "transcribing" ? 2.2 : 1) * (reduced ? 0.25 : 1)
      paint(canvasRef.current, time, smooth, current, current === "listening" || current === "muted" ? LISTEN_TONE : tone)
      document.documentElement.style.setProperty("--cv-level", smooth.toFixed(3))
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); document.documentElement.style.removeProperty("--cv-level") }
  }, [finishTurn, listen, tone])

  // ---------------------------------------------------------------- controls
  const interrupt = () => { if (phaseRef.current === "speaking" || phaseRef.current === "thinking") { stopPlayback(); listen() } }
  const toggleMute = () => {
    if (phaseRef.current === "muted") { streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = true }); listen(); return }
    if (phaseRef.current === "listening") {
      discardRecording()
      streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false })
      go("muted")
    }
  }
  const retry = () => { setError(null); if (streamRef.current) listen(); else onClose() }
  const end = () => {
    // Once only: a second press (or Esc) while the call is closing shouldn't chime again.
    if (!aliveRef.current) return
    playHangUpSound()
    aliveRef.current = false
    stopPlayback()
    discardRecording()
    setClosing(true)
    window.setTimeout(onClose, 420)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") end()
      if (event.key === " " && event.target === document.body) { event.preventDefault(); if (phaseRef.current === "listening") void finishTurn(); else interrupt() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishTurn])

  if (typeof document === "undefined") return null
  const first = coachName.replace(/^Coach\s+/i, "")
  const label = {
    connecting: `Connecting to ${coachName}…`, listening: heard ? "Listening…" : "Go ahead, I'm listening", transcribing: "Got it…",
    thinking: `${first} is thinking`, speaking: `${first} is speaking`, muted: "Microphone muted", error: "Conversation paused",
  }[phase]
  const words = coachCaption.slice(0, revealed)
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Voice conversation with ${coachName}`}
      className={cn("cv-root fixed inset-0 z-[100] flex flex-col overflow-hidden text-white", closing && "cv-closing")}
      style={{ "--cv-x": `${origin?.x ?? window.innerWidth / 2}px`, "--cv-y": `${origin?.y ?? window.innerHeight / 2}px`, "--cv-a": tone[0], "--cv-b": tone[1] } as CSSProperties}>
      <div aria-hidden className="cv-backdrop absolute inset-0">
        <span className="cv-aurora cv-aurora-a" />
        <span className="cv-aurora cv-aurora-b" />
        <span className="cv-stars absolute inset-0" />
      </div>

      {/* Top bar */}
      <header className="cv-fade relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <CoachAvatar name={coach} shape="circle" className="h-10 w-10 ring-2 ring-white/15" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{coachName}</p>
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className={cn("h-1.5 w-1.5 rounded-full", phase === "error" ? "bg-rose-400" : phase === "muted" ? "bg-amber-300" : "cv-live bg-emerald-400")} />
              Voice conversation · <span className="font-mono tabular-nums">{clock}</span>
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setCaptions((value) => !value)} aria-pressed={captions}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300 backdrop-blur transition-colors hover:bg-white/10 hover:text-white">
          {captions ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
          <span className="hidden sm:inline">Captions</span>
        </button>
      </header>

      {/* Orb */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4">
        <button type="button" onClick={interrupt} aria-label={phase === "speaking" ? "Interrupt the coach" : coachName}
          className={cn("cv-orb relative mt-6 w-[min(80vw,400px,44vh)] shrink-0 outline-none [aspect-ratio:180/182] sm:mt-10", (phase === "speaking" || phase === "thinking") && "cursor-pointer")}>
          {/* The orb glows behind the coach's head and moves with the voice */}
          <span aria-hidden className="absolute left-1/2 top-[-8%] aspect-square w-[80%] -translate-x-1/2">
            {[0, 1, 2].map((ring) => <span key={ring} className="cv-ring absolute inset-[14%] rounded-full" style={{ "--r": ring } as CSSProperties} />)}
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          </span>
          <CoachLiveAvatar coach={coach} phaseRef={phaseRef} speech={outAnalyser} mic={micAnalyser} className="cv-avatar relative h-full w-full" />
        </button>

        <p key={phase} role="status" aria-live="polite" className="cv-label mt-5 flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl">
          {phase === "connecting" && <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />}
          {label}
          {(phase === "thinking" || phase === "transcribing") && <span className="cv-dots" aria-hidden><i /><i /><i /></span>}
        </p>
        {phase === "listening" && (
          <div aria-hidden className="mt-4 flex h-8 items-center gap-1">
            {Array.from({ length: 13 }, (_, index) => <span key={index} className="cv-bar w-1 rounded-full bg-cyan-200" style={{ "--i": index } as CSSProperties} />)}
          </div>
        )}
        <p className="mt-3 h-5 text-center text-xs text-slate-500">
          {phase === "listening" ? "Pause when you're done and I'll answer. Space to send now." : phase === "speaking" ? "Tap the coach or press Space to interrupt." : phase === "muted" ? "Unmute when you're ready to talk." : ""}
        </p>

        {/* Captions */}
        {captions && (userCaption || coachCaption) && phase !== "error" && (
          <div className="cv-captions mt-4 flex max-h-[24vh] w-full max-w-2xl flex-col justify-end gap-2 overflow-hidden text-center">
            {userCaption && <p key={userCaption} className="cv-fade text-sm text-slate-400"><span className="text-slate-500">You · </span>{userCaption}</p>}
            {coachCaption && (
              <p className="text-balance text-lg leading-8 text-white/95 sm:text-xl [@media(max-height:760px)]:text-base [@media(max-height:760px)]:leading-7">
                {words.split(/(\s+)/).map((word, index) => <span key={index} className="cv-word">{word}</span>)}
                {revealed < coachCaption.length && <span className="cv-caret" />}
              </p>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="cv-fade mt-6 max-w-md rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-center text-sm text-rose-100">
            <p>{error}</p>
            <button type="button" onClick={retry} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold hover:bg-white/20">
              <RotateCcw className="h-3.5 w-3.5" />Try again
            </button>
          </div>
        )}
      </main>

      {/* Controls */}
      <footer className="cv-fade relative z-10 flex items-center justify-center gap-4 px-4 pb-8 pt-4 sm:gap-6" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        <ControlButton label={phase === "muted" ? "Unmute" : "Mute"} onClick={toggleMute} disabled={phase !== "listening" && phase !== "muted"} active={phase === "muted"}>
          {phase === "muted" ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </ControlButton>
        <button type="button" onClick={end} aria-label="End conversation"
          className="cv-end grid h-[72px] w-[72px] place-items-center rounded-full bg-rose-500 text-white shadow-[0_16px_40px_-8px_rgba(244,63,94,0.7)] transition-transform hover:scale-105 active:scale-95">
          <PhoneOff className="h-7 w-7" />
        </button>
        {phase === "speaking" || phase === "thinking" ? (
          <ControlButton label="Interrupt" onClick={interrupt}><Hand className="h-6 w-6" /></ControlButton>
        ) : (
          <ControlButton label="Send now" onClick={() => void finishTurn()} disabled={phase !== "listening" || !heard}><Send className="h-6 w-6" /></ControlButton>
        )}
      </footer>
      <p className="relative z-10 pb-4 text-center text-[11px] text-slate-600">AI-generated coach voice · Your speech is sent to OpenAI for transcription</p>
    </div>,
    document.body,
  )
}

function ControlButton({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <span className="flex flex-col items-center gap-2">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
        className={cn("grid h-14 w-14 place-items-center rounded-full border backdrop-blur-md transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-35",
          active ? "border-amber-300/50 bg-amber-300/20 text-amber-100" : "border-white/12 bg-white/[0.07] text-white hover:bg-white/[0.14]")}>
        {children}
      </button>
      <span className="text-[11px] text-slate-400">{label}</span>
    </span>
  )
}

/** The living orb: three translucent blobs whose edges ripple with the voice level, plus a halo and drifting sparks. */
function paint(canvas: HTMLCanvasElement | null, time: number, level: number, phase: Phase, [a, b]: [string, string]) {
  if (!canvas) return
  const ratio = window.devicePixelRatio || 1
  const size = canvas.clientWidth
  if (canvas.width !== Math.round(size * ratio)) { canvas.width = Math.round(size * ratio); canvas.height = Math.round(size * ratio) }
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, size, size)
  const c = size / 2
  const base = size * 0.3 * (1 + level * 0.18)
  const calm = phase === "muted" || phase === "error" || phase === "connecting"

  const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, size * 0.5)
  halo.addColorStop(0, `${b}55`)
  halo.addColorStop(1, `${b}00`)
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)

  ctx.globalCompositeOperation = "lighter"
  for (let layer = 0; layer < 3; layer++) {
    const amp = (calm ? 0.02 : 0.05 + level * 0.22) * (1 - layer * 0.18)
    ctx.beginPath()
    for (let i = 0; i <= 120; i++) {
      const theta = (i / 120) * Math.PI * 2
      const wobble = Math.sin(theta * 3 + time * 1.4 + layer * 2.1) * 0.55
        + Math.sin(theta * 5 - time * 1.9 + layer) * 0.3
        + Math.sin(theta * 8 + time * 2.7 - layer * 1.3) * 0.15 * (0.4 + level)
      const radius = base * (1 + amp * wobble) * (1 - layer * 0.07)
      const x = c + Math.cos(theta + time * 0.15 * (layer + 1)) * radius
      const y = c + Math.sin(theta + time * 0.15 * (layer + 1)) * radius
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    const fill = ctx.createRadialGradient(c - base * 0.3, c - base * 0.4, base * 0.1, c, c, base * 1.25)
    fill.addColorStop(0, layer === 0 ? "#ffffffcc" : `${a}aa`)
    fill.addColorStop(0.45, `${a}${layer === 0 ? "88" : "55"}`)
    fill.addColorStop(1, `${b}${layer === 2 ? "22" : "44"}`)
    ctx.fillStyle = fill
    ctx.fill()
  }

  // Sparks orbiting the surface.
  for (let i = 0; i < 26; i++) {
    const angle = time * (0.25 + (i % 5) * 0.06) + i * 2.4
    const distance = base * (1.18 + ((i * 37) % 23) / 60 + level * 0.25 * Math.sin(time * 3 + i))
    const x = c + Math.cos(angle) * distance
    const y = c + Math.sin(angle) * distance
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.35 * ((i % 4) / 4) + level * 0.3})`
    ctx.beginPath()
    ctx.arc(x, y, 0.8 + (i % 3) * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = "source-over"
}
