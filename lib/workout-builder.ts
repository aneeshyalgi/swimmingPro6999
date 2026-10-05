import type { BuilderExercise, BuilderSection, GymItem } from "@/lib/training"

/** A workout document as edited in the Workout Builder (mirrors the backend BuilderWorkout). */
export type BuilderDoc = {
  title: string
  date: string
  start_time: string | null
  end_time: string | null
  label: string
  location: string
  intensity: "Minimal" | "Moderate" | "Full"
  notes: string
  rationale: string
  coaching_notes: string
  sections: BuilderSection[]
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export const SECTION_KINDS: { kind: string; title: string; placeholder: string }[] = [
  { kind: "warmup", title: "Warm-Up", placeholder: "Raise the temperature: pulse raiser, mobility, activation…" },
  { kind: "activation", title: "Activation", placeholder: "Wake up the muscles you are about to train…" },
  { kind: "main", title: "Main Set", placeholder: "Your key lifts for today…" },
  { kind: "power", title: "Power", placeholder: "Explosive work: jumps, throws, fast reps…" },
  { kind: "accessory", title: "Accessory", placeholder: "Supporting exercises and weak links…" },
  { kind: "core", title: "Core", placeholder: "Trunk stiffness, anti-rotation, streamline strength…" },
  { kind: "conditioning", title: "Conditioning", placeholder: "Circuits and work capacity…" },
  { kind: "mobility", title: "Mobility", placeholder: "Range of motion and flexibility…" },
  { kind: "cooldown", title: "Cool-Down", placeholder: "Bring the heart rate down and stretch…" },
  { kind: "custom", title: "Custom Section", placeholder: "Anything you like…" },
]
export const placeholderFor = (kind: string) => SECTION_KINDS.find((item) => item.kind === kind)?.placeholder ?? "Write notes for this section…"

/** One-tap exercises for each section type (manual picks; no AI). */
export const QUICK_ADD: Record<string, string[]> = {
  warmup: ["Jump rope", "Arm circles", "Band pull-aparts", "World's greatest stretch", "Inchworms"],
  activation: ["Band external rotation", "Glute bridge", "Scapular push-up", "Dead bug"],
  main: ["Pull-up", "Push-up", "Goblet squat", "Romanian deadlift", "Bench press", "Bent-over row", "Split squat"],
  power: ["Box jump", "Broad jump", "Medicine ball slam", "Squat jump", "Clap push-up"],
  accessory: ["Face pull", "Lateral raise", "Single-leg RDL", "Band row", "Tricep dip"],
  core: ["Hollow body hold", "Plank", "Side plank", "Pallof press", "Sit-up", "Russian twist"],
  conditioning: ["Burpee", "Mountain climber", "Kettlebell swing", "Jumping jack"],
  mobility: ["Thoracic rotation", "Hip flexor stretch", "Shoulder dislocates", "Cat-cow"],
  cooldown: ["Child's pose", "Doorway pec stretch", "Hamstring stretch", "Easy walk"],
  custom: ["Push-up", "Plank", "Squat"],
}

export const exercise = (name = "", patch: Partial<BuilderExercise> = {}): BuilderExercise => ({
  name, sets: 3, reps: "10", load: "", rest_seconds: 60, tempo: "", notes: "", ...patch,
})
export const section = (kind: string, patch: Partial<BuilderSection> = {}): BuilderSection => ({
  id: uid(), kind, title: SECTION_KINDS.find((item) => item.kind === kind)?.title ?? "Section", notes: "", exercises: [], collapsed: false, ...patch,
})

export const blankDoc = (date: string): BuilderDoc => ({
  title: "", date, start_time: null, end_time: null, label: "", location: "", intensity: "Moderate",
  notes: "", rationale: "", coaching_notes: "",
  sections: [section("warmup"), section("main"), section("core"), section("cooldown")],
})

const ex = (name: string, sets: number, reps: string, load = "", rest = 60) => exercise(name, { sets, reps, load, rest_seconds: rest })

export const TEMPLATES: { name: string; description: string; build: () => Pick<BuilderDoc, "title" | "intensity" | "sections"> }[] = [
  { name: "Blank workout", description: "Empty sections to fill in", build: () => ({ title: "", intensity: "Moderate", sections: [section("warmup"), section("main"), section("core"), section("cooldown")] }) },
  { name: "Upper body pull", description: "Lats, back and shoulders", build: () => ({ title: "Upper Body Pull", intensity: "Full", sections: [
    section("warmup", { notes: "5 min easy cardio\nBand pull-aparts × 15\nArm circles × 20" }),
    section("main", { exercises: [ex("Pull-up", 4, "6-8", "Bodyweight", 120), ex("Bent-over row", 4, "8-10", "RPE 7", 90), ex("Face pull", 3, "12-15", "Light band", 60)] }),
    section("core", { exercises: [ex("Hollow body hold", 3, "30 s", "Bodyweight", 45), ex("Side plank", 3, "30 s / side", "Bodyweight", 45)] }),
    section("cooldown", { notes: "Child's pose 60 s\nDoorway pec stretch 30 s / side" }),
  ] }) },
  { name: "Lower body power", description: "Starts, turns and legs", build: () => ({ title: "Lower Body Power", intensity: "Full", sections: [
    section("warmup", { notes: "Leg swings × 10 / side\nWalking lunges × 10\nGlute bridges × 15" }),
    section("power", { exercises: [ex("Box jump", 4, "5", "Bodyweight", 90), ex("Broad jump", 3, "5", "Max effort", 90)] }),
    section("main", { exercises: [ex("Goblet squat", 4, "8", "RPE 7", 90), ex("Split squat", 3, "8 / leg", "RPE 7", 75), ex("Single-leg RDL", 3, "8 / leg", "Light", 60)] }),
    section("cooldown", { notes: "Hip flexor stretch 45 s / side\nHamstring stretch 45 s / side" }),
  ] }) },
  { name: "Full body", description: "A bit of everything", build: () => ({ title: "Full Body Strength", intensity: "Full", sections: [
    section("warmup", { notes: "Jump rope 3 min\nWorld's greatest stretch × 5 / side" }),
    section("main", { exercises: [ex("Push-up", 4, "10-12", "Bodyweight", 75), ex("Goblet squat", 4, "10", "RPE 7", 75), ex("Band row", 4, "12", "Medium band", 60)] }),
    section("core", { exercises: [ex("Plank", 3, "45 s", "Bodyweight", 45), ex("Russian twist", 3, "20", "Bodyweight", 45)] }),
    section("cooldown", { notes: "Full-body stretch 5 min" }),
  ] }) },
  { name: "Core & mobility", description: "Short recovery session", build: () => ({ title: "Core & Mobility", intensity: "Minimal", sections: [
    section("mobility", { exercises: [ex("Thoracic rotation", 2, "10 / side", "Bodyweight", 30), ex("Cat-cow", 2, "10", "Bodyweight", 30), ex("Shoulder dislocates", 2, "12", "Light band", 30)] }),
    section("core", { exercises: [ex("Dead bug", 3, "10 / side", "Bodyweight", 45), ex("Pallof press", 3, "12 / side", "Light band", 45)] }),
    section("cooldown", { notes: "Box breathing 2 min" }),
  ] }) },
  { name: "Bodyweight circuit", description: "No equipment needed", build: () => ({ title: "Bodyweight Circuit", intensity: "Moderate", sections: [
    section("warmup", { notes: "Jumping jacks 60 s\nInchworms × 6" }),
    section("conditioning", { notes: "3 rounds, 60 s rest between rounds", exercises: [ex("Burpee", 3, "10", "Bodyweight", 20), ex("Mountain climber", 3, "30 s", "Bodyweight", 20), ex("Squat jump", 3, "12", "Bodyweight", 20), ex("Push-up", 3, "12", "Bodyweight", 20)] }),
    section("cooldown", { notes: "Easy walk 3 min\nStretch 5 min" }),
  ] }) },
]

/** Builder document for any saved workout; AI workouts become warm-up / main / cool-down sections. */
export function docFromItem(item: GymItem): BuilderDoc {
  const workout = item.workout
  const sections = workout.sections?.length ? workout.sections.map((entry) => ({ ...entry, exercises: entry.exercises.map((row) => ({ ...row })) })) : [
    section("warmup", { notes: workout.warm_up.join("\n") }),
    section("main", { exercises: workout.exercises.map((row) => exercise(row.exercise, {
      sets: row.sets, reps: row.repetitions, load: row.load, rest_seconds: row.rest_seconds, tempo: row.tempo ?? "",
      notes: [row.demonstration.join(" "), row.swim_benefit].filter(Boolean).join(" — "),
    })) }),
    section("cooldown", { notes: workout.cool_down.join("\n") }),
  ]
  return {
    title: workout.title, date: item.date, start_time: workout.meta?.start_time ?? null, end_time: workout.meta?.end_time ?? null,
    label: workout.meta?.label ?? "", location: workout.meta?.location ?? "",
    intensity: (["Minimal", "Moderate", "Full"].includes(workout.intensity) ? workout.intensity : "Moderate") as BuilderDoc["intensity"],
    notes: workout.objective, rationale: workout.rationale, coaching_notes: workout.coaching_notes, sections,
  }
}

const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))

