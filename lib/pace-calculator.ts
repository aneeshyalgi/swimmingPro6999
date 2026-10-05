import { z } from "zod"
import { supabase } from "@/lib/supabase"

export const STROKES = ["Freestyle", "Backstroke", "Breaststroke", "Butterfly"] as const
export const COURSES = ["LCM", "SCM", "SCY"] as const
export type Stroke = (typeof STROKES)[number]
export type Course = (typeof COURSES)[number]
export type Suit = "TRAINING_SUIT" | "TECH"
export type Start = "DIVE" | "PUSH"
export type Display = "BOTH" | "PUSH" | "DIVE"

const courseSchema = z.enum(COURSES)
const pbEntrySchema = z.object({
  distance: z.number(), time: z.string(), suit: z.enum(["TRAINING_SUIT", "TECH"]), start: z.enum(["DIVE", "PUSH"]), swum_on: z.string().nullable(),
})
const cssTestSchema = z.object({ t200: z.string().nullable(), t400: z.string().nullable(), tested_on: z.string().nullable() })
export const athleteSchema = z.object({
  id: z.string(), name: z.string(), group: z.string(), course: courseSchema, notes: z.string(),
  pbs: z.record(z.string(), z.array(pbEntrySchema)), tests: z.record(z.string(), cssTestSchema),
  is_self: z.boolean(), imported: z.boolean(), updated_at: z.string().nullable(),
})
export const athletesSchema = z.object({
  athletes: z.array(athleteSchema), default_course: courseSchema, strokes: z.array(z.string()),
  distances: z.record(z.string(), z.record(z.string(), z.array(z.number()))), saved_id: z.string().optional(),
})
const rangeSchema = z.object({ fast: z.number(), slow: z.number() })
export const paceResultSchema = z.object({
  athlete: z.string(), stroke: z.string(), course: courseSchema, unit: z.string(), suit: z.string(), display: z.string(),
  start_advantage: z.number(), converted_from: z.string().nullable(),
  zones: z.array(z.object({
    zone: z.string(), purpose: z.string(), rest: z.string(), why: z.string(), per_100: rangeSchema, dive_relevant: z.boolean(),
    rows: z.array(z.object({ label: z.string(), distance: z.number(), push: rangeSchema, dive: rangeSchema.nullable(), note: z.string().nullable() })),
  })),
  flags: z.array(z.object({ level: z.string(), text: z.string() })),
  reference: z.object({
    css_per_100: z.number(), css_basis: z.string(), exponent: z.number(), pace_50: z.number(), pace_200: z.number(),
    pace_400: z.number(), pbs_used: z.number(),
  }).nullable(),
})

export type Athlete = z.infer<typeof athleteSchema>
export type AthleteList = z.infer<typeof athletesSchema>
export type PbEntry = z.infer<typeof pbEntrySchema>
export type CssTest = z.infer<typeof cssTestSchema>
export type PaceResult = z.infer<typeof paceResultSchema>
export type PaceRange = z.infer<typeof rangeSchema>
/** The editable part of an athlete (what the API stores). */
export type AthleteData = Pick<Athlete, "name" | "group" | "course" | "notes" | "pbs" | "tests">

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

async function authorized(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal }) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error("Sign in again to use the pace calculator.")
  const response = await fetch(`${apiUrl()}/api/pace-calculator${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
  })
  if (!response.ok) {
    let message = `Pace calculator request failed (${response.status}).`
    try {
      const failure = await response.json() as { detail?: string | { msg: string }[] }
      if (typeof failure.detail === "string") message = failure.detail
      else if (Array.isArray(failure.detail)) message = failure.detail.map((issue) => issue.msg.replace(/^Value error, /, "")).join("; ")
    } catch { /* keep the generic message */ }
    throw new Error(message)
  }
  return response
}

export async function paceRequest<T>(path: string, schema: z.ZodType<T>, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  return schema.parse(await (await authorized(path, options)).json())
}

/** Download the branded pace PDF for the current (possibly unsaved) athlete data. */
export async function downloadPacePdf(body: unknown, filename: string) {
  const blob = await (await authorized("/pdf", { body })).blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filename.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "paces"}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Seconds from "28.45", "1:02.3" or "16:05"; null when the text is not a valid swim time. */
export function parseTime(text: string): number | null {
  const value = text.trim()
  if (!/^\d+(?::[0-5]\d)?(?:\.\d{1,3})?$/.test(value)) return null
  const parts = value.split(":")
  const seconds = Number(parts[parts.length - 1]) + (parts.length === 2 ? Number(parts[0]) * 60 : 0)
  return seconds > 0 && seconds <= 7200 ? seconds : null
}

export function formatPace(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return minutes ? `${minutes}:${rest.toFixed(1).padStart(4, "0")}` : rest.toFixed(1)
}

export function formatRange(range: PaceRange | null) {
  if (!range) return "—"
  return Math.abs(range.fast - range.slow) < 0.05 ? formatPace(range.fast) : `${formatPace(range.fast)} – ${formatPace(range.slow)}`
}

/** Only complete, valid rows are sent to the API; unfinished inputs stay in the form. */
export function cleanAthlete(data: AthleteData): AthleteData {
  return {
    ...data,
    pbs: Object.fromEntries(Object.entries(data.pbs).map(([key, entries]) => [key, entries.filter((entry) => parseTime(entry.time) !== null)]).filter(([, entries]) => entries.length)),
    tests: Object.fromEntries(Object.entries(data.tests).map(([key, test]) => [key, {
      t200: test.t200 && parseTime(test.t200) !== null ? test.t200 : null,
      t400: test.t400 && parseTime(test.t400) !== null ? test.t400 : null,
      tested_on: test.tested_on || null,
    }])),
  }
}
