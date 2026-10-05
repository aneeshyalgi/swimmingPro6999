"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { generateCoachSpeech, MAX_RECORDING_BYTES, MAX_RECORDING_MS, speechChunks, transcribeRecording } from "@/lib/coach-audio"

type RecordingState = "idle" | "starting" | "recording" | "transcribing"
type SpeechState = { messageId: string; status: "loading" | "playing" } | null

export function useCoachAudio(coach: string | null, onTranscript: (text: string) => void) {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle")
  const [speech, setSpeech] = useState<SpeechState>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordingRequest = useRef<AbortController | null>(null)
  const recordingGeneration = useRef(0)
  const speechRequest = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => { onTranscriptRef.current = onTranscript }, [onTranscript])

  const releaseMicrophone = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  const stopListening = useCallback(() => {
    speechRequest.current?.abort()
    speechRequest.current = null
    audioRef.current?.pause()
    audioRef.current = null
    setSpeech(null)
  }, [])

  const cancelRecording = useCallback(() => {
    recordingGeneration.current += 1
    recordingRequest.current?.abort()
    recordingRequest.current = null
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") recorder.stop()
    releaseMicrophone()
    setRecordingState("idle")
  }, [releaseMicrophone])

  const cancelAudio = useCallback(() => {
    cancelRecording()
    stopListening()
    setAudioError(null)
  }, [cancelRecording, stopListening])

  useEffect(() => {
    cancelAudio()
    return cancelAudio
  }, [coach, cancelAudio])

  const startRecording = async (availableCharacters: number) => {
    if (!coach || recordingState !== "idle") return
    setAudioError(null)
    if (availableCharacters <= 0) {
      setAudioError("Your message is full. Send it or clear some text before dictating.")
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAudioError("Microphone recording is unavailable. Use a supported browser on HTTPS or localhost.")
      return
    }
    stopListening()
    setRecordingState("starting")
    const generation = ++recordingGeneration.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation !== recordingGeneration.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error("Your browser cannot record a supported audio format. Try Chrome, Edge or Safari.")
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      const chunks: Blob[] = []
      let bytes = 0
      recorder.ondataavailable = (event) => {
        if (generation !== recordingGeneration.current || !event.data.size) return
        bytes += event.data.size
        if (bytes > MAX_RECORDING_BYTES) {
          cancelRecording()
          setAudioError("Recording is too large. Please record a shorter message.")
          return
        }
        chunks.push(event.data)
      }
      recorder.onerror = () => {
        if (generation !== recordingGeneration.current) return
        cancelRecording()
        setAudioError("The microphone stopped recording unexpectedly. Please try again.")
      }
      recorder.onstop = async () => {
        if (generation !== recordingGeneration.current) return
        releaseMicrophone()
        const recording = new Blob(chunks, { type: recorder.mimeType })
        if (!recording.size) {
          setRecordingState("idle")
          setAudioError("No audio was recorded. Please try again.")
          return
        }
        const controller = new AbortController()
        recordingRequest.current = controller
        setRecordingState("transcribing")
        try {
          const text = await transcribeRecording(coach, recording, controller.signal)
          if (controller.signal.aborted || generation !== recordingGeneration.current) return
          if (text.length > availableCharacters) throw new Error("Dictation exceeds the space left in your message. Record a shorter message or clear the existing text.")
          onTranscriptRef.current(text)
        } catch (error) {
          if (!controller.signal.aborted && generation === recordingGeneration.current) {
            setAudioError(error instanceof Error ? error.message : "Could not transcribe your recording.")
          }
        } finally {
          if (generation === recordingGeneration.current) {
            recordingRequest.current = null
            setRecordingState("idle")
          }
        }
      }
      recorder.start(250)
      setRecordingState("recording")
      timerRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop()
      }, MAX_RECORDING_MS)
    } catch (error) {
      if (generation !== recordingGeneration.current) return
      releaseMicrophone()
      setRecordingState("idle")
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
      setAudioError(denied ? "Microphone access was denied. Allow microphone access in your browser and try again." :
        error instanceof Error ? error.message : "Could not access your microphone.")
    }
  }

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      setRecordingState("transcribing")
      recorderRef.current.stop()
    }
  }

  const listen = async (messageId: string, content: string) => {
    if (!coach || recordingState !== "idle") return
    if (speech?.messageId === messageId) {
      stopListening()
      return
    }
    stopListening()
    setAudioError(null)
    const controller = new AbortController()
    speechRequest.current = controller
    setSpeech({ messageId, status: "loading" })
    try {
      const chunks = speechChunks(content)
      if (!chunks.length) throw new Error("This message has no text to read aloud.")
      for (const text of chunks) {
        if (controller.signal.aborted) return
        setSpeech({ messageId, status: "loading" })
        const blob = await generateCoachSpeech(coach, text, controller.signal)
        if (controller.signal.aborted) return
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        try {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              controller.signal.removeEventListener("abort", aborted)
              audio.onended = null
              audio.onerror = null
            }
            const aborted = () => { cleanup(); audio.pause(); reject(new DOMException("Playback cancelled", "AbortError")) }
            audio.onended = () => { cleanup(); resolve() }
            audio.onerror = () => { cleanup(); reject(new Error("Could not play the coach's audio. Please try again.")) }
            controller.signal.addEventListener("abort", aborted, { once: true })
            audio.play().then(() => {
              if (!controller.signal.aborted) setSpeech({ messageId, status: "playing" })
            }).catch((error: unknown) => { cleanup(); reject(error) })
          })
        } finally {
          audio.pause()
          audio.removeAttribute("src")
          audio.load()
          URL.revokeObjectURL(url)
          if (audioRef.current === audio) audioRef.current = null
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setAudioError(error instanceof Error ? error.message : "Could not play the coach's reply.")
      }
    } finally {
      if (speechRequest.current === controller) {
        speechRequest.current = null
        setSpeech(null)
      }
    }
  }

  return { recordingState, speech, audioError, startRecording, stopRecording, listen, cancelAudio }
}
