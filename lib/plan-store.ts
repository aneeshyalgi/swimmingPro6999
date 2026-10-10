import { z } from "zod"
import type { Book } from "@/lib/plan-book"
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

const verifySchema = z.object({
  paid: z.boolean(), plan: planSchema, email: z.string().nullable(), amount_total: z.number().nullable(),
  /** Bought with a SwimGPT account, so it's saved to that account. */
  account: z.boolean().catch(false),
})
export type PlanPurchase = z.infer<typeof verifySchema>

const purchasesSchema = z.object({
  purchases: z.array(z.object({ plan_id: z.string(), plan_title: z.string(), amount: z.number(), currency: z.string(), paid_at: z.string().nullable() })),
})
export type OwnedPlan = z.infer<typeof purchasesSchema>["purchases"][number]

/** Buying a plan needs a SwimGPT account (only that: no subscription or setup). Thrown when nobody is signed in. */
export class SignInRequired extends Error {}

export class PlanStoreError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Colours for each plan's cover: [light, main, deep rgb] */
export const ACCENT_COLORS: Record<Accent, { light: string; main: string; rgb: string }> = {
  cyan: { light: "#a5f3fc", main: "#22d3ee", rgb: "34,211,238" },
  violet: { light: "#ddd6fe", main: "#a78bfa", rgb: "167,139,250" },
  sky: { light: "#bae6fd", main: "#38bdf8", rgb: "56,189,248" },
  emerald: { light: "#a7f3d0", main: "#34d399", rgb: "52,211,153" },
  amber: { light: "#fde68a", main: "#fbbf24", rgb: "251,191,36" },
  rose: { light: "#fecdd3", main: "#fb7185", rgb: "251,113,133" },
}

/** Where a bought plan is read. */
export const readerHref = (planId: string) => `/training-plans/read/${encodeURIComponent(planId)}`

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

/** Creates a Stripe Checkout session for one plan and sends the browser there. The purchase is saved to the signed-in
 * account; with nobody signed in this throws SignInRequired. */
export async function startPlanCheckout(planId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new SignInRequired("Sign in to buy a plan.")
  const response = await fetch(`${API_URL}/api/plans/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ plan_id: planId }),
  })
  if (response.status === 401) throw new SignInRequired(await readError(response))
  if (!response.ok) throw new PlanStoreError(await readError(response), response.status)
  const { checkout_url } = (await response.json()) as { checkout_url: string }
  window.location.assign(checkout_url)
}

/** The plans the signed-in account has bought (none when nobody is signed in). */
export async function fetchPurchases(): Promise<OwnedPlan[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []
  const response = await fetch(`${API_URL}/api/plans/purchases`, { headers: { Authorization: `Bearer ${session.access_token}` } })
  if (!response.ok) throw new PlanStoreError(await readError(response), response.status)
  return purchasesSchema.parse(await response.json()).purchases
}

export async function verifyPlanPurchase(sessionId: string): Promise<PlanPurchase> {
  const response = await fetch(`${API_URL}/api/plans/verify/${encodeURIComponent(sessionId)}`)
  if (!response.ok) throw new Error(await readError(response))
  return verifySchema.parse(await response.json())
}

/** The book of a plan the signed-in account bought: every page, to read in SwimGPT (never a PDF). Throws SignInRequired
 * with nobody signed in, and PlanStoreError otherwise (403: this account didn't buy it; 404: the plan has no book). */
export async function fetchPlanBook(planId: string): Promise<Book> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new SignInRequired("Sign in to read your plan.")
  const response = await fetch(`${API_URL}/api/plans/${encodeURIComponent(planId)}/book`, {
    headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
  })
  if (response.status === 401) throw new SignInRequired(await readError(response))
  if (!response.ok) throw new PlanStoreError(await readError(response), response.status)
  const book = (await response.json()) as Book
  if (book?.format !== 1 || !Array.isArray(book.pages) || !book.pages.length) {
    throw new PlanStoreError("This plan couldn't be opened in this version of SwimGPT. Refresh the page and try again.", 500)
  }
  return book
}

/** Look inside: a plan's first two pages after the cover, which anyone can see, as a small book for BookPage. */
export type PlanPreviewPages = { book: Book; images: Record<string, string>; firstPage: number; pageCount: number }

const previews = new Map<string, Promise<PlanPreviewPages>>()

/** Fetched once per plan and kept; a failed fetch is forgotten so the next attempt retries. */
export function fetchPlanPreview(planId: string): Promise<PlanPreviewPages> {
  const cached = previews.get(planId)
  if (cached) return cached
  const pending = (async () => {
    const response = await fetch(`${API_URL}/api/plans/${encodeURIComponent(planId)}/preview`)
    if (!response.ok) throw new Error(await readError(response))
    const preview = await response.json()
    if (preview?.format !== 1 || !Array.isArray(preview.pages) || !preview.pages.length) throw new Error("This preview couldn't be shown.")
    const book: Book = { format: 1, plan_id: preview.plan_id, size: preview.size, fonts: preview.fonts, images: preview.images, pages: preview.pages, toc: [], sessions: [] }
    const images = Object.fromEntries(Object.entries(book.images).map(([key, image]) => [key, image.src]))
    return { book, images, firstPage: Number(preview.first_page) || 0, pageCount: Number(preview.page_count) || book.pages.length }
  })()
  previews.set(planId, pending)
  pending.catch(() => previews.delete(planId))
  return pending
}

/** Starts loading a plan's Look inside pages ahead of time (on hover), so they're there when the details open. */
export const prefetchPlanPreview = (planId: string) => { fetchPlanPreview(planId).catch(() => {}) }
