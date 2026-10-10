import { z } from "zod"
import { apiRequest, localDay } from "@/lib/api"

const sexSchema = z.enum(["male", "female", "other"])
export const answersSchema = z.object({
  goal: z.enum(["perform", "build", "lean", "recover"]),
  sex: sexSchema,
  age: z.number(),
  height_cm: z.number(),
  weight_kg: z.number(),
  swim_time: z.enum(["early", "midday", "afternoon", "evening", "varies"]),
  meals_per_day: z.number(),
  pre_training: z.enum(["always", "sometimes", "rarely"]),
  water: z.enum(["under_1", "1_2", "2_3", "over_3"]),
  diet: z.enum(["any", "vegetarian", "vegan", "pescatarian"]),
  avoid: z.array(z.enum(["dairy", "gluten", "nuts", "eggs", "seafood", "soy"])),
  challenge: z.enum(["eating_enough", "cravings", "time", "energy", "hydration", "none"]),
})
const daySchema = z.object({ calories: z.number(), protein_g: z.number(), carbs_g: z.number(), fat_g: z.number(), water_l: z.number() })
export const planSchema = z.object({
  goal: z.object({ key: z.string(), title: z.string(), approach: z.string() }),
  summary: z.string(),
  training: z.object({ swims: z.number(), gyms: z.number(), swim_minutes: z.number(), training_days: z.number(), hours_per_day: z.number() }),
  days: z.object({ training: daySchema, rest: daySchema }),
  meals: z.number(),
  protein_per_meal_g: z.number(),
  sources: z.object({ protein: z.array(z.string()), carbs: z.array(z.string()), fat: z.array(z.string()) }),
  timeline: z.array(z.object({ key: z.string(), when: z.string(), title: z.string(), text: z.string(), ideas: z.array(z.string()) })),
  habits: z.array(z.object({ icon: z.string(), title: z.string(), body: z.string() })),
  youth: z.boolean(),
})
const waterSchema = z.object({ date: z.string(), ml: z.number() })
export const nutritionSchema = z.object({
  answers: answersSchema.nullable(),
  defaults: z.object({ sex: sexSchema.nullable(), age: z.number().nullable(), height_cm: z.number().nullable(), weight_kg: z.number().nullable() }),
  plan: planSchema.nullable(),
  water: waterSchema,
})

export type NutritionAnswers = z.infer<typeof answersSchema>
export type NutritionData = z.infer<typeof nutritionSchema>
export type FuelPlan = z.infer<typeof planSchema>
export type FuelDay = z.infer<typeof daySchema>
export type NutritionDefaults = NutritionData["defaults"]

export const loadNutrition = (signal?: AbortSignal) => apiRequest(`/nutrition?date=${localDay()}`, nutritionSchema, { signal })

export const saveNutrition = (answers: NutritionAnswers) =>
  apiRequest(`/nutrition?date=${localDay()}`, nutritionSchema, { method: "PUT", body: answers })

export const logWater = (date: string, ml: number) => apiRequest("/nutrition/water", waterSchema, { body: { date, ml } })
