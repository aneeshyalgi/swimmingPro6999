import { z } from "zod"
import { apiRequest } from "@/lib/api"

// GET /api/consents (backend/app/consents.py). health_required is false for athletes who joined before consents.
const consentsSchema = z.object({
  health_required: z.boolean(),
  health: z.object({ given_at: z.string().nullable().optional(), by: z.string().optional(), version: z.string().optional() }).nullable(),
  parental: z.boolean(),
  version: z.string(),
})
export type Consents = z.infer<typeof consentsSchema>

export const loadConsents = (signal?: AbortSignal) => apiRequest("/consents", consentsSchema, { signal })
export const agreeToHealthUse = () => apiRequest("/consents/health", consentsSchema, { method: "POST" })
/** Withdrawing deletes the Mind and Nutrition answers, check-ins and water log. */
export const withdrawHealthConsent = () => apiRequest("/consents/health", consentsSchema, { method: "DELETE" })
