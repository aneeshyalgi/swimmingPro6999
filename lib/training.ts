import { z } from "zod"
import { supabase } from "@/lib/supabase"
import { swimSessionSchema, strengthSessionSchema, mobilityWorkSchema } from "@/lib/workout-schemas"

export const workoutSchema = z.object({
  key: z.string(), workout: swimSessionSchema, date: z.string().nullable(),
  phase: z.string(), pool_length: z.number().nullable(), event: z.string().nullable(),
  origin: z.string(), favorite: z.boolean(), template: z.boolean(), completed: z.boolean(),
  distance_meters: z.number(), zones: z.record(z.number()), composition: z.record(z.number()),
  source_files: z.array(z.string()),
})
export const builderExerciseSchema = z.object({
  name: z.string(), sets: z.number(), reps: z.string(), load: z.string(), rest_seconds: z.number(), tempo: z.string(), notes: z.string(),
})
export const builderSectionSchema = z.object({
  id: z.string(), title: z.string(), kind: z.string(), notes: z.string(), exercises: z.array(builderExerciseSchema), collapsed: z.boolean(),
})
export const gymWorkoutSchema = z.object({
  title: z.string(), objective: z.string(), rationale: z.string(), intensity: z.string(),
  estimated_duration_minutes: z.number(), warm_up: z.array(z.string()), cool_down: z.array(z.string()), coaching_notes: z.string(),
  exercises: z.array(z.object({
    exercise: z.string(), sets: z.number(), repetitions: z.string(), load: z.string(), rest_seconds: z.number(),
    tempo: z.string().nullable(), demonstration: z.array(z.string()), swim_benefit: z.string(),
  })),
  sections: z.array(builderSectionSchema).optional(),
  meta: z.object({ start_time: z.string().nullable(), end_time: z.string().nullable(), label: z.string(), location: z.string() }).optional(),
})
export const gymItemSchema = z.object({
  key: z.string(), date: z.string(), workout: gymWorkoutSchema, dose: z.string(), focus: z.string(),
  completed: z.boolean(), source_files: z.array(z.string()), edited: z.boolean(), source: z.string(),
})
export const gymListSchema = z.object({ workouts: z.array(gymItemSchema), sessions_per_week: z.number(), equipment: z.string() })
export const gymWeekSchema = z.object({
  week_start: z.string(),
  days: z.array(z.object({ date: z.string(), day_name: z.string(), workouts: z.array(gymItemSchema) })),
  summary: z.object({ sessions: z.number(), completed: z.number(), minutes: z.number(), exercises: z.number() }),
  sessions_per_week: z.number(), equipment: z.string(),
})
export const gymSavedSchema = z.object({ item: gymItemSchema, week: gymWeekSchema })
export const librarySchema = z.object({
  workouts: z.array(workoutSchema),
  strength_sessions: z.array(z.object({ date: z.string(), workout: strengthSessionSchema, phase: z.string() })),
})
const splitSchema = z.object({ distance_meters: z.number(), seconds: z.number() })
export const racePlanSchema = z.object({
  event: z.string(), target_time: z.string().nullable(), target_splits: z.array(splitSchema),
  race_strategy: z.string(), stroke_rate_target: z.string().nullable(),
  underwater_target: z.string().nullable(), breakout_target: z.string().nullable(),
  technical_cues: z.array(z.string()), mental_cues: z.array(z.string()),
})
export const raceResultSchema = z.object({
  event: z.string(), final_time: z.string(), splits: z.array(splitSchema),
  ranking: z.number().nullable(), stroke_rate: z.number().nullable(),
  underwaters: z.string(), feedback: z.string(),
})
export const competitionSchema = z.object({
  id: z.string(), name: z.string(), date: z.string(), location: z.string(),
  pool_length: z.number(), events: z.array(z.string()), priority: z.string(),
  races: z.array(racePlanSchema), source_files: z.array(z.string()),
  results: z.array(z.object({
    competition_id: z.string(), result: raceResultSchema,
    analysis: z.object({
      target_time: z.string().nullable(), delta_seconds: z.number().nullable(),
      pb_status: z.string(), previous_best_seconds: z.number().nullable(),
      split_comparison: z.array(z.object({
        distance_meters: z.number(), planned_seconds: z.number(),
        actual_seconds: z.number(), delta_seconds: z.number(),
      })),
      training_focus: z.array(z.string()), warnings: z.array(z.string()),
    }),
  })),
})
export const competitionsSchema = z.object({
  competitions: z.array(competitionSchema), main_events: z.array(z.string()),
  events: z.array(z.string()), default_pool_length: z.number().nullable(),
})
export const weekSchema = z.object({
  week_start: z.string(), generated: z.boolean(), phase: z.string().nullable(),
  coaching_note: z.string().nullable(),
  days: z.array(z.object({
    date: z.string(), day_name: z.string(), objective: z.string(), workouts: z.array(workoutSchema),
    strength: strengthSessionSchema.nullable(), mobility: z.array(mobilityWorkSchema),
    strength_completed: z.boolean(), mobility_completed: z.boolean(),
    recovery: z.array(z.string()), rest: z.boolean(), competitions: z.array(competitionSchema),
  })),
  summary: z.object({
    swim_volume_meters: z.number(), swim_sessions: z.number(), strength_sessions: z.number(),
    mobility_sessions: z.number(), duration_minutes: z.number(),
  }),
  zones: z.array(z.object({ zone: z.string(), meters: z.number(), percentage: z.number() })),
  composition: z.array(z.object({ label: z.string(), meters: z.number() })),
})
export const pacesSchema = z.object({
  paces: z.array(z.object({
    event: z.string(), course: z.string(), pb: z.string(), per_50_seconds: z.number(),
    per_100_seconds: z.number(), target: z.string().nullable(),
  })),
  css: z.array(z.object({ course: z.string(), seconds_per_100: z.number(), basis: z.string() })),
  warnings: z.array(z.string()), zones: z.array(z.object({ name: z.string(), guidance: z.string() })),
})

