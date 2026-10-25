/*
 * Hearing the athlete on a voice call (components/coach-conversation.tsx): their microphone brought down to 16 kHz and
 * kept for the last minute, a voice detector that learns the room's noise, and the turn-taking built on it (when they
 * start, pause, carry on and finish speaking). Plain code with no browser APIs, so it also runs offline on recordings.
 */

export const VOICE_RATE = 16_000
const HOP = 320 // one frame: 20 ms
const FRAME_S = HOP / VOICE_RATE

/** A second-order filter (RBJ cookbook), run a sample at a time. */
export class Biquad {
  private z1 = 0
  private z2 = 0
  private readonly b0: number
  private readonly b1: number
  private readonly b2: number
  private readonly a1: number
  private readonly a2: number

  constructor(kind: "lowpass" | "highpass", hz: number, rate: number, q: number) {
    const w = (2 * Math.PI * hz) / rate
    const alpha = Math.sin(w) / (2 * q)
    const cos = Math.cos(w)
    const a0 = 1 + alpha
    const edge = kind === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2
    this.b0 = edge / a0
    this.b1 = (kind === "lowpass" ? 1 - cos : -(1 + cos)) / a0
    this.b2 = edge / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }

  step(x: number) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

/** The microphone at the audio context's rate, as 16 kHz: a 7 kHz low-pass (4th-order Butterworth), then linear
 *  interpolation that carries on seamlessly from one block to the next. */
export class Resampler {
  private readonly step: number
  private readonly filters: Biquad[]
  private position = 0 // where the next output sample falls, in input samples from the start of the next block
  private previous = 0 // the last input sample of the previous block

  constructor(from: number) {
    this.step = from / VOICE_RATE
    this.filters = from > VOICE_RATE ? [0.5412, 1.3066].map((q) => new Biquad("lowpass", 7000, from, q)) : []
  }

  push(input: Float32Array): Float32Array {
    if (!input.length) return new Float32Array(0)
    const x = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) {
      let sample = input[i]
      for (const filter of this.filters) sample = filter.step(sample)
      x[i] = sample
    }
    const out = new Float32Array(Math.ceil((x.length + 1) / this.step) + 1)
    let n = 0
    let t = this.position
    while (t < x.length - 1) {
      const i = Math.floor(t)
      const a = i < 0 ? this.previous : x[i]
      out[n++] = a + (x[i + 1] - a) * (t - i)
      t += this.step
    }
    this.position = t - x.length
    this.previous = x[x.length - 1]
    return out.subarray(0, n)
  }
}

/** The last minute of the microphone at 16 kHz, on the clock of the audio heard (seconds since the call started
 *  listening), from which each turn's audio is cut. */
export class VoiceRecording {
  private readonly ring = new Float32Array(VOICE_RATE * 60)
  private written = 0

  push(samples: Float32Array) {
    for (let i = 0; i < samples.length; i++) this.ring[(this.written + i) % this.ring.length] = samples[i]
    this.written += samples.length
  }

  /** Seconds of audio heard so far: the clock every voice frame and turn is on. */
  get seconds() {
    return this.written / VOICE_RATE
  }

  /** A 16-bit mono WAV file of the audio from `from` to `to` seconds (as much of it as is still kept). */
  wav(from: number, to: number): Uint8Array<ArrayBuffer> {
    const end = Math.min(this.written, Math.round(to * VOICE_RATE))
    const start = Math.max(0, this.written - this.ring.length, Math.round(from * VOICE_RATE))
    const count = Math.max(0, end - start)
    const bytes = new Uint8Array(44 + count * 2)
    const view = new DataView(bytes.buffer)
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i) }
    text(0, "RIFF")
    view.setUint32(4, 36 + count * 2, true)
    text(8, "WAVE")
    text(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, VOICE_RATE, true)
    view.setUint32(28, VOICE_RATE * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, "data")
    view.setUint32(40, count * 2, true)
    for (let i = 0; i < count; i++) {
      const sample = Math.max(-1, Math.min(1, this.ring[(start + i) % this.ring.length]))
      view.setInt16(44 + i * 2, Math.round(sample * 32767), true)
    }
    return bytes
  }
}

