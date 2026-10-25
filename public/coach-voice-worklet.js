// The microphone on a voice call with a coach (components/coach-conversation.tsx): passes what it hears to the page in
// 20 ms blocks, each with the coach's voice from the same moment (the input's second channel), so the page can tell
// the athlete from the coach's voice coming back through the speakers however late it gets the blocks. It runs on the
// audio thread, so the call keeps listening while the page is busy or in the background.
class CoachMicTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = Math.round(sampleRate / 50)
    this.fresh()
  }

  fresh() {
    this.mic = new Float32Array(this.size)
    this.coach = new Float32Array(this.size)
    this.filled = 0
  }

  process(inputs) {
    const mic = inputs[0] && inputs[0][0]
    if (mic) {
      const coach = inputs[0][1]
      let offset = 0
      while (offset < mic.length) {
        const take = Math.min(mic.length - offset, this.size - this.filled)
        this.mic.set(mic.subarray(offset, offset + take), this.filled)
        if (coach) this.coach.set(coach.subarray(offset, offset + take), this.filled)
        this.filled += take
        offset += take
        if (this.filled === this.size) {
          this.port.postMessage({ mic: this.mic, coach: this.coach }, [this.mic.buffer, this.coach.buffer])
          this.fresh()
        }
      }
    }
    return true
  }
}

registerProcessor("coach-mic-tap", CoachMicTap)
