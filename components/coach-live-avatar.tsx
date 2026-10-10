"use client"

import { useEffect, useId, useRef, type CSSProperties } from "react"
import { BeardShape, FACE, Glasses, HairShape, LOOKS, MOUSTACHE, Outfit, PropShape, coachLookKey, type Look } from "@/components/coach-avatar"
import { HAND_SHAPES, Hand, HandDefs, mix, type HandShape } from "@/components/coach-hands"
import { cn } from "@/lib/utils"

/*
 * The coach as a living half-body character for voice conversations, drawn from the same look as their profile
 * picture (skin, hair, beard, glasses, outfit, whistle/stopwatch/headphones) so it is recognisably the same coach.
 *
 * Everything moves from one animation frame loop that writes SVG attributes directly (no React renders per frame).
 * The coach's voice is read as a performance: its loudness drives the jaw and its spectrum shapes the lips ("oo" vs
 * "ee/s"); syllable onsets land head nods and hand beats; pauses split it into phrases, and each phrase picks a new
 * gesture, head direction and expression. Arms move on springs, so they overshoot and settle like real limbs.
 * Listening, thinking and trouble each have their own body language, and the coach waves when the call connects.
 */

type Mood = "idle" | "listening" | "thinking" | "speaking" | "concerned"
const moodOf = (phase: string): Mood =>
  phase === "speaking" ? "speaking" : phase === "listening" || phase === "muted" ? "listening" : phase === "thinking" || phase === "transcribing" ? "thinking" : phase === "error" ? "concerned" : "idle"

/**
 * a1: shoulder (+ swings the arm out), a2: elbow (- brings the hand up and in), wrist: hand tilt, in degrees.
 * reach: how long the forearm looks. Gesturing, it points partly at the viewer and is foreshortened; folded across
 * the body it lies flat to the viewer and shows its full length.
 */
type Pose = { a1: number; a2: number; wrist: number; hand: HandShape; reach?: number }
/** A forearm at least this long (see `reach`) lies across the body: the arms are folded. */
const FOLDED_REACH = 2.4
const POSES = {
  rest: { a1: 3, a2: -8, wrist: 0, hand: "relaxed" },
  // Engaged but not gesturing: hands lifted a little in front, elbows bent.
  ready: { a1: 8, a2: -40, wrist: -14, hand: "relaxed" },
  // Arms folded, elbows drawn in. The viewer's-right forearm lies in front, rising across the body until its hand
  // slips under the other upper arm; the other forearm runs level beneath it, its hand hidden behind that elbow.
  crossUnder: { a1: -22, a2: -70, wrist: 0, hand: "flat", reach: 2.45 },
  crossOver: { a1: -22, a2: -82, wrist: -4, hand: "fist", reach: 2.8 },
  explain: { a1: 12, a2: -114, wrist: -22, hand: "open" },
  present: { a1: 26, a2: -96, wrist: -40, hand: "open" },
  point: { a1: 6, a2: -130, wrist: -6, hand: "point" },
  chest: { a1: -6, a2: -128, wrist: 16, hand: "flat" },
  shrug: { a1: 30, a2: -66, wrist: -52, hand: "open" },
  wave: { a1: 40, a2: 138, wrist: 0, hand: "wave" },
} satisfies Record<string, Pose>
type PoseName = keyof typeof POSES
/** Gestures for a spoken phrase: [viewer's left arm, viewer's right arm], weighted. */
const PHRASE_GESTURES: [number, [PoseName, PoseName]][] = [
  [0.22, ["ready", "explain"]], [0.13, ["explain", "ready"]], [0.17, ["present", "present"]], [0.12, ["ready", "point"]],
  [0.09, ["chest", "ready"]], [0.08, ["ready", "chest"]], [0.1, ["ready", "ready"]], [0.05, ["explain", "explain"]],
]

const EYES = [50, 70] as const
const EYE_Y = 53.8
const MOUTH_Y = 71
const LONG_SLEEVES = new Set(["quarterzip", "jacket", "hoodie"])

const almond = (cx: number) => `M${cx - 5.6} 54 C ${cx - 3.6} 50.6, ${cx + 3.6} 50.6, ${cx + 5.6} 54 C ${cx + 3.6} 56.6, ${cx - 3.6} 56.6, ${cx - 5.6} 54 Z`
/** Closed lips: `smile` from -0.6 (frown) to 1.2 (beaming); the corners lift as it grows. */
const closedMouth = (width: number, smile: number) => {
  const corner = MOUTH_Y - Math.max(0, smile) * 0.7 + Math.max(0, -smile) * 0.9
  return `M${60 - width} ${corner} C ${60 - width * 0.53} ${MOUTH_Y + 2.8 * smile}, ${60 + width * 0.53} ${MOUTH_Y + 2.8 * smile}, ${60 + width} ${corner}`
}
const openMouth = (width: number, open: number, smile: number) => {
  const corner = MOUTH_Y - Math.max(0, smile) * 0.9
  const top = MOUTH_Y - 1.1 - open * 0.14
  const bottom = MOUTH_Y + 0.9 + open * 1.25 + Math.max(0, smile) * 0.9
  return `M${60 - width} ${corner} C ${60 - width * 0.55} ${top}, ${60 + width * 0.55} ${top}, ${60 + width} ${corner} `
    + `C ${60 + width * 0.62} ${bottom}, ${60 - width * 0.62} ${bottom}, ${60 - width} ${corner} Z`
}

/**
 * The forearm from the elbow (9, 146) to the wrist: `extra` longer than at rest, and `bulk` (0 to 1) fuller through
 * the muscle below the elbow, as a forearm seen at full length is. Returns the outline and its two long sides.
 */
