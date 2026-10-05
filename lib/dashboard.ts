import { z } from "zod"

const metricSchema = z.object({ label: z.string(), value: z.string(), detail: z.string() })

export const dashboardOverviewSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  today: z.array(z.object({
    category: z.string(),
    name: z.string(),
    time: z.string(),
    duration: z.string(),
    objective: z.string(),
    status: z.string(),
    basis: z.string(),
  })),
  training_status: z.array(metricSchema),
  weekly: z.array(metricSchema),
  zones: z.array(z.object({
    zone: z.string(),
    meters: z.number().nonnegative(),
    percentage: z.number().min(0).max(100),
  })),
  personal_bests: z.array(z.object({
    event: z.string(),
    course: z.string(),
    time: z.string(),
    target: z.string().nullable(),
  })),
  performance: z.array(metricSchema),
  insight: z.object({ title: z.string(), body: z.string(), basis: z.string() }),
})

const namedDescription = z.object({ name: z.string(), description: z.string() })
export const dashboardPlanSchema = z.object({
  phase: z.string(),
  phase_duration: z.string(),
  focus: z.string(),
  tags: z.array(z.string()),
}).passthrough()

/** Earlier plan sections (no longer displayed); kept for reference, not required to load the dashboard. */
export const legacyPlanSectionsSchema = z.object({
  swim: z.object({
    cycles: z.array(namedDescription),
    sessions: z.array(z.object({ type: z.string(), example: z.string(), frequency: z.string() })),
  }),
  gym: z.object({
    focus: z.string(),
    phases: z.array(namedDescription),
    exercises: z.array(z.object({ category: z.string(), exercises: z.array(z.string()) })),
  }),
  nutrition: z.object({
    daily_calories: z.number(),
    macros: z.object({ protein: z.string(), carbs: z.string(), fats: z.string() }),
    meal_timing: z.array(z.object({ meal: z.string(), focus: z.string(), example: z.string() })),
    hydration: z.string(),
  }),
  recovery: z.object({
    strategies: z.array(z.object({ type: z.string(), target: z.string(), tips: z.string() })),
  }),
})

export const dashboardResponseSchema = z.object({
  profile: z.object({
    full_name: z.string(),
    user_key: z.string(),
    age: z.number().nullable().optional(),
    swimmer_type: z.string().nullable().optional(),
    main_events: z.array(z.string()),
    swim_sessions_per_week: z.number(),
    gym_sessions_per_week: z.number(),
    one_year_goal: z.string().nullable().optional(),
    three_year_goal: z.string().nullable().optional(),
    weight: z.number().nullable().optional(),
    recommended_coaches: z.array(z.string()),
  }),
  plan: z.object({ plan: dashboardPlanSchema }),
  overview: dashboardOverviewSchema,
})

export type DashboardOverviewData = z.infer<typeof dashboardOverviewSchema>
export type DashboardPlan = z.infer<typeof dashboardPlanSchema>