export type Workout = z.infer<typeof workoutSchema>
export type GymItem = z.infer<typeof gymItemSchema>
export type GymWeek = z.infer<typeof gymWeekSchema>
export type BuilderExercise = z.infer<typeof builderExerciseSchema>
export type BuilderSection = z.infer<typeof builderSectionSchema>
export type GymWorkoutData = z.infer<typeof gymWorkoutSchema>
export type StrengthFocus = "coach" | "upper" | "lower" | "full" | "core"
export type StrengthRequest = { week_start: string; mode: "week" | "single"; day?: string; focus?: StrengthFocus; notes: string }
export type SwimWorkout = z.infer<typeof swimSessionSchema>
export type TrainingWeek = z.infer<typeof weekSchema>
export type Competition = z.infer<typeof competitionSchema>
export type RaceResultData = z.infer<typeof raceResultSchema>

export async function trainingRequest<T>(
  path: string, schema: z.ZodType<T>, options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error("Sign in again to access your training data.")
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const response = await fetch(`${apiUrl}/api/training${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })
  if (!response.ok) {
    const text = await response.text()
    let detail = `Training request failed (${response.status}).`
    try {
      const parsed = JSON.parse(text) as { detail?: string | { msg: string }[] }
      if (typeof parsed.detail === "string") detail = parsed.detail
      else if (Array.isArray(parsed.detail)) detail = parsed.detail.map((item) => item.msg).join("; ")
    } catch {
      detail = `The training service returned an unexpected response (${response.status}).`
    }
    throw new Error(detail)
  }
  return schema.parse(await response.json())
}

export function mondayISO(day = new Date()): string {
  const date = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.toISOString().slice(0, 10)
}

export function shiftWeek(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta * 7)
  return date.toISOString().slice(0, 10)
}

export function timeText(seconds: number): string {
  const hundredths = Math.round(seconds * 100)
  const minutes = Math.floor(hundredths / 6000)
  const remainder = ((hundredths % 6000) / 100).toFixed(2).padStart(5, "0")
  return `${minutes}:${remainder}`
}

/** Fetch a PDF generated by the backend (under /api/training) and save it as `filename`.pdf. */
async function downloadPdf(path: string, filename: string) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error("Sign in again to export PDFs.")
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const response = await fetch(`${apiUrl}/api/training${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
  if (!response.ok) throw new Error(`The PDF could not be created (${response.status}).`)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement("a")
  link.href = url
  link.download = `${filename.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "SwimGPT"}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Download a workout as a PDF generated by the backend. */
export const downloadGymPdf = (key: string, title: string) => downloadPdf(`/gym/${encodeURIComponent(key)}/pdf`, title)

/** Download a Training Week swim as a PDF. */
export const downloadSwimPdf = (key: string, title: string) => downloadPdf(`/library/${encodeURIComponent(key)}/pdf`, title)

/** Download a Training Week day's strength session or mobility work as a PDF. */
export const downloadWeekItemPdf = (part: "strength" | "mobility", date: string, title: string) =>
  downloadPdf(`/week/${part}/pdf?date=${date}`, `${date} ${title}`)

/** Download a whole week (swim Training Week or the Workout Library week) as one PDF. */
export const downloadWeekPdf = (kind: "training" | "workouts", weekStart: string) =>
  kind === "training"
    ? downloadPdf(`/week/pdf?week_start=${weekStart}`, `SwimGPT Swim Week ${weekStart}`)
    : downloadPdf(`/gym/week/pdf?week_start=${weekStart}`, `SwimGPT Gym Week ${weekStart}`)