/** One 20 ms frame of what the microphone heard. `at` is when it ended (seconds on the recording's clock). */
export type VoiceFrame = {
  at: number
  /** Loudness, dBFS (above 100 Hz, so rumble and hum don't count). */
  db: number
  /** The room's noise floor under it, dBFS. */
  floor: number
  /** Clearly louder than the room: part of speech, or of some other sound. */
  active: boolean
  /** Louder than the room at all: enough to carry on speech that has started (quiet ends of words), not to start it. */
  audible: boolean
  /** Active and periodic, like a vowel: someone talking, not a click, a rustle or a fan. */
  voiced: boolean
  /** Heard while the coach's voice was coming back into the microphone, and no louder than that (see push's gate). */
  gated: boolean
}

const ACTIVE_DB = 6 // this far above the noise floor is a sound, not the room
const AUDIBLE_DB = 3 // and this far, part of a sound already going
const FLOOR_FRAMES = 125 // the noise floor is the quietest moment of the last 2.5 s
const QUIETEST_DB = -75 // digital silence counts as this quiet
const APERIODIC = 0.35 // below this, a frame is periodic (YIN's normalised difference)
const PITCH_WINDOW = 200 // pitch is looked for in 25 ms at 8 kHz,
const PITCH_MIN_LAG = 16 // between 500 Hz
const PITCH_MAX_LAG = 110 // and 73 Hz
const PITCH_SPAN = 320

/**
 * Speech in the microphone, frame by frame. The noise floor is the quietest the room has been over the last few
 * seconds (speech always has gaps, so it follows the room, not the voice), so the detector works for a quiet voice in
 * a quiet room and a loud one by a pool alike. Voicing (YIN's periodicity test) tells a voice from other sounds.
 */
export class VoiceDetector {
  private readonly highPass = new Biquad("highpass", 100, VOICE_RATE, Math.SQRT1_2)
  private readonly frame = new Float32Array(HOP)
  private filled = 0
  private readonly pitch = new Float32Array(PITCH_SPAN)
  private readonly levels = new Float32Array(FLOOR_FRAMES)
  private smooth: number | null = null
  private frames = 0
  floor = QUIETEST_DB

  /**
   * Frames completed by these 16 kHz samples. `gate`: a level (dBFS) a frame must also reach to count as a sound, for
   * while the coach is talking, so their voice coming back through the speakers isn't taken for the athlete's.
   */
  push(samples: Float32Array, gate = -Infinity): VoiceFrame[] {
    const frames: VoiceFrame[] = []
    for (let i = 0; i < samples.length; i++) {
      this.frame[this.filled++] = this.highPass.step(samples[i])
      if (this.filled === HOP) {
        frames.push(this.analyse(gate))
        this.filled = 0
      }
    }
    return frames
  }

  private analyse(gate: number): VoiceFrame {
    let energy = 0
    for (let i = 0; i < HOP; i++) energy += this.frame[i] * this.frame[i]
    const db = 10 * Math.log10(energy / HOP + 1e-12)
    this.smooth = this.smooth === null ? db : this.smooth + (db - this.smooth) * 0.35
    this.levels[this.frames % FLOOR_FRAMES] = this.smooth
    this.frames++
    let quietest = Infinity
    for (let i = 0, n = Math.min(this.frames, FLOOR_FRAMES); i < n; i++) quietest = Math.min(quietest, this.levels[i])
    this.floor = Math.max(QUIETEST_DB, quietest + 1)

    // 8 kHz (averaging pairs) for the pitch search, keeping the last 40 ms.
    this.pitch.copyWithin(0, HOP / 2)
    for (let i = 0; i < HOP / 2; i++) this.pitch[PITCH_SPAN - HOP / 2 + i] = (this.frame[2 * i] + this.frame[2 * i + 1]) / 2
    const gated = db < gate
    const audible = db >= this.floor + AUDIBLE_DB && !gated
    const active = audible && db >= this.floor + ACTIVE_DB
    return { at: (this.frames * HOP) / VOICE_RATE, db, floor: this.floor, active, audible, gated, voiced: active && aperiodicity(this.pitch) < APERIODIC }
  }
}

