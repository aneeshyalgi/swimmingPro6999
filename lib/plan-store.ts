import { z } from "zod"
import { supabase } from "@/lib/supabase"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export const ACCENTS = ["cyan", "violet", "sky", "emerald", "amber", "rose"] as const
export type Accent = (typeof ACCENTS)[number]

const planSchema = z.object({
  id: z.string(),
  title: z.string(),
  tagline: z.string(),
  category: z.string(),
  level: z.string(),
  weeks: z.number(),
  sessions_per_week: z.number(),
  pages: z.number(),
  price: z.number(),
  currency: z.string(),
  accent: z.enum(ACCENTS).catch("cyan"),
  badge: z.string().nullable(),
  events: z.array(z.string()),
  includes: z.array(z.string()),
  sample_week: z.array(z.tuple([z.string(), z.string()])),
})
export type StorePlan = z.infer<typeof planSchema>

const catalogSchema = z.object({ categories: z.array(z.string()), plans: z.array(planSchema) })
export type Catalog = z.infer<typeof catalogSchema>

const verifySchema = z.object({ paid: z.boolean(), plan: planSchema, email: z.string().nullable(), amount_total: z.number().nullable() })
export type PlanPurchase = z.infer<typeof verifySchema>

/** Colours for each plan's cover: [light, main, deep rgb] */
export const ACCENT_COLORS: Record<Accent, { light: string; main: string; rgb: string }> = {
  cyan: { light: "#a5f3fc", main: "#22d3ee", rgb: "34,211,238" },
  violet: { light: "#ddd6fe", main: "#a78bfa", rgb: "167,139,250" },
  sky: { light: "#bae6fd", main: "#38bdf8", rgb: "56,189,248" },
  emerald: { light: "#a7f3d0", main: "#34d399", rgb: "52,211,153" },
  amber: { light: "#fde68a", main: "#fbbf24", rgb: "251,191,36" },
  rose: { light: "#fecdd3", main: "#fb7185", rgb: "251,113,133" },
}

export const formatPrice = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100)

async function readError(response: Response) {
  const text = await response.text()
  try {
    const detail = JSON.parse(text)?.detail
    if (typeof detail === "string") return detail
  } catch {}
  return text || `Request failed (${response.status})`
}

export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch(`${API_URL}/api/plans/catalog`)
  if (!response.ok) throw new Error(await readError(response))
  return catalogSchema.parse(await response.json())
}

/** Creates a Stripe Checkout session for one plan and sends the browser there. Signed-in buyers are linked to their account. */
export async function startPlanCheckout(planId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${API_URL}/api/plans/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ plan_id: planId }),
  })
  if (!response.ok) throw new Error(await readError(response))
  const { checkout_url } = (await response.json()) as { checkout_url: string }
  window.location.assign(checkout_url)
}

export async function verifyPlanPurchase(sessionId: string): Promise<PlanPurchase> {
  const response = await fetch(`${API_URL}/api/plans/verify/${encodeURIComponent(sessionId)}`)
  if (!response.ok) throw new Error(await readError(response))
  return verifySchema.parse(await response.json())
}
