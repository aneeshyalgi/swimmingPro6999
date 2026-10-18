import { z } from "zod"
import { apiRequest } from "@/lib/api"
import { supabase } from "@/lib/supabase"

// The survey at /survey (backend/app/survey.py): each list here matches the backend's choices.
export const FEATURES = ["swim_week", "gym_week", "workout_builder", "competitions", "coach_chat", "voice_calls", "nutrition",
  "mental", "video_analysis", "pace_calculator", "training_plans"] as const
export const FREQUENCIES = ["daily", "few_weekly", "weekly", "rarely"] as const
export const IMPACTS = ["much_better", "better", "same", "worse"] as const
export const LIKES = ["personalised", "coach", "workouts", "variety", "ease", "design", "progress", "all_in_one", "value"] as const
export const IMPROVEMENTS = ["workout_fit", "coach_answers", "ease", "speed", "bugs", "phone", "features", "price", "nothing"] as const
export const WISHES = ["watch_sync", "progress_charts", "drill_videos", "teams", "offline", "reminders", "calendar_sync", "community",
  "languages"] as const
/** Likes and wishes: up to this many each. */
export const MOST_PICKS = 3
export const NOTE_LENGTH = 1000
export const COMMENT_LENGTH = 2000

export type Feature = (typeof FEATURES)[number]
export type Frequency = (typeof FREQUENCIES)[number]
export type Impact = (typeof IMPACTS)[number]
export type Like = (typeof LIKES)[number]
export type Improvement = (typeof IMPROVEMENTS)[number]
export type Wish = (typeof WISHES)[number]

const stars = z.number().int().min(1).max(5)
const draftSchema = z.object({
  rating: stars.nullable(),
  usage_frequency: z.enum(FREQUENCIES).nullable(),
  training_impact: z.enum(IMPACTS).nullable(),
  features_used: z.array(z.enum(FEATURES)),
  feature_ratings: z.record(z.enum(FEATURES), stars),
  liked: z.array(z.enum(LIKES)).max(MOST_PICKS),
  liked_note: z.string().max(NOTE_LENGTH),
  improve: z.array(z.enum(IMPROVEMENTS)),
  improve_note: z.string().max(NOTE_LENGTH),
  wishlist: z.array(z.enum(WISHES)).max(MOST_PICKS),
  wishlist_note: z.string().max(NOTE_LENGTH),
  recommend: z.number().int().min(0).max(10).nullable(),
  comments: z.string().max(COMMENT_LENGTH),
  contact_ok: z.boolean(),
})
/** The answers while they're being given: a question not answered yet is null (or empty). */
export type SurveyDraft = z.infer<typeof draftSchema>
/** Where the athlete is in the survey and what they've answered so far. */
export type SurveyProgress = { step: number; answers: SurveyDraft }

/** The answers as they're sent, once every required question is answered. */
export type SurveyAnswers = Omit<SurveyDraft, "rating" | "usage_frequency" | "training_impact" | "recommend"> & {
  rating: number; usage_frequency: Frequency; training_impact: Impact; recommend: number
}

export const emptyDraft = (): SurveyDraft => ({
  rating: null, usage_frequency: null, training_impact: null, features_used: [], feature_ratings: {}, liked: [], liked_note: "",
  improve: [], improve_note: "", wishlist: [], wishlist_note: "", recommend: null, comments: "", contact_ok: false,
})

// GET and POST /api/survey. `available` is false until the survey's table exists; `response` is this round's answer.
const stateSchema = z.object({
  version: z.string(),
  available: z.boolean(),
  response: z.object({ rating: z.number(), submitted_at: z.string() }).nullable(),
})
export type SurveyState = z.infer<typeof stateSchema>

export const sendSurvey = (answers: SurveyAnswers) => apiRequest("/survey", stateSchema, { body: answers })

/** Why someone can't take the survey: they aren't signed in, don't pay for SwimGPT, or haven't set up their profile. */
export type SurveyBlock = "signed_out" | "unpaid" | "no_profile"
/** The survey for whoever is signed in (with their account, which their unsent answers are kept under, and first name),
 * or why they can't take it. */
export type SurveyAccess = { state: SurveyState; account: string; firstName: string } | { blocked: SurveyBlock }

/** Opens the survey for whoever is signed in. Only athletes who pay for SwimGPT get it; the API refuses anyone else. */
export async function openSurvey(signal?: AbortSignal): Promise<SurveyAccess> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) return { blocked: "signed_out" }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const response = await fetch(`${apiUrl}/api/survey`, { headers: { Authorization: `Bearer ${session.access_token}` }, signal })
  if (response.status === 401) return { blocked: "signed_out" }
  if (response.status === 402) return { blocked: "unpaid" }
  if (response.status === 404) return { blocked: "no_profile" }
  if (!response.ok) throw new Error("The survey couldn't be loaded just now. Please try again.")
  const fullName = String(session.user.user_metadata?.full_name ?? "").trim()
  return { state: stateSchema.parse(await response.json()), account: session.user.id, firstName: fullName.split(/\s+/)[0] }
}

// Answers not yet sent are kept on this device only, per round and account, so leaving the survey, closing the tab or
// the browser doesn't lose them.
const progressKey = (version: string, account: string) => `swimgpt_survey_${version}_${account}`
const progressSchema = z.object({ step: z.number().int().min(0), answers: draftSchema })

export function readProgress(version: string, account: string): SurveyProgress | null {
  try {
    const parsed = progressSchema.safeParse(JSON.parse(window.localStorage.getItem(progressKey(version, account)) ?? "null"))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveProgress(version: string, account: string, progress: SurveyProgress) {
  try { window.localStorage.setItem(progressKey(version, account), JSON.stringify(progress)) } catch { /* private mode or full */ }
}

export function clearProgress(version: string, account: string) {
  try { window.localStorage.removeItem(progressKey(version, account)) } catch { /* private mode */ }
}
