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

// GET /api/consents/terms: an account made before tokens is asked to agree to the Terms with them (`required`), or, having
// said no, has its subscription end at `ends_at`.
const termsSchema = z.object({ required: z.boolean(), declined: z.boolean(), ends_at: z.string().nullable(), version: z.string() })
export type TermsState = z.infer<typeof termsSchema>

export const loadTermsState = (signal?: AbortSignal) => apiRequest("/consents/terms", termsSchema, { signal })
/** Agreeing to the Terms shown (`version`) starts tokens; not agreeing ends the subscription at the end of its billing
 *  period. Refused (409) if the Terms changed since. */
export const answerTerms = (version: string, agree: boolean) => apiRequest("/consents/terms", termsSchema, { body: { version, agree } })
