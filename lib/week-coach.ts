import { z } from "zod"
import { supabase } from "@/lib/supabase"
import { mobilityWorkSchema, swimSessionSchema } from "@/lib/workout-schemas"
import {
  builderSectionSchema, gymWeekSchema, gymWorkoutSchema, trainingRequest, weekSchema,
  type GymWeek, type GymWorkoutData, type SwimWorkout, type TrainingWeek,
} from "@/lib/training"

/** The week a coach chat changes: the Swim week or the Gym week. */
export type WeekKind = "swim" | "gym"
export type Mobility = z.infer<typeof mobilityWorkSchema>

export const changeSchema = z.object({
  id: z.string(),
  action: z.enum(["edit", "add", "remove", "move", "copy", "replan"]),
  label: z.string(),
  ref: z.string().nullable(),
  kind: z.enum(["swim", "mobility", "gym"]),
  key: z.string().nullable(),
  date: z.string(),
  to: z.string().nullable(),
  title: z.string(),
  before: z.unknown().nullable(),
  base: z.string().nullable(),
  format: z.enum(["ai", "builder"]).nullable(),
  focus: z.enum(["swim", "strength", "mobility"]).nullable(),
  writing: z.boolean(),
})
export type PlannedChange = z.infer<typeof changeSchema>
export type ChangeAction = PlannedChange["action"]

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plan"), message: z.string(), changes: z.array(changeSchema), notes: z.array(z.string()), elsewhere: z.boolean().optional() }),
  z.object({ type: z.literal("change"), id: z.string(), workout: z.unknown().optional(), doc: z.unknown().optional(), mobility: z.unknown().optional() }),
  z.object({ type: z.literal("failed"), id: z.string(), detail: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), detail: z.string() }),
])
export type CoachEvent = z.infer<typeof eventSchema>

export type Turn = { role: "athlete" | "coach"; text: string }

async function token() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error("Sign in again to talk to your coach.")
  return session.access_token
}

async function failure(response: Response): Promise<Error> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { detail?: string | { msg: string }[] }
    if (typeof parsed.detail === "string") return new Error(parsed.detail)
    if (Array.isArray(parsed.detail)) return new Error(parsed.detail.map((item) => item.msg).join("; "))
  } catch { /* not JSON */ }
  return new Error(`Your coach couldn't answer just now (${response.status}). Please try again.`)
}

/**
 * Ask the coach to change the week. Its answer streams in: the coach's message and the changes it makes first
 * ("plan"), then each change as it's written ("change" or "failed"), then "done".
 */
export async function askWeekCoach(body: { kind: WeekKind; week_start: string; message: string; history: Turn[] },
  onEvent: (event: CoachEvent) => void, signal?: AbortSignal): Promise<void> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  let response: Response
  try {
    response = await fetch(`${apiUrl}/api/training/week-coach/chat`, {
      method: "POST", signal, body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error("We lost the connection to SwimGPT. Check your internet connection and try again.")
  }
  if (!response.ok || !response.body) throw await failure(response)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const flush = (line: string) => {
    if (!line.trim()) return
    const parsed = eventSchema.safeParse(JSON.parse(line))
    if (parsed.success) onEvent(parsed.data)
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let end: number
      while ((end = buffer.indexOf("\n")) >= 0) {
        flush(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)
      }
    }
    flush(buffer + decoder.decode())
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error("The connection dropped while your coach was answering. Please try again.")
  }
}

const changeResult = z.object({ id: z.string(), highlight: z.array(z.string()), undo: z.boolean() })

/** A change ready to apply: the coach's change and, for one it wrote, what it wrote. */
export type ReadyChange = PlannedChange & { workout?: unknown; doc?: unknown; mobility?: unknown }

function appliedBody(change: ReadyChange) {
  const moves = change.action === "add" ? change.date : change.to
  return {
    id: change.id, action: change.action, kind: change.kind, key: change.key, base: change.base, date: moves,
    ...(change.workout !== undefined && { workout: change.workout }),
    ...(change.doc !== undefined && { doc: change.doc }),
    ...(change.mobility !== undefined && { mobility: change.mobility }),
    ...(change.kind === "gym" && change.action === "add" && { focus: change.focus === "mobility" ? "mobility" : "strength" }),
  }
}

export async function applyWeekChanges<K extends WeekKind>(kind: K, weekStart: string, id: string, changes: ReadyChange[]) {
  const week = kind === "swim" ? weekSchema : gymWeekSchema
  return trainingRequest("/week-coach/apply", z.object({ week, change: changeResult }), {
    body: { id, kind, week_start: weekStart, changes: changes.map(appliedBody) },
  }) as Promise<{ week: K extends "swim" ? TrainingWeek : GymWeek; change: z.infer<typeof changeResult> }>
}

export async function undoWeekChange<K extends WeekKind>(kind: K, weekStart: string, id: string) {
  const week = kind === "swim" ? weekSchema : gymWeekSchema
  return trainingRequest("/week-coach/undo", z.object({ week, highlight: z.array(z.string()) }), {
    body: { id, kind, week_start: weekStart },
  }) as Promise<{ week: K extends "swim" ? TrainingWeek : GymWeek; highlight: string[] }>
}