export function docSummary(doc: BuilderDoc) {
  const rows = doc.sections.flatMap((entry) => entry.exercises)
  const sets = rows.reduce((sum, row) => sum + (row.sets || 0), 0)
  const estimate = Math.round(rows.reduce((sum, row) => sum + (row.sets || 0) * (40 + (row.rest_seconds || 0)), 0) / 60) + 5
  const scheduled = doc.start_time && doc.end_time ? toMinutes(doc.end_time) - toMinutes(doc.start_time) : null
  return { exercises: rows.length, sets, minutes: scheduled && scheduled > 0 ? scheduled : estimate, scheduled: !!(scheduled && scheduled > 0) }
}

export const sectionStats = (entry: BuilderSection) => ({
  exercises: entry.exercises.length, sets: entry.exercises.reduce((sum, row) => sum + (row.sets || 0), 0),
})

/** What the API expects (empty exercise rows are dropped, text trimmed). */
export function docPayload(doc: BuilderDoc) {
  return {
    ...doc, title: doc.title.trim() || "Untitled workout",
    start_time: doc.start_time || null, end_time: doc.end_time || null,
    sections: doc.sections.map((entry) => ({
      ...entry, title: entry.title.trim() || "Section",
      exercises: entry.exercises.filter((row) => row.name.trim()).map((row) => ({ ...row, name: row.name.trim(), sets: Math.max(1, Math.min(20, row.sets || 1)) })),
    })),
  }
}

export const isBlank = (doc: BuilderDoc) => !doc.title.trim() && doc.sections.every((entry) => !entry.notes.trim() && !entry.exercises.some((row) => row.name.trim()))
