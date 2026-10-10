import { z } from "zod"
import { apiRequest, localDay } from "@/lib/api"

export const SKILLS = ["confidence", "focus", "calm", "motivation", "resilience"] as const
export type Skill = (typeof SKILLS)[number]

export const mindAnswersSchema = z.object({
  goal: z.enum(["nerves", "confidence", "focus", "resilience", "motivation", "balance"]),
  confidence: z.number(),
  focus: z.number(),
  calm: z.number(),
  motivation: z.number(),
  resilience: z.number(),
  pre_race: z.enum(["calm", "excited", "anxious", "flat"]),
  routine: z.enum(["set", "loose", "none"]),
  setback: z.enum(["move_on", "replay", "doubt", "frustrated"]),
  sleep: z.enum(["well", "ok", "poorly"]),
  stress: z.enum(["low", "medium", "high"]),
  mood: z.enum(["good", "mixed", "low"]),
  tools: z.array(z.enum(["breathing", "visualisation", "music", "self_talk", "journaling", "talking"])),
})
const weekSchema = z.array(z.object({ date: z.string(), mood: z.number().nullable() }))
export const mindPlanSchema = z.object({
  goal: z.object({ key: z.string(), title: z.string(), approach: z.string() }),
  skills: z.array(z.object({ key: z.enum(SKILLS), label: z.string(), value: z.number() })),
  strength: z.enum(SKILLS).nullable(),
  working_on: z.enum(SKILLS),
  reset: z.object({ text: z.string(), uses: z.boolean() }),
  routine: z.object({ note: z.string(), steps: z.array(z.object({ key: z.string(), when: z.string(), title: z.string(), text: z.string() })) }),
  toolkit: z.array(z.object({ key: z.string(), icon: z.string(), title: z.string(), why: z.string(), steps: z.array(z.string()), uses: z.boolean() })),
  wellbeing: z.array(z.object({ key: z.string(), label: z.string(), tone: z.enum(["good", "fair", "low"]) })),
})
export const mentalSchema = z.object({ answers: mindAnswersSchema.nullable(), plan: mindPlanSchema.nullable(), week: weekSchema, support: z.boolean() })
const checkInSchema = z.object({ week: weekSchema, support: z.boolean() })

export type MindAnswers = z.infer<typeof mindAnswersSchema>
export type MindPlan = z.infer<typeof mindPlanSchema>
export type MentalData = z.infer<typeof mentalSchema>
export type MoodWeek = z.infer<typeof weekSchema>

export const loadMental = (signal?: AbortSignal) => apiRequest(`/mental?date=${localDay()}`, mentalSchema, { signal })

export const saveMental = (answers: MindAnswers) => apiRequest(`/mental?date=${localDay()}`, mentalSchema, { method: "PUT", body: answers })

/** Today's mood, 1 (rough) to 5 (great). */
export const checkIn = (mood: number) => apiRequest("/mental/checkin", checkInSchema, { body: { date: localDay(), mood } })