// ---------------------------------------------------------------- what a change looks like
export const parseSwim = (value: unknown): SwimWorkout | null => {
  const parsed = swimSessionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
export const parseGym = (value: unknown): GymWorkoutData | null => {
  const parsed = gymWorkoutSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
export const parseMobility = (value: unknown): Mobility[] | null => {
  const parsed = z.array(mobilityWorkSchema).safeParse(value)
  return parsed.success ? parsed.data : null
}
export const parseSections = (value: unknown) => {
  const parsed = z.array(builderSectionSchema).safeParse(value)
  return parsed.success ? parsed.data : null
}

/** What makes a set, exercise or section the same one through a change: its name, without the numbers that change. */
export const sameName = (name: string) => name.toLowerCase().replace(/\d+(?:[.,]\d+)?|[x×]/g, "").replace(/\s+/g, " ").trim()

export const swimMeters = (workout: SwimWorkout) =>
  workout.sets.reduce((sum, item) => sum + item.rounds * item.repetitions * item.distance_meters, 0)

/** One line of a diff: kept as it was, added, removed, or changed (with what it was). */
export type DiffRow<T> = { state: "same" | "added" | "removed" | "changed"; item: T; was?: T }

/**
 * How a list changed, item by item: the longest run of items kept exactly as they were, and between them the items
 * that went and came. One that came is shown as a change of one that went when `identity` says they're the same item
 * (a set renamed "6 x 100" from "8 x 100"); otherwise one went and another came.
 */
export function diffList<T>(before: T[], after: T[], identity: (item: T) => string = (item) => JSON.stringify(item)): DiffRow<T>[] {
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b)
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = same(before[i], after[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const rows: DiffRow<T>[] = []
  let gone: T[] = []
  let come: T[] = []
  const settle = () => {
    const left = [...gone]
    const came = come.map((item): DiffRow<T> => {
      const match = left.findIndex((old) => identity(old) === identity(item))
      return match >= 0 ? { state: "changed", item, was: left.splice(match, 1)[0] } : { state: "added", item }
    })
    left.forEach((item) => rows.push({ state: "removed", item }))
    rows.push(...came)
    gone = []; come = []
  }
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && same(before[i], after[j])) {
      settle()
      rows.push({ state: "same", item: after[j] })
      i++; j++
    } else if (j < after.length && (i >= before.length || table[i][j + 1] >= table[i + 1][j])) {
      come.push(after[j]); j++
    } else {
      gone.push(before[i]); i++
    }
  }
  settle()
  return rows
}

// ---------------------------------------------------------------- what to ask
const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const weekday = (iso: string) => WEEKDAY[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7]

/** What asking for a fresh plan says, in each week. */
export const FRESH_PLAN: Record<WeekKind, string> = {
  swim: "Re-plan the rest of this week from scratch",
  gym: "Re-plan the rest of my gym week from scratch",
}

/** Things to ask, from the week as it stands: its next session, a free day, the rest of the week. */
export function suggestions(kind: WeekKind, week: TrainingWeek | GymWeek | null, today: string): string[] {
  if (!week) return []
  const ahead = week.days.filter((day) => day.date >= today)
  if (kind === "swim") {
    const days = ahead as TrainingWeek["days"]
    const next = days.find((day) => day.workouts.some((item) => !item.completed))
    const free = days.find((day) => !day.workouts.length && day.date !== next?.date)
    const later = days.find((day) => day.date > (next?.date ?? today) && day.workouts.length < 2 && day.date !== next?.date)
    return [
      next && `Make ${weekday(next.date)}'s swim about 20 minutes shorter`,
      next && `Add more kick to ${weekday(next.date)}'s swim`,
      next && later && `Move ${weekday(next.date)}'s swim to ${weekday(later.date)}`,
      free && `Add an easy recovery swim on ${weekday(free.date)}`,
      next && "I'm sore: make the rest of this week easier",
      !next && free && `Add a threshold swim on ${weekday(free.date)}`,
      next && `Swap the main set of ${weekday(next.date)}'s swim for race-pace work`,
    ].filter((item): item is string => !!item).slice(0, 5)
  }
  const days = ahead as GymWeek["days"]
  const next = days.find((day) => day.workouts.some((item) => !item.completed))
  const free = days.find((day) => !day.workouts.length)
  return [
    next && `Make ${weekday(next.date)}'s workout 30 minutes`,
    next && `Swap an exercise in ${weekday(next.date)}'s workout for one that's easier on my shoulders`,
    `Add a core workout on ${weekday((free ?? days[days.length - 1] ?? week.days[6]).date)}`,
    next && "I only have bands and bodyweight this week",
    next && `Take ${weekday(next.date)}'s workout off`,
  ].filter((item): item is string => !!item).slice(0, 5)
}

export { weekday }