const forearm = (extra: number, bulk: number) => {
  const x = (value: number, out: number) => (value + out * bulk).toFixed(2)
  const y = (value: number, share: number) => (value + extra * share).toFixed(2)
  const left = `M${x(1, -1.2)} 145 C ${x(0.8, -2)} ${y(154, 0.3)}, ${x(2.7, -1)} ${y(162, 0.68)}, ${x(4.4, -0.3)} ${y(168.8, 1)}`
  const right = `${x(14.6, 0.3)} ${y(168.8, 1)} C ${x(16.3, 1)} ${y(162, 0.68)}, ${x(17.6, 2)} ${y(154, 0.3)}, ${x(17, 1.2)} 145`
  return { outline: `${left} L ${right} Z`, sides: `${left} M${right}` }
}
/** How far each copy of a folded forearm's outline sits below it, building a shadow that fades away from the arm. */
const SHADOW_STEPS = [0.55, 1.1, 1.65, 2.2, 2.75]
/** The upper arm in a long sleeve, and its inner side (the one against the body). */
const UPPER_ARM = "M1.5 110 C 2 103, 7 99.5, 14 100 C 21 100.5, 22.6 111, 21.6 128 C 20.8 136, 18.8 142, 17 147 L 1 147 C -0.6 135, -0.2 121, 1.5 110 Z"
const UPPER_ARM_INSIDE = "M22.5 112 C 22.6 118, 22.2 123, 21.6 128 C 20.8 136, 18.8 142, 17 147"

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const smooth = (t: number) => t * t * (3 - 2 * t)
/** Frame-rate independent approach of `current` toward `target`. */
const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))
const between = (min: number, max: number) => min + Math.random() * (max - min)
type Spring = { x: number; v: number }
const spring = (x = 0): Spring => ({ x, v: 0 })
/** A damped spring toward `target`: limbs overshoot a little and settle. */
const springTo = (value: Spring, target: number, dt: number, stiffness = 55, damping = 11) => {
  value.v += (stiffness * (target - value.x) - damping * value.v) * dt
  value.x += value.v * dt
  return value.x
}
const pick = <T,>(options: [number, T][]) => {
  let roll = Math.random() * options.reduce((sum, [weight]) => sum + weight, 0)
  for (const [weight, option] of options) { roll -= weight; if (roll <= 0) return option }
  return options[options.length - 1][1]
}

type Refs = {
  body: SVGGElement | null; head: SVGGElement | null; jaw: SVGGElement | null
  features: SVGGElement | null; glasses: SVGGElement | null; nose: SVGGElement | null; ears: SVGGElement | null; hair: SVGGElement | null; cheeks: SVGGElement | null
  eyes: (SVGGElement | null)[]; irises: (SVGGElement | null)[]; brows: (SVGPathElement | null)[]
  closed: SVGPathElement | null; open: SVGGElement | null; cavity: SVGPathElement | null; cavityClip: SVGPathElement | null; lips: SVGPathElement | null
  arms: (SVGGElement | null)[]; armFronts: (SVGGElement | null)[]; forearms: (SVGGElement | null)[]; wrists: (SVGGElement | null)[]
  hands: Record<HandShape, (SVGGElement | null)[]>
  // Folded arms: forearm outlines, elbows and shadows, sleeve cuffs, the upper arms brought in front of the body, and
  // the part of the viewer's-left upper arm that the front hand slips under (with its clip at the elbow crease).
  forearmShapes: (SVGPathElement | null)[]; forearmSides: (SVGPathElement | null)[]; forearmShadows: (SVGGElement | null)[]
  elbows: (SVGCircleElement | null)[]; cuffs: (SVGGElement | null)[]; armOvers: (SVGGElement | null)[]
  tuck: SVGGElement | null; tuckClip: SVGRectElement | null
}

