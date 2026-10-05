import { z } from "zod"

export const swimSetSchema = z.object({
  name: z.string(),
  rounds: z.number().int().positive(),
  repetitions: z.number().int().positive(),
  distance_meters: z.number().int().positive(),
  stroke: z.string(),
  interval: z.string(),
  target_time: z.string().nullable(),
  training_zone: z.string(),
  equipment: z.array(z.string()),
  description: z.string(),
  technical_focus: z.array(z.string()),
})

export const swimSessionSchema = z.object({
  title: z.string(),
  objective: z.string(),
  event: z.string().nullable().optional(),
  notes: z.string().optional(),
  estimated_duration_minutes: z.number(),
  main_training_zones: z.array(z.string()),
  equipment: z.array(z.string()),
  sets: z.array(swimSetSchema),
})

export const strengthSessionSchema = z.object({
  title: z.string(),
  objective: z.string(),
  estimated_duration_minutes: z.number(),
  exercises: z.array(z.object({
    exercise: z.string(), sets: z.number(), repetitions: z.string(), load: z.string(),
    rest_seconds: z.number(), tempo: z.string().nullable(), demonstration: z.array(z.string()),
  })),
})

export const mobilityWorkSchema = z.object({
  category: z.string(), exercise: z.string(), duration_minutes: z.number(), instructions: z.array(z.string()),
})

