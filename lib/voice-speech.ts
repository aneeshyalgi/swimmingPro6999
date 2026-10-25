import { Biquad } from "@/lib/voice-turns"

/*
 * The coach talking on a voice call (components/coach-conversation.tsx): their reply cut into pieces to speak as it is
 * written (the first as soon as it's a sentence, so they start talking quickly), and a player for the speech as it
 * streams in (16-bit PCM at 24 kHz), seamless from one piece to the next.
 */

export const SPEECH_RATE = 24_000
const SPEECH_SPEED = 14 // characters a second, about, before a piece's length is known
const FIRST_CLAUSE = 15 // with no sentence yet, the first piece can end at a comma this far in ("Three weeks out,")
const LONGEST_FIRST = 140 // or at a space, this far in
export const LONGEST_PIECE = 2_500 // the speech endpoint takes 3,000 characters at most

/** A piece of a reply as it should be said: markdown, citations and links dropped (as lib/coach-audio speechChunks). */
export function speakable(text: string) {
  return text
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * A reply cut into pieces to speak while it's still being written. The first piece is its first sentence (or, when
 * that is long, its first clause), so the coach starts talking before the rest is written; after that, each sentence
 * is a piece as soon as it's complete. Pieces are speakable() text.
 */
export class SpokenText {
  private text = ""
  private taken = 0
  private first = true

  /** Adds what has been written since; returns the pieces now ready. */
  push(delta: string): string[] {
    this.text += delta
    const pieces: string[] = []
    for (;;) {
      const end = this.next()
      if (end < 0) break
      const piece = speakable(this.text.slice(this.taken, end))
      this.taken = end
      if (piece) {
        pieces.push(...bounded(piece))
        this.first = false
      }
    }
    return pieces
  }

  /** The reply is complete: what's left of it. */
  finish(): string[] {
    const piece = speakable(this.text.slice(this.taken))
    this.taken = this.text.length
    return piece ? bounded(piece) : []
  }

