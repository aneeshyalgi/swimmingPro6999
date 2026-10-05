// A swim time as typed into the minutes / seconds / hundredths boxes. Stored in Supabase as
// {"minutes": int, "seconds": int, "hundredths": int} (see backend/supabase_schema.sql).
export type TimeParts = { minutes: string; seconds: string; hundredths: string }

export type StoredSwimTime = { minutes: number; seconds: number; hundredths: number }

export const emptyTime: TimeParts = { minutes: "", seconds: "", hundredths: "" }

export const isBlankTime = (time?: TimeParts) => !time || (!time.minutes && !time.seconds && !time.hundredths)

// The hundredths box reads like the digits after a decimal point: "4" means .40, "04" means .04.
export const hundredthsValue = (hundredths: string) =>
  hundredths === "" ? 0 : hundredths.length === 1 ? Number(hundredths) * 10 : Number(hundredths)

export const timeError = (time: TimeParts | undefined, required: boolean, missingMessage: string) => {
  if (isBlankTime(time)) return required ? missingMessage : undefined
  if (!time!.seconds) return "Enter the seconds"
  if (Number(time!.seconds) > 59) return "Seconds must be between 0 and 59"
  if (Number(time!.minutes || 0) === 0 && Number(time!.seconds) === 0 && hundredthsValue(time!.hundredths) === 0) {
    return "Time must be greater than zero"
  }
  return undefined
}

/** A time outside realistic race speed for the event (40 s to 4:00 per 100 m), matching the backend's check. */
export const realismError = (event: string, time?: TimeParts) => {
  if (isBlankTime(time) || timeError(time, true, "")) return undefined
  const stored = toStoredTime(time!)
  const per100 = ((stored.minutes * 60 + stored.seconds + stored.hundredths / 100) / Number.parseInt(event)) * 100
  if (per100 < 40) return "That's faster than world-record pace. Check the time"
  if (per100 > 240) return "That's slower than 4:00 per 100 m. Check the minutes and seconds"
  return undefined
}

export const toStoredTime = (time: TimeParts): StoredSwimTime => ({
  minutes: Number(time.minutes || 0),
  seconds: Number(time.seconds || 0),
  hundredths: hundredthsValue(time.hundredths),
})

export const timeToSeconds = (time?: TimeParts) => {
  if (!time || timeError(time, true, "missing")) return null
  const stored = toStoredTime(time)
  return stored.minutes * 60 + stored.seconds + stored.hundredths / 100
}

export const formatSeconds = (seconds: number) => {
  if (seconds < 60) return seconds.toFixed(2)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`
}

export const formatTime = (time?: TimeParts) => {
  const seconds = timeToSeconds(time)
  return seconds === null ? null : formatSeconds(seconds)
}

// Parses "1:02.35" / "24.5" style text (pasted values, drafts saved before the split inputs).
export const parseTimeText = (text: string): TimeParts | null => {
  const match = text.trim().match(/^(?:(\d{1,3}):)?(\d{1,2})(?:\.(\d{1,3}))?$/)
  if (!match) return null
  const [, minutes = "", seconds, fraction = ""] = match
  return { minutes, seconds: seconds.padStart(2, "0"), hundredths: fraction ? (fraction + "0").slice(0, 2) : "" }
}

export const coerceTimeParts = (value: unknown): TimeParts => {
  if (typeof value === "string") return parseTimeText(value) || emptyTime
  if (value && typeof value === "object") {
    const parts = value as Partial<Record<keyof TimeParts, unknown>>
    const hundredths = typeof parts.hundredths === "number" ? String(parts.hundredths).padStart(2, "0") : String(parts.hundredths ?? "")
    return { minutes: String(parts.minutes ?? ""), seconds: String(parts.seconds ?? ""), hundredths }
  }
  return emptyTime
}
