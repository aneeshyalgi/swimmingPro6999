/*
 * Sound effects for voice conversations, synthesised with the Web Audio API so there is no audio file to load.
 */

/**
 * Schedules the "call ended" chime on `context`: two soft bell-like notes falling a fifth (G5 → C5) with a short echo.
 * Returns when the sound has finished, in the context's time.
 */
export function scheduleHangUp(context: BaseAudioContext, destination: AudioNode = context.destination, at = context.currentTime + 0.01) {
  const master = context.createGain()
  master.gain.value = 0.22
  master.connect(destination)
  // A little echo gives the chime some room.
  const delay = context.createDelay(1)
  delay.delayTime.value = 0.11
  const feedback = context.createGain()
  feedback.gain.value = 0.22
  const wet = context.createGain()
  wet.gain.value = 0.35
  master.connect(delay)
  delay.connect(feedback).connect(delay)
  delay.connect(wet).connect(destination)

  const note = (frequency: number, start: number, length: number) => {
    // A sine with a quiet octave overtone reads as a soft bell; the pitch droops slightly as it fades.
    for (const [type, level, ratio] of [["sine", 1, 1], ["triangle", 0.18, 2]] as const) {
      const oscillator = context.createOscillator()
      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency * ratio, start)
      oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio * 0.985, start + length)
      const envelope = context.createGain()
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.exponentialRampToValueAtTime(level, start + 0.012)
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + length)
      oscillator.connect(envelope).connect(master)
      oscillator.start(start)
      oscillator.stop(start + length + 0.02)
    }
  }
  note(784, at, 0.22)
  note(523.25, at + 0.15, 0.85)
  return at + 1 + 0.6 // notes, then the echo tail
}

/** Plays the "call ended" chime on its own audio context, so it outlives the conversation's audio being shut down. */
export function playHangUpSound() {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return
    const context = new Context()
    const end = scheduleHangUp(context)
    window.setTimeout(() => void context.close(), Math.ceil((end - context.currentTime) * 1000) + 100)
  } catch {
    // The sound is a nicety; ending the call never depends on it.
  }
}
