import { z } from "zod"
import { swimSessionSchema } from "@/lib/workout-schemas"
import {
  builderSectionSchema, gymWeekSchema, gymWorkoutSchema, mondayISO, shiftWeek, trainingRequest, weekSchema,
  type GymItem, type GymWeek, type TrainingWeek,
} from "@/lib/training"

/**
 * Training a coach writes in chat or on a call, added to the athlete's swim and gym weeks (backend/app/coach_plan.py).
 * The reply is read into sessions in the weeks' own formats; the athlete picks a day for each and adds them.
 */

/** The kinds of session a coach's reply prescribes (from the chat), which the chat offers to add. */
export type PlanKind = "swim" | "gym" | "both"

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const
const dayHintSchema = z.enum([...WEEKDAYS, "today", "tomorrow"]).nullable()

const gymDocSchema = z.object({
  title: z.string(), intensity: z.enum(["Minimal", "Moderate", "Full"]), notes: z.string(), rationale: z.string(),
  coaching_notes: z.string(), duration_minutes: z.number().nullable(), sections: z.array(builderSectionSchema),
})

export const planSessionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("swim"), id: z.string(), title: z.string(), day: dayHintSchema, workout: swimSessionSchema }),
  z.object({
    kind: z.literal("gym"), id: z.string(), title: z.string(), day: dayHintSchema, focus: z.enum(["strength", "mobility"]),
    doc: gymDocSchema, workout: gymWorkoutSchema,
  }),
])
export const coachPlanSchema = z.object({
  title: z.string(), coach: z.string(), sessions: z.array(planSessionSchema).min(1),
  // Sessions left out: named by the coach without their sets or exercises (rather than made up), or couldn't be read.
  skipped: z.array(z.object({
    kind: z.enum(["swim", "gym"]), title: z.string(), day: dayHintSchema, reason: z.enum(["named", "unreadable"]).optional(),
  })).optional(),
})
const addedSchema = z.object({
  added: z.array(z.object({ kind: z.enum(["swim", "gym"]), date: z.string(), title: z.string(), week_start: z.string() })),
})

export type PlanSession = z.infer<typeof planSessionSchema>
export type CoachPlan = z.infer<typeof coachPlanSchema>
export type AddedSession = z.infer<typeof addedSchema>["added"][number]
/** Where an added session went: the Training section opens on that sub-tab and week. */
export type TrainingTarget = { tab: "week" | "library"; weekStart: string }

/** Read a coach's reply into its sessions (nothing is saved). */
export const readCoachPlan = (body: { reply: string; request: string; spoken: boolean }, signal?: AbortSignal) =>
  trainingRequest("/coach-plan/read", coachPlanSchema, { body, signal })

// Reads by reply (the chat message's id), started when the athlete opens it to add (reading costs a token a session,
// app/tokens.py, so nothing is read they didn't ask for): opening it again shows the plan straight away, or waits on the
// read already under way. A failed read is forgotten, so opening it again tries again.
const reads = new Map<string, Promise<CoachPlan>>()
export function readPlanFor(id: string, body: { reply: string; request: string; spoken: boolean }): Promise<CoachPlan> {
  let read = reads.get(id)
  if (!read) {
    read = readCoachPlan(body)
    read.catch(() => { if (reads.get(id) === read) reads.delete(id) })
    reads.set(id, read)
  }
  return read
}

/**
 * Whether a plan's sessions still have the ids its read gave them (version 8 UUIDs, signed by the backend: _session_id in
 * coach_plan.py), under which adding them is paid for by the read. Under any other id (a copy's, "Add again") adding
 * them costs a token a session; a plan kept from before reads gave such ids is read again, at no cost.
 */
export const fromRead = (plan: CoachPlan) => plan.sessions.every((session) => session.id[14] === "8")

/** Put sessions on the days picked for them. Sent again after a lost reply, each is still added once (by its id). */
export const addCoachPlan = (sessions: { session: PlanSession; date: string }[]) =>
  trainingRequest("/coach-plan/add", addedSchema, {
    body: {
      sessions: sessions.map(({ session, date }) => session.kind === "swim"
        ? { kind: "swim", id: session.id, date, workout: session.workout }
        : { kind: "gym", id: session.id, date, focus: session.focus, doc: session.doc }),
    },
  })

export const swimMeters = (session: PlanSession) => session.kind === "swim"
  ? session.workout.sets.reduce((sum, set) => sum + set.rounds * set.repetitions * set.distance_meters, 0) : 0

/** A coach's workout as the gym week shows one (for its details before it's added). */
export const asGymItem = (session: Extract<PlanSession, { kind: "gym" }>): GymItem => ({
  key: session.id, date: "", workout: session.workout, dose: session.doc.intensity, focus: "", completed: false,
  source_files: [], edited: false, source: "coach",
})

// ---------------------------------------------------------------- the week the sessions go in
/** What a day of a week already holds, and whether a session can still go on it. */
export type DayLoad = {
  date: string; dayName: string; past: boolean
  swims: number; meters: number; gyms: number; minutes: number; meets: string[]
  /** The day's sessions, swims and gym workouts, by title (to spot a session added twice). */
  titles: string[]
}
export type WeekLoad = { weekStart: string; days: DayLoad[]; generated: boolean }

// The same rules the swim week keeps when a swim is added, moved or copied: two swims and 16,000 m a day.
export const MAX_SWIMS_A_DAY = 2
export const MAX_METERS_A_DAY = 16000

