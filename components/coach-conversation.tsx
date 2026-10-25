"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { ArrowRight, CalendarPlus, Captions, CaptionsOff, Hand, Loader2, Mic, MicOff, PhoneOff, RotateCcw, Send } from "lucide-react"
import { CoachAvatar, coachLookKey } from "@/components/coach-avatar"
import { CallScene, ScenePicker, SceneTitle } from "@/components/call-scenes"
import { CoachLiveAvatar } from "@/components/coach-live-avatar"
import { DEFAULT_SCENE, drawnScene, saveScene, savedScene, sceneById, type SceneId } from "@/lib/call-scenes"
import { NoSpeechError, streamCoachSpeech, transcribeRecording } from "@/lib/coach-audio"
import { echoOf, Resampler, soundsFinished, TURN, TurnTaker, VoiceDetector, VoiceRecording, type TurnEvent } from "@/lib/voice-turns"
import { LONGEST_PIECE, SpeechPlayer, SpokenText, type SpeechPart } from "@/lib/voice-speech"
import { playHangUpSound } from "@/lib/call-sounds"
import { cn } from "@/lib/utils"

/*
 * Conversation mode: a hands-free voice call with a coach.
 * The microphone is heard all the time (lib/voice-turns). When the athlete pauses, what they've said is already being
 * transcribed in case they've finished; a longer pause ends their turn, and if they carry on before the coach answers,
 * their turn simply goes on. The coach's reply streams in and is spoken as it's written (lib/voice-speech), so they
 * start talking within a sentence. The athlete can interrupt by tapping the coach, or by talking over them when the
 * device keeps the coach's voice out of the microphone. Every turn is also written to the chat thread by `ask`.
 */

type Phase = "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "muted" | "error"

const TONES: Record<string, [string, string]> = {
  brad: ["#22d3ee", "#0ea5e9"], pete: ["#fbbf24", "#f97316"], timothy: ["#f472b6", "#a855f7"],
  robert: ["#a78bfa", "#6366f1"], tony: ["#34d399", "#14b8a6"],
}
const LISTEN_TONE: [string, string] = ["#e0f2fe", "#57e5ea"]
/** The coach's two colours (their orb on a call, and the scenes that take on their colours). */
export const coachTone = (coach: string): [string, string] => TONES[coachLookKey(coach)] ?? TONES.brad

/** Why a reply is abandoned when the athlete goes on talking: their turn wasn't over, so nothing of it is kept. */
export const CONTINUED = "continued"
const OPENER_MS = 3_200        // how long each "Try …" line shows on the athlete's first turn
const SHORTEST_TURN = 0.3      // seconds: anything shorter sent on its own has no words in it
// While the coach talks, their voice comes back into the microphone, less what the device's echo cancellation takes
// out. How much comes back is measured over the first 1.5 s of each reply; to interrupt, the athlete must be this much
// louder than that. Until it's measured, talking over the coach doesn't interrupt (tapping always does). The coach's
// level is held as it dies away (by this much each 20 ms), so the room's echo of their last words is covered too.
const ECHO_MARGIN_DB = 10
const ECHO_FRAMES = 75
const ECHO_DECAY_DB = 0.6
// Talking over the coach for this long interrupts them; anything shorter ("mm-hmm", "okay", a laugh) doesn't. The
// coach's voice drops as soon as it's clearly the athlete talking, so they hear at once that they've been heard.
const BARGE_IN_S = 0.5
// The Interrupt button takes Send now's place when a turn is sent: a tap meant for Send now that lands just after
// (the call ended the turn itself a moment before) isn't taken as interrupting the coach.
const SWAP_GUARD_MS = 700
const NOT_CAUGHT = "Sorry, I didn't catch that. Could you say it again?"

/** Things to open with: the call waits for the athlete to speak first, so show what they could say. */
const openers = (first: string) => [
  `Hi ${first}, how should I train this week?`,
  "What should I focus on in today's session?",
  "How do I get faster at my main event?",
  "I'm feeling tired. Should I go easier today?",
]

type Hearing = { resampler: Resampler; recording: VoiceRecording; detector: VoiceDetector; turns: TurnTaker }

/**
 * `planOffer`: what the coach just prescribed on the call ("Swim session ready"), offered for the athlete's training;
 * taking it (`onAddPlan`) ends the call, and the chat opens the plan.
 */