export function CoachLiveAvatar({ coach, phaseRef, speech, mic, className, style }: {
  coach: string
  /** The conversation's phase ("listening", "thinking", "speaking"…), read every frame. */
  phaseRef: { readonly current: string }
  /** The coach's voice and the athlete's microphone, for lip-sync and listening nods. */
  speech: { readonly current: AnalyserNode | null }
  mic: { readonly current: AnalyserNode | null }
  className?: string
  style?: CSSProperties
}) {
  const raw = useId()
  const id = `la${raw.replace(/[^a-zA-Z0-9]/g, "")}`
  const look: Look = LOOKS[coachLookKey(coach)] ?? LOOKS.brad
  const refs = useRef<Refs>({
    body: null, head: null, jaw: null, features: null, glasses: null, nose: null, ears: null, hair: null, cheeks: null,
    eyes: [], irises: [], brows: [], closed: null, open: null, cavity: null, cavityClip: null, lips: null,
    arms: [], armFronts: [], forearms: [], wrists: [], hands: Object.fromEntries(HAND_SHAPES.map((shape) => [shape, []])) as unknown as Refs["hands"],
    forearmShapes: [], forearmSides: [], forearmShadows: [], elbows: [], cuffs: [], armOvers: [], tuck: null, tuckClip: null,
  })

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const motion = reduced ? 0.3 : 1
    const buffers = new Map<AnalyserNode, { wave: Float32Array<ArrayBuffer>; bins: Uint8Array<ArrayBuffer> }>()
    const read = (analyser: AnalyserNode | null) => {
      if (!analyser) return null
      let buffer = buffers.get(analyser)
      if (!buffer) { buffer = { wave: new Float32Array(analyser.fftSize), bins: new Uint8Array(analyser.frequencyBinCount) }; buffers.set(analyser, buffer) }
      analyser.getFloatTimeDomainData(buffer.wave)
      let sum = 0
      for (let i = 0; i < buffer.wave.length; i++) sum += buffer.wave[i] * buffer.wave[i]
      return { rms: Math.sqrt(sum / buffer.wave.length), analyser, bins: buffer.bins }
    }
    const bands = (signal: NonNullable<ReturnType<typeof read>>) => {
      signal.analyser.getByteFrequencyData(signal.bins)
      const hz = signal.analyser.context.sampleRate / 2 / signal.bins.length
      const energy = (from: number, to: number) => {
        let total = 0
        const start = Math.floor(from / hz), end = Math.min(signal.bins.length, Math.ceil(to / hz))
        for (let i = start; i < end; i++) total += signal.bins[i]
        return total / Math.max(1, end - start)
      }
      const low = energy(120, 650), mid = energy(650, 2200), high = energy(2200, 7000)
      const sum = low + mid + high || 1
      return { low: low / sum, high: high / sum }
    }

    const start = performance.now()
    // Animated state.
    const s = {
      t: 0, last: start, mood: "idle" as Mood, moodSince: start,
      // Voice
      level: 0, peak: 0, open: 0, width: 6.2, syllable: false, silentMs: 0, talkMs: 0,
      // Face
      smile: 0.5, smileKick: spring(), grin: spring(), browKick: spring(), brow: 0, browL: 0, browR: 0, browTilt: 0,
      eyeOpen: 1, blink: 1, nextBlink: start + between(1200, 3000), blinkStart: 0, doubleBlink: false,
      gx: 0, gy: 0, gazeX: 0, gazeY: 0, nextGlance: 0,
      // Head and body
      tilt: 0, turn: 0, headX: 0, headY: 0, tiltTarget: 0, turnTarget: 0, nod: spring(), lean: 0, shrug: 0, bodyTilt: 0,
      // Arms: [viewer's left, viewer's right]
      poses: ["rest", "rest"] as [PoseName, PoseName], poseUntil: 0,
      a1: [spring(3), spring(3)], a2: [spring(-8), spring(-8)], wrist: [spring(), spring()], beat: [spring(), spring()], reach: [spring(1), spring(1)],
      outline: ["", ""],
      hand: [0, 1].map(() => Object.fromEntries(HAND_SHAPES.map((shape) => [shape, shape === "relaxed" ? 1 : 0]))) as Record<HandShape, number>[],
      greeted: false, waveUntil: 0, micWasLoud: false, lastNod: 0, lastPhrase: "",
    }
    const setPoses = (left: PoseName, right: PoseName, until: number) => { s.poses = [left, right]; s.poseUntil = until }
    const flashBrows = (strength = 1) => { s.browKick.v += 24 * strength * motion }
    const nod = (strength = 1) => { s.nod.v += 10 * strength * motion }

    /** A new spoken phrase: a fresh gesture, head direction and, now and then, an eyebrow flash. */
    const phraseStart = (now: number) => {
      if (now > s.poseUntil || Math.random() < 0.55) {
        let gesture = pick(PHRASE_GESTURES)
        if (gesture.join() === s.lastPhrase) gesture = pick(PHRASE_GESTURES)
        s.lastPhrase = gesture.join()
        setPoses(gesture[0], gesture[1], now + between(1800, 3800))
      }
      s.turnTarget = between(-0.55, 0.55)
      s.tiltTarget = between(-3.5, 3.5)
      if (Math.random() < 0.35) flashBrows(0.8)
    }
    /** A stressed syllable: hands beat and the head dips with it. */
    const syllable = (strength: number) => {
      ;[0, 1].forEach((side) => { if (s.poses[side] !== "rest" && s.poses[side] !== "ready") s.beat[side].v -= 150 * strength * motion })
      if (strength > 0.55 && Math.random() < 0.5) nod(0.6 * strength)
    }

    let frame = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - s.last) / 1000)
      s.last = now
      s.t += dt
      const r = refs.current
      const mood = moodOf(phaseRef.current)

      // ------------------------------------------------ what the coach is doing
      if (mood !== s.mood) {
        s.mood = mood
        s.moodSince = now
        s.nextBlink = now + 80
        s.nextGlance = now
        if (mood === "listening" && !s.greeted) {
          // Call connected: a wave, a grin and raised brows.
          s.greeted = true
          s.waveUntil = now + 2200
          setPoses("rest", "wave", s.waveUntil)
          s.grin.v += 6
          flashBrows(1.3)
        } else if (mood === "listening") { setPoses("crossUnder", "crossOver", now + 60_000); s.smileKick.v += 3 }
        else if (mood === "thinking") { setPoses("crossUnder", "crossOver", now + 60_000); s.turnTarget = -0.7; s.tiltTarget = -5 }
        else if (mood === "concerned") { setPoses("shrug", "shrug", now + 60_000); s.turnTarget = 0.2; s.tiltTarget = 4 }
        else if (mood === "speaking") { s.silentMs = 999; s.poseUntil = 0 }
        else setPoses("rest", "rest", now)
      }
      if (mood === "listening" && now > s.poseUntil && now > s.waveUntil) setPoses("crossUnder", "crossOver", now + 60_000)
      if (mood === "listening" && now > s.waveUntil) { s.turnTarget = 0; s.tiltTarget = 4 }
      if (mood === "idle") { s.turnTarget = Math.sin(s.t * 0.3) * 0.3; s.tiltTarget = 0 }

      // ------------------------------------------------ the voice: jaw, lips, syllables, phrases
      let open = 0, round = 0, wide = 0
      const voice = mood === "speaking" ? read(speech.current) : null
      if (voice) {
        const level = clamp((voice.rms - 0.008) * 9)
        s.level = ease(s.level, level, level > s.level ? 30 : 9, dt)
        s.peak = Math.max(s.peak * Math.exp(-3 * dt), level)
        if (s.level > 0.06) {
          const shape = bands(voice)
          round = clamp((shape.low - 0.45) * 3)
          wide = clamp((shape.high - 0.12) * 4)
        }
        open = clamp(s.level * (1.05 + 0.18 * Math.sin(s.t * 23) + 0.12 * Math.sin(s.t * 37)))
        if (s.level > 0.1) {
          if (s.silentMs > 260) phraseStart(now)
          s.silentMs = 0
          s.talkMs += dt * 1000
        } else {
          if (s.silentMs < 300 && s.silentMs + dt * 1000 >= 300 && Math.random() < 0.35) s.smileKick.v += 4 // a warm beat at the end of a phrase
          s.silentMs += dt * 1000
        }
        if (s.level > 0.3 && !s.syllable) { s.syllable = true; syllable(s.level) }
        else if (s.level < 0.16) s.syllable = false
        // Between sentences the hands drift back down.
        if (s.silentMs > 1100 && now > s.poseUntil) setPoses("ready", "ready", now + 400)
      } else {
        s.level = ease(s.level, 0, 10, dt)
      }

      // Listening: nod when the athlete pauses after speaking.
      if (mood === "listening") {
        const heard = read(mic.current)
        const loud = (heard?.rms ?? 0) > 0.03
        if (s.micWasLoud && !loud && now - s.lastNod > 1500 && Math.random() < 0.65) { nod(1); s.lastNod = now; if (Math.random() < 0.4) s.smileKick.v += 3 }
        s.micWasLoud = loud
      }

      // ------------------------------------------------ mouth
      const grin = springTo(s.grin, 0, dt, 9, 6)
      const targetOpen = mood === "speaking" ? open * 5.4 : clamp(grin) * 1.6
      s.open = ease(s.open, targetOpen, targetOpen > s.open ? 28 : 16, dt)
      const pursed = mood === "thinking" ? 1 : 0
      s.width = ease(s.width, pursed ? 4.4 : 6.1 + wide * 1.6 - round * 1.9 - (s.open > 3 ? 0.4 : 0) + clamp(grin) * 1.2, 14, dt)
      const baseSmile = mood === "concerned" ? -0.35 : mood === "thinking" ? 0.12 : mood === "listening" ? 0.62 : mood === "speaking" ? 0.42 : 0.55
      const smileKick = springTo(s.smileKick, 0, dt, 10, 6)
      s.smile = ease(s.smile, clamp(baseSmile + smileKick * 0.12 + clamp(grin) * 0.6, -0.6, 1.2), 5, dt)
      const happy = clamp((s.smile - 0.7) / 0.5)

      // ------------------------------------------------ head
      const nodAmount = springTo(s.nod, 0, dt, 70, 9)
      s.turn = ease(s.turn, s.turnTarget * motion, 3.2, dt)
      const sway = (Math.sin(s.t * 0.55) * 1.2 + Math.sin(s.t * 1.27) * 0.5) * motion
      s.tilt = ease(s.tilt, s.tiltTarget * motion + sway + (mood === "speaking" ? Math.sin(s.t * 1.9) * 1.4 * s.level * motion : 0), 3.5, dt)
      s.headX = ease(s.headX, Math.sin(s.t * 0.42) * 0.6 * motion, 2.5, dt)
      s.headY = ease(s.headY, (mood === "thinking" ? -0.8 : 0) + s.level * 0.6, 4, dt)

      // ------------------------------------------------ body
      const leanTarget = mood === "listening" ? 1 : mood === "speaking" ? 0.35 + clamp((s.level - 0.4) * 1.5) * 0.6 : 0
      s.lean = ease(s.lean, leanTarget * motion, 2.5, dt)
      s.shrug = ease(s.shrug, mood === "concerned" && now - s.moodSince < 1800 ? 1 : mood === "concerned" ? 0.35 : 0, 5, dt)
      s.bodyTilt = ease(s.bodyTilt, s.turn * 1.6 + (mood === "speaking" ? Math.sin(s.t * 0.8) * 0.8 : 0) * motion, 2, dt)

      // ------------------------------------------------ eyes
      if (now >= s.nextGlance) {
        const shift = Math.abs(s.gazeX)
        if (mood === "thinking") { s.gazeX = between(-1.8, -0.7); s.gazeY = between(-1.3, -0.7); s.nextGlance = now + between(900, 2200) }
        else if (mood === "listening") { s.gazeX = between(-0.35, 0.35); s.gazeY = between(-0.15, 0.2); s.nextGlance = now + between(700, 2000) }
        else if (mood === "speaking") {
          // Mostly eye contact, with glances away while forming a thought.
          const away = Math.random() < 0.2
          s.gazeX = away ? between(-1.5, 1.5) : between(-0.4, 0.4); s.gazeY = away ? between(-0.9, 0.3) : between(-0.2, 0.2)
          s.nextGlance = now + (away ? between(350, 700) : between(800, 2200))
        } else { s.gazeX = between(-1.1, 1.1); s.gazeY = between(-0.5, 0.4); s.nextGlance = now + between(1000, 3200) }
        // Big eye movements come with a blink, as they do in people.
        if (Math.abs(s.gazeX - shift) > 1 && !s.blinkStart && Math.random() < 0.5) s.nextBlink = now
      }
      s.gx = ease(s.gx, s.gazeX + s.turn * 0.6, 22, dt)
      s.gy = ease(s.gy, s.gazeY, 22, dt)
      if (now >= s.nextBlink && !s.blinkStart) s.blinkStart = now
      if (s.blinkStart) {
        const p = (now - s.blinkStart) / 150
        s.blink = p < 0.4 ? 1 - (p / 0.4) * 0.92 : p < 1 ? 0.08 + ((p - 0.4) / 0.6) * 0.92 : 1
        if (p >= 1) {
          s.blinkStart = 0
          s.doubleBlink = !s.doubleBlink && Math.random() < 0.18
          s.nextBlink = now + (s.doubleBlink ? 120 : between(2200, 5600))
        }
      }
      const emphasis = mood === "speaking" ? clamp((s.level - 0.35) * 1.8) : 0
      // Wider on emphasis, narrower when smiling broadly or attentive.
      s.eyeOpen = ease(s.eyeOpen, 1 + emphasis * 0.12 - happy * 0.28 - (mood === "listening" ? 0.06 : 0) + (mood === "concerned" ? 0.05 : 0), 10, dt)

      // ------------------------------------------------ brows
      const browKick = springTo(s.browKick, 0, dt, 40, 9)
      s.brow = ease(s.brow, (mood === "listening" ? 0.5 : mood === "concerned" ? 0.4 : 0) + emphasis * 1.2, 8, dt)
      s.browL = ease(s.browL, mood === "thinking" ? 1.6 : mood === "concerned" ? 0.7 : 0, 4, dt)
      s.browR = ease(s.browR, mood === "thinking" ? 0.1 : mood === "concerned" ? 0.7 : 0, 4, dt)
      // Positive tilt raises the inner ends (worry); negative lowers them (focus).
      s.browTilt = ease(s.browTilt, mood === "concerned" ? 7 : mood === "thinking" ? -2 : mood === "speaking" && s.level > 0.75 ? -2.5 : 0, 6, dt)

      // ------------------------------------------------ write the frame
      const breath = Math.sin(s.t * (mood === "speaking" ? 1.6 : 1.15)) * 0.7 * motion
      const leanScale = 1 + s.lean * 0.018
      r.body?.setAttribute("transform",
        `translate(0 ${(s.lean * 1.2 - breath).toFixed(2)}) rotate(${s.bodyTilt.toFixed(2)} 60 182) translate(60 182) scale(${leanScale.toFixed(4)} ${(leanScale + breath * 0.004).toFixed(4)}) translate(-60 -182)`)
      r.head?.setAttribute("transform",
        `translate(${(s.headX + s.turn * 0.9).toFixed(2)} ${(s.headY + nodAmount * 1.2 + s.shrug * 1.4 - breath * 0.4).toFixed(2)}) rotate(${(s.tilt + nodAmount * 0.5).toFixed(2)} 60 86)`)
      // Turning the head: the features slide across the face more than the ears and hair do.
      const featureShift = `translate(${(s.turn * 1.5).toFixed(2)} 0)`
      r.features?.setAttribute("transform", featureShift)
      r.glasses?.setAttribute("transform", featureShift)
      r.nose?.setAttribute("transform", `translate(${(s.turn * 0.8).toFixed(2)} 0)`)
      r.ears?.setAttribute("transform", `translate(${(-s.turn * 0.8).toFixed(2)} 0)`)
      r.hair?.setAttribute("transform", `translate(${(s.turn * 0.5).toFixed(2)} 0)`)
      r.jaw?.setAttribute("transform", `translate(${(s.turn * 0.5).toFixed(2)} ${(s.open * 0.32).toFixed(2)})`)
      r.cheeks?.setAttribute("transform", `translate(0 ${(-happy * 1.2).toFixed(2)})`)
      r.cheeks?.setAttribute("opacity", (0.6 + Math.max(0, s.smile) * 0.7 + happy * 0.6).toFixed(2))
      EYES.forEach((cx, index) => {
        r.eyes[index]?.setAttribute("transform", `translate(0 ${EYE_Y}) scale(1 ${(s.blink * s.eyeOpen).toFixed(3)}) translate(0 ${-EYE_Y})`)
        r.irises[index]?.setAttribute("transform", `translate(${s.gx.toFixed(2)} ${s.gy.toFixed(2)})`)
        const lift = s.brow + browKick * 0.09 + (index === 0 ? s.browL : s.browR)
        const angle = index === 0 ? -s.browTilt : s.browTilt
        r.brows[index]?.setAttribute("transform", `translate(0 ${(-lift).toFixed(2)}) rotate(${angle.toFixed(2)} ${cx} 46)`)
      })
      const openness = clamp((s.open - 0.25) / 0.7)
      r.closed?.setAttribute("d", closedMouth(Math.max(4.2, s.width + 0.3), s.smile))
      r.closed?.setAttribute("opacity", (1 - openness).toFixed(2))
      r.open?.setAttribute("opacity", openness.toFixed(2))
      if (openness > 0) {
        const path = openMouth(s.width, Math.max(0.6, s.open), s.smile * 0.6)
        r.cavity?.setAttribute("d", path)
        r.cavityClip?.setAttribute("d", path)
        r.lips?.setAttribute("d", path)
      }

      // Arms on springs; a beat on stressed syllables; the waving hand wags at the wrist. Folding the arms brings the
      // upper arms in front of the body and lays the forearms across it at full length.
      ;[0, 1].forEach((side) => {
        const pose: Pose = POSES[s.poses[side]]
        const idle = Math.sin(s.t * 0.9 + side * 1.7) * 1.4 * motion
        const a1 = springTo(s.a1[side], pose.a1 + idle, dt)
        const beat = springTo(s.beat[side], 0, dt, 90, 10)
        const a2 = springTo(s.a2[side], pose.a2, dt) + beat * 0.12
        const wag = s.poses[side] === "wave" ? Math.sin(s.t * 10) * 22 : 0
        const wrist = springTo(s.wrist[side], pose.wrist + wag, dt, 70, 10)
        const reach = springTo(s.reach[side], pose.reach ?? 1, dt)
        const extra = 22 * (Math.max(0.7, reach) - 1)
        const bulk = clamp((reach - 1) / (FOLDED_REACH - 1))
        const folded = smooth(bulk).toFixed(3)
        const shoulder = `translate(0 ${(-s.shrug * 3.2).toFixed(2)}) rotate(${a1.toFixed(2)} 12 106)`
        r.arms[side]?.setAttribute("transform", shoulder)
        r.armFronts[side]?.setAttribute("transform", shoulder)
        r.forearms[side]?.setAttribute("transform", `rotate(${a2.toFixed(2)} 9 146)`)
        r.wrists[side]?.setAttribute("transform", `translate(0 ${extra.toFixed(2)}) rotate(${wrist.toFixed(2)} 9.5 168)`)
        r.cuffs[side]?.setAttribute("transform", `translate(0 ${extra.toFixed(2)})`)
        // The forearm's outline only changes while its length does.
        const shape = forearm(extra, bulk)
        const reshaped = shape.outline !== s.outline[side]
        s.outline[side] = shape.outline
        if (reshaped) {
          r.forearmShapes[side]?.setAttribute("d", shape.outline)
          r.forearmSides[side]?.setAttribute("d", shape.sides)
          r.elbows[side]?.setAttribute("r", (8 + 1.2 * bulk).toFixed(2))
        }
        // The forearm's shadow falls straight down the body, whichever way the forearm points: copies of its outline
        // stepped further down, so the shadow is darkest against the forearm and fades away from it.
        const angle = ((a1 + a2) * Math.PI) / 180
        const shadow = r.forearmShadows[side]
        shadow?.setAttribute("opacity", folded)
        if (shadow && bulk > 0) {
          SHADOW_STEPS.forEach((step, index) => {
            if (reshaped) shadow.children[index]?.setAttribute("d", shape.outline)
            shadow.children[index]?.setAttribute("transform", `translate(${(Math.sin(angle) * step).toFixed(2)} ${(Math.cos(angle) * step).toFixed(2)})`)
          })
        }
        r.armOvers[side]?.setAttribute("transform", shoulder)
        r.armOvers[side]?.setAttribute("opacity", folded)
        if (side === 0) {
          // The front hand slips under this arm.
          r.tuck?.setAttribute("transform", shoulder)
          r.tuck?.setAttribute("opacity", folded)
          r.tuckClip?.setAttribute("transform", `rotate(${a2.toFixed(2)} 9 146)`)
        }
        HAND_SHAPES.forEach((shape) => {
          // Swapped, not dissolved: two half-transparent hands would show the body through them.
          s.hand[side][shape] = shape === pose.hand ? 1 : ease(s.hand[side][shape], 0, 30, dt)
          r.hands[shape][side]?.setAttribute("opacity", s.hand[side][shape].toFixed(2))
        })
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phaseRef, speech, mic])

  const [skinLight, skinBase, skinShadow] = look.skin
  const [hairBase, hairLight] = look.hair
  const [shirt, shirtShade] = look.shirt
  const ref = (name: string) => `url(#${id}-${name})`
  const longSleeves = LONG_SLEEVES.has(look.outfit)
  const browColor = look.hairStyle === "receding" ? "#6b6f76" : hairBase
  const set = <K extends Exclude<keyof Refs, "hands">>(key: K) => (element: Refs[K]) => { refs.current[key] = element }
  const setAt = (key: "eyes" | "irises" | "arms" | "armFronts" | "forearms" | "wrists" | "cuffs" | "armOvers" | "forearmShadows", index: number) =>
    (element: SVGGElement | null) => { refs.current[key][index] = element }
  const setPathAt = (key: "forearmShapes" | "forearmSides", index: number) => (element: SVGPathElement | null) => { refs.current[key][index] = element }
  const setHand = (shape: HandShape, side: number) => (element: SVGGElement | null) => { refs.current.hands[shape][side] = element }
  // Sleeve or bare skin, and the soft edge that keeps an arm readable where it crosses the body or the other arm.
  const sleeve = longSleeves ? ref("sleeve") : ref("arm")
  const armEdge = longSleeves ? mix(shirtShade, "#000000", 0.45) : skinShadow

  const upperArmShapes = (sleeveFill: string) => longSleeves ? (
    <path d={UPPER_ARM} fill={sleeveFill} />
  ) : (
    <>
      <path d="M0.8 126 L 21.6 126 C 20.8 134, 18.8 141, 17 147 L 1 147 C 0.3 140, 0.3 133, 0.8 126 Z" fill={ref("arm")} />
      <path d="M1.5 110 C 2 103, 7 99.5, 14 100 C 21 100.5, 22.6 112, 22 128 L 0.7 128 C 0.3 121, 0.6 115, 1.5 110 Z" fill={sleeveFill} />
      <path d="M0.7 128 L 22 128" stroke={look.trim} strokeOpacity="0.8" strokeWidth="1.2" />
    </>
  )
  /** Upper arm, behind the torso: the shoulder of the shirt covers where it joins. */
  const upperArm = (side: number) => <g ref={setAt("arms", side)}>{upperArmShapes(ref("shirt"))}</g>
  // The upper arm as seen in front of the body: its sleeve fades in below the shoulder seam (where the shirt's shoulder
  // covers it) and a soft line marks its inner side against the shirt.
  const frontArm = (
    <>
      {upperArmShapes(ref("front-sleeve"))}
      <path d={UPPER_ARM_INSIDE} fill="none" stroke={ref("front-edge")} strokeWidth="1" strokeLinecap="round" />
    </>
  )
  /** The upper arm brought in front of the body as the arms fold and the elbows come forward. */
  const upperArmFront = (side: number) => <g ref={setAt("armOvers", side)} opacity="0">{frontArm}</g>
  /**
   * The viewer's-left upper arm painted again over the front forearm, so that forearm's hand slips under it. It stops
   * at the crease of the elbow, so the arm's own forearm stays in front, and shades the hand where it goes under.
   */
  const tuckCover = (
    <g ref={(element) => { refs.current.tuck = element }} opacity="0">
      <g clipPath={ref("tuck-clip")}>
        <path d={UPPER_ARM_INSIDE} transform="translate(1.1 0.2)" fill="none" stroke={ref("front-edge")} strokeOpacity="0.4" strokeWidth="2.2" />
        {frontArm}
      </g>
    </g>
  )
  /**
   * Forearm and hand, in front of the torso so gestures can cross the chest. The hand shapes blend into each other;
   * each hand is drawn before the forearm, which narrows to the wrist and covers the joint however the wrist bends.
   * The forearm's outline is rewritten as its length changes, and the sleeve cuff moves with the wrist.
   */
  const lowerArm = (side: number) => (
    <g ref={setAt("armFronts", side)}>
      <g ref={setAt("forearms", side)}>
        <g ref={setAt("forearmShadows", side)} fill="#000" fillOpacity="0.07" opacity="0">
          {SHADOW_STEPS.map((step) => <path key={step} d={forearm(0, 0).outline} />)}
        </g>
        <g ref={setAt("wrists", side)}>
          <g transform="translate(9.5 168)">
            {HAND_SHAPES.map((shape) => (
              <g key={shape} ref={setHand(shape, side)} opacity={shape === "relaxed" ? 1 : 0}>
                <Hand shape={shape} id={id} skin={look.skin} />
              </g>
            ))}
          </g>
        </g>
        <circle ref={(element) => { refs.current.elbows[side] = element }} cx="9" cy="146" r="8" fill={sleeve} />
        <path ref={setPathAt("forearmSides", side)} d={forearm(0, 0).sides} fill="none" stroke={armEdge} strokeOpacity="0.7" strokeWidth="0.8" />
        <path ref={setPathAt("forearmShapes", side)} d={forearm(0, 0).outline} fill={sleeve} />
        {longSleeves && (
          <g ref={setAt("cuffs", side)}>
            <path d="M3.9 164.6 L 15.1 164.6 L 14.6 168.8 L 4.4 168.8 Z" fill={shirtShade} />
            <path d="M3.9 164.6 L 15.1 164.6" stroke={look.trim} strokeOpacity="0.85" strokeWidth="1.1" />
          </g>
        )}
      </g>
    </g>
  )

  return (
    <svg viewBox="-30 -4 180 182" className={cn("block", className)} style={style} role="img" aria-label={`${coach}, animated`}>
      <defs>
        <linearGradient id={`${id}-skin`} x1="0.1" y1="0.15" x2="0.9" y2="0.85">
          <stop offset="0" stopColor={skinLight} /><stop offset="0.55" stopColor={skinBase} /><stop offset="1" stopColor={skinShadow} />
        </linearGradient>
        <linearGradient id={`${id}-neck`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={skinShadow} /><stop offset="1" stopColor={skinBase} /></linearGradient>
        <linearGradient id={`${id}-hair`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={hairLight} /><stop offset="0.45" stopColor={hairBase} /><stop offset="1" stopColor={hairBase} />
        </linearGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hairBase} /><stop offset="0.55" stopColor={hairBase} stopOpacity="0.9" /><stop offset="1" stopColor={hairBase} stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={`${id}-shirt`} x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stopColor={shirt} /><stop offset="1" stopColor={shirtShade} /></linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={look.bg[0]} stopOpacity="0.95" /><stop offset="0.4" stopColor={look.bg[0]} stopOpacity="0" /></linearGradient>
        <linearGradient id={`${id}-torso-light`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
        <HandDefs id={id} skin={look.skin} />
        {/* A sleeve lit across its width like the bare arms, so a forearm still reads as round against the shirt. */}
        <linearGradient id={`${id}-sleeve`} gradientUnits="userSpaceOnUse" x1="0.5" y1="0" x2="18.5" y2="0">
          <stop offset="0" stopColor={mix(shirtShade, "#000000", 0.15)} /><stop offset="0.45" stopColor={shirt} /><stop offset="1" stopColor={mix(shirt, "#ffffff", 0.09)} />
        </linearGradient>
        {/*
          Arms folded. An upper arm in front of the body fades in below the shoulder seam, where the shirt's shoulder
          covers it (the sleeve darkening toward the elbow like the shirt does), with a soft line along its inner side.
        */}
        <linearGradient id={`${id}-front-sleeve`} gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="0" y2="147">
          <stop offset="0.234" stopColor={mix(shirt, shirtShade, 0.23)} stopOpacity="0" />
          <stop offset="0.447" stopColor={mix(shirt, shirtShade, 0.45)} />
          <stop offset="1" stopColor={shirtShade} />
        </linearGradient>
        <linearGradient id={`${id}-front-edge`} gradientUnits="userSpaceOnUse" x1="0" y1="111" x2="0" y2="121">
          <stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.4" />
        </linearGradient>
        {/* The arm the front hand slips under ends at the crease of its elbow: on the upper arm's side of its forearm. */}
        <clipPath id={`${id}-tuck-clip`}>
          <rect ref={(element) => { refs.current.tuckClip = element }} x="18.6" y="-100" width="200" height="400" />
        </clipPath>
        <clipPath id={`${id}-face`}><path d={FACE} /></clipPath>
        {EYES.map((cx) => <clipPath key={cx} id={`${id}-eye-${cx}`}><path d={almond(cx)} /></clipPath>)}
        <clipPath id={`${id}-mouth`}><path ref={set("cavityClip")} d={openMouth(6, 1, 0.3)} /></clipPath>
      </defs>

      <g ref={set("body")}>
        {/* Body */}
        {look.outfit === "hoodie" && <path d="M36 96 C 34 84, 46 79, 60 81 C 74 79, 86 84, 84 96 C 76 91, 44 91, 36 96 Z" fill={shirtShade} />}
        {upperArm(0)}
        <g transform="translate(120 0) scale(-1 1)">{upperArm(1)}</g>
        <path d="M43 90 C 29 91.5, 15 95.5, 9 104 C 6 109, 8.5 118, 17.6 122 C 16.6 140, 17 160, 17.5 182 L 102.5 182 C 103 160, 103.4 140, 102.4 122 C 111.5 118, 114 109, 111 104 C 105 95.5, 91 91.5, 77 90 C 71 89, 66 92, 60 92 C 54 92, 49 89, 43 90 Z" fill={ref("shirt")} />
        <path d="M43 90 C 29 91.5, 15 95.5, 9 104 C 6 109, 8.5 118, 17.6 122 C 16.6 140, 17 160, 17.5 182 L 102.5 182 C 103 160, 103.4 140, 102.4 122 C 111.5 118, 114 109, 111 104 C 105 95.5, 91 91.5, 77 90 C 71 89, 66 92, 60 92 C 54 92, 49 89, 43 90 Z" fill={ref("torso-light")} />
        <path d="M12 106 C 15 100, 21 97, 28 95.5" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M17.6 122 C 18.6 128, 18.4 134, 17.8 140 M102.4 122 C 101.4 128, 101.6 134, 102.2 140" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1.2" strokeLinecap="round" />
        {look.prop === "headphones" && <path d="M40 95 C 39 81, 81 81, 80 95" fill="none" stroke="#0a0a0d" strokeWidth="4" strokeLinecap="round" />}
        <path d="M49 70 L49 90 C 54 95.5, 66 95.5, 71 90 L71 70 Z" fill={ref("neck")} />
        <path d="M49 76 C 54 84, 66 84, 71 76 L71 82.5 C 66 88.5, 54 88.5, 49 82.5 Z" fill={skinShadow} opacity="0.55" />
        <Outfit look={look} />
        <PropShape prop={look.prop} trim={look.trim} />
        {upperArmFront(0)}
        <g transform="translate(120 0) scale(-1 1)">{upperArmFront(1)}</g>
        {lowerArm(0)}
        <g transform="translate(120 0) scale(-1 1)">{lowerArm(1)}</g>
        {tuckCover}

        {/* Head */}
        <g ref={set("head")}>
          <g ref={set("ears")}>
            <path d="M36.8 49.5 C 30.6 47.5, 29.6 58.5, 34 62 C 35.6 63.4, 37.2 62.4, 37.8 60 Z" fill={skinBase} />
            <path d="M35.4 52 C 33.4 52.5, 33.4 57.5, 35.6 59" fill="none" stroke={skinShadow} strokeWidth="1.1" strokeLinecap="round" />
            <path d="M83.2 49.5 C 89.4 47.5, 90.4 58.5, 86 62 C 84.4 63.4, 82.8 62.4, 82.2 60 Z" fill={skinShadow} />
            <path d="M84.6 52 C 86.6 52.5, 86.6 57.5, 84.4 59" fill="none" stroke={skinShadow} strokeOpacity="0.6" strokeWidth="1.1" strokeLinecap="round" />
          </g>

          <path d={FACE} fill={ref("skin")} />
          <g clipPath={ref("face")}>
            <path d="M73 27 C 83 33, 86 46, 85.5 52 C 85 64, 80 74, 70 81.5 C 77 70, 80 58, 79 46 C 78 38, 76 32, 73 27 Z" fill={skinShadow} opacity="0.45" />
            <ellipse cx="51" cy="36" rx="11" ry="5.5" fill="#fff" opacity="0.13" />
            <g ref={set("cheeks")}>
              <ellipse cx="47" cy="63" rx="5" ry="3" fill="#ff7a6b" opacity="0.1" />
              <ellipse cx="73" cy="63" rx="5" ry="3" fill="#ff7a6b" opacity="0.08" />
            </g>
          </g>
          <path d={FACE} fill="none" stroke={ref("rim")} strokeOpacity="0.3" strokeWidth="0.8" />

          {/* The beard rides on the jaw */}
          <g ref={set("jaw")}><BeardShape beard={look.beard} hair={hairBase} /></g>

          {/* Eyes, brows, nose and mouth slide together when the head turns */}
          <g ref={set("features")}>
            {look.lines && (
              <g fill="none" stroke={skinShadow} strokeLinecap="round" opacity="0.5" strokeWidth="0.9">
                <path d="M50 36.5 C 55 35, 65 35, 70 36.5" /><path d="M52 39.5 C 56 38.4, 64 38.4, 68 39.5" />
                <path d="M48.6 63.5 C 46.6 66.5, 47 70, 49.2 72.4" /><path d="M71.4 63.5 C 73.4 66.5, 73 70, 70.8 72.4" />
              </g>
            )}
            {EYES.map((cx, index) => (
              <g key={cx} ref={setAt("eyes", index)}>
                <path d={almond(cx)} fill="#f8f4ef" />
                <g clipPath={ref(`eye-${cx}`)}>
                  <g ref={setAt("irises", index)}>
                    <circle cx={cx + 0.3} cy={EYE_Y} r="2.65" fill={look.iris} />
                    <circle cx={cx + 0.3} cy={EYE_Y} r="1.25" fill="#0b0705" />
                    <circle cx={cx + 1.2} cy="52.9" r="0.85" fill="#fff" />
                  </g>
                </g>
                <path d={`M${cx - 5.8} 53.8 C ${cx - 3.6} 50.2, ${cx + 3.6} 50.2, ${cx + 5.8} 53.8`} fill="none" stroke="#2a1a12" strokeWidth="1.15" strokeLinecap="round" />
              </g>
            ))}
            <path ref={(element) => { refs.current.brows[0] = element }} d="M43.6 47.4 C 46.8 45.2, 51.6 44.9, 55.2 46.4" fill="none" stroke={browColor} strokeWidth="2.5" strokeLinecap="round" />
            <path ref={(element) => { refs.current.brows[1] = element }} d="M64.8 46.4 C 68.4 44.9, 73.2 45.2, 76.4 47.4" fill="none" stroke={browColor} strokeWidth="2.5" strokeLinecap="round" />

            <g ref={set("nose")}>
              <ellipse cx="61.5" cy="62.2" rx="3.4" ry="2" fill={skinShadow} opacity="0.35" />
              <path d="M60.6 54 C 60.2 58.8, 57.6 62.2, 57.9 64 C 59.1 65.3, 61.6 65.3, 63.1 64.3" fill="none" stroke={skinShadow} strokeWidth="1.35" strokeLinecap="round" />
            </g>

            {/* Mouth: closed lips crossfading to an open mouth with teeth and tongue */}
            <path ref={set("closed")} d={closedMouth(6.4, 0.6)} fill="none" stroke={look.lip} strokeWidth="1.8" strokeLinecap="round" />
            <g ref={set("open")} opacity="0">
              <path ref={set("cavity")} d={openMouth(6, 1, 0.3)} fill="#2b0c10" />
              <g clipPath={ref("mouth")}>
                <rect x="50" y={MOUTH_Y - 3.4} width="20" height="3.6" rx="1" fill="#f5f1ea" />
                <ellipse cx="60" cy={MOUTH_Y + 6.4} rx="4.2" ry="2.6" fill="#c4566a" />
              </g>
              <path ref={set("lips")} d={openMouth(6, 1, 0.3)} fill="none" stroke={look.lip} strokeWidth="1.5" strokeLinejoin="round" />
            </g>
            {(look.beard === "full" || look.beard === "boxed" || look.beard === "goatee") && <path d={MOUSTACHE} fill={hairBase} opacity={look.beard === "goatee" ? 0.85 : 0.95} />}
            {look.beard === "stubble" && <path d={MOUSTACHE} fill={hairBase} opacity="0.3" />}
          </g>

          <g ref={set("hair")}><HairShape style={look.hairStyle} fill={ref("hair")} fade={ref("fade")} base={hairBase} light={hairLight} /></g>
          {/* Glasses sit over the hair but move with the eyes */}
          {look.glasses && <g ref={set("glasses")}><Glasses /></g>}
        </g>
      </g>
    </svg>
  )
}