export function weekLoad(swim: TrainingWeek, gym: GymWeek, today: string): WeekLoad {
  return {
    weekStart: swim.week_start, generated: swim.generated,
    days: swim.days.map((day) => {
      const gymDay = gym.days.find((entry) => entry.date === day.date)
      return {
        date: day.date, dayName: day.day_name, past: day.date < today,
        swims: day.workouts.length, meters: day.workouts.reduce((sum, item) => sum + item.distance_meters, 0),
        gyms: gymDay?.workouts.length ?? 0, minutes: gymDay?.workouts.reduce((sum, item) => sum + item.workout.estimated_duration_minutes, 0) ?? 0,
        meets: day.competitions.map((meet) => meet.name),
        titles: [...day.workouts.map((item) => item.workout.title), ...(gymDay?.workouts.map((item) => item.workout.title) ?? [])],
      }
    }),
  }
}

export async function loadWeek(weekStart: string, today: string, signal?: AbortSignal): Promise<WeekLoad> {
  const [swim, gym] = await Promise.all([
    trainingRequest(`/week?week_start=${weekStart}`, weekSchema, { signal }),
    trainingRequest(`/gym/week?week_start=${weekStart}`, gymWeekSchema, { signal }),
  ])
  return weekLoad(swim, gym, today)
}

/** Why `session` can't go on `day`, beside the other sessions placed this week (`others`); null when it can. */
export function dayProblem(session: PlanSession, day: DayLoad, others: PlanSession[]): string | null {
  if (day.past) return "This day is over"
  if (session.kind !== "swim") return null
  const swims = others.filter((other) => other.kind === "swim")
  if (day.swims + swims.length + 1 > MAX_SWIMS_A_DAY) return "Already two swims on this day"
  if (day.meters + swims.reduce((sum, other) => sum + swimMeters(other), 0) + swimMeters(session) > MAX_METERS_A_DAY) return "Over 16,000 m on this day"
  return null
}

const weekdayIndex = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** The date a session's day hint points at in the week starting `weekStart` (relative hints only in their own week). */
export function hintedDate(session: PlanSession, weekStart: string, today: string): string | null {
  if (!session.day) return null
  if (session.day === "today" || session.day === "tomorrow") {
    const date = session.day === "today" ? today : addDays(today, 1)
    return mondayISO(new Date(`${date}T00:00:00Z`)) === weekStart ? date : null
  }
  return addDays(weekStart, WEEKDAYS.indexOf(session.day))
}

/** The week to start in: this one, unless a day the coach named has already gone (then next week). */
export function startingWeek(sessions: PlanSession[], today: string): string {
  const thisWeek = mondayISO(new Date(`${today}T00:00:00Z`))
  const relative = sessions.find((session) => session.day === "today" || session.day === "tomorrow")
  if (relative) return mondayISO(new Date(`${relative.day === "today" ? today : addDays(today, 1)}T00:00:00Z`))
  const gone = sessions.some((session) => session.day && WEEKDAYS.indexOf(session.day as (typeof WEEKDAYS)[number]) < weekdayIndex(today))
  return gone ? shiftWeek(thisWeek, 1) : thisWeek
}

/**
 * A day for each session in `week`: the weekday it already has (`keep`, when moving the plan to another week) or the
 * coach named, when that day can take it; the rest in order from there, each on a day without a session of its own kind
 * when there is one, so a plan spreads through the week the way the coach laid it out.
 */
export function placeSessions(sessions: PlanSession[], week: WeekLoad, today: string, keep: Record<string, number | null> = {}): Record<string, string | null> {
  const placed: Record<string, string | null> = {}
  const onDay = (date: string) => sessions.filter((other) => placed[other.id] === date)
  const fits = (session: PlanSession, day: DayLoad) => !dayProblem(session, day, onDay(day.date))
  for (const session of sessions) {
    const kept = keep[session.id]
    const wanted = kept !== undefined && kept !== null ? week.days[kept]?.date : hintedDate(session, week.weekStart, today)
    const day = week.days.find((entry) => entry.date === wanted)
    if (day && fits(session, day)) placed[session.id] = day.date
  }
  let cursor = Math.max(0, week.days.findIndex((day) => !day.past))
  for (const session of sessions) {
    if (placed[session.id] !== undefined) {
      cursor = Math.max(cursor, week.days.findIndex((day) => day.date === placed[session.id]) + 1)
      continue
    }
    const open = week.days.filter((day) => fits(session, day))
    const later = open.filter((day) => week.days.indexOf(day) >= cursor)
    const free = (day: DayLoad) => (session.kind === "swim" ? day.swims : day.gyms) === 0
      && !onDay(day.date).some((other) => other.kind === session.kind)
    const day = later.find(free) ?? later[0] ?? open.find(free) ?? open[0] ?? null
    placed[session.id] = day?.date ?? null
    if (day) cursor = week.days.indexOf(day) + 1
  }
  return placed
}

/** The day of `week` that already holds a session with this one's title (it was added before), or null. */
export const alreadyIn = (session: PlanSession, week: WeekLoad) => {
  const title = session.title.trim().toLowerCase()
  return week.days.find((day) => day.titles.some((other) => other.trim().toLowerCase() === title)) ?? null
}

/** The weekday (0 = Monday) each placed session is on, to keep when the plan moves to another week. */
export const placedWeekdays = (placed: Record<string, string | null>) =>
  Object.fromEntries(Object.entries(placed).map(([id, date]) => [id, date ? weekdayIndex(date) : null]))
