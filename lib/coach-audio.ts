import { supabase } from "@/lib/supabase"
import type { ChatSource } from "@/components/chat-markdown"
import type { PlanKind } from "@/lib/coach-plan"
import { EARLIER_CONTEXT } from "@/lib/coach-history"
import { tokensNeededIn } from "@/lib/token-events"

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
export const MAX_RECORDING_BYTES = 24 * 1024 * 1024
export const MAX_RECORDING_MS = 60_000
const SPEECH_CHUNK_SIZE = 3000

/** A recording with no words in it (silence, or a sound that wasn't speech). */
export class NoSpeechError extends Error {}

async function authorization() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error("Sign in again to use voice coaching.")
  return `Bearer ${session.access_token}`
}

async function audioRequest(path: string, options: RequestInit, signal: AbortSignal) {
  const response = await fetch(`${apiUrl()}/api/coach-chat/${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: await authorization() },
    signal,
  })
  if (!response.ok) {
    const text = await response.text()
    let message = `Voice request failed (${response.status}). Please try again.`
    try {
      const body: { detail?: unknown } = JSON.parse(text)
      if (typeof body.detail === "string") message = body.detail
    } catch {
      message = text || message
    }
    throw response.status === 422 && path.startsWith("transcribe") ? new NoSpeechError(message) : new Error(message)
  }
  return response
}

export async function transcribeRecording(coach: string, recording: Blob, signal: AbortSignal): Promise<string> {
  const response = await audioRequest(`transcribe?coach=${encodeURIComponent(coach)}`, {
    method: "POST",
    headers: { "Content-Type": recording.type },
    body: recording,
  }, signal)
  const result: { text?: unknown } = await response.json()
  if (typeof result.text !== "string" || !result.text.trim()) throw new NoSpeechError("No speech was detected. Please try again.")
  return result.text.trim()
}

export async function generateCoachSpeech(coach: string, text: string, signal: AbortSignal): Promise<Blob> {
  const response = await audioRequest("speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coach, text }),
  }, signal)
  const audio = await response.blob()
  if (!audio.size || !audio.type.startsWith("audio/")) throw new Error("The voice service returned invalid audio. Please try again.")
  return audio
}

/** The coach saying `text` on a voice call, streamed as it's synthesised: 16-bit PCM at 24 kHz. (A server that doesn't
 *  stream speech sends an MP3 instead, so check the response's type.) */
export function streamCoachSpeech(coach: string, text: string, signal: AbortSignal): Promise<Response> {
  return audioRequest("speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coach, text, format: "pcm" }),
  }, signal)
}

export type LiveReply = { content: string; sources?: ChatSource[]; plan?: PlanKind | null }

/**
 * A voice call's reply as the coach writes it (POST /api/coach-chat/live, with POST /api/coach-chat's body): `onText`
 * gets each new piece of it, and it resolves with the whole reply. A server from before replies were streamed answers
 * all at once.
 */
export async function askCoachLive(body: Record<string, unknown>, signal: AbortSignal, onText: (text: string) => void): Promise<LiveReply> {
  const failed = "The coach couldn't answer just now. Please try again."
  const request = { method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: await authorization() }, body: JSON.stringify(body) }
  const response = await fetch(`${apiUrl()}/api/coach-chat/live`, request)
  // Refused by a backend from before it took the longer conversation (while it's being updated): as it was given.
  if (response.status === 422 && Array.isArray(body.history) && body.history.length > EARLIER_CONTEXT) {
    return askCoachLive({ ...body, history: body.history.slice(-EARLIER_CONTEXT) }, signal, onText)
  }
  if (response.status === 404 || response.status === 405) {
    const whole = await fetch(`${apiUrl()}/api/coach-chat`, request)
    if (!whole.ok) throw new Error(failed)
    const reply: LiveReply = await whole.json()
    onText(reply.content)
    return reply
  }
  // Out of tokens: the API says so in words the athlete can act on.
  if (!response.ok) throw tokensNeededIn(response.status, await response.text().catch(() => "")) ?? new Error(failed)
  if (!response.body) throw new Error(failed)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  for (;;) {
    const { value, done } = await reader.read()
    buffered += decoder.decode(value, { stream: !done })
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      const line = buffered.slice(0, end).trim()
      buffered = buffered.slice(end + 1)
      if (!line) continue
      const event: { delta?: string; done?: boolean; error?: string } & LiveReply = JSON.parse(line)
      if (typeof event.delta === "string") onText(event.delta)
      else if (event.done) return event
      else if (event.error) throw new Error(event.error)
    }
    if (done) throw new Error(failed)
  }
}

export function speechChunks(markdown: string): string[] {
  const text = markdown
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Dividers, headings' #s and list markers (indented ones under an item too) aren't read out.
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+•][ \t]+/gm, "")
    .replace(/\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`/g, (_, bold: string, italic: string, code: string) => bold || italic || code)
    .trim()
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > SPEECH_CHUNK_SIZE) {
    const candidate = remaining.slice(0, SPEECH_CHUNK_SIZE)
    const sentence = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("? "), candidate.lastIndexOf("! "), candidate.lastIndexOf("\n"))
    const boundary = sentence > SPEECH_CHUNK_SIZE / 2 ? sentence + 1 : candidate.lastIndexOf(" ")
    const end = boundary > 0 ? boundary : SPEECH_CHUNK_SIZE
    chunks.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}