/** YIN's cumulative mean normalised difference at its lowest over the pitch range: near 0 for a vowel, near 1 for noise. */
function aperiodicity(x: Float32Array) {
  const start = x.length - PITCH_WINDOW - PITCH_MAX_LAG
  let cumulative = 0
  let best = 1
  for (let lag = 1; lag <= PITCH_MAX_LAG; lag++) {
    let difference = 0
    for (let j = start; j < start + PITCH_WINDOW; j++) {
      const delta = x[j] - x[j + lag]
      difference += delta * delta
    }
    cumulative += difference
    if (lag >= PITCH_MIN_LAG && cumulative > 0) best = Math.min(best, (difference * lag) / cumulative)
  }
  return best
}

/** What the athlete is doing, as turn-taking sees it. Times are on the recording's clock. */
export type TurnEvent =
  /** They started making a sound like speech; their turn's audio starts at `from`. */
  | { type: "start"; from: number }
  /** It's speech, not a cough or a click: enough of it to be them talking. */
  | { type: "speech" }
  /** A pause long enough to start transcribing what they've said (from `from` to `to`), in case it's the end. */
  | { type: "pause"; from: number; to: number }
  /** They went on after that pause. */
  | { type: "resume" }
  /** Their turn is over: what they said is from `from` to `to`. */
  | { type: "end"; from: number; to: number }
  /** What started was too short to be speech; it's forgotten. */
  | { type: "noise" }

export const TURN = {
  onsetFrames: 10, // a start needs, in the last 0.2 s,
  onsetActive: 5, // 0.1 s of sound
  onsetVoiced: 3, // of which 60 ms voiced
  confirm: 0.3, // seconds of speech before it counts as them talking
  speculateAfter: 0.25, // a pause this long: start transcribing, in case it's the end
  endAfter: 0.9, // a pause this long ends the turn
  maxTurn: 45, // a turn ends after this long, whatever is happening
  preroll: 0.3, // audio kept before the first sound of speech (soft starts: "h", "s", "f")
  tail: 0.25, // and after the last
  quietRun: 0.24, // a gap this long before the speech is where it began
  lookback: 3, // the furthest back a turn can begin before it was noticed
  voicedNear: 0.3, // unvoiced sounds this close to voiced ones are speech too ("s", "t", "f")
}

/**
 * Turn-taking, from voice frames: when the athlete starts talking, pauses (long enough to get a transcription going,
 * in case they've finished), goes on, or has finished. A start is found from voiced sound; the turn's audio begins at
 * the last real gap before it, so a soft or early start isn't cut off even though it was noticed a moment later.
 */
export class TurnTaker {
  private recent: VoiceFrame[] = []
  private speaking = false
  private confirmed = false
  private paused = false
  private from = 0
  private lastSound = 0
  private lastVoiced = -Infinity
  private speech = 0
  private since = 0
  /** The pause that ends a turn, in seconds: TURN.endAfter, unless the call, knowing what has been said so far, makes
   *  it shorter (it sounds finished) or longer (it leads on). Back to TURN.endAfter whenever the athlete speaks again. */
  endAfter = TURN.endAfter

  /** Whether an utterance is under way. */
  get talking() {
    return this.speaking
  }

  /** Seconds of speech in the utterance under way. */
  get spoken() {
    return this.speaking ? this.speech : 0
  }

