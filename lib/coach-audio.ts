import { supabase } from "@/lib/supabase"

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
export const MAX_RECORDING_BYTES = 24 * 1024 * 1024
export const MAX_RECORDING_MS = 60_000
const SPEECH_CHUNK_SIZE = 3000

async function audioRequest(path: string, options: RequestInit, signal: AbortSignal) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error("Sign in again to use voice coaching.")
  const response = await fetch(`${apiUrl()}/api/coach-chat/${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${session.access_token}` },
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
    throw new Error(message)
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
  if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech was detected. Please try again.")
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

export function speechChunks(markdown: string): string[] {
  const text = markdown
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*•]\s+/gm, "")
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