  /** Where the next piece ends (an index into the text), or -1 while it isn't complete yet. */
  private next() {
    const rest = this.text.slice(this.taken)
    const sentence = rest.search(/[.!?]["')\]]*\s|\n/)
    if (sentence >= 0) {
      const mark = rest.slice(sentence).search(/\s/)
      return this.taken + sentence + mark + 1
    }
    if (!this.first) return -1
    const clause = [...rest.matchAll(/[,;:]\s|\s[–—-]\s/g)].find((match) => (match.index ?? 0) >= FIRST_CLAUSE)
    if (clause?.index !== undefined) return this.taken + clause.index + clause[0].length
    if (rest.length > LONGEST_FIRST) {
      const space = rest.lastIndexOf(" ", LONGEST_FIRST)
      if (space > 0) return this.taken + space + 1
    }
    return -1
  }
}

/** A piece in parts the speech endpoint takes, cut at a space. */
function bounded(piece: string): string[] {
  const parts: string[] = []
  let rest = piece
  while (rest.length > LONGEST_PIECE) {
    const space = rest.lastIndexOf(" ", LONGEST_PIECE)
    const end = space > LONGEST_PIECE / 2 ? space : LONGEST_PIECE
    parts.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

type Part = {
  chars: number
  pending: Float32Array[]
  ended: boolean
  /** When its first sample plays (the context's clock), once scheduled. */
  start: number | null
  /** Seconds of it scheduled so far. */
  seconds: number
  /** The odd byte of a 16-bit sample split between two network chunks. */
  carry: number | null
  /** Resampling to the context's rate: where the next output sample falls, the last input sample, and (for a context
   *  slower than the speech, as with some Bluetooth headsets) a low-pass so it doesn't alias. */
  position: number
  previous: number
  filters: Biquad[]
}

/** A piece being spoken, written to as its audio streams in. */
export type SpeechPart = {
  /** More 16-bit PCM (24 kHz) of it. */
  write(bytes: Uint8Array): void
  /** All of it, decoded already (an MP3 from a server that doesn't stream PCM). */
  decoded(buffer: AudioBuffer): void
  /** It has all arrived (or it never will: what did arrive is still played). */
  end(): void
}

/**
 * Plays a reply's pieces in order, each as it streams in, on the call's audio context: the first waits for a little
 * audio (so a slow network doesn't stutter it), the rest follow on without a gap. The audio goes through `destination`
 * (the coach's level, which the orb and the avatar move with). Captions follow `spoken()`.
 */
export class SpeechPlayer {
  private readonly context: AudioContext
  private readonly destination: AudioNode
  private output: GainNode
  private parts: Part[] = []
  private head = 0
  private cursor = 0
  private playing = new Set<AudioBufferSourceNode>()
  private started = false
  private held = false
  private drained: (() => void)[] = []
  /** The first sound of what it was given has just been scheduled to play. */
  onstart: (() => void) | null = null

  constructor(context: AudioContext, destination: AudioNode) {
    this.context = context
    this.destination = destination
    this.output = this.connect()
  }

  private connect() {
    const output = this.context.createGain()
    output.connect(this.destination)
    return output
  }

  /** The next piece, after any already given. `chars`: its length as captioned. */
  part(chars: number): SpeechPart {
    const rate = this.context.sampleRate
    const filters = rate < SPEECH_RATE ? [0.5412, 1.3066].map((q) => new Biquad("lowpass", rate * 0.45, SPEECH_RATE, q)) : []
    const part: Part = { chars, pending: [], ended: false, start: null, seconds: 0, carry: null, position: 0, previous: 0, filters }
    this.parts.push(part)
    const live = () => this.parts.includes(part)
    return {
      write: (bytes) => { if (live() && !part.ended) { part.pending.push(this.resample(part, this.samples(part, bytes))); this.pump() } },
      decoded: (buffer) => { if (live() && !part.ended) { part.pending.push(buffer.getChannelData(0).slice()); part.ended = true; this.pump() } },
      end: () => { if (live() && !part.ended) { part.ended = true; this.pump() } },
    }
  }

  private samples(part: Part, bytes: Uint8Array) {
    let data = bytes
    if (part.carry !== null) {
      data = new Uint8Array(bytes.length + 1)
      data[0] = part.carry
      data.set(bytes, 1)
      part.carry = null
    }
    if (data.length % 2) {
      part.carry = data[data.length - 1]
      data = data.subarray(0, data.length - 1)
    }
    const view = new DataView(data.buffer, data.byteOffset, data.length)
    const out = new Float32Array(data.length / 2)
    for (let i = 0; i < out.length; i++) {
      let sample = view.getInt16(i * 2, true) / 32768
      for (const filter of part.filters) sample = filter.step(sample)
      out[i] = sample
    }
    return out
  }

  /** 24 kHz to the context's rate, by linear interpolation carried on from the piece's previous chunk. */
  private resample(part: Part, x: Float32Array) {
    const step = SPEECH_RATE / this.context.sampleRate
    if (!x.length) return x
    const out = new Float32Array(Math.ceil((x.length + 1) / step) + 1)
    let n = 0
    let t = part.position
    while (t < x.length - 1) {
      const i = Math.floor(t)
      const a = i < 0 ? part.previous : x[i]
      out[n++] = a + (x[i + 1] - a) * (t - i)
      t += step
    }
    part.position = t - x.length
    part.previous = x[x.length - 1]
    return out.subarray(0, n)
  }

  /** Quieter while the athlete talks over the coach (they hear they've been heard), back to full when they stop. */
  duck(on: boolean) {
    const now = this.context.currentTime
    this.output.gain.cancelScheduledValues(now)
    this.output.gain.setValueAtTime(this.output.gain.value, now)
    this.output.gain.linearRampToValueAtTime(on ? 0.25 : 1, now + (on ? 0.08 : 0.25))
  }

  /** Keeps a reply from starting (the athlete has started to say something): its audio waits until released. Once
   *  a reply has started, it plays on. */
  hold(on: boolean) {
    this.held = on
    if (!on) this.pump()
  }

  private pump() {
    const rate = this.context.sampleRate
    if (this.held && !this.started) return
    while (this.head < this.parts.length) {
      const part = this.parts[this.head]
      const buffered = part.pending.reduce((sum, chunk) => sum + chunk.length, 0)
      // Starting from silence, wait for 120 ms of audio (or the whole piece) so the network can keep ahead of it.
      const idle = this.cursor < this.context.currentTime + 0.01
      if (buffered && (!idle || part.ended || buffered >= rate * 0.12)) {
        const audio = new Float32Array(buffered)
        let offset = 0
        for (const chunk of part.pending) { audio.set(chunk, offset); offset += chunk.length }
        part.pending = []
        if (idle) this.cursor = this.context.currentTime + 0.04
        const buffer = this.context.createBuffer(1, audio.length, rate)
        buffer.copyToChannel(audio, 0)
        const source = this.context.createBufferSource()
        source.buffer = buffer
        source.connect(this.output)
        source.onended = () => { this.playing.delete(source); this.settle() }
        source.start(this.cursor)
        this.playing.add(source)
        part.start ??= this.cursor
        this.cursor += audio.length / rate
        part.seconds += audio.length / rate
        if (!this.started) {
          this.started = true
          this.onstart?.()
        }
      }
      if (!part.ended || part.pending.length) break
      this.head++
    }
    this.settle()
  }

  private settle() {
    if (this.head < this.parts.length || this.playing.size) return
    const waiting = this.drained
    this.drained = []
    for (const resolve of waiting) resolve()
  }

  /** Resolves once everything given to it so far has been played (or stopped). */
  whenDrained(): Promise<void> {
    return new Promise((resolve) => {
      this.drained.push(resolve)
      this.settle()
    })
  }

  /** Whether any of what it was given is still to be heard. */
  get busy() {
    return this.head < this.parts.length || this.playing.size > 0
  }

  /** How many characters of the captions have been spoken (pieces in order, each by how far through its audio it is). */
  spoken() {
    let chars = 0
    for (const part of this.parts) {
      if (part.start === null) break
      const length = part.ended && !part.pending.length ? part.seconds : Math.max(part.seconds, part.chars / SPEECH_SPEED)
      const played = Math.max(0, this.context.currentTime - part.start)
      if (played < length) return chars + Math.round(part.chars * (played / length))
      chars += part.chars
    }
    return chars
  }

  /** Silences it at once (a short fade, no click) and forgets everything it was given. */
  stop() {
    const output = this.output
    const now = this.context.currentTime
    output.gain.cancelScheduledValues(now)
    output.gain.setValueAtTime(output.gain.value, now)
    output.gain.linearRampToValueAtTime(0, now + 0.05)
    const sources = [...this.playing]
    window.setTimeout(() => {
      for (const source of sources) { try { source.stop() } catch { /* already ended */ } }
      output.disconnect()
    }, 80)
    this.output = this.connect()
    this.parts = []
    this.head = 0
    this.cursor = 0
    this.playing.clear()
    this.started = false
    this.held = false
    this.settle()
  }
}