export function CoachConversation({ coach, coachName, origin, ask, onClose, planOffer = null, onAddPlan }: {
  coach: string
  coachName: string
  origin: { x: number; y: number } | null
  /** Asks the coach and writes the turn to the chat: `onText` gets the reply as it's written, and it resolves with all
   *  of it. Aborted with the reason CONTINUED when the athlete goes on talking. */
  ask: (text: string, signal: AbortSignal, onText: (text: string) => void) => Promise<string>
  onClose: () => void
  planOffer?: { id: string; label: string } | null
  onAddPlan?: () => void
}) {
  const [phase, setPhase] = useState<Phase>("connecting")
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const [userCaption, setUserCaption] = useState("")
  const [coachCaption, setCoachCaption] = useState("")
  const [revealed, setRevealed] = useState(0)
  const [captions, setCaptions] = useState(true)
  const [heard, setHeard] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [closing, setClosing] = useState(false)
  const [opener, setOpener] = useState(0)
  // The scene behind the call (components/call-scenes), picked from the top bar and kept on this device. `settled`
  // is the scene once it has finished sweeping in; `titled` counts picks, each shown by name for a moment.
  const [scene, setScene] = useState<SceneId>(() => savedScene())
  const [settled, setSettled] = useState<SceneId>(scene)
  const [sceneFrom, setSceneFrom] = useState<{ x: number; y: number } | null>(null)
  const [scenesOpen, setScenesOpen] = useState(false)
  const [scenesAvailable, setScenesAvailable] = useState(true)
  const [titled, setTitled] = useState(0)

  const phaseRef = useRef<Phase>("connecting")
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const micAnalyser = useRef<AnalyserNode | null>(null)
  const outAnalyser = useRef<AnalyserNode | null>(null)
  const tapRef = useRef<(() => void) | null>(null)
  const playerRef = useRef<SpeechPlayer | null>(null)
  const hearingRef = useRef<Hearing | null>(null)
  // The athlete's turn under way: where its audio starts (kept when they go on after the call thought they'd finished).
  const turnRef = useRef<{ from: number; carried: boolean } | null>(null)
  // Where the latest speech heard began, in whatever phase: the start of an interruption.
  const lastStart = useRef(0)
  // When the coach's voice started (on the recording's clock), whether their reply has been written in full, whether
  // the athlete is talking over them, when the athlete's last turn was sent (performance.now()), and whether they sent
  // it themselves (Send now: their turn is over, whatever else is heard before the coach answers, such as a TV).
  const speakingSince = useRef(Infinity)
  const replyWritten = useRef(false)
  const overCoach = useRef(false)
  const sentAt = useRef(-Infinity)
  const sentByHand = useRef(false)
  // A pause's transcription, started in case the turn is over.
  const guessRef = useRef<{ from: number; to: number; controller: AbortController; text: Promise<string> } | null>(null)
  const replyRef = useRef<AbortController | null>(null)
  const retryRef = useRef<(() => void) | null>(null)
  // The coach's voice coming back (see ECHO_MARGIN_DB): how loud it comes back relative to them (dB), its measurement,
  // the coach's held level (dBFS), and whether it's been set for good (their voice was once taken for the athlete's).
  const echoRef = useRef({ gain: 0, differences: [] as number[], measured: false, level: -120, fixed: false })
  const captionRef = useRef("")
  const stalledRef = useRef(false)
  const revealedRef = useRef(0)
  const sessionRef = useRef({ closed: false })
  const aliveRef = useRef(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const askRef = useRef(ask)
  askRef.current = ask
  // What the scene behind the call moves with: the athlete's voice only, never the coach's (talking or thinking), so it
  // looks the same whether or not the coach is speaking. `scenePhase` never says the coach is speaking.
  const sceneLevel = useRef(0)
  const scenePhase = useRef("listening")
  const sceneButtonRef = useRef<HTMLButtonElement>(null)
  const scenesOpenRef = useRef(false)
  scenesOpenRef.current = scenesOpen

  const tone = coachTone(coach)
  const go = (next: Phase) => { phaseRef.current = next; setPhase(next) }

  // ---------------------------------------------------------------- the athlete's turn
  const dropGuess = () => {
    guessRef.current?.controller.abort()
    guessRef.current = null
  }

  /** Abandons the reply under way: its requests and its voice. */
  const stopReply = (reason: string) => {
    replyRef.current?.abort(reason)
    replyRef.current = null
    playerRef.current?.stop()
  }

  /** The athlete's turn, from now. `keep`: if they're already talking (as the coach finishes), that's their turn. */
  const listen = (keep = false) => {
    const hearing = hearingRef.current
    if (!aliveRef.current || !hearing) return
    stopReply("interrupted")
    dropGuess()
    overCoach.current = false
    if (keep && hearing.turns.talking) {
      turnRef.current = { from: lastStart.current, carried: false }
      setHeard(true)
    } else {
      hearing.turns.reset(hearing.recording.seconds)
      turnRef.current = null
      setHeard(false)
    }
    go("listening")
  }

  const transcribe = (from: number, to: number, signal: AbortSignal) => {
    if (to - from < SHORTEST_TURN) return Promise.reject(new NoSpeechError(NOT_CAUGHT))
    const audio = hearingRef.current!.recording.wav(from, to)
    return transcribeRecording(coach, new Blob([audio], { type: "audio/wav" }), signal)
  }

  /** A pause: what the athlete has said so far starts being transcribed, in case it's the end of their turn. Once it's
   *  known what they said, their turn ends sooner if it sounds finished, or later if it leads on ("and…", "so…"). */
  const guess = (from: number, to: number) => {
    dropGuess()
    const controller = new AbortController()
    const text = transcribe(from, to, controller.signal)
    guessRef.current = { from, to, controller, text }
    text.then((said) => {
      const hearing = hearingRef.current
      if (guessRef.current?.text === text && hearing) hearing.turns.endAfter = soundsFinished(said) ? 0.6 : 1.5
    }, () => undefined)
  }

  const fail = (problem: unknown, retry: () => void) => {
    stopReply("failed")
    retryRef.current = retry
    setError(problem instanceof Error ? problem.message : "Something went wrong.")
    go("error")
  }

  /** The athlete's turn is over: what they said, `from` to `to` on the recording, becomes the coach's spoken reply. */
  const respond = async (from: number, to: number, byHand = false) => {
    const controller = new AbortController()
    replyRef.current = controller
    turnRef.current = { from, carried: turnRef.current?.carried ?? false }
    sentAt.current = performance.now()
    sentByHand.current = byHand
    setHint(null)
    go("transcribing")
    const earlier = guessRef.current
    guessRef.current = null
    // The pause's transcription is this turn's when nothing has been said since; a failed request is tried once more.
    const again = (problem: unknown) => {
      if (problem instanceof NoSpeechError || controller.signal.aborted) throw problem
      return transcribe(from, to, controller.signal)
    }
    let text: string
    try {
      if (earlier && earlier.from === from && Math.abs(earlier.to - to) < 0.03) {
        controller.signal.addEventListener("abort", () => earlier.controller.abort(), { once: true })
        text = await earlier.text.catch(again)
      } else {
        earlier?.controller.abort()
        text = await transcribe(from, to, controller.signal).catch(again)
      }
    } catch (problem) {
      if (controller.signal.aborted || !aliveRef.current) return
      if (problem instanceof NoSpeechError) {
        setHint(NOT_CAUGHT)
        listen()
      } else fail(problem, () => void respond(from, to))
      return
    }
    if (controller.signal.aborted || !aliveRef.current) return
    if (echoOf(text, captionRef.current)) {
      // The coach's own voice came back loud enough to pass for the athlete's (a device with no echo cancellation):
      // it isn't answered, and from now on only a tap interrupts the coach.
      Object.assign(echoRef.current, { gain: Math.max(echoRef.current.gain, 6), fixed: true })
      listen()
      return
    }
    setUserCaption(text)
    await reply(text, controller)
  }

  /** Asks the coach, and speaks the reply while it's being written: its first piece as soon as there is one. */
  const reply = async (text: string, controller: AbortController) => {
    const player = playerRef.current
    if (!player) return
    const { signal } = controller
    const pieces = new SpokenText()
    const queue: string[] = []
    let written = false
    let wake = () => {}
    signal.addEventListener("abort", () => wake(), { once: true })
    let caption = ""
    let spoken = 0
    let silent = 0
    captionRef.current = ""
    revealedRef.current = 0
    replyWritten.current = false
    speakingSince.current = Infinity
    setCoachCaption("")
    setRevealed(0)
    go("thinking")
    player.onstart = () => {
      if (signal.aborted) return
      if (!echoRef.current.fixed) Object.assign(echoRef.current, { differences: [], measured: false })
      speakingSince.current = hearingRef.current?.recording.seconds ?? 0
      go("speaking")
    }

    // Each piece is synthesised as soon as it's written (two at most at once: the one playing and the next), and
    // everything written by the time a piece is started goes in it, as fewer, longer pieces sound most natural.
    const speaking = (async () => {
      const working: Promise<void>[] = []
      for (;;) {
        if (signal.aborted) return
        if (!queue.length) {
          if (written) break
          await new Promise<void>((resolve) => { wake = resolve })
          continue
        }
        let piece = queue.shift()!
        if (caption) while (queue.length && piece.length + queue[0].length < LONGEST_PIECE) piece += ` ${queue.shift()}`
        caption = caption ? `${caption} ${piece}` : piece
        captionRef.current = caption
        setCoachCaption(caption)
        spoken++
        const part = player.part(piece.length + 1)
        working.push(voice(part, piece, signal).catch(() => { if (!signal.aborted) silent++ }).finally(() => part.end()))
        if (working.length >= 2) await working.shift()
      }
      await Promise.all(working)
    })()

    try {
      await askRef.current(text, signal, (delta) => {
        queue.push(...pieces.push(delta))
        wake()
      })
    } catch (problem) {
      written = true
      wake()
      if (signal.aborted || !aliveRef.current) return
      fail(problem, () => {
        const retried = new AbortController()
        replyRef.current = retried
        void reply(text, retried)
      })
      return
    }
    queue.push(...pieces.finish())
    written = true
    replyWritten.current = true
    wake()
    await speaking
    if (!signal.aborted) await player.whenDrained()
    if (signal.aborted || !aliveRef.current) return
    revealedRef.current = caption.length
    setRevealed(caption.length)
    if (silent) setHint(silent === spoken ? "The coach's voice couldn't play, so their reply is in the captions." : null)
    replyRef.current = null
    listen(true)
  }

  /** One piece of the reply, played as it streams in. */
  const voice = async (part: SpeechPart, text: string, signal: AbortSignal) => {
    const response = await streamCoachSpeech(coach, text, signal)
    if (response.body && /audio\/(l16|pcm)/i.test(response.headers.get("content-type") ?? "")) {
      const reader = response.body.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value?.length) part.write(value)
      }
    } else {
      // A server that doesn't stream speech sends an MP3.
      part.decoded(await contextRef.current!.decodeAudioData(await response.arrayBuffer()))
    }
  }

  /** They went on talking before the coach answered: their turn wasn't over, so it carries on from where it began. */
  const carryOn = () => {
    stopReply(CONTINUED)
    dropGuess()
    turnRef.current = { from: turnRef.current?.from ?? lastStart.current, carried: true }
    setHeard(true)
    setHint(null)
    go("listening")
  }

  /** They talked over the coach: the coach stops, and it's their turn from where they started. */
  const interruptedBy = (from: number) => {
    stopReply("interrupted")
    dropGuess()
    turnRef.current = { from, carried: false }
    setHeard(true)
    setHint(null)
    go("listening")
  }

  const onTurn = (event: TurnEvent) => {
    if (event.type === "start") lastStart.current = event.from
    const turn = turnRef.current
    switch (phaseRef.current) {
      case "listening":
        if (event.type === "start") {
          if (!turn) turnRef.current = { from: event.from, carried: false }
          setHeard(true)
          setHint(null)
        } else if (event.type === "noise" && !turn?.carried) {
          turnRef.current = null
          setHeard(false)
        } else if (event.type === "pause") guess(turn?.from ?? event.from, event.to)
        else if (event.type === "resume") dropGuess()
        else if (event.type === "end") void respond(turn?.from ?? event.from, event.to)
        return
      case "transcribing":
      case "thinking":
        // A sound from the athlete: the coach doesn't start talking over it. If it's them talking, their turn carries on;
        // if it was only a sound, the coach goes ahead. Unless they pressed Send: then their turn is over.
        if (sentByHand.current) return
        if (event.type === "start") playerRef.current?.hold(true)
        else if (event.type === "speech") carryOn()
        else if (event.type === "noise") playerRef.current?.hold(false)
        return
      case "speaking":
        if (event.type === "speech") {
          // Already talking when the coach began (they hadn't finished, and hadn't heard the coach yet): their turn
          // carries on, unless the reply is already written (and in the chat), when it's a new turn.
          if (lastStart.current + TURN.preroll < speakingSince.current + 0.2) {
            if (replyWritten.current) interruptedBy(lastStart.current)
            else carryOn()
          } else {
            overCoach.current = true
            playerRef.current?.duck(true)
          }
        } else if ((event.type === "end" || event.type === "noise") && overCoach.current) {
          overCoach.current = false
          playerRef.current?.duck(false)
        }
        return
    }
  }

  // ---------------------------------------------------------------- the microphone
  /** What the microphone heard in the last 20 ms, with the coach's voice at that moment (`coach`). */
  const hear = (block: Float32Array, coach: Float32Array | null) => {
    const hearing = hearingRef.current
    if (!hearing || !aliveRef.current) return
    const samples = hearing.resampler.push(block)
    hearing.recording.push(samples)
    // While the coach talks (and while their voice dies away in the room), the athlete counts as talking only when
    // clearly louder than the coach's voice coming back.
    const echo = echoRef.current
    let level = -120
    if (coach?.length) {
      let sum = 0
      for (const sample of coach) sum += sample * sample
      level = 10 * Math.log10(sum / coach.length + 1e-12)
    }
    echo.level = Math.max(level, echo.level - ECHO_DECAY_DB)
    const out = echo.level
    const gate = out > -90 ? out + echo.gain + ECHO_MARGIN_DB : -Infinity
    const talking = !!playerRef.current?.busy
    for (const frame of hearing.detector.push(samples, gate)) {
      if (talking && !echo.measured && !echo.fixed && out > -50) {
        echo.differences.push(frame.db - out)
        if (echo.differences.length >= ECHO_FRAMES) {
          const sorted = [...echo.differences].sort((a, b) => a - b)
          echo.gain = sorted[Math.floor(sorted.length * 0.75)]
          echo.measured = true
        }
      }
      const event = hearing.turns.push(frame)
      if (event) onTurn(event)
    }
    if (overCoach.current && phaseRef.current === "speaking" && hearing.turns.spoken >= BARGE_IN_S) {
      overCoach.current = false
      interruptedBy(lastStart.current)
    }
  }
  const hearRef = useRef(hear)
  hearRef.current = hear

  const release = () => {
    tapRef.current?.()
    tapRef.current = null
    streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    streamRef.current = null
  }

  const micLost = () => {
    if (!aliveRef.current) return
    stopReply("interrupted")
    dropGuess()
    release()
    setError("Your microphone stopped. Check it's connected, then try again.")
    retryRef.current = () => { go("connecting"); void connect(sessionRef.current) }
    go("error")
  }

  const connect = async (session: { closed: boolean }) => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") throw new Error("Voice conversation needs a browser with microphone support (HTTPS or localhost).")
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (session.closed) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      const context = contextRef.current ?? new AudioContext()
      contextRef.current = context
      // A context that can't start yet (some browsers want a tap first) starts on the next tap; the call doesn't wait.
      await Promise.race([context.resume(), new Promise((resolve) => window.setTimeout(resolve, 1500))])
      if (session.closed) return
      const source = context.createMediaStreamSource(stream)
      const mic = context.createAnalyser()
      mic.fftSize = 1024
      source.connect(mic)
      micAnalyser.current = mic
      if (!outAnalyser.current) {
        const out = context.createAnalyser()
        out.fftSize = 1024
        out.connect(context.destination)
        outAnalyser.current = out
        playerRef.current = new SpeechPlayer(context, out)
      }
      hearingRef.current = { resampler: new Resampler(context.sampleRate), recording: new VoiceRecording(), detector: new VoiceDetector(), turns: new TurnTaker() }
      const stop = await tap(context, source, outAnalyser.current, (block, coach) => hearRef.current(block, coach))
      if (session.closed) { stop(); return }
      tapRef.current = stop
      stream.getAudioTracks().forEach((track) => { track.onended = micLost })
      listen()
    } catch (problem) {
      if (session.closed) return
      const denied = problem instanceof DOMException && (problem.name === "NotAllowedError" || problem.name === "SecurityError")
      setError(denied ? "Microphone access was blocked. Allow the microphone for this site and try again." : problem instanceof Error ? problem.message : "Couldn't start the microphone.")
      retryRef.current = () => { go("connecting"); void connect(sessionRef.current) }
      go("error")
    }
  }

  // ---------------------------------------------------------------- start, end
  useEffect(() => {
    aliveRef.current = true
    const session = { closed: false }
    sessionRef.current = session
    void connect(session)
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    // An audio context the browser suspended (another app took the audio, or the page was hidden) resumes when the
    // athlete is back.
    const wake = () => {
      const context = contextRef.current
      if (context && context.state !== "running" && context.state !== "closed") void context.resume().catch(() => undefined)
    }
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("pointerdown", wake)
    return () => {
      session.closed = true
      aliveRef.current = false
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", wake)
      window.removeEventListener("pointerdown", wake)
      stopReply("interrupted")
      dropGuess()
      release()
      void contextRef.current?.close()
      contextRef.current = null
      outAnalyser.current = null
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- orb, captions, one frame loop
  useEffect(() => {
    let frame = 0
    let smooth = 0
    let time = 0
    let last = performance.now()
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const buffer = new Float32Array(1024)
    const level = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
      return Math.sqrt(sum / buffer.length)
    }
    const draw = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const current = phaseRef.current
      const raw = current === "speaking" ? level(outAnalyser.current) : current === "listening" ? level(micAnalyser.current) : 0
      // An audio context the browser keeps suspended hears nothing: the athlete is asked to tap (which resumes it).
      const context = contextRef.current
      const stalled = !!context && context.state !== "running" && context.state !== "closed" && current !== "connecting" && current !== "error"
      if (stalled !== stalledRef.current) { stalledRef.current = stalled; setStalled(stalled) }
      // Captions follow the coach's voice.
      if ((current === "speaking" || current === "thinking") && playerRef.current) {
        const spoken = Math.min(captionRef.current.length, playerRef.current.spoken())
        if (spoken > revealedRef.current) { revealedRef.current = spoken; setRevealed(spoken) }
      }
      const target = current === "thinking" || current === "transcribing" ? 0.18 : Math.min(1, raw * 7)
      smooth += (target - smooth) * (target > smooth ? 0.35 : 0.08)
      const athlete = current === "listening" ? Math.min(1, raw * 7) : 0
      sceneLevel.current += (athlete - sceneLevel.current) * (athlete > sceneLevel.current ? 0.35 : 0.08)
      time +=(dt / 1000) * (current === "thinking" || current === "transcribing" ? 2.2 : 1) * (reduced ? 0.25 : 1)
      paint(canvasRef.current, time, smooth, current, current === "listening" || current === "muted" ? LISTEN_TONE : tone)
      document.documentElement.style.setProperty("--cv-level", smooth.toFixed(3))
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); document.documentElement.style.removeProperty("--cv-level") }
  }, [tone])

  // ---------------------------------------------------------------- controls
  const interrupt = () => {
    if (performance.now() - sentAt.current < SWAP_GUARD_MS) return
    if (phaseRef.current === "speaking" || phaseRef.current === "thinking") listen()
  }
  /** Ends the athlete's turn now: what they've said, or (if nothing was noticed) the last few seconds heard. */
  const sendNow = () => {
    const hearing = hearingRef.current
    if (phaseRef.current !== "listening" || !hearing) return
    const range = hearing.turns.finish(hearing.recording.seconds)
    void respond(turnRef.current?.from ?? range.from, range.to, true)
  }
  const toggleMute = () => {
    if (phaseRef.current === "muted") { streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = true }); listen(); return }
    if (phaseRef.current === "listening") {
      dropGuess()
      streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false })
      go("muted")
    }
  }
  const retry = () => {
    setError(null)
    const again = retryRef.current
    retryRef.current = null
    if (again) again()
    else if (streamRef.current) listen()
    else onClose()
  }
  const end = () => {
    // Once only: a second press (or Esc) while the call is closing shouldn't chime again.
    if (!aliveRef.current) return
    playHangUpSound()
    aliveRef.current = false
    stopReply("interrupted")
    dropGuess()
    setClosing(true)
    window.setTimeout(onClose, 420)
  }
  const keys = useRef<(event: KeyboardEvent) => void>(() => {})
  keys.current = (event) => {
    // Esc closes the scene picker first; with it closed, Esc ends the call.
    if (event.key === "Escape") { if (scenesOpenRef.current) setScenesOpen(false); else end() }
    if (event.key === " " && event.target === document.body) { event.preventDefault(); if (phaseRef.current === "listening") sendNow(); else interrupt() }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // The call opens on the athlete's turn. Until they've said something, a "You speak first" cue replaces the label.
  const yourTurn = phase === "listening" && !userCaption
  const waiting = yourTurn && !heard
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => setOpener((value) => value + 1), OPENER_MS)
    return () => window.clearInterval(timer)
  }, [waiting])

  if (typeof document === "undefined") return null
  const first = coachName.replace(/^Coach\s+/i, "")
  const examples = openers(first)
  const label = {
    connecting: `Connecting to ${coachName}…`, listening: heard ? "Listening…" : "Go ahead, I'm listening", transcribing: "Got it…",
    thinking: `${first} is thinking`, speaking: `${first} is speaking`, muted: "Microphone muted", error: "Conversation paused",
  }[phase]
  const words = coachCaption.slice(0, revealed)
  const notice = stalled ? "Tap anywhere so I can hear you." : hint
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Voice conversation with ${coachName}`} data-phase={phase}
      className={cn("cv-root fixed inset-0 z-[100] flex flex-col overflow-hidden text-white", closing && "cv-closing")}
      style={{ "--cv-x": `${origin?.x ?? window.innerWidth / 2}px`, "--cv-y": `${origin?.y ?? window.innerHeight / 2}px`, "--cv-a": tone[0], "--cv-b": tone[1] } as CSSProperties}>
      <div aria-hidden className={cn("cv-backdrop absolute inset-0", drawnScene(settled) && settled === scene && "vs-covered")}>
        <span className="cv-aurora cv-aurora-a" />
        <span className="cv-aurora cv-aurora-b" />
        <span className="cv-stars absolute inset-0" />
      </div>
      {scenesAvailable && (
        <CallScene scene={scene} origin={sceneFrom} tone={tone} level={sceneLevel} phase={scenePhase} warm={scenesOpen} onSettled={setSettled}
          onUnavailable={() => { setScenesAvailable(false); setScene(DEFAULT_SCENE); setSettled(DEFAULT_SCENE) }}
          onFailed={(_, previous) => { setScene(previous); setSettled(previous) }} />
      )}
      {titled > 0 && !closing && <SceneTitle key={titled} scene={scene} />}

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
        <div className="flex shrink-0 items-center gap-2">
          {scenesAvailable && (
            <button ref={sceneButtonRef} type="button" onClick={() => setScenesOpen((value) => !value)} aria-haspopup="dialog" aria-expanded={scenesOpen}
              aria-label={`Scene: ${sceneById(scene).name}. Change the scene`}
              className={cn("vs-trigger flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] p-1 text-xs text-slate-300 backdrop-blur transition-colors hover:bg-white/10 hover:text-white sm:pr-3",
                scenesOpen && "border-white/25 bg-white/[0.12] text-white")}>
              <span aria-hidden className="vs-trigger-dot h-6 w-6 shrink-0 rounded-full" style={{ background: sceneById(scene).swatch }} />
              <span className="hidden sm:inline">Scene</span>
            </button>
          )}
          <button type="button" onClick={() => setCaptions((value) => !value)} aria-pressed={captions}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300 backdrop-blur transition-colors hover:bg-white/10 hover:text-white">
            {captions ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
            <span className="hidden sm:inline">Captions</span>
          </button>
        </div>
      </header>

      {/* The session the coach just gave: adding it ends the call and opens it in the chat. */}
      {planOffer && !closing && (
        <div className="pointer-events-none absolute inset-x-0 top-[72px] z-20 flex justify-center px-4 sm:top-[80px]">
          <button key={planOffer.id} type="button" onClick={() => { onAddPlan?.(); end() }} title="Ends the call and opens the session to add"
            className="cp-pill group pointer-events-auto relative inline-flex max-w-full items-center gap-2.5 overflow-hidden rounded-full py-1.5 pl-1.5 pr-4 text-left text-white">
            <span aria-hidden className="cp-cta-sheen" />
            <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-200 to-violet-300 text-slate-950">
              <CalendarPlus className="h-4 w-4" />
            </span>
            <span className="relative min-w-0 leading-tight">
              <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/85">{planOffer.label}</span>
              <span className="block truncate text-sm font-semibold">Add to training<span className="font-normal text-slate-300"> · ends call</span></span>
            </span>
            <ArrowRight className="relative h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      )}

      {/* Orb */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4">
        <button type="button" onClick={interrupt} aria-label={phase === "speaking" ? "Interrupt the coach" : coachName}
          className={cn("cv-orb relative mt-6 w-[min(80vw,400px,44vh)] shrink-0 outline-none [aspect-ratio:180/182] sm:mt-10", (phase === "speaking" || phase === "thinking") && "cursor-pointer", yourTurn && "cv-orb-small")}>
          {/* The orb glows behind the coach's head and moves with the voice */}
          <span aria-hidden className="absolute left-1/2 top-[-8%] aspect-square w-[80%] -translate-x-1/2">
            {[0, 1, 2].map((ring) => <span key={ring} className="cv-ring absolute inset-[14%] rounded-full" style={{ "--r": ring } as CSSProperties} />)}
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          </span>
          <CoachLiveAvatar coach={coach} phaseRef={phaseRef} speech={outAnalyser} mic={micAnalyser} className="cv-avatar relative h-full w-full" />
        </button>

        {yourTurn ? (
          <div className={cn("cv-turn relative mt-6 w-full max-w-md rounded-3xl px-5 py-5 text-center sm:px-7 [@media(max-height:760px)]:mt-4 [@media(max-height:760px)]:py-4", heard && "cv-turn-heard")}>
            <span aria-hidden className="cv-turn-ring" />
            <span aria-hidden className="cv-turn-tail" />
            <div className="relative flex flex-col items-center">
              <span aria-hidden className="cv-turn-mic relative grid h-14 w-14 place-items-center rounded-full [@media(max-height:760px)]:h-11 [@media(max-height:760px)]:w-11">
                {[0, 1, 2].map((wave) => <span key={wave} className="cv-turn-wave" style={{ "--w": wave } as CSSProperties} />)}
                <Mic className="relative h-6 w-6 [@media(max-height:760px)]:h-5 [@media(max-height:760px)]:w-5" />
              </span>
              <p className={cn("mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] [@media(max-height:760px)]:mt-2", heard ? "text-emerald-200/90" : "text-cyan-200/90")}>
                {heard ? "Your mic is picking you up" : "Your turn"}
              </p>
              <p key={heard ? "heard" : "waiting"} role="status" aria-live="polite"
                className="cv-turn-title mt-1 text-2xl font-semibold tracking-tight sm:text-3xl [@media(max-height:760px)]:text-xl">
                {heard ? "I can hear you" : "You speak first"}
              </p>
              <p aria-live="polite" className="mt-1.5 max-w-xs text-sm leading-6 text-slate-300">
                {heard ? `Keep going. Pause when you're done and ${first} will answer.` : notice ?? `${first} is listening and waiting for you. Say hello or ask a question to start.`}
              </p>
              {heard ? (
                <div aria-hidden className="mt-3 flex h-7 items-center gap-1 [@media(max-height:760px)]:hidden">
                  {Array.from({ length: 13 }, (_, index) => <span key={index} className="cv-bar w-1 rounded-full bg-emerald-200" style={{ "--i": index } as CSSProperties} />)}
                </div>
              ) : (
                <p className="mt-3 flex h-7 max-w-full items-center justify-center text-sm text-slate-400 [@media(max-height:760px)]:hidden">
                  <span className="mr-1.5 shrink-0 text-slate-500">Try</span>
                  <span key={opener} className="cv-turn-example min-w-0 truncate italic text-white/85">“{examples[opener % examples.length]}”</span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
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
            <p aria-live="polite" className={cn("mt-3 min-h-5 text-center text-xs", stalled || (notice && phase === "listening") ? "text-amber-200/90" : "text-slate-500")}>
              {stalled ? notice : phase === "connecting" ? "You'll speak first once the call connects." : phase === "listening" ? notice ?? "Pause when you're done and I'll answer. Space to send now." : phase === "speaking" ? "Tap the coach or press Space to interrupt." : phase === "muted" ? "Unmute when you're ready to talk." : ""}
            </p>
          </>
        )}

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
          <ControlButton label="Send now" onClick={sendNow} disabled={phase !== "listening"}><Send className="h-6 w-6" /></ControlButton>
        )}
      </footer>
      <p className="relative z-10 pb-4 text-center text-[11px] text-slate-600">AI-generated coach voice · Your speech is sent to OpenAI for transcription</p>

      {scenesAvailable && !closing && (
        <ScenePicker open={scenesOpen} place="call" current={scene} tone={tone} coachFirstName={first} returnFocus={sceneButtonRef}
          onPick={(next, from) => { setScene(next); setSceneFrom(from); saveScene(next); setTitled((count) => count + 1) }}
          onClose={() => setScenesOpen(false)} />
      )}
    </div>,
    document.body,
  )
}