  push(frame: VoiceFrame): TurnEvent | null {
    this.recent.push(frame)
    while (this.recent.length && frame.at - this.recent[0].at > TURN.lookback + 0.5) this.recent.shift()
    if (frame.voiced) this.lastVoiced = frame.at
    const sound = frame.audible && (frame.voiced || frame.at - this.lastVoiced <= TURN.voicedNear)

    if (!this.speaking) {
      const window = this.recent.slice(-TURN.onsetFrames)
      const active = window.filter((item) => item.active).length
      const voiced = window.filter((item) => item.voiced).length
      if (active < TURN.onsetActive || voiced < TURN.onsetVoiced) return null
      this.speaking = true
      this.confirmed = false
      this.paused = false
      this.endAfter = TURN.endAfter
      this.from = this.beginning()
      this.lastSound = frame.at
      this.speech = window.filter((item) => item.active).length * FRAME_S
      return { type: "start", from: this.from }
    }

    if (sound) {
      this.lastSound = frame.at
      this.speech += FRAME_S
      if (!this.confirmed && this.speech >= TURN.confirm) {
        this.confirmed = true
        return { type: "speech" }
      }
      if (this.paused) {
        this.paused = false
        this.endAfter = TURN.endAfter
        return { type: "resume" }
      }
    }
    const silence = frame.at - this.lastSound
    if (silence >= this.endAfter || frame.at - this.from >= TURN.maxTurn) {
      this.speaking = false
      if (!this.confirmed) return { type: "noise" }
      return { type: "end", from: this.from, to: Math.min(frame.at, this.lastSound + TURN.tail) }
    }
    if (this.confirmed && !this.paused && silence >= TURN.speculateAfter) {
      this.paused = true
      return { type: "pause", from: this.from, to: Math.min(frame.at, this.lastSound + TURN.tail) }
    }
    return null
  }

  /** Where the utterance just noticed began: after the last real gap (judged against the room's noise as it's known
   *  now, which may be better than when those frames were heard), less a little for a soft start, and never before
   *  the coach's voice was last coming back into the microphone. */
  private beginning() {
    const floor = this.recent[this.recent.length - 1].floor
    let quiet = 0
    let first = this.recent[this.recent.length - 1].at - FRAME_S
    let coach = -Infinity
    for (let i = this.recent.length - 1; i >= 0; i--) {
      if (this.recent[i].gated) {
        coach = this.recent[i].at
        break
      }
      if (this.recent[i].db >= floor + ACTIVE_DB) {
        quiet = 0
        first = this.recent[i].at - FRAME_S
      } else if (++quiet * FRAME_S >= TURN.quietRun) break
    }
    return Math.max(this.since, coach, first - TURN.preroll, this.recent[this.recent.length - 1].at - TURN.lookback)
  }

  /** Starts a fresh turn at `at` (seconds): anything under way is forgotten, and a turn can't reach back before it. */
  reset(at: number) {
    this.speaking = false
    this.confirmed = false
    this.paused = false
    this.speech = 0
    this.endAfter = TURN.endAfter
    this.since = Math.max(0, at - 0.2)
  }

  /** Ends the turn now (the athlete pressed send): what they've said so far, or, with nothing noticed, the last
   *  `fallback` seconds heard (a voice too quiet for the detector still gets sent). */
  finish(at: number, fallback = 15): { from: number; to: number } {
    const range = this.speaking ? { from: this.from, to: at } : { from: Math.max(this.since, at - fallback), to: at }
    this.reset(at)
    return range
  }
}

/** Whether what the athlete said sounds finished: it ends a sentence, and not on a word that leads on ("and", "so"). */
export const soundsFinished = (text: string) =>
  /[.?!]["')\]]*$/.test(text.trim()) && !/\b(?:and|but|so|or|because|um+|uh+|er+|like|then|with|to|the|a|an|of|if|my|for)\W*$/i.test(text.trim())

/** Whether `heard` is the coach's own voice coming back: nearly all its words are, in order, what the coach said. */
export function echoOf(heard: string, said: string) {
  const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? []
  const mine = words(heard)
  const theirs = words(said)
  if (mine.length < 3 || !theirs.length) return false
  // How many of the athlete's words appear in order in the coach's (a longest common subsequence).
  let row = new Array<number>(theirs.length + 1).fill(0)
  for (const word of mine) {
    const next = [0]
    for (let j = 0; j < theirs.length; j++) next.push(word === theirs[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]))
    row = next
  }
  return row[theirs.length] >= mine.length * 0.75
}