/**
 * Hands the microphone to `hear` in 20 ms blocks, each with the coach's voice (`coach`, what's going to the speakers)
 * from the same moment: the two go in side by side as one input's channels, so they stay together however late the
 * page gets them. From the audio thread (an AudioWorklet), so listening carries on in a background tab; where there is
 * none, from a ScriptProcessor on the page. Returns what stops it.
 */
async function tap(context: AudioContext, mic: AudioNode, coach: AudioNode | null, hear: (block: Float32Array, coach: Float32Array | null) => void): Promise<() => void> {
  const both = context.createChannelMerger(2)
  mic.connect(both, 0, 0)
  coach?.connect(both, 0, 1)
  // A node only runs when its output leads somewhere: into silence here.
  const silent = context.createGain()
  silent.gain.value = 0
  silent.connect(context.destination)
  const options = { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "discrete" } as const
  let node: AudioWorkletNode | ScriptProcessorNode
  try {
    await context.audioWorklet.addModule("/coach-voice-worklet.js")
    const worklet = new AudioWorkletNode(context, "coach-mic-tap", { numberOfInputs: 1, numberOfOutputs: 1, ...options })
    worklet.port.onmessage = (event: MessageEvent<{ mic: Float32Array; coach: Float32Array }>) => hear(event.data.mic, event.data.coach)
    node = worklet
  } catch {
    const processor = context.createScriptProcessor(1024, 2, 1)
    Object.assign(processor, options)
    processor.onaudioprocess = (event) => hear(event.inputBuffer.getChannelData(0).slice(), event.inputBuffer.getChannelData(1).slice())
    node = processor
  }
  both.connect(node)
  node.connect(silent)
  return () => {
    if (node instanceof ScriptProcessorNode) node.onaudioprocess = null
    else node.port.onmessage = null
    for (const [from, to] of [[mic, both], [coach, both], [both, node], [node, silent], [silent, context.destination]] as const) {
      try { from?.disconnect(to) } catch { /* not connected */ }
    }
  }
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
